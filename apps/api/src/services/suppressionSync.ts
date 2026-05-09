import { prisma } from '../lib/db';
import { redis } from '../lib/redis';

/**
 * Add an email to the global suppression list.
 * Also publishes to Redis pub/sub so all agents are notified.
 */
export async function addToSuppression(email: string, reason: string, source: string): Promise<void> {
  await prisma.suppressionEntry.upsert({
    where: { email },
    update: { reason, source },
    create: { email, reason, source },
  });

  // Publish to Redis channel for real-time agent sync
  await redis.publish('suppression:add', JSON.stringify({ email, reason, source }));
}

/**
 * Check if emails are in the suppression list.
 * Returns set of suppressed emails.
 */
export async function checkSuppression(emails: string[]): Promise<Set<string>> {
  const entries = await prisma.suppressionEntry.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  return new Set(entries.map(e => e.email));
}

/**
 * Remove an email from the suppression list.
 */
export async function removeFromSuppression(email: string): Promise<void> {
  await prisma.suppressionEntry.delete({ where: { email } }).catch(() => {});
  await redis.publish('suppression:remove', JSON.stringify({ email }));
}

/**
 * Get full suppression list with pagination.
 */
export async function getSuppressionList(page: number = 1, limit: number = 50) {
  const skip = (page - 1) * limit;
  const [entries, total] = await Promise.all([
    prisma.suppressionEntry.findMany({
      skip,
      take: limit,
      orderBy: { addedAt: 'desc' },
    }),
    prisma.suppressionEntry.count(),
  ]);

  return { entries, total, page, totalPages: Math.ceil(total / limit) };
}
