"""
agent.py — Main verification agent loop.

Responsibilities:
  1. Send heartbeats to master every 30s
  2. Poll master for assigned jobs
  3. Resolve MX records for each batch domain
  4. Detect catch-all domains before verifying real emails
  5. Run async SMTP verification with concurrency control
  6. Classify results via bounce code map
  7. POST results back to master (HMAC-signed)
"""
import asyncio
import json
import logging
import os
import time
import hashlib
import hmac as hmac_lib
from collections import defaultdict
from typing import Optional

import aiohttp
import aiodns

from smtp_verifier import verify_email
from catchall_detector import is_catch_all
from bounce_codes import classify
from heartbeat import heartbeat_loop

# ── Config ───────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("agent")

MASTER_API_URL  = os.getenv("MASTER_API_URL",  "http://localhost:4000")
NODE_ID         = os.getenv("NODE_ID",          "")
HMAC_SECRET     = os.getenv("HMAC_SECRET",      "dev-hmac-secret")
HELO_HOSTNAME   = os.getenv("HELO_HOSTNAME",    "mail.bounce-cln.local")
FROM_ADDRESS    = os.getenv("FROM_ADDRESS",     "probe@bounce-cln.local")
CONCURRENCY     = int(os.getenv("CONCURRENCY",  "50"))
POLL_INTERVAL   = int(os.getenv("POLL_INTERVAL","5"))

# ── Auth helpers ──────────────────────────────────────────────────────────

def _sign(body: str, timestamp: int) -> str:
    payload = f"{timestamp}.{body}"
    return hmac_lib.new(HMAC_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _auth_headers(body: str) -> dict:
    ts = int(time.time())
    return {
        "Content-Type":     "application/json",
        "X-HMAC-Signature": _sign(body, ts),
        "X-HMAC-Timestamp": str(ts),
        "X-Node-Id":        NODE_ID,
    }

# ── MX resolution ─────────────────────────────────────────────────────────

async def resolve_mx(resolver: aiodns.DNSResolver, domain: str) -> Optional[str]:
    try:
        records = await resolver.query(domain, "MX")
        if records:
            # Sort by priority, pick lowest
            best = sorted(records, key=lambda r: r.priority)[0]
            return best.host.rstrip('.')
    except Exception as e:
        logger.debug(f"MX lookup failed for {domain}: {e}")
    return None

# ── Job processing ─────────────────────────────────────────────────────────

_queue_depth = 0


async def process_job(session: aiohttp.ClientSession, resolver: aiodns.DNSResolver, job: dict):
    global _queue_depth
    job_id = job["id"]
    emails = job["emails"]
    _queue_depth += len(emails)

    logger.info(f"Processing job {job_id}: {len(emails)} emails")

    # Group emails by domain
    domain_emails: dict[str, list[str]] = defaultdict(list)
    for email in emails:
        if "@" in email:
            domain_emails[email.split("@")[1].lower()].append(email)

    # Resolve MX for each unique domain
    mx_map: dict[str, Optional[str]] = {}
    for domain in domain_emails:
        mx_map[domain] = await resolve_mx(resolver, domain)

    # Check catch-all domains first
    catch_all_domains: set[str] = set()
    for domain, mx in mx_map.items():
        if mx:
            if await is_catch_all(domain, mx, HELO_HOSTNAME, FROM_ADDRESS):
                catch_all_domains.add(domain)

    # Verify emails with concurrency limit
    semaphore = asyncio.Semaphore(CONCURRENCY)
    results = []

    async def verify_one(email: str):
        domain = email.split("@")[1].lower()
        mx = mx_map.get(domain)

        # Catch-all: mark immediately without SMTP
        if domain in catch_all_domains:
            results.append({
                "email": email, "domain": domain,
                "mxProvider": None, "smtpCode": 250,
                "smtpMessage": "Catch-all domain detected",
                "isCatchAll": True,
            })
            return

        # No MX record = invalid domain
        if not mx:
            results.append({
                "email": email, "domain": domain,
                "mxProvider": None, "smtpCode": 550,
                "smtpMessage": "No MX record found",
                "isCatchAll": False,
            })
            return

        async with semaphore:
            smtp = await verify_email(
                email=email,
                mx_host=mx,
                helo_hostname=HELO_HOSTNAME,
                from_address=FROM_ADDRESS,
                timeout=30.0,
            )
            results.append({
                "email":      email,
                "domain":     domain,
                "mxProvider": None,  # master classifies from MX host
                "smtpCode":   smtp.smtp_code,
                "smtpMessage": smtp.smtp_message[:255] if smtp.smtp_message else None,
                "isCatchAll": False,
            })

    await asyncio.gather(*[verify_one(e) for e in emails])

    # POST results back to master
    body = json.dumps({"jobId": job_id, "results": results})
    headers = _auth_headers(body)

    try:
        async with session.post(
            f"{MASTER_API_URL}/api/results",
            data=body,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=60),
        ) as resp:
            if resp.status == 200:
                logger.info(f"Job {job_id} — posted {len(results)} results ✓")
            else:
                text = await resp.text()
                logger.error(f"Result POST failed [{resp.status}]: {text}")
    except Exception as e:
        logger.error(f"Failed to post results for job {job_id}: {e}")

    _queue_depth -= len(emails)
    if _queue_depth < 0:
        _queue_depth = 0


# ── Poll loop ─────────────────────────────────────────────────────────────

async def poll_jobs(session: aiohttp.ClientSession, resolver: aiodns.DNSResolver):
    while True:
        try:
            async with session.get(
                f"{MASTER_API_URL}/api/jobs/node/{NODE_ID}",
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    jobs = await resp.json()
                    if jobs:
                        logger.info(f"Fetched {len(jobs)} job(s)")
                        for job in jobs:
                            asyncio.create_task(process_job(session, resolver, job))
        except Exception as e:
            logger.warning(f"Poll failed: {e}")

        await asyncio.sleep(POLL_INTERVAL)


# ── Main ──────────────────────────────────────────────────────────────────

async def main():
    if not NODE_ID:
        logger.error("NODE_ID is not set. Cannot start agent.")
        return

    logger.info(f"Agent starting — NODE_ID={NODE_ID} → {MASTER_API_URL}")

    resolver = aiodns.DNSResolver(nameservers=["8.8.8.8", "1.1.1.1"])

    async with aiohttp.ClientSession() as session:
        await asyncio.gather(
            heartbeat_loop(get_queue_depth_fn=lambda: _queue_depth),
            poll_jobs(session, resolver),
        )


if __name__ == "__main__":
    asyncio.run(main())
