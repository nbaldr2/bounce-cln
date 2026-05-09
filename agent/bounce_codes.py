"""
bounce_codes.py — Full RFC 5321 SMTP response code map
"""
from dataclasses import dataclass
from typing import Optional

@dataclass
class BounceInfo:
    status: str          # VALID | INVALID | SOFT_BOUNCE | GREYLISTED | UNKNOWN | TIMEOUT | CATCH_ALL
    action: str          # keep | suppress | retry | flag_unknown
    category: str
    description: str

BOUNCE_MAP: dict[int, BounceInfo] = {
    # 2xx — Success
    200: BounceInfo("VALID",       "keep",         "Success",          "Generic success"),
    250: BounceInfo("VALID",       "keep",         "Success",          "Requested action completed"),
    251: BounceInfo("VALID",       "keep",         "Forwarded",        "User not local; will forward"),
    252: BounceInfo("UNKNOWN",     "flag_unknown", "Cannot Verify",    "Cannot VRFY user but will accept"),

    # 4xx — Temporary failures
    421: BounceInfo("GREYLISTED",  "retry",        "Temp block",       "Service not available, greylisting"),
    422: BounceInfo("SOFT_BOUNCE", "retry",        "Mailbox full",     "Recipient mailbox full"),
    431: BounceInfo("SOFT_BOUNCE", "retry",        "Server full",      "Not enough space on server"),
    442: BounceInfo("GREYLISTED",  "retry",        "Connection drop",  "Connection dropped during transmission"),
    450: BounceInfo("SOFT_BOUNCE", "retry",        "Mailbox unavail",  "Mailbox unavailable (busy/blocked)"),
    451: BounceInfo("SOFT_BOUNCE", "retry",        "Server error",     "Requested action aborted: local error"),
    452: BounceInfo("SOFT_BOUNCE", "retry",        "Storage full",     "Insufficient system storage"),

    # 5xx — Permanent failures
    500: BounceInfo("INVALID",     "suppress",     "Syntax error",     "Syntax error, command unrecognized"),
    501: BounceInfo("INVALID",     "suppress",     "Syntax error",     "Syntax error in parameters"),
    502: BounceInfo("INVALID",     "suppress",     "Not implemented",  "Command not implemented"),
    503: BounceInfo("INVALID",     "suppress",     "Bad sequence",     "Bad sequence of commands"),
    510: BounceInfo("INVALID",     "suppress",     "Bad address",      "Bad email address"),
    511: BounceInfo("INVALID",     "suppress",     "Bad address",      "Bad email address"),
    512: BounceInfo("INVALID",     "suppress",     "DNS error",        "Host server not found"),
    521: BounceInfo("INVALID",     "suppress",     "No mail",          "Host does not accept mail"),
    541: BounceInfo("INVALID",     "suppress",     "Rejected",         "Recipient address rejected"),
    550: BounceInfo("INVALID",     "suppress",     "User not found",   "Mailbox unavailable / user not found"),
    551: BounceInfo("INVALID",     "suppress",     "Not local",        "User not local"),
    552: BounceInfo("INVALID",     "suppress",     "Storage exceeded", "Exceeded storage allocation"),
    553: BounceInfo("INVALID",     "suppress",     "Name invalid",     "Mailbox name not allowed"),
    554: BounceInfo("INVALID",     "suppress",     "Tx failed",        "Transaction failed / no routing"),
    556: BounceInfo("INVALID",     "suppress",     "Domain no mail",   "Domain does not accept mail"),
}


def classify(smtp_code: Optional[int], smtp_message: str = "") -> BounceInfo:
    if smtp_code is None:
        return BounceInfo("TIMEOUT", "flag_unknown", "No response", "Connection timeout or no response")

    if smtp_code in BOUNCE_MAP:
        return BOUNCE_MAP[smtp_code]

    # Fallback by range
    if 200 <= smtp_code < 300:
        return BounceInfo("VALID",       "keep",         "Success",   f"Success {smtp_code}")
    if 400 <= smtp_code < 500:
        return BounceInfo("SOFT_BOUNCE", "retry",        "Temp fail", f"Temp failure {smtp_code}")
    if 500 <= smtp_code < 600:
        return BounceInfo("INVALID",     "suppress",     "Perm fail", f"Permanent failure {smtp_code}")

    # Content-based hints
    msg = smtp_message.lower()
    if "greylist" in msg or "try again" in msg:
        return BounceInfo("GREYLISTED",  "retry",        "Greylisting", "Greylisting detected in message")
    if "blocked" in msg or "blacklist" in msg:
        return BounceInfo("UNKNOWN",     "flag_unknown", "IP blocked",  "IP appears blocked")

    return BounceInfo("UNKNOWN", "flag_unknown", "Unclassified", f"Unknown code {smtp_code}")
