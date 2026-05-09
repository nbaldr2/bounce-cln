"""
catchall_detector.py — Detect catch-all domains before verifying real emails.
Probes a random email address and if it returns 250, domain is catch-all.
"""
import asyncio
import random
import string
import logging
from smtp_verifier import verify_email

logger = logging.getLogger(__name__)

# In-memory cache: domain -> is_catch_all (True/False)
_cache: dict[str, bool] = {}


def _random_email(domain: str) -> str:
    """Generate a highly unlikely email address for probing."""
    prefix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=12))
    return f"{prefix}@{domain}"


async def is_catch_all(
    domain: str,
    mx_host: str,
    helo_hostname: str,
    from_address: str,
    timeout: float = 20.0,
) -> bool:
    """
    Returns True if the domain accepts all email addresses (catch-all).
    Results are cached in-memory for the lifetime of the agent process.
    """
    if domain in _cache:
        return _cache[domain]

    probe_email = _random_email(domain)
    logger.info(f"Catch-all probe: {probe_email} on {mx_host}")

    result = await verify_email(
        email=probe_email,
        mx_host=mx_host,
        helo_hostname=helo_hostname,
        from_address=from_address,
        timeout=timeout,
    )

    # If 250 returned for a random address → catch-all
    catch_all = result.smtp_code == 250
    _cache[domain] = catch_all

    if catch_all:
        logger.warning(f"Catch-all domain detected: {domain}")

    return catch_all


def clear_cache():
    _cache.clear()
