import { prisma } from '../lib/db';

interface WarmupSchedule {
  day: number;
  maxPerIpPerDay: number;
  label: string;
}

/**
 * Default warm-up schedule:
 * - Day 1-3: Conservative (200/IP/day)
 * - Day 4-7: Moderate (500/IP/day)
 * - Day 8-14: Aggressive (1500/IP/day)
 * - Day 15+: Full capacity (no limit from warm-up perspective)
 */
const DEFAULT_SCHEDULE: WarmupSchedule[] = [
  { day: 1, maxPerIpPerDay: 200, label: 'Conservative' },
  { day: 4, maxPerIpPerDay: 500, label: 'Moderate' },
  { day: 8, maxPerIpPerDay: 1500, label: 'Aggressive' },
  { day: 15, maxPerIpPerDay: 5000, label: 'Full capacity' },
];

/**
 * Get the warm-up limit for a given day.
 */
export function getWarmupLimitForDay(day: number): number {
  let limit = DEFAULT_SCHEDULE[0].maxPerIpPerDay;
  for (const step of DEFAULT_SCHEDULE) {
    if (day >= step.day) {
      limit = step.maxPerIpPerDay;
    }
  }
  return limit;
}

/**
 * Increment warm-up day for all online nodes.
 * Should be called daily (e.g. via cron job or BullMQ repeatable).
 */
export async function advanceWarmup(): Promise<void> {
  // Advance node warm-up day
  await prisma.node.updateMany({
    where: { status: 'ONLINE' },
    data: { warmupDay: { increment: 1 } },
  });

  // Advance per-IP warm-up day
  await prisma.nodeIp.updateMany({
    data: { warmupDay: { increment: 1 } },
  });

  // Update maxChecksPerDay based on new warmup day
  const nodes = await prisma.node.findMany({
    where: { status: 'ONLINE' },
    select: { id: true, warmupDay: true },
  });

  for (const node of nodes) {
    const limit = getWarmupLimitForDay(node.warmupDay);
    await prisma.node.update({
      where: { id: node.id },
      data: { maxChecksPerDay: limit },
    });
  }
}

/**
 * Reset daily counters for all IPs.
 * Should be called daily at midnight UTC.
 */
export async function resetDailyCounters(): Promise<void> {
  await prisma.nodeIp.updateMany({
    data: {
      dailyCount: 0,
      lastReset: new Date(),
    },
  });
}

/**
 * Get warm-up status for all nodes.
 */
export async function getWarmupStatus() {
  const nodes = await prisma.node.findMany({
    where: { status: { in: ['ONLINE', 'OFFLINE'] } },
    include: { ips: true },
    orderBy: { createdAt: 'asc' },
  });

  return nodes.map(node => {
    const currentLimit = getWarmupLimitForDay(node.warmupDay);
    const totalUsedToday = node.ips.reduce((sum, ip) => sum + ip.dailyCount, 0);
    const totalCapacity = currentLimit * Math.max(1, node.ips.length);

    return {
      nodeId: node.id,
      hostname: node.hostname,
      ip: node.ip,
      warmupDay: node.warmupDay,
      currentLimit,
      totalCapacity,
      totalUsedToday,
      remainingToday: Math.max(0, totalCapacity - totalUsedToday),
      schedule: DEFAULT_SCHEDULE,
    };
  });
}
