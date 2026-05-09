import { EventEmitter } from 'events';
import { prisma } from '../lib/db';
import { executeSSH, executeSSHWithLog, uploadDirectory, type SSHConfig } from '../lib/ssh';
import { NodeStatus } from '@prisma/client';
import path from 'path';

export const provisionEventBus = new EventEmitter();
provisionEventBus.setMaxListeners(100);

async function writeProvisionLog(nodeId: string, message: string, level: string = 'INFO', command?: string) {
  const log = await prisma.provisionLog.create({
    data: { nodeId, message, level, command },
  });
  provisionEventBus.emit(`log:${nodeId}`, log);
  return log;
}

async function updateNodeStatus(nodeId: string, status: string, errorMessage?: string | null) {
  await prisma.node.update({
    where: { id: nodeId },
    data: { status: status as NodeStatus, ...(errorMessage !== undefined ? { errorMessage } : {}) },
  });
}

export async function provisionNode(nodeId: string, sshPassword?: string): Promise<void> {
  const node = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });

  await updateNodeStatus(nodeId, 'PROVISIONING', null);
  await writeProvisionLog(nodeId, `Starting provisioning for ${node.hostname} (${node.ip})`, 'INFO');

  const sshConfig: SSHConfig = {
    host: node.ip,
    port: node.sshPort,
    username: node.sshUser,
    ...(node.sshKeyPath ? { privateKeyPath: node.sshKeyPath } : {}),
    ...(sshPassword ? { password: sshPassword } : {}),
  };

  try {
    const logCb = (msg: string, level: string) => writeProvisionLog(nodeId, msg, level);

    // Step 1: Install system dependencies
    await writeProvisionLog(nodeId, 'Step 1/6: Installing system dependencies...', 'INFO');
    await executeSSHWithLog(sshConfig, [
      // Auto-detect package manager — dnf for RHEL/AlmaLinux, apt-get for Debian/Ubuntu
      'which dnf && dnf install -y python3 python3-pip python3-virtualenv curl wget || (which apt-get && apt-get update -qq && apt-get install -y -qq python3 python3-pip python3-venv curl wget)',
      'mkdir -p /opt/bounce-agent',
    ], logCb);
    await writeProvisionLog(nodeId, 'System dependencies installed', 'SUCCESS');

    // Step 2: Upload agent code
    await writeProvisionLog(nodeId, 'Step 2/6: Uploading agent code...', 'INFO');
    const agentDir = path.resolve(__dirname, '../../../../agent');
    await uploadDirectory(sshConfig, agentDir, '/opt/bounce-agent');
    await writeProvisionLog(nodeId, 'Agent code uploaded', 'SUCCESS');

    // Step 3: Set up Python virtual environment
    await writeProvisionLog(nodeId, 'Step 3/6: Setting up Python virtual environment...', 'INFO');
    await executeSSHWithLog(sshConfig, [
      'cd /opt/bounce-agent && python3 -m venv .venv',
      'cd /opt/bounce-agent && .venv/bin/pip install -r requirements.txt',
    ], logCb);
    await writeProvisionLog(nodeId, 'Python environment ready', 'SUCCESS');

    // Step 4: Create environment file
    await writeProvisionLog(nodeId, 'Step 4/6: Configuring agent...', 'INFO');
    const masterUrl = process.env.MASTER_API_URL || `http://${process.env.API_HOST || '0.0.0.0'}:${process.env.API_PORT || 4000}`;
    const envContent = [
      `MASTER_API_URL=${masterUrl}`,
      `NODE_ID=${nodeId}`,
      `HMAC_SECRET=${process.env.HMAC_SECRET}`,
      `HEARTBEAT_INTERVAL=30`,
      `CONCURRENCY=50`,
    ].join('\n');

    await executeSSHWithLog(sshConfig, [
      `cat > /opt/bounce-agent/.env << 'ENVEOF'\n${envContent}\nENVEOF`,
    ], logCb);
    await writeProvisionLog(nodeId, 'Agent configured', 'SUCCESS');

    // Step 5: Create systemd service
    await writeProvisionLog(nodeId, 'Step 5/6: Installing systemd service...', 'INFO');
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

    await executeSSHWithLog(sshConfig, [
      `cat > /etc/systemd/system/bounce-agent.service << 'SERVICEEOF'\n${serviceContent}\nSERVICEEOF`,
      'systemctl daemon-reload',
      'systemctl enable bounce-agent',
      'systemctl restart bounce-agent',
    ], logCb);
    await writeProvisionLog(nodeId, 'Agent service started', 'SUCCESS');

    // Step 6: Install PowerMTA (optional)
    try {
      await writeProvisionLog(nodeId, 'Step 6/6: Optionally installing PowerMTA...', 'INFO');
      await executeSSHWithLog(sshConfig, ['mkdir -p /root/PMTA'], logCb);
      await executeSSHWithLog(sshConfig, [
        `wget -q -O /root/PMTA/pmta-installer.tar.gz ${masterUrl}/public/pmta-installer.tar.gz`,
        'cd /root/PMTA && tar -xzf pmta-installer.tar.gz',
        'cd /root/PMTA && rpm -ivh --force PowerMTA-5.0r8.rpm PowerMTA-api-5.0r8.rpm PowerMTA-snmp-5.0r8.rpm || true',
        'systemctl stop pmta pmtahttp 2>/dev/null || service pmta stop 2>/dev/null || true',
        'rm -rf /usr/sbin/pmtad /usr/sbin/pmtahttpd',
        'cd /root/PMTA/usr/sbin && cp * /usr/sbin/',
        'chmod -R 777 /usr/sbin/pmta /usr/sbin/pmtad /usr/sbin/pmtahttpd',
        'cp /root/PMTA/license /etc/pmta/ || true',
        'systemctl start pmta pmtahttp 2>/dev/null || service pmta start 2>/dev/null || true',
      ], logCb);
      await prisma.node.update({
        where: { id: nodeId },
        data: { pmtaConfigured: true },
      });
      await writeProvisionLog(nodeId, 'PowerMTA installed and configured', 'SUCCESS');
    } catch {
      await writeProvisionLog(nodeId, 'PowerMTA installation skipped (installer not available)', 'WARN');
    }

    await updateNodeStatus(nodeId, 'ONLINE');
    await writeProvisionLog(nodeId, 'Node is ONLINE and ready', 'SUCCESS');
    provisionEventBus.emit(`done:${nodeId}`);

  } catch (error: any) {
    const msg = error.message || 'Provisioning failed';
    await writeProvisionLog(nodeId, `❌ ${msg}`, 'ERROR');
    await updateNodeStatus(nodeId, 'ERROR', msg);
    provisionEventBus.emit(`done:${nodeId}`);
    throw error;
  }
}

export async function checkHeartbeats(): Promise<void> {
  const timeoutSeconds = 120;
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