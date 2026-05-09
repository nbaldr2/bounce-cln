import forge from 'node-forge';
import { prisma } from '../lib/db';

interface DkimKeys {
  privateKey: string;
  publicKey: string;
  dnsRecord: string;
  selector: string;
}

/**
 * Generate RSA-2048 DKIM key pair for a sending domain.
 */
export function generateDkimKeys(domain: string, selector: string = 'bounce'): DkimKeys {
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });

  const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
  const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);

  // Extract the base64 public key (strip PEM headers/footers and newlines)
  const publicKeyBase64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\n/g, '')
    .trim();

  // Format as DNS TXT record
  const dnsRecord = `v=DKIM1; k=rsa; p=${publicKeyBase64}`;

  return {
    privateKey: privateKeyPem,
    publicKey: publicKeyPem,
    dnsRecord,
    selector,
  };
}

/**
 * Generate SPF record suggestion for a domain.
 */
export function generateSpfRecord(ips: string[]): string {
  const ipEntries = ips.map(ip => {
    if (ip.includes(':')) return `ip6:${ip}`;
    return `ip4:${ip}`;
  });
  return `v=spf1 ${ipEntries.join(' ')} -all`;
}

/**
 * Create a sending domain with auto-generated DKIM keys.
 */
export async function createSendingDomain(domain: string, selector: string = 'bounce') {
  const keys = generateDkimKeys(domain, selector);

  const sendingDomain = await prisma.sendingDomain.create({
    data: {
      domain,
      dkimSelector: selector,
      dkimPrivateKey: keys.privateKey,
      dkimPublicKey: keys.publicKey,
      dkimDnsRecord: keys.dnsRecord,
      spfRecord: null,
      dnsVerified: false,
    },
  });

  return sendingDomain;
}

/**
 * Get the DNS records a user needs to add for a domain.
 */
export function getDnsInstructions(domain: string, selector: string, dkimDnsRecord: string, spfRecord?: string | null) {
  const records = [
    {
      type: 'TXT',
      name: `${selector}._domainkey.${domain}`,
      value: dkimDnsRecord,
      purpose: 'DKIM signing key',
    },
  ];

  if (spfRecord) {
    records.push({
      type: 'TXT',
      name: domain,
      value: spfRecord,
      purpose: 'SPF authorization',
    });
  }

  return records;
}
