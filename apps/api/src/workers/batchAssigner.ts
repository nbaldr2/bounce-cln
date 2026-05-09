import { Queue, Worker, Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis';
import { prisma } from '../lib/db';
import { assignBatch } from '../services/loadBalancer';
import { detectMxProvider } from '../services/bounceClassifier';

const connection = createRedisConnection();

export const batchAssignerQueue = new Queue('batch-assigner', { connection: createRedisConnection() });

// Worker that processes batch assignment jobs
const worker = new Worker(
  'batch-assigner',
  async (job: Job) => {
    const { jobId } = job.data;

    const emailJob = await prisma.emailJob.findUnique({
      where: { id: jobId },
      include: { list: { select: { status: true } } },
    });

    if (!emailJob || emailJob.list.status === 'PAUSED') {
      return { skipped: true };
    }
    if (emailJob.status === 'COMPLETED') {
      return { alreadyDone: true };
    }

    // Detect dominant MX provider from batch domains
    const domains = [...new Set(emailJob.emails.map(e => e.split('@')[1]).filter(Boolean))];
    const provider = domains.length > 0 ? detectMxProvider(domains[0]) : 'custom';

    await prisma.emailJob.update({
      where: { id: jobId },
      data: { status: 'PROCESSING', startedAt: new Date(), attempts: { increment: 1 } },
    });

    const nodeId = await assignBatch(jobId, emailJob.emails, provider);

    if (!nodeId) {
      // No node available — requeue with delay
      await prisma.emailJob.update({
        where: { id: jobId },
        data: { status: 'QUEUED' },
      });
      throw new Error('No available nodes to assign batch');
    }

    return { jobId, nodeId, provider, emailCount: emailJob.emailCount };
  },
  {
    connection,
    concurrency: 20,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30000 },
    },
  }
);

worker.on('completed', (job: Job, result: any) => {
  if (!result?.skipped && !result?.alreadyDone) {
    console.log(`[BatchAssigner] Job ${result.jobId} assigned to node ${result.nodeId} (${result.emailCount} emails)`);
  }
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[BatchAssigner] Job failed:`, err.message);
});

export default worker;
