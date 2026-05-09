import { Worker, Job, Queue } from 'bullmq';
import { createRedisConnection } from '../lib/redis';
import { checkHeartbeats } from '../services/nodeManager';
import { advanceWarmup, resetDailyCounters } from '../services/warmupScheduler';

const connection = createRedisConnection();

export const alertWorkerQueue = new Queue('alert-worker', { connection: createRedisConnection() });

const worker = new Worker(
  'alert-worker',
  async (job: Job) => {
    const { task } = job.data;

    switch (task) {
      case 'heartbeat-check':
        await checkHeartbeats();
        break;
      case 'daily-warmup':
        await advanceWarmup();
        break;
      case 'daily-reset':
        await resetDailyCounters();
        break;
    }

    return { task, completedAt: new Date() };
  },
  { connection, concurrency: 1 }
);

worker.on('failed', (_job: Job | undefined, err: Error) => {
  console.error('[AlertWorker] Failed:', err.message);
});

export async function startScheduledTasks() {
  // Heartbeat check every 30 seconds
  await alertWorkerQueue.add('heartbeat-check', { task: 'heartbeat-check' }, {
    repeat: { every: 30 * 1000 },
    jobId: 'heartbeat-check',
  });

  // Daily warmup advance at midnight UTC
  await alertWorkerQueue.add('daily-warmup', { task: 'daily-warmup' }, {
    repeat: { pattern: '0 0 * * *' },
    jobId: 'daily-warmup',
  });

  // Daily counter reset at midnight UTC
  await alertWorkerQueue.add('daily-reset', { task: 'daily-reset' }, {
    repeat: { pattern: '1 0 * * *' },
    jobId: 'daily-reset',
  });

  console.log('[AlertWorker] Scheduled tasks registered');
}

export default worker;
