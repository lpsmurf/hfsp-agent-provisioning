import { PortRegistry } from "./port-registry";
import { NginxManager } from "./nginx-manager";

export type Surface = "telegram" | "webapp" | "extension";

export interface ProvisionConfig {
  tenantId: string;
  image: string;
  surface: Surface;
  containerName: string;
  workspacePath: string;
  secretsPath: string;
  configPath: string;
  gatewayPort?: number;   // auto-allocated if omitted
  env?: Record<string, string>;
}

export interface ProvisionResult {
  ok: boolean;
  tenantId: string;
  containerName: string;
  image: string;
  gatewayPort: number;
  gatewayUrl: string;       // internal ws://
  publicUrl: string;        // external wss:// via nginx
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
    allocatedPort?: number;
    publicUrl?: string;
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
  private nginx: NginxManager;

  constructor(registry?: PortRegistry, nginx?: NginxManager) {
    this.registry = registry ?? new PortRegistry();
    this.nginx = nginx ?? new NginxManager();
  }

  async provision(config: ProvisionConfig): Promise<ProvisionResult> {
    const now = new Date().toISOString();
    const name = config.containerName;
    const port = config.gatewayPort ?? this.registry.allocate(config.tenantId);

    try {
      await this.exec(`docker rm -f ${shEscape(name)} >/dev/null 2>&1 || true`);

      const env: Record<string, string> = {
        HOME: "/home/hfsp",
        GATEWAY_PORT: String(port),
        ...(config.env ?? {}),
      };

      await this.checkCapacity();

      const createCmd = [
        "docker create",
        `--name ${shEscape(name)}`,
        "--restart unless-stopped",
        "--memory 512m",
        "--memory-swap 512m",
        "--cpus 0.75",
        `-p 127.0.0.1:${port}:${port}`,   // bind host-side to loopback only
        ...buildEnvArgs(env),
        `-v ${shEscape(config.configPath)}:/run/openclaw/openclaw.json:ro`,
        `-v ${shEscape(config.workspacePath)}:/tenant/workspace`,
        `-v ${shEscape(config.secretsPath)}:/home/hfsp/.openclaw/secrets:ro`,
        shEscape(config.image),
      ].join(" ");

      await this.exec(createCmd);

      // Update entrypoint uses --bind lan so gateway binds to container eth0
      await this.exec(`docker start ${shEscape(name)}`);

      const running = await this.waitForRunning(name, 30_000);
      if (!running) throw new Error("Container did not reach running state");

      // Probe from host side — simpler than docker exec, proves port forwarding works
      const healthPassed = await this.waitForGatewayFromHost(port, 30_000);
      if (!healthPassed) throw new Error("Gateway did not become healthy within 30s");

      // Wire nginx routing
      await this.nginx.addTenant(config.tenantId, port);

      const publicUrl = this.nginx.gatewayUrl(config.tenantId);

      return {
        ok: true,
        tenantId: config.tenantId,
        containerName: name,
        image: config.image,
        gatewayPort: port,
        gatewayUrl: `ws://127.0.0.1:${port}`,
        publicUrl,
        startedAt: now,
        finishedAt: new Date().toISOString(),
        healthPassed: true,
      };
    } catch (err) {
      if (!config.gatewayPort) this.registry.release(config.tenantId);
      await this.exec(`docker rm -f ${shEscape(name)} >/dev/null 2>&1 || true`);
      return {
        ok: false,
        tenantId: config.tenantId,
        containerName: name,
        image: config.image,
        gatewayPort: port,
        gatewayUrl: `ws://127.0.0.1:${port}`,
        publicUrl: "",
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
      await this.nginx.removeTenant(tenantId);
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
    publicUrl?: string;
    error?: string;
  }> {
    const containerName = this.nameFor(tenantId);
    const allocatedPort = this.registry.get(tenantId);
    const publicUrl = allocatedPort ? this.nginx.gatewayUrl(tenantId) : undefined;
    try {
      const out = await this.exec(
        `docker inspect -f '{{.State.Running}} {{.State.Health.Status}}' ${shEscape(containerName)} 2>/dev/null || true`
      );
      const trimmed = out.trim();
      if (!trimmed) return { ok: true, exists: false, running: false, containerName, allocatedPort, publicUrl };
      const [running, health] = trimmed.split(/\s+/);
      return {
        ok: true,
        exists: true,
        running: running === "true",
        healthy: health === "healthy" ? true : health === "unhealthy" ? false : undefined,
        containerName,
        allocatedPort,
        publicUrl,
      };
    } catch (err) {
      return { ok: false, exists: false, running: false, containerName, allocatedPort, publicUrl, error: err instanceof Error ? err.message : String(err) };
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

  // Probe from host — validates port mapping + gateway bind
  private async waitForGatewayFromHost(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const out = await this.exec(
          `bash -c '(exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null && echo ok || echo fail'`
        );
        if (out.trim() === "ok") return true;
      } catch { /* not ready */ }
      await this.sleep(1500);
    }
    return false;
  }

  // Preflight: refuse to provision if host is low on memory or disk.
  // Thresholds: <300 MB free RAM or <2 GB free disk.
  private async checkCapacity(): Promise<void> {
    const memOut = await this.exec("awk '/MemAvailable/ {print $2}' /proc/meminfo");
    const memKb = parseInt(memOut.trim(), 10);
    if (!isNaN(memKb) && memKb < 300_000) {
      throw new Error(
        `CAPACITY_MEMORY: Only ${Math.round(memKb / 1024)} MB RAM available. Provision refused.`
      );
    }

    const diskOut = await this.exec("df --output=avail / | tail -1");
    const diskKb = parseInt(diskOut.trim(), 10);
    if (!isNaN(diskKb) && diskKb < 2_097_152) { // 2 GB in KB
      throw new Error(
        `CAPACITY_DISK: Only ${Math.round(diskKb / 1024 / 1024)} GB disk available. Provision refused.`
      );
    }
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
