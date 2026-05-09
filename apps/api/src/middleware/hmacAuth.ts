import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const HMAC_SECRET = process.env.HMAC_SECRET || 'dev-hmac-secret';

/**
 * HMAC-SHA256 authentication middleware for agent requests.
 * Agents must include:
 *   - X-HMAC-Signature: HMAC-SHA256 of the request body
 *   - X-HMAC-Timestamp: Unix timestamp (must be within 5 minutes)
 *   - X-Node-Id: The node's UUID
 */
export function hmacAuth(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-hmac-signature'] as string;
  const timestamp = req.headers['x-hmac-timestamp'] as string;
  const nodeId = req.headers['x-node-id'] as string;

  if (!signature || !timestamp || !nodeId) {
    res.status(401).json({ error: 'Missing authentication headers' });
    return;
  }

  // Check timestamp freshness (5 minute window)
  const now = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (Math.abs(now - requestTime) > 300) {
    res.status(401).json({ error: 'Request timestamp expired' });
    return;
  }

  // Compute expected signature
  const body = JSON.stringify(req.body);
  const payload = `${timestamp}.${body}`;
  const expectedSignature = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Attach nodeId to request for downstream use
  (req as any).nodeId = nodeId;
  next();
}

/**
 * Generate HMAC signature for a payload (used by tests/agent setup)
 */
export function generateHmac(body: string, timestamp: number): string {
  const payload = `${timestamp}.${body}`;
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('hex');
}
