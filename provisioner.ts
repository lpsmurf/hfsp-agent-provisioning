import { PortRegistry } from "./port-registry";

export type Surface = "telegram" | "webapp" | "extension";

export interface ProvisionConfig {
  tenantId: string;
  image: string;
  surface: Surface;
  containerName: string;
  workspacePath: string;
  secretsPath: string;
  configPath: string;     // host path to openclaw.json — staged read-only in container
  gatewayPort?: number;   // optional: auto-allocated from registry if omitted
  env?: Record<string, string>;
}

export interface ProvisionResult {
  ok: boolean;
  tenantId: string;
  containerName: string;
  image: string;
  gatewayPort: number;
  gatewayUrl: string;
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
  return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

export class ShellProvisioner implements Provisioner {
  private registry: PortRegistry;

  constructor(registry?: PortRegistry) {
    this.registry = registry ?? new PortRegistry();
  }

  async provision(config: ProvisionConfig): Promise<ProvisionResult> {
    const now = new Date().toISOString();
    const name = config.containerName;

    // Allocate port — idempotent if tenant already has one
    const port = config.gatewayPort ?? this.registry.allocate(config.tenantId);

    try {
      await this.exec(`docker rm -f ${shEscape(name)} >/dev/null 2>&1 || true`);

      const env: Record<string, string> = {
        HOME: "/home/hfsp",
        GATEWAY_PORT: String(port),
        ...(config.env ?? {}),
      };

      const createCmd = [
        "docker create",
        `--name ${shEscape(name)}`,
        "--restart unless-stopped",
        `-p ${port}:${port}`,
        ...buildEnvArgs(env),
        `-v ${shEscape(config.configPath)}:/run/openclaw/openclaw.json:ro`,
        `-v ${shEscape(config.workspacePath)}:/tenant/workspace`,
        `-v ${shEscape(config.secretsPath)}:/home/hfsp/.openclaw/secrets:ro`,
        shEscape(config.image),
      ].join(" ");

      await this.exec(createCmd);
      await this.exec(`docker start ${shEscape(name)}`);

      const running = await this.waitForRunning(name, 30_000);
      if (!running) throw new Error("Container did not reach running state");

      const healthPassed = await this.waitForGateway(name, port, 30_000);
      if (!healthPassed) throw new Error("Gateway did not become healthy within 30s");

      return {
        ok: true,
        tenantId: config.tenantId,
        containerName: name,
        image: config.image,
        gatewayPort: port,
        gatewayUrl: `ws://127.0.0.1:${port}`,
        startedAt: now,
        finishedAt: new Date().toISOString(),
        healthPassed: true,
      };
    } catch (err) {
      // Release port on failure so it doesn't leak
      if (!config.gatewayPort) this.registry.release(config.tenantId);
      await this.exec(`docker rm -f ${shEscape(name)} >/dev/null 2>&1 || true`);
      return {
        ok: false,
        tenantId: config.tenantId,
        containerName: name,
        image: config.image,
        gatewayPort: port,
        gatewayUrl: `ws://127.0.0.1:${port}`,
        startedAt: now,
        finishedAt: new Date().toISOString(),
        healthPassed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async stop(tenantId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.exec(`docker stop ${shEscape(this.nameFor(tenantId))} >/dev/null 2>&1 || true`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async remove(tenantId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.exec(`docker rm -f ${shEscape(this.nameFor(tenantId))} >/dev/null 2>&1 || true`);
      this.registry.release(tenantId);
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
    allocatedPort?: number;
    error?: string;
  }> {
    const containerName = this.nameFor(tenantId);
    const allocatedPort = this.registry.get(tenantId);
    try {
      const out = await this.exec(
        `docker inspect -f '{{.State.Running}} {{.State.Health.Status}}' ${shEscape(containerName)} 2>/dev/null || true`
      );
      const trimmed = out.trim();
      if (!trimmed) return { ok: true, exists: false, running: false, containerName, allocatedPort };
      const [running, health] = trimmed.split(/\s+/);
      return {
        ok: true,
        exists: true,
        running: running === "true",
        healthy: health === "healthy" ? true : health === "unhealthy" ? false : undefined,
        containerName,
        allocatedPort,
      };
    } catch (err) {
      return {
        ok: false,
        exists: false,
        running: false,
        containerName,
        allocatedPort,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async waitForRunning(name: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const out = await this.exec(
        `docker inspect -f '{{.State.Running}}' ${shEscape(name)} 2>/dev/null || true`
      );
      if (out.trim() === "true") return true;
      await this.sleep(1000);
    }
    return false;
  }

  private async waitForGateway(name: string, port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const out = await this.exec(
          `docker exec ${shEscape(name)} bash -c '(exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null && echo ok || echo fail'`
        );
        if (out.trim() === "ok") return true;
      } catch {
        // not ready yet
      }
      await this.sleep(1500);
    }
    return false;
  }

  private nameFor(tenantId: string): string {
    return `hfsp_${tenantId}`;
  }

  private async exec(command: string): Promise<string> {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      execFile("bash", ["-lc", command], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.toString().trim() || err.message));
          return;
        }
        resolve(stdout.toString());
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
