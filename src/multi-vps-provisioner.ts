/**
 * Multi-VPS Provisioner
 * Orchestrates agent provisioning across distributed VPS nodes.
 * - Selects best node via VpsRegistry
 * - Local node  → delegates to ShellProvisioner
 * - Remote node → SSH docker commands + nginx upstream update
 */
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ShellProvisioner, ProvisionConfig, ProvisionResult } from './provisioner';
import { deprovisionTenant } from './deprovisioner';
import { NginxManager } from './nginx-manager';

const LOCAL_HOST = '72.62.239.63';

export interface VpsNodeRow {
  id: number;
  name: string;
  host: string;
  ssh_user: string;
  ssh_key_path: string;
  port_range_start: number;
  port_range_end: number;
  status: string;
  capacity_agents_max: number;
  agents_current: number;
}

export interface MultiProvisionConfig extends ProvisionConfig {
  preferNodeId?: number;  // Force specific node (admin use)
}

export class MultiVpsProvisioner {
  private local: ShellProvisioner;
  private nginx: NginxManager;

  constructor(private db: any) {
    this.local = new ShellProvisioner();
    this.nginx = new NginxManager();
  }

  // ── Node Selection ─────────────────────────────────────────────────────────

  selectBestNode(): VpsNodeRow {
    const nodes = this.db.prepare(`
      SELECT n.*, (
        SELECT COUNT(*) FROM tenants t
        WHERE t.vps_node_id = n.id
          AND t.status IN ('active','provisioning')
          AND t.deleted_at IS NULL
      ) as live_agents
      FROM vps_nodes n
      WHERE n.status = 'active'
      ORDER BY (live_agents * 1.0 / n.capacity_agents_max) ASC
      LIMIT 1
    `).get() as VpsNodeRow | undefined;

    if (!nodes) throw new Error('No active VPS nodes available');

    const liveAgents = (this.db.prepare(`
      SELECT COUNT(*) as cnt FROM tenants
      WHERE vps_node_id = ? AND status IN ('active','provisioning') AND deleted_at IS NULL
    `).get(nodes.id) as any).cnt ?? 0;

    if (liveAgents >= nodes.capacity_agents_max) {
      throw new Error(`All nodes at capacity. Consider spinning up a new node.`);
    }

    return nodes;
  }

  isLocalNode(node: VpsNodeRow): boolean {
    return node.host === LOCAL_HOST || node.host === 'localhost' || node.host === '127.0.0.1';
  }

  // ── Port Allocation ────────────────────────────────────────────────────────

  allocatePort(nodeId: number): number {
    const node = this.db.prepare('SELECT * FROM vps_nodes WHERE id = ?').get(nodeId) as VpsNodeRow;
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const used = (this.db.prepare(`
      SELECT dashboard_port FROM tenants
      WHERE vps_node_id = ? AND deleted_at IS NULL AND dashboard_port IS NOT NULL
    `).all(nodeId) as any[]).map((r: any) => r.dashboard_port as number);

    const usedSet = new Set(used);
    for (let p = node.port_range_start; p <= node.port_range_end; p++) {
      if (!usedSet.has(p)) return p;
    }
    throw new Error(`No available ports on node ${nodeId}`);
  }

  // ── Remote SSH Helpers ─────────────────────────────────────────────────────

  private ssh(node: VpsNodeRow, cmd: string): string {
    const expandedKey = node.ssh_key_path.replace('~', process.env.HOME ?? '/home/hfsp');
    try {
      return execFileSync('ssh', [
        '-i', expandedKey,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        `${node.ssh_user}@${node.host}`,
        cmd,
      ], { encoding: 'utf8', timeout: 60_000 });
    } catch (e: any) {
      throw new Error(`SSH to ${node.host} failed: ${e.message}`);
    }
  }

  private scpTo(node: VpsNodeRow, localPath: string, remotePath: string): void {
    const expandedKey = node.ssh_key_path.replace('~', process.env.HOME ?? '/home/hfsp');
    execFileSync('scp', [
      '-i', expandedKey,
      '-o', 'StrictHostKeyChecking=no',
      '-r', localPath,
      `${node.ssh_user}@${node.host}:${remotePath}`,
    ], { timeout: 120_000 });
  }

  // ── Remote Provisioning ────────────────────────────────────────────────────

