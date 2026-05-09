import { Worker, Job } from 'bullmq';
import { Queue } from 'bullmq';
import { createRedisConnection } from '../lib/redis';
import { prisma } from '../lib/db';
import { selectBestNode } from '../services/loadBalancer';

const connection = createRedisConnection();

export const retryWorkerQueue = new Queue('retry-worker', { connection: createRedisConnection() });

// Process due retries every 5 minutes
const worker = new Worker(
  'retry-worker',
  async (_job: Job) => {
    const now = new Date();

    const dueRetries = await prisma.retryQueue.findMany({
      where: { status: 'PENDING', retryAfter: { lte: now } },
      take: 100,
    });

    let processed = 0;
    for (const retry of dueRetries) {
      if (retry.retryCount >= retry.maxRetries) {
        // Dead letter — mark as unknown
        await prisma.retryQueue.update({
          where: { id: retry.id },
          data: { status: 'DEAD_LETTER' },
        });

        await prisma.emailResult.create({
          data: {
            jobId: retry.jobId,
            email: retry.email,
            domain: retry.email.split('@')[1] || 'unknown',
            status: 'UNKNOWN',
            smtpCode: retry.smtpCode,
            smtpMessage: `Dead letter after ${retry.retryCount} retries`,
            retryCount: retry.retryCount,
          },
        }).catch(() => {});
        continue;
      }

      // Find a different node to retry on (distribute retries)
      const node = await selectBestNode('custom');
      if (!node) continue;

      await prisma.retryQueue.update({
        where: { id: retry.id },
        data: {
          status: 'ASSIGNED',
          retryCount: { increment: 1 },
          assignedNodeId: node.id,
          retryAfter: new Date(Date.now() + 4 * 60 * 60 * 1000), // next retry in 4h if fails again
        },
      });
      processed++;
    }

    return { processed, total: dueRetries.length };
  },
  { connection, concurrency: 1 }
);

worker.on('completed', (_job: Job, result: any) => {
  if (result.total > 0) {
    console.log(`[RetryWorker] Processed ${result.processed}/${result.total} retries`);
  }
});

worker.on('failed', (_job: Job | undefined, err: Error) => {
  console.error('[RetryWorker] Failed:', err.message);
});

// Schedule retry checks every 5 minutes
export async function startRetryScheduler() {
  await retryWorkerQueue.add('check-retries', {}, {
    repeat: { every: 5 * 60 * 1000 },
    jobId: 'retry-check',
  });
}

export default worker;
