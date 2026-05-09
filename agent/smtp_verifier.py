"""
smtp_verifier.py — Async SMTP handshake verifier using raw asyncio TCP
Performs EHLO → MAIL FROM → RCPT TO → QUIT without sending a message.
"""
import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

@dataclass
class SmtpResult:
    email: str
    domain: str
    smtp_code: Optional[int]
    smtp_message: str
    connected: bool
    is_catch_all: bool = False
    error: Optional[str] = None


async def _readline(reader: asyncio.StreamReader, timeout: float = 10.0) -> str:
    """Read a (potentially multi-line) SMTP response."""
    lines = []
    while True:
        try:
            line = await asyncio.wait_for(reader.readline(), timeout=timeout)
            decoded = line.decode(errors='replace').rstrip('\r\n')
            lines.append(decoded)
            # Multi-line responses have a dash after the code: "250-OK"
            # Single/last line has a space: "250 OK"
            if len(decoded) < 4 or decoded[3] != '-':
                break
        except asyncio.TimeoutError:
            break
    return '\n'.join(lines)


def _parse_code(response: str) -> Optional[int]:
    """Extract numeric SMTP code from response string."""
    match = re.match(r'^(\d{3})', response.strip())
    return int(match.group(1)) if match else None


async def verify_email(
    email: str,
    mx_host: str,
    helo_hostname: str,
    from_address: str,
    source_ip: Optional[str] = None,
    timeout: float = 30.0,
    port: int = 25,
) -> SmtpResult:
    """
    Perform an SMTP handshake to verify email existence.
    Does NOT send any email — quits immediately after RCPT TO.
    """
    domain = email.split('@')[1] if '@' in email else email

    try:
        # Open TCP connection
        open_coro = asyncio.open_connection(mx_host, port)
        reader, writer = await asyncio.wait_for(open_coro, timeout=timeout)

        async def send(cmd: str) -> str:
            writer.write((cmd + '\r\n').encode())
            await writer.drain()
            return await _readline(reader, timeout)

        # 220 banner
        banner = await _readline(reader, timeout)
        code = _parse_code(banner)
        if code != 220:
            writer.close()
            return SmtpResult(email, domain, code, banner, connected=False)

        # EHLO
        resp = await send(f'EHLO {helo_hostname}')
        if _parse_code(resp) not in (250, 220):
            # Try HELO fallback
            resp = await send(f'HELO {helo_hostname}')

        # MAIL FROM
        resp = await send(f'MAIL FROM:<{from_address}>')
        if _parse_code(resp) not in (250, 200):
            writer.close()
            return SmtpResult(email, domain, _parse_code(resp), resp, connected=True)

        # RCPT TO — this is the key check
        resp = await send(f'RCPT TO:<{email}>')
        code = _parse_code(resp)

        # QUIT cleanly
        try:
            await send('QUIT')
            writer.close()
        except Exception:
            pass

        return SmtpResult(email, domain, code, resp, connected=True)

    except asyncio.TimeoutError:
        return SmtpResult(email, domain, None, 'Connection timeout', connected=False, error='timeout')
    except ConnectionRefusedError:
        return SmtpResult(email, domain, None, 'Connection refused', connected=False, error='refused')
    except OSError as e:
        return SmtpResult(email, domain, None, str(e), connected=False, error='network')
    except Exception as e:
        logger.error(f"SMTP verify error for {email}: {e}")
        return SmtpResult(email, domain, None, str(e), connected=False, error='unknown')
