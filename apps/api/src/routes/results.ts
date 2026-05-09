import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { hmacAuth } from '../middleware/hmacAuth';
import { classifyBounce } from '../services/bounceClassifier';
import { addToSuppression } from '../services/suppressionSync';

const router = Router();

// POST /api/results — agents post batch results (HMAC auth required)
router.post('/', hmacAuth, async (req: Request, res: Response) => {
  try {
    const nodeId = (req as any).nodeId;
    const { jobId, results } = req.body as {
      jobId: string;
      results: Array<{
        email: string;
        domain: string;
        mxProvider?: string;
        smtpCode: number | null;
        smtpMessage?: string;
        isCatchAll?: boolean;
      }>;
    };

    if (!jobId || !Array.isArray(results)) {
      res.status(400).json({ error: 'jobId and results[] are required' });
      return;
    }

    const job = await prisma.emailJob.findUniqueOrThrow({ where: { id: jobId } });

    // Classify each result
    const emailResults = results.map(r => {
      const classification = classifyBounce(r.smtpCode, r.smtpMessage);
      return {
        jobId,
        nodeId,
        email: r.email,
        domain: r.domain,
        mxProvider: r.mxProvider,
        status: classification.status,
        smtpCode: r.smtpCode,
        smtpMessage: r.smtpMessage,
        isCatchAll: r.isCatchAll || false,
      };
    });

    // Write results
    await prisma.emailResult.createMany({ data: emailResults });

    // Add hard bounces to suppression list
    const hardBounces = emailResults.filter(r => r.status === 'INVALID');
    for (const hb of hardBounces) {
      await addToSuppression(hb.email, `SMTP ${hb.smtpCode}: ${hb.smtpMessage}`, 'hard_bounce');
    }

    // Update job status
    await prisma.emailJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    // Update list progress counters
    const valid = emailResults.filter(r => r.status === 'VALID').length;
    const invalid = emailResults.filter(r => r.status === 'INVALID').length;
    const unknown = emailResults.filter(r => ['UNKNOWN', 'TIMEOUT', 'GREYLISTED', 'SOFT_BOUNCE'].includes(r.status)).length;
    const catchAll = emailResults.filter(r => r.isCatchAll).length;

    await prisma.emailList.update({
      where: { id: job.listId },
      data: {
        processed: { increment: results.length },
        valid: { increment: valid },
        invalid: { increment: invalid },
        unknown: { increment: unknown },
        catchAll: { increment: catchAll },
      },
    });

    // Check if bounce rate is dangerously high (> 40%)
    const bounceRate = (invalid / results.length) * 100;
    if (bounceRate > 40) {
      await prisma.alert.create({
        data: {
          type: 'HIGH_BOUNCE_RATE',
          severity: 'WARNING',
          message: `Job ${jobId} has ${bounceRate.toFixed(1)}% hard bounce rate (${invalid}/${results.length}) — possible dirty list`,
          nodeId,
        },
      });
    }

    // Queue soft bounces for retry
    const softBounces = emailResults.filter(r => ['SOFT_BOUNCE', 'GREYLISTED'].includes(r.status));
    if (softBounces.length > 0) {
      const retryDelay = 4 * 60 * 60 * 1000; // 4 hours
      await prisma.retryQueue.createMany({
        data: softBounces.map(r => ({
          email: r.email,
          jobId,
          smtpCode: r.smtpCode || 0,
          smtpMessage: r.smtpMessage,
          retryAfter: new Date(Date.now() + retryDelay),
          maxRetries: 3,
        })),
        skipDuplicates: true,
      });
    }

    res.json({ ok: true, processed: results.length, hardBounces: hardBounces.length, retrying: softBounces.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/results/stats
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [total, byStatus, retryQueueDepth] = await Promise.all([
      prisma.emailResult.count(),
      prisma.emailResult.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      prisma.retryQueue.count({ where: { status: 'PENDING' } }),
    ]);

    const statusMap = Object.fromEntries(byStatus.map(s => [s.status, s._count.status]));

    res.json({
      total,
      valid: statusMap['VALID'] || 0,
      invalid: statusMap['INVALID'] || 0,
      unknown: statusMap['UNKNOWN'] || 0,
      catchAll: statusMap['CATCH_ALL'] || 0,
      softBounce: statusMap['SOFT_BOUNCE'] || 0,
      greylisted: statusMap['GREYLISTED'] || 0,
      timeout: statusMap['TIMEOUT'] || 0,
      retryQueueDepth,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/results — paginated results with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const { listId, status, domain, page = '1', limit = '50' } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = {};
    if (status) where.status = status;
    if (domain) where.domain = domain;
    if (listId) where.job = { listId };

    const [results, total] = await Promise.all([
      prisma.emailResult.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { checkedAt: 'desc' },
      }),
      prisma.emailResult.count({ where }),
    ]);

    res.json({ results, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
