import { prisma } from '../lib/db';
import { executeSSH, uploadDirectory, type SSHConfig } from '../lib/ssh';
import { NodeStatus } from '@prisma/client';
import path from 'path';

/**
 * Provision a new VPS node:
 * 1. Install Python + dependencies
 * 2. Upload agent code
 * 3. Configure systemd service
 * 4. Start agent
 */
export async function provisionNode(nodeId: string, sshPassword?: string): Promise<void> {
  const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });

  await prisma.node.update({
    where: { id: nodeId },
    data: { status: 'PROVISIONING', errorMessage: null },
  });

  const sshConfig: SSHConfig = {
    host: node.ip,
    port: node.sshPort,
    username: node.sshUser,
    ...(node.sshKeyPath ? { privateKeyPath: node.sshKeyPath } : {}),
    ...(sshPassword ? { password: sshPassword } : {}),
  };

  try {
    // Step 1: Install system dependencies
    await executeSSH(sshConfig, [
      'apt-get update -qq',
      'apt-get install -y -qq python3 python3-pip python3-venv curl',
      'mkdir -p /opt/bounce-agent',
    ]);

    // Step 2: Upload agent code
    const agentDir = path.resolve(__dirname, '../../../../agent');
    await uploadDirectory(sshConfig, agentDir, '/opt/bounce-agent');

    // Step 3: Set up Python virtual environment and install deps
    await executeSSH(sshConfig, [
      'cd /opt/bounce-agent && python3 -m venv .venv',
      'cd /opt/bounce-agent && .venv/bin/pip install -r requirements.txt',
    ]);

    // Step 4: Create environment file
    const masterUrl = process.env.MASTER_API_URL || `http://${process.env.API_HOST || '0.0.0.0'}:${process.env.API_PORT || 4000}`;
    const envContent = [
      `MASTER_API_URL=${masterUrl}`,
      `NODE_ID=${nodeId}`,
      `HMAC_SECRET=${process.env.HMAC_SECRET}`,
      `HEARTBEAT_INTERVAL=30`,
    ].join('\n');

    await executeSSH(sshConfig, [
      `echo '${envContent}' > /opt/bounce-agent/.env`,
    ]);

    // Step 5: Create systemd service
    const serviceContent = `[Unit]
Description=Bounce-CLN Verification Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/bounce-agent
ExecStart=/opt/bounce-agent/.venv/bin/python agent.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=/opt/bounce-agent/.env

[Install]
WantedBy=multi-user.target`;

    await executeSSH(sshConfig, [
      `echo '${serviceContent}' > /etc/systemd/system/bounce-agent.service`,
      'systemctl daemon-reload',
      'systemctl enable bounce-agent',
      'systemctl restart bounce-agent',
    ]);

    // Step 6: Install PowerMTA (optional — only if installer tarball exists on master)
    try {
      await executeSSH(sshConfig, ['mkdir -p /root/PMTA']);
      await executeSSH(sshConfig, [
        `wget -q -O /root/PMTA/pmta-installer.tar.gz ${masterUrl}/public/pmta-installer.tar.gz`,
        'cd /root/PMTA && tar -xzf pmta-installer.tar.gz',
        'cd /root/PMTA && rpm -ivh --force PowerMTA-5.0r8.rpm || true',
        'service pmta stop || true',
        'service pmtahttp stop || true',
        'rm -rf /usr/sbin/pmtad',
        'rm -rf /usr/sbin/pmtahttpd',
        'cd /root/PMTA/usr/sbin && cp * /usr/sbin/',
        'chmod -R 777 /usr/sbin/pmta',
        'chmod -R 777 /usr/sbin/pmtad',
        'chmod -R 777 /usr/sbin/pmtahttpd',
        'cp /root/PMTA/license /etc/pmta/ || true',
        'service pmta start || true',
        'service pmtahttp start || true',
      ]);
      await prisma.node.update({
        where: { id: nodeId },
        data: { pmtaConfigured: true },
      });
    } catch {
      // PMTA installer not available — node is still usable for verification
      console.warn(`[provisionNode] PMTA installation skipped for node ${nodeId} (installer unavailable)`);
    }

    await prisma.node.update({
      where: { id: nodeId },
      data: { status: 'ONLINE' },
    });

  } catch (error: any) {
    await prisma.node.update({
      where: { id: nodeId },
      data: {
        status: 'ERROR',
        errorMessage: error.message || 'Provisioning failed',
      },
    });
    throw error;
  }
}

/**
 * Check heartbeat timeouts and mark nodes as offline.
 */
export async function checkHeartbeats(): Promise<void> {
  const timeoutSeconds = 120; // 2 minutes
  const cutoff = new Date(Date.now() - timeoutSeconds * 1000);

  const staleNodes = await prisma.node.findMany({
    where: {
      status: 'ONLINE',
      lastHeartbeat: { lt: cutoff },
    },
  });

  for (const node of staleNodes) {
    await prisma.node.update({
      where: { id: node.id },
      data: { status: 'OFFLINE' },
    });

    // Create alert
    await prisma.alert.create({
      data: {
        type: 'NODE_OFFLINE',
        severity: 'CRITICAL',
        message: `Node ${node.hostname} (${node.ip}) went offline — no heartbeat for ${timeoutSeconds}s`,
        nodeId: node.id,
      },
    });
  }
}

/**
 * Process a heartbeat from an agent node.
 */
export async function processHeartbeat(nodeId: string, metrics: {
  cpuUsage: number;
  memoryUsage: number;
  queueDepth: number;
}) {
  const node = await prisma.node.update({
    where: { id: nodeId },
    data: {
      lastHeartbeat: new Date(),
      cpuUsage: metrics.cpuUsage,
      memoryUsage: metrics.memoryUsage,
      queueDepth: metrics.queueDepth,
      status: 'ONLINE',
    },
  });

  // Resolve any NODE_OFFLINE alerts for this node
  await prisma.alert.updateMany({
    where: {
      nodeId,
      type: 'NODE_OFFLINE',
      resolved: false,
    },
    data: {
      resolved: true,
      resolvedAt: new Date(),
    },
  });

  return node;
}

/**
 * Get all nodes with their IPs and health status.
 */
export async function getNodesWithHealth() {
  return prisma.node.findMany({
    include: {
      ips: true,
      _count: {
        select: {
          jobs: { where: { status: 'PROCESSING' } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}
