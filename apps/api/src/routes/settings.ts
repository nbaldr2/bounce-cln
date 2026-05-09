import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';

const router = Router();

// GET /api/rate-limits
router.get('/', async (_req: Request, res: Response) => {
  try {
    const limits = await prisma.rateLimit.findMany({ orderBy: { provider: 'asc' } });
    res.json(limits);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rate-limits/:provider
router.put('/:provider', async (req: Request, res: Response) => {
  try {
    const { maxSmtpOut, maxMsgRatePerHour, connectTimeout, description } = req.body;
    const limit = await prisma.rateLimit.upsert({
      where: { provider: req.params.provider },
      update: { maxSmtpOut, maxMsgRatePerHour, connectTimeout, description },
      create: { provider: req.params.provider, maxSmtpOut, maxMsgRatePerHour, connectTimeout, description },
    });
    res.json(limit);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
