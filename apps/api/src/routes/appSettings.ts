import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';

const router = Router();

// GET /api/settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/:key
router.put('/:key', async (req: Request, res: Response) => {
  try {
    const setting = await prisma.setting.upsert({
      where: { key: req.params.key },
      update: { value: String(req.body.value) },
      create: { key: req.params.key, value: String(req.body.value), description: req.body.description },
    });
    res.json(setting);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
