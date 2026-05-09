import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';

const router = Router();

// GET /api/jobs
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, listId, page = '1', limit = '50' } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = {};
    if (status) where.status = status;
    if (listId) where.listId = listId;

    const [jobs, total] = await Promise.all([
      prisma.emailJob.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          node: { select: { hostname: true, ip: true } },
        },
        // Don't select the emails array — too large
        select: {
          id: true, batchIndex: true, emailCount: true, status: true,
          attempts: true, startedAt: true, completedAt: true, createdAt: true,
          node: { select: { hostname: true, ip: true } },
          listId: true, nodeId: true,
        },
      }),
      prisma.emailJob.count({ where }),
    ]);

    res.json({ jobs, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id — get a job with its results
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await prisma.emailJob.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        node: { select: { hostname: true, ip: true } },
        results: { take: 100, orderBy: { checkedAt: 'desc' } },
      },
    });
    res.json(job);
  } catch {
    res.status(404).json({ error: 'Job not found' });
  }
});

// GET /api/jobs/node/:nodeId — get pending jobs assigned to a node (for agent polling)
router.get('/node/:nodeId', async (req: Request, res: Response) => {
  try {
    const jobs = await prisma.emailJob.findMany({
      where: { nodeId: req.params.nodeId, status: 'ASSIGNED' },
      select: {
        id: true, emails: true, emailCount: true, batchIndex: true, listId: true,
      },
      take: 5,
    });
    res.json(jobs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
