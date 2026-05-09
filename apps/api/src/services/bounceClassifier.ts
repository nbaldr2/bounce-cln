import { VerifyStatus } from '@prisma/client';

interface BounceClassification {
  status: VerifyStatus;
  category: string;
  action: 'keep' | 'retry' | 'suppress' | 'flag_unknown' | 'flag_catchall';
  description: string;
}

/**
 * Full RFC 5321 SMTP response code classification map.
 * Covers all standard and common extended codes.
 */
const BOUNCE_MAP: Record<number, BounceClassification> = {
  // ─── 2xx: Success ─────────────────────────────────
  200: { status: 'VALID', category: 'Success', action: 'keep', description: 'Generic success' },
  250: { status: 'VALID', category: 'Success', action: 'keep', description: 'Requested action completed' },
  251: { status: 'VALID', category: 'Forwarded', action: 'keep', description: 'User not local; will forward' },
  252: { status: 'VALID', category: 'Cannot verify', action: 'flag_unknown', description: 'Cannot VRFY user but will accept' },

  // ─── 4xx: Temporary Failures ──────────────────────
  421: { status: 'GREYLISTED', category: 'Temp block / greylisting', action: 'retry', description: 'Service not available, try again later' },
  422: { status: 'SOFT_BOUNCE', category: 'Mailbox full', action: 'retry', description: 'Recipient mailbox full' },
  431: { status: 'SOFT_BOUNCE', category: 'Server full', action: 'retry', description: 'Not enough space on server' },
  442: { status: 'GREYLISTED', category: 'Connection dropped', action: 'retry', description: 'Connection dropped during transmission' },
  450: { status: 'SOFT_BOUNCE', category: 'Mailbox unavailable', action: 'retry', description: 'Mailbox unavailable (busy or blocked)' },
  451: { status: 'SOFT_BOUNCE', category: 'Server error', action: 'retry', description: 'Requested action aborted: local error' },
  452: { status: 'SOFT_BOUNCE', category: 'Mailbox full', action: 'retry', description: 'Insufficient system storage' },

  // ─── 5xx: Permanent Failures ──────────────────────
  500: { status: 'INVALID', category: 'Syntax error', action: 'suppress', description: 'Syntax error, command unrecognized' },
  501: { status: 'INVALID', category: 'Syntax error', action: 'suppress', description: 'Syntax error in parameters' },
  502: { status: 'INVALID', category: 'Command not implemented', action: 'suppress', description: 'Command not implemented' },
  503: { status: 'INVALID', category: 'Bad sequence', action: 'suppress', description: 'Bad sequence of commands' },
  510: { status: 'INVALID', category: 'Bad address', action: 'suppress', description: 'Bad email address' },
  511: { status: 'INVALID', category: 'Bad address', action: 'suppress', description: 'Bad email address' },
  512: { status: 'INVALID', category: 'DNS error', action: 'suppress', description: 'Host server not found' },
  521: { status: 'INVALID', category: 'Does not accept mail', action: 'suppress', description: 'Host does not accept mail' },
  523: { status: 'INVALID', category: 'Size limit', action: 'suppress', description: 'Message size exceeds limits' },
  530: { status: 'INVALID', category: 'Auth required', action: 'suppress', description: 'Authentication required' },
  541: { status: 'INVALID', category: 'Rejected', action: 'suppress', description: 'Recipient address rejected' },
  550: { status: 'INVALID', category: 'User not found', action: 'suppress', description: 'Requested action not taken: mailbox unavailable' },
  551: { status: 'INVALID', category: 'User not local', action: 'suppress', description: 'User not local' },
  552: { status: 'INVALID', category: 'Storage exceeded', action: 'suppress', description: 'Exceeded storage allocation' },
  553: { status: 'INVALID', category: 'Mailbox name invalid', action: 'suppress', description: 'Mailbox name not allowed' },
  554: { status: 'INVALID', category: 'Transaction failed', action: 'suppress', description: 'Transaction failed' },
  556: { status: 'INVALID', category: 'Domain not found', action: 'suppress', description: 'Domain does not accept mail' },
};

/**
 * Classify an SMTP response code into a verification status.
 */
export function classifyBounce(smtpCode: number | null, smtpMessage?: string): BounceClassification {
  if (smtpCode === null || smtpCode === undefined) {
    return {
      status: 'TIMEOUT',
      category: 'No response',
      action: 'flag_unknown',
      description: 'Connection timeout or no response',
    };
  }

  // Direct code match
  if (BOUNCE_MAP[smtpCode]) {
    return BOUNCE_MAP[smtpCode];
  }

  // Fallback by range
  if (smtpCode >= 200 && smtpCode < 300) {
    return { status: 'VALID', category: 'Success', action: 'keep', description: `Success code ${smtpCode}` };
  }
  if (smtpCode >= 400 && smtpCode < 500) {
    return { status: 'SOFT_BOUNCE', category: 'Temporary failure', action: 'retry', description: `Temp failure ${smtpCode}` };
  }
  if (smtpCode >= 500 && smtpCode < 600) {
    return { status: 'INVALID', category: 'Permanent failure', action: 'suppress', description: `Permanent failure ${smtpCode}` };
  }

  // Check message content for additional clues
  const msg = (smtpMessage || '').toLowerCase();
  if (msg.includes('greylist') || msg.includes('try again')) {
    return { status: 'GREYLISTED', category: 'Greylisting', action: 'retry', description: 'Greylisting detected in message' };
  }
  if (msg.includes('blocked') || msg.includes('blacklist') || msg.includes('spamhaus')) {
    return { status: 'UNKNOWN', category: 'IP blocked', action: 'flag_unknown', description: 'IP appears blocked' };
  }

  return {
    status: 'UNKNOWN',
    category: 'Unclassified',
    action: 'flag_unknown',
    description: `Unknown code ${smtpCode}`,
  };
}

/**
 * Determine the MX provider from a domain's MX record hostname.
 */
export function detectMxProvider(mxHost: string): string {
  const h = mxHost.toLowerCase();
  if (h.includes('google') || h.includes('gmail')) return 'gmail';
  if (h.includes('outlook') || h.includes('microsoft') || h.includes('hotmail')) return 'outlook';
  if (h.includes('yahoo') || h.includes('yahoodns')) return 'yahoo';
  if (h.includes('icloud') || h.includes('apple')) return 'icloud';
  if (h.includes('zoho')) return 'zoho';
  if (h.includes('proton') || h.includes('protonmail')) return 'protonmail';
  if (h.includes('yandex')) return 'yandex';
  return 'custom';
}

export { BOUNCE_MAP };
