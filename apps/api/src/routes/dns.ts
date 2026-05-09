import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { createSendingDomain, getDnsInstructions, generateSpfRecord } from '../services/dkimGenerator';

const router = Router();

// GET /api/domains
router.get('/', async (_req: Request, res: Response) => {
  try {
    const domains = await prisma.sendingDomain.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(domains);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/domains — add domain + auto-generate DKIM keys
router.post('/', async (req: Request, res: Response) => {
  try {
    const { domain, selector = 'bounce' } = req.body;
    if (!domain) {
      res.status(400).json({ error: 'domain is required' });
      return;
    }

    const existing = await prisma.sendingDomain.findUnique({ where: { domain } });
    if (existing) {
      res.status(409).json({ error: 'Domain already exists' });
      return;
    }

    const record = await createSendingDomain(domain, selector);
    res.status(201).json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/domains/:id/dns-records — return DNS records to add
router.get('/:id/dns-records', async (req: Request, res: Response) => {
  try {
    const domain = await prisma.sendingDomain.findUniqueOrThrow({ where: { id: req.params.id } });
    const instructions = getDnsInstructions(domain.domain, domain.dkimSelector, domain.dkimDnsRecord, domain.spfRecord);
    res.json({ domain: domain.domain, records: instructions });
  } catch {
    res.status(404).json({ error: 'Domain not found' });
  }
});

// POST /api/domains/:id/verify-dns — check DNS propagation
router.post('/:id/verify-dns', async (req: Request, res: Response) => {
  try {
    const domain = await prisma.sendingDomain.findUniqueOrThrow({ where: { id: req.params.id } });

    const dns = await import('dns2').then(m => m.default || m);
    const resolver = new (dns as any)({ nameServers: ['8.8.8.8', '1.1.1.1'] });

    const txtName = `${domain.dkimSelector}._domainkey.${domain.domain}`;
    let verified = false;

    try {
      const result = await resolver.resolve(txtName, 'TXT');
      const answers = result?.answers || [];
      verified = answers.some((a: any) => {
        const txt = Array.isArray(a.data) ? a.data.join('') : String(a.data || '');
        return txt.includes('v=DKIM1') && txt.includes(domain.dkimSelector);
      });
    } catch {
      verified = false;
    }

    await prisma.sendingDomain.update({
      where: { id: domain.id },
      data: { dnsVerified: verified, lastDnsCheck: new Date() },
    });

    if (!verified) {
      await prisma.alert.create({
        data: {
          type: 'DNS_VERIFICATION_FAILED',
          severity: 'WARNING',
          message: `DKIM DNS record for ${domain.domain} not found at ${txtName}`,
        },
      }).catch(() => {});
    }

    res.json({ verified, domain: domain.domain, checkedAt: new Date() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/domains/:id/spf — set SPF record (after node IPs known)
router.put('/:id/spf', async (req: Request, res: Response) => {
  try {
    const { ips } = req.body as { ips: string[] };
    const spfRecord = generateSpfRecord(ips);
    const domain = await prisma.sendingDomain.update({
      where: { id: req.params.id },
      data: { spfRecord },
    });
    res.json({ spfRecord, domain: domain.domain });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/domains/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.sendingDomain.delete({ where: { id: req.params.id } });
    res.json({ message: 'Domain deleted' });
  } catch {
    res.status(404).json({ error: 'Domain not found' });
  }
});

export default router;
