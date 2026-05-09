import { NodeSSH } from 'node-ssh';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
}

export async function executeSSH(config: SSHConfig, commands: string[]): Promise<string[]> {
  const ssh = new NodeSSH();
  const results: string[] = [];

  try {
    await ssh.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      ...(config.privateKeyPath ? { privateKeyPath: config.privateKeyPath } : {}),
      ...(config.password ? { password: config.password } : {}),
      readyTimeout: 30000,
    });

    for (const cmd of commands) {
      const result = await ssh.execCommand(cmd, { cwd: '/' });
      if (result.stderr && !result.stderr.includes('WARNING')) {
        console.error(`SSH command error [${cmd}]:`, result.stderr);
      }
      results.push(result.stdout || result.stderr);
    }
  } finally {
    ssh.dispose();
  }

  return results;
}

export async function uploadFile(config: SSHConfig, localPath: string, remotePath: string): Promise<void> {
  const ssh = new NodeSSH();

  try {
    await ssh.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      ...(config.privateKeyPath ? { privateKeyPath: config.privateKeyPath } : {}),
      ...(config.password ? { password: config.password } : {}),
    });

    await ssh.putFile(localPath, remotePath);
  } finally {
    ssh.dispose();
  }
}

export async function uploadDirectory(config: SSHConfig, localDir: string, remoteDir: string): Promise<void> {
  const ssh = new NodeSSH();

  try {
    await ssh.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      ...(config.privateKeyPath ? { privateKeyPath: config.privateKeyPath } : {}),
      ...(config.password ? { password: config.password } : {}),
    });

    await ssh.putDirectory(localDir, remoteDir, {
      recursive: true,
      concurrency: 5,
    });
  } finally {
    ssh.dispose();
  }
}

export async function executeSSHWithLog(
  config: SSHConfig,
  commands: string[],
  onLog: (message: string, level: string) => void
): Promise<string[]> {
  const ssh = new NodeSSH();
  const results: string[] = [];

  try {
    onLog(`Connecting to ${config.username}@${config.host}:${config.port}...`, 'INFO');

    await ssh.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      ...(config.privateKeyPath ? { privateKeyPath: config.privateKeyPath } : {}),
      ...(config.password ? { password: config.password } : {}),
      readyTimeout: 30000,
    });

    onLog('SSH connection established', 'SUCCESS');

    for (const cmd of commands) {
      onLog(`$ ${cmd}`, 'INFO');
      const result = await ssh.execCommand(cmd, { cwd: '/' });
      if (result.stdout) {
        result.stdout.split('\n').filter(Boolean).forEach(line => onLog(line, 'OUTPUT'));
      }
      if (result.stderr && !result.stderr.includes('WARNING')) {
        result.stderr.split('\n').filter(Boolean).forEach(line => onLog(line, 'WARN'));
      }
      results.push(result.stdout || result.stderr);
    }
  } catch (error: any) {
    onLog(`SSH Error: ${error.message}`, 'ERROR');
    throw error;
  } finally {
    ssh.dispose();
  }

  return results;
}
