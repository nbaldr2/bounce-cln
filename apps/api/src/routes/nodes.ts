import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { provisionNode, getNodesWithHealth, processHeartbeat, provisionEventBus } from '../services/nodeManager';
import { hmacAuth } from '../middleware/hmacAuth';

const router = Router();

// GET /api/nodes
router.get('/', async (_req: Request, res: Response) => {
  try {
    const nodes = await getNodesWithHealth();
    res.json(nodes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes/:id/logs/stream — SSE endpoint for real-time provisioning logs
// IMPORTANT: defined before /:id to avoid route collision
router.get('/:id/logs/stream', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial comment to flush headers — required for browser EventSource
    res.write(':ok\n\n');

    // Send existing logs
    const existingLogs = await prisma.provisionLog.findMany({
      where: { nodeId: id },
      orderBy: { createdAt: 'asc' },
    });
    for (const log of existingLogs) {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    }

    const onLog = (log: any) => {
      try { res.write(`data: ${JSON.stringify(log)}\n\n`); } catch {}
    };
    const onDone = () => {
      try {
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      } catch {}
    };

    provisionEventBus.on(`log:${id}`, onLog);
    provisionEventBus.on(`done:${id}`, onDone);

    req.on('close', () => {
      provisionEventBus.off(`log:${id}`, onLog);
      provisionEventBus.off(`done:${id}`, onDone);
    });
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'SSE setup failed' });
    }
  }
});

// GET /api/nodes/:id/logs — fetch all provision logs for replay
router.get('/:id/logs', async (req: Request, res: Response) => {
  try {
    const logs = await prisma.provisionLog.findMany({
      where: { nodeId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nodes/:id — single node with IPs + unresolved alerts
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const node = await prisma.node.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { ips: true, alerts: { where: { resolved: false }, take: 10, orderBy: { createdAt: 'desc' } } },
    });
    res.json(node);
  } catch {
    res.status(404).json({ error: 'Node not found' });
  }
});

// POST /api/nodes — add a new VPS node
router.post('/', async (req: Request, res: Response) => {
  try {
    const { hostname, ip, sshPort = 22, sshUser = 'root', sshKeyPath, sshPassword, tags = [] } = req.body;
    if (!hostname || !ip) {
      res.status(400).json({ error: 'hostname and ip are required' });
      return;
    }

    const node = await prisma.node.create({
      data: { hostname, ip, sshPort, sshUser, sshKeyPath, tags, status: 'PENDING' },
    });

    // Trigger async provisioning (don't await — let it run in background)
    provisionNode(node.id, sshPassword).catch(err =>
      console.error(`Provisioning failed for node ${node.id}:`, err.message)
    );

    res.status(201).json(node);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nodes/:id/provision — re-provision an existing node
router.post('/:id/provision', async (req: Request, res: Response) => {
  try {
    const { sshPassword } = req.body;
    const node = await prisma.node.findUniqueOrThrow({ where: { id: req.params.id } });
    provisionNode(node.id, sshPassword).catch(err =>
      console.error(`Re-provisioning failed for node ${node.id}:`, err.message)
    );
    res.json({ message: 'Provisioning started' });
  } catch {
    res.status(404).json({ error: 'Node not found' });
  }
});

// DELETE /api/nodes/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.node.delete({ where: { id: req.params.id } });
    res.json({ message: 'Node deleted' });
  } catch {
    res.status(404).json({ error: 'Node not found' });
  }
});

// POST /api/nodes/heartbeat — called by agents (HMAC auth)
router.post('/heartbeat', hmacAuth, async (req: Request, res: Response) => {
  try {
    const nodeId = (req as any).nodeId;
    const { cpuUsage = 0, memoryUsage = 0, queueDepth = 0 } = req.body;
    const node = await processHeartbeat(nodeId, { cpuUsage, memoryUsage, queueDepth });
    res.json({ ok: true, node });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nodes/:id/ips — add IP to a node
router.post('/:id/ips', async (req: Request, res: Response) => {
  try {
    const { ip, provider } = req.body;
    const nodeIp = await prisma.nodeIp.create({
      data: { nodeId: req.params.id, ip, provider },
    });
    res.status(201).json(nodeIp);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
