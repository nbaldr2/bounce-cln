import { prisma } from '../lib/db';
import { Node, NodeIp } from '@prisma/client';

interface NodeWithIps extends Node {
  ips: NodeIp[];
}

interface ScoredNode {
  node: NodeWithIps;
  score: number;
}

/**
 * Intelligent load balancer that routes verification batches to optimal nodes.
 *
 * Scoring factors:
 * - Queue depth (lower is better) — weight: 40%
 * - CPU usage (lower is better) — weight: 20%
 * - IP reputation for target provider — weight: 25%
 * - Warm-up capacity remaining — weight: 15%
 */
export async function selectBestNode(provider: string): Promise<NodeWithIps | null> {
  const nodes = await prisma.node.findMany({
    where: { status: 'ONLINE' },
    include: { ips: true },
  });

  if (nodes.length === 0) return null;

  const scored: ScoredNode[] = nodes.map(node => {
    // Queue depth score (0-100, lower queue = higher score)
    const maxQueue = 50;
    const queueScore = Math.max(0, 100 - (node.queueDepth / maxQueue) * 100);

    // CPU score (0-100, lower CPU = higher score)
    const cpuScore = Math.max(0, 100 - node.cpuUsage);

    // IP reputation for this provider
    const providerIps = node.ips.filter(ip => ip.provider === provider || ip.provider === 'general' || !ip.provider);
    const avgReputation = providerIps.length > 0
      ? providerIps.reduce((sum, ip) => sum + ip.reputationScore, 0) / providerIps.length
      : 50; // Default reputation if no IPs matched

    // Warm-up capacity (how many more checks can this node do today)
    const totalDailyUsed = node.ips.reduce((sum, ip) => sum + ip.dailyCount, 0);
    const totalDailyCapacity = node.maxChecksPerDay * Math.max(1, node.ips.length);
    const warmupRemaining = Math.max(0, totalDailyCapacity - totalDailyUsed);
    const warmupScore = Math.min(100, (warmupRemaining / Math.max(1, totalDailyCapacity)) * 100);

    // Weighted composite score
    const score =
      queueScore * 0.40 +
      cpuScore * 0.20 +
      avgReputation * 0.25 +
      warmupScore * 0.15;

    return { node, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return best node, but only if it has capacity
  const best = scored[0];
  if (best.score < 10) return null; // All nodes are overloaded

  return best.node;
}

/**
 * Assign a batch of emails to the optimal node based on MX provider.
 * Filters out suppressed emails first.
 */
export async function assignBatch(jobId: string, emails: string[], provider: string): Promise<string | null> {
  // 1. Filter suppressed emails
  const suppressed = await prisma.suppressionEntry.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  const suppressedSet = new Set(suppressed.map(s => s.email));
  const filteredEmails = emails.filter(e => !suppressedSet.has(e));

  if (filteredEmails.length === 0) {
    await prisma.emailJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return null;
  }

  // 2. Select best node
  const node = await selectBestNode(provider);
  if (!node) return null;

  // 3. Assign job to node
  await prisma.emailJob.update({
    where: { id: jobId },
    data: {
      nodeId: node.id,
      emails: filteredEmails,
      emailCount: filteredEmails.length,
      status: 'ASSIGNED',
    },
  });

  return node.id;
}

/**
 * Get the current warm-up limit for a node based on its warm-up day.
 */
export async function getWarmupLimit(nodeId: string): Promise<number> {
  const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
  const settings = await prisma.setting.findMany({
    where: {
      key: { in: ['warmup_day1_limit', 'warmup_day4_limit', 'warmup_week2_limit'] },
    },
  });

  const settingsMap = Object.fromEntries(settings.map(s => [s.key, parseInt(s.value)]));

  if (node.warmupDay <= 3) return settingsMap['warmup_day1_limit'] || 200;
  if (node.warmupDay <= 7) return settingsMap['warmup_day4_limit'] || 500;
  return settingsMap['warmup_week2_limit'] || 2000;
}
