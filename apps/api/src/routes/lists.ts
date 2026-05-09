import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import fs from 'fs';
import { prisma } from '../lib/db';
import { batchAssignerQueue } from '../workers/batchAssigner';

const router = Router();
const upload = multer({ dest: 'uploads/' });

// GET /api/lists
router.get('/', async (_req: Request, res: Response) => {
  try {
    const lists = await prisma.emailList.findMany({
      orderBy: { uploadedAt: 'desc' },
      include: { _count: { select: { jobs: true } } },
    });
    res.json(lists);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lists/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const list = await prisma.emailList.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        jobs: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: { id: true, batchIndex: true, status: true, emailCount: true, startedAt: true, completedAt: true },
        },
      },
    });
    res.json(list);
  } catch {
    res.status(404).json({ error: 'List not found' });
  }
});

// POST /api/lists/upload — upload CSV email list
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const name = req.body.name || req.file.originalname;
  const batchSize = parseInt(req.body.batchSize || '1000', 10);

  try {
    // Parse CSV to extract emails
    const emails: string[] = [];
    const parser = fs.createReadStream(req.file.path).pipe(
      parse({ columns: false, skip_empty_lines: true, trim: true })
    );

    for await (const row of parser) {
      const cell = Array.isArray(row) ? row[0] : Object.values(row as Record<string, string>)[0];
      const email = String(cell || '').trim().toLowerCase();
      if (email && email.includes('@') && !emails.includes(email)) {
        emails.push(email);
      }
    }

    fs.unlink(req.file.path, () => {}); // Cleanup temp file

    if (emails.length === 0) {
      res.status(400).json({ error: 'No valid emails found in file' });
      return;
    }

    // Create list record
    const list = await prisma.emailList.create({
      data: {
        name,
        fileName: req.file.originalname,
        totalEmails: emails.length,
        status: 'PENDING',
      },
    });

    // Create batches
    const batches: string[][] = [];
    for (let i = 0; i < emails.length; i += batchSize) {
      batches.push(emails.slice(i, i + batchSize));
    }

    await prisma.emailJob.createMany({
      data: batches.map((batch, idx) => ({
        listId: list.id,
        batchIndex: idx,
        emails: batch,
        emailCount: batch.length,
        status: 'QUEUED',
      })),
    });

    res.status(201).json({ ...list, batchCount: batches.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/lists/:id/start
router.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const list = await prisma.emailList.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { jobs: { where: { status: 'QUEUED' } } },
    });

    await prisma.emailList.update({
      where: { id: req.params.id },
      data: { status: 'PROCESSING' },
    });

    // Enqueue all QUEUED jobs to BullMQ
    for (const job of list.jobs) {
      await batchAssignerQueue.add('assign', { jobId: job.id, listId: list.id }, {
        jobId: job.id,
        priority: job.priority,
      });
    }

    res.json({ message: `Enqueued ${list.jobs.length} batches`, listId: list.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/lists/:id/pause
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    await prisma.emailList.update({
      where: { id: req.params.id },
      data: { status: 'PAUSED' },
    });
    res.json({ message: 'List paused' });
  } catch {
    res.status(404).json({ error: 'List not found' });
  }
});

// GET /api/lists/:id/download — download results as CSV
router.get('/:id/download', async (req: Request, res: Response) => {
  try {
    const results = await prisma.emailResult.findMany({
      where: { job: { listId: req.params.id } },
      select: { email: true, status: true, smtpCode: true, smtpMessage: true, mxProvider: true, isCatchAll: true, checkedAt: true },
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="results-${req.params.id}.csv"`);

    res.write('email,status,smtp_code,smtp_message,mx_provider,is_catch_all,checked_at\n');
    for (const r of results) {
      res.write(`"${r.email}","${r.status}","${r.smtpCode || ''}","${(r.smtpMessage || '').replace(/"/g, '')}","${r.mxProvider || ''}","${r.isCatchAll}","${r.checkedAt.toISOString()}"\n`);
    }
    res.end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
