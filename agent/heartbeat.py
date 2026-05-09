"""
heartbeat.py — Periodic heartbeat reporter to the master API.
Sends CPU, memory, and queue depth every HEARTBEAT_INTERVAL seconds.
"""
import asyncio
import json
import logging
import os
import time
import hashlib
import hmac

import aiohttp
import psutil

logger = logging.getLogger(__name__)

MASTER_API_URL = os.getenv("MASTER_API_URL", "http://localhost:4000")
NODE_ID        = os.getenv("NODE_ID", "")
HMAC_SECRET    = os.getenv("HMAC_SECRET", "dev-hmac-secret")
INTERVAL       = int(os.getenv("HEARTBEAT_INTERVAL", "30"))


def _sign(body: str, timestamp: int) -> str:
    payload = f"{timestamp}.{body}"
    return hmac.new(HMAC_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


async def send_heartbeat(session: aiohttp.ClientSession, queue_depth: int = 0):
    cpu    = psutil.cpu_percent(interval=1)
    memory = psutil.virtual_memory().percent

    body = json.dumps({
        "cpuUsage":    cpu,
        "memoryUsage": memory,
        "queueDepth":  queue_depth,
    })
    timestamp = int(time.time())
    signature = _sign(body, timestamp)

    headers = {
        "Content-Type":     "application/json",
        "X-HMAC-Signature": signature,
        "X-HMAC-Timestamp": str(timestamp),
        "X-Node-Id":        NODE_ID,
    }

    try:
        async with session.post(
            f"{MASTER_API_URL}/api/nodes/heartbeat",
            data=body,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status != 200:
                logger.warning(f"Heartbeat rejected: {resp.status}")
    except Exception as e:
        logger.warning(f"Heartbeat failed: {e}")


async def heartbeat_loop(get_queue_depth_fn=None):
    async with aiohttp.ClientSession() as session:
        while True:
            depth = get_queue_depth_fn() if get_queue_depth_fn else 0
            await send_heartbeat(session, depth)
            await asyncio.sleep(INTERVAL)
