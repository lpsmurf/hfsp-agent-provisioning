export type Surface = 'telegram' | 'webapp' | 'extension';

export interface ProvisionConfig {
  tenantId: string;
  image: string;
  surface: Surface;
  containerName: string;
  workspacePath: string;
  secretsPath: string;
  env: Record<string, string>;
  healthCheckCmd?: string;
  portMappings?: Array<{ hostPort: number; containerPort: number }>;
}

export interface ProvisionResult {
  ok: boolean;
  tenantId: string;
  containerName: string;
  image: string;
  startedAt: string;
  finishedAt: string;
  healthPassed: boolean;
  error?: string;
}

export interface Provisioner {
  provision(config: ProvisionConfig): Promise<ProvisionResult>;
  stop(tenantId: string): Promise<{ ok: boolean; error?: string }>;
  remove(tenantId: string): Promise<{ ok: boolean; error?: string }>;
  status(tenantId: string): Promise<{
    ok: boolean;
    exists: boolean;
    running: boolean;
    healthy?: boolean;
    containerName?: string;
    error?: string;
  }>;
}

function shEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildEnvArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

function buildPortArgs(portMappings?: Array<{ hostPort: number; containerPort: number }>): string[] {
  if (!portMappings?.length) return [];
  return portMappings.flatMap(({ hostPort, containerPort }) => ['-p', `${hostPort}:${containerPort}`]);
}

export class ShellProvisioner implements Provisioner {
  async provision(config: ProvisionConfig): Promise<ProvisionResult> {
    const now = new Date().toISOString();
    const name = config.containerName;
    try {
      // Reconcile existing container if present
      await this.exec(`docker rm -f ${shEscape(name)} >/dev/null 2>&1 || true`);

      const createCmd = [
        'docker create',
        `--name ${shEscape(name)}`,
        '--restart unless-stopped',
        ...buildPortArgs(config.portMappings),
        ...buildEnvArgs(config.env),
        `-v ${shEscape(config.workspacePath)}:/tenant/workspace`,
        `-v ${shEscape(config.secretsPath)}:/home/clawd/.openclaw/secrets:ro`,
        `-v ${shEscape('/home/clawd/.openclaw/openclaw.json')}:/home/clawd/.openclaw/openclaw.json:ro`,
        shEscape(config.image),
      ].join(' ');

      await this.exec(createCmd);
      await this.exec(`docker start ${shEscape(name)}`);

      const running = await this.waitForRunning(name, 30_000);
      if (!running) {
        throw new Error('Container did not reach running state');
      }

      const healthPassed = await this.runHealthCheck(name, config.healthCheckCmd);
      if (!healthPassed) {
        throw new Error('Health check failed');
      }

      return {
        ok: true,
        tenantId: config.tenantId,
        containerName: name,
        image: config.image,
        startedAt: now,
        finishedAt: new Date().toISOString(),
        healthPassed: true,
      };
    } catch (err) {
      await this.exec(`docker rm -f ${shEscape(name)} >/dev/null 2>&1 || true`);
      return {
        ok: false,
        tenantId: config.tenantId,
        containerName: name,
        image: config.image,
        startedAt: now,
        finishedAt: new Date().toISOString(),
        healthPassed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async stop(tenantId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const containerName = this.containerNameFor(tenantId);
      await this.exec(`docker stop ${shEscape(containerName)} >/dev/null 2>&1 || true`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async remove(tenantId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const containerName = this.containerNameFor(tenantId);
      await this.exec(`docker rm -f ${shEscape(containerName)} >/dev/null 2>&1 || true`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async status(tenantId: string): Promise<{
    ok: boolean;
    exists: boolean;
    running: boolean;
    healthy?: boolean;
    containerName?: string;
    error?: string;
  }> {
    const containerName = this.containerNameFor(tenantId);
    try {
      const inspect = await this.exec(
        `docker inspect -f '{{.State.Running}} {{.State.Health.Status}}' ${shEscape(containerName)} 2>/dev/null || true`
      );
      const trimmed = inspect.trim();
      if (!trimmed) {
        return { ok: true, exists: false, running: false, containerName };
      }
      const [running, health] = trimmed.split(/\s+/);
      return {
        ok: true,
        exists: true,
        running: running === 'true',
        healthy: health === 'healthy' ? true : health ? health === 'unhealthy' ? false : undefined : undefined,
        containerName,
      };
    } catch (err) {
      return { ok: false, exists: false, running: false, containerName, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async waitForRunning(containerName: string, timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const out = await this.exec(`docker inspect -f '{{.State.Running}}' ${shEscape(containerName)} 2>/dev/null || true`);
      if (out.trim() === 'true') return true;
      await this.sleep(1000);
    }
    return false;
  }

  private async runHealthCheck(containerName: string, healthCheckCmd?: string): Promise<boolean> {
    const cmd = healthCheckCmd ?? 'HOME=/home/clawd openclaw channels status --probe';
    const out = await this.exec(`docker exec -u clawd ${shEscape(containerName)} bash -lc ${shEscape(cmd)}`);
    return /healthy|works|running|Gateway reachable/i.test(out) || out.trim().length > 0;
  }

  private containerNameFor(tenantId: string): string {
    return `hfsp_${tenantId}`;
  }

  private async exec(command: string): Promise<string> {
    const { execFile } = await import('node:child_process');
    return await new Promise((resolve, reject) => {
      execFile('bash', ['-lc', command], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const message = stderr?.toString().trim() || error.message;
          reject(new Error(message));
          return;
        }
        resolve(stdout.toString());
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
