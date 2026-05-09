import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';

const router = Router();

// GET /api/dashboard/overview
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const [
      nodeStats,
      resultStats,
      listStats,
      retryDepth,
      activeAlerts,
    ] = await Promise.all([
      prisma.node.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.emailResult.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.emailList.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.retryQueue.count({ where: { status: 'PENDING' } }),
      prisma.alert.count({ where: { resolved: false } }),
    ]);

    const nodeMap = Object.fromEntries(nodeStats.map(n => [n.status, n._count.status]));
    const resultMap = Object.fromEntries(resultStats.map(r => [r.status, r._count.status]));

    const total = Object.values(resultMap).reduce((a, b) => a + b, 0);

    res.json({
      nodes: {
        online: nodeMap['ONLINE'] || 0,
        offline: nodeMap['OFFLINE'] || 0,
        provisioning: nodeMap['PROVISIONING'] || 0,
        error: nodeMap['ERROR'] || 0,
      },
      results: {
        total,
        valid: resultMap['VALID'] || 0,
        invalid: resultMap['INVALID'] || 0,
        unknown: resultMap['UNKNOWN'] || 0,
        catchAll: resultMap['CATCH_ALL'] || 0,
        softBounce: resultMap['SOFT_BOUNCE'] || 0,
        greylisted: resultMap['GREYLISTED'] || 0,
        timeout: resultMap['TIMEOUT'] || 0,
      },
      lists: Object.fromEntries(listStats.map(l => [l.status.toLowerCase(), l._count.status])),
      retryQueueDepth: retryDepth,
      activeAlerts,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/throughput — emails per hour (last 24h)
router.get('/throughput', async (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const results = await prisma.$queryRaw<Array<{ hour: Date; count: bigint }>>`
      SELECT date_trunc('hour', "checkedAt") AS hour, COUNT(*) AS count
      FROM "EmailResult"
      WHERE "checkedAt" >= ${since}
      GROUP BY hour
      ORDER BY hour ASC
    `;
    res.json(results.map(r => ({ hour: r.hour, count: Number(r.count) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/providers
router.get('/providers', async (_req: Request, res: Response) => {
  try {
    const providers = await prisma.emailResult.groupBy({
      by: ['mxProvider', 'status'],
      _count: { status: true },
      where: { mxProvider: { not: null } },
    });

    const grouped: Record<string, Record<string, number>> = {};
    for (const p of providers) {
      const provider = p.mxProvider || 'unknown';
      if (!grouped[provider]) grouped[provider] = {};
      grouped[provider][p.status] = p._count.status;
    }

    res.json(grouped);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const { resolved = 'false' } = req.query as { resolved?: string };
    const alerts = await prisma.alert.findMany({
      where: { resolved: resolved === 'true' },
      include: { node: { select: { hostname: true, ip: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(alerts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/dashboard/alerts/:id/resolve
router.put('/alerts/:id/resolve', async (req: Request, res: Response) => {
  try {
    const alert = await prisma.alert.update({
      where: { id: req.params.id },
      data: { resolved: true, resolvedAt: new Date() },
    });
    res.json(alert);
  } catch {
    res.status(404).json({ error: 'Alert not found' });
  }
});

export default router;