  private async provisionRemote(
    node: VpsNodeRow,
    config: ProvisionConfig,
    port: number
  ): Promise<ProvisionResult> {
    const { tenantId, containerName, secretsPath, configPath, workspacePath, image, env } = config;
    const name = containerName ?? `hfsp_${tenantId}`;

    // 1. Copy tenant files to remote node
    const remoteBase = `/home/hfsp/tenants/${tenantId}`;
    this.ssh(node, `mkdir -p ${remoteBase}/secrets ${remoteBase}/workspace`);
    this.scpTo(node, secretsPath, `${remoteBase}/secrets`);
    this.scpTo(node, configPath, `${remoteBase}/openclaw.json`);

    // 2. Build docker run command
    const envArgs = Object.entries(env ?? {})
      .map(([k, v]) => `-e ${k}=${v}`).join(' ');

    const dockerCmd = [
      `docker rm -f ${name} 2>/dev/null || true`,
      `&&`,
      `docker create`,
      `--name ${name}`,
      `--restart unless-stopped`,
      `--memory 512m --memory-swap 512m --cpus 0.75`,
      `-p 127.0.0.1:${port}:${port}`,
      `-e HOME=/home/hfsp`,
      `-e GATEWAY_PORT=${port}`,
      envArgs,
      `-v ${remoteBase}/openclaw.json:/run/openclaw/openclaw.json:ro`,
      `-v ${remoteBase}/workspace:/tenant/workspace`,
      `-v ${remoteBase}/secrets:/home/hfsp/.openclaw/secrets:ro`,
      image ?? 'hfsp-openclaw-runtime:local',
      `&& docker start ${name}`,
    ].join(' ');

    this.ssh(node, dockerCmd);

    // 3. Health probe (bash TCP)
    let healthy = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const out = this.ssh(node,
          `bash -c '(exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null && echo ok || echo fail'`
        ).trim();
        if (out === 'ok') { healthy = true; break; }
      } catch { /* retry */ }
    }

    if (!healthy) {
      // Cleanup on failure
      try { this.ssh(node, `docker rm -f ${name} 2>/dev/null || true`); } catch {}
      return { ok: false, tenantId, containerName: name, image: image ?? '', gatewayPort: port, gatewayUrl: '', publicUrl: '', startedAt: '', finishedAt: new Date().toISOString(), healthPassed: false, error: `Container on ${node.host} did not become healthy` };
    }

    // 4. Update PIERCALITO nginx to route to this remote container
    await this.nginx.addRemoteTenant(tenantId, node.host, port);

    const publicUrl = this.nginx.gatewayUrl(tenantId);
    return { ok: true, tenantId, containerName: name, image: image ?? '', gatewayPort: port, gatewayUrl: `ws://${node.host}:${port}`, publicUrl, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), healthPassed: true };
  }

  // ── Main provision() ──────────────────────────────────────────────────────

  async provision(config: MultiProvisionConfig): Promise<ProvisionResult> {
    // Select target node
    let node: VpsNodeRow;
    if (config.preferNodeId !== undefined) {
      node = this.db.prepare('SELECT * FROM vps_nodes WHERE id = ?').get(config.preferNodeId);
      if (!node) return { ok: false, tenantId: config.tenantId, containerName: '', image: '', gatewayPort: 0, gatewayUrl: '', publicUrl: '', startedAt: '', finishedAt: '', healthPassed: false, error: `Node ${config.preferNodeId} not found` };
    } else {
      node = this.selectBestNode();
    }

    // Allocate port on target node
    const port = this.allocatePort(node.id);

    // Update tenant record with node + port
    this.db.prepare(`
      UPDATE tenants SET vps_node_id = ?, dashboard_port = ? WHERE tenant_id = ?
    `).run(node.id, port, config.tenantId);

    // Delegate to local or remote
    if (this.isLocalNode(node)) {
      return this.local.provision({ ...config, port } as any);
    } else {
      return this.provisionRemote(node, config, port);
    }
  }

  // ── Deprovision ───────────────────────────────────────────────────────────

  async deprovision(tenantId: string): Promise<void> {
    const tenant = this.db.prepare(
      'SELECT vps_node_id, dashboard_port FROM tenants WHERE tenant_id = ?'
    ).get(tenantId) as any;

    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    const node = this.db.prepare('SELECT * FROM vps_nodes WHERE id = ?')
      .get(tenant.vps_node_id) as VpsNodeRow | undefined;

    const name = `hfsp_${tenantId}`;

    if (!node || this.isLocalNode(node)) {
      await deprovisionTenant(tenantId, this.db);
    } else {
      try { this.ssh(node, `docker rm -f ${name} 2>/dev/null || true`); } catch {}
    }

    // Remove nginx routing
    await this.nginx.removeTenant(tenantId);

    // Update DB
    this.db.prepare(`
      UPDATE tenants SET status = 'deleted', deleted_at = datetime('now') WHERE tenant_id = ?
    `).run(tenantId);
  }

  // ── Node Bootstrap ────────────────────────────────────────────────────────

  /**
   * Bootstrap a fresh node: install Docker, create hfsp user, load image.
   * Called when adding a new node to the fleet.
   */
  async bootstrapNode(nodeId: number): Promise<void> {
    const node = this.db.prepare('SELECT * FROM vps_nodes WHERE id = ?')
      .get(nodeId) as VpsNodeRow;
    if (!node) throw new Error(`Node ${nodeId} not found`);

    console.log(`[bootstrap] Setting up ${node.name} (${node.host})...`);

    const BOOTSTRAP = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Install Docker
if ! command -v docker &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \$VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq && apt-get install -y -qq docker-ce docker-ce-cli containerd.io
fi

# Create hfsp user (UID 1002 must match PIERCALITO)
if ! id hfsp &>/dev/null; then
  useradd -u 1002 -m -s /bin/bash -G docker hfsp
fi

# Create directories
mkdir -p /home/hfsp/tenants /home/hfsp/.openclaw/secrets
chown -R hfsp:hfsp /home/hfsp/tenants /home/hfsp/.openclaw

# Sudo for nginx reload
echo 'hfsp ALL=(ALL) NOPASSWD: /usr/sbin/nginx' > /etc/sudoers.d/hfsp-nginx
chmod 440 /etc/sudoers.d/hfsp-nginx

echo "[bootstrap] Node ready"
`.trim();

    this.ssh(node, BOOTSTRAP);

    // Transfer docker image
    console.log(`[bootstrap] Transferring Docker image...`);
    const expandedKey = node.ssh_key_path.replace('~', process.env.HOME ?? '/home/hfsp');
    execSync(
      `docker save hfsp-openclaw-runtime:local | ssh -i ${expandedKey} -o StrictHostKeyChecking=no ${node.ssh_user}@${node.host} "docker load"`,
      { stdio: 'inherit', timeout: 300_000 }
    );

    // Mark node active
    this.db.prepare(`
      UPDATE vps_nodes SET status = 'active', added_at = datetime('now') WHERE id = ?
    `).run(nodeId);

    console.log(`[bootstrap] ${node.name} is now active`);
  }
}
