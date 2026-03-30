import { execFileSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { VpsRegistry, VpsNode } from './vps-registry';

const NGINX_TENANT_CONF_DIR = '/etc/nginx/conf.d/hfsp-tenants';

function sshRun(node: VpsNode, cmd: string[]): void {
  execFileSync('ssh', [
    '-i', node.ssh_key_path,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${node.ssh_user}@${node.host}`,
    ...cmd,
  ], { stdio: 'pipe' });
}

export async function deprovisionTenant(
  tenantId: string,
  db: Database.Database,
  registry: VpsRegistry,
): Promise<void> {
  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(tenantId) as any;
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  const nodeId = tenant.vps_node_id ?? 1;
  const node = registry.get(nodeId);
  const containerName = `hfsp_${tenantId}`;

  // 1. Stop + remove container (local or remote)
  if (registry.isLocal(node)) {
    try { execFileSync('docker', ['stop', containerName], { stdio: 'pipe' }); } catch {}
    try { execFileSync('docker', ['rm', '-f', containerName], { stdio: 'pipe' }); } catch {}
  } else {
    try { sshRun(node, ['docker', 'stop', containerName]); } catch {}
    try { sshRun(node, ['docker', 'rm', '-f', containerName]); } catch {}
  }

  // 2. Remove nginx conf + reload
  const confPath = `${NGINX_TENANT_CONF_DIR}/${tenantId}.conf`;
  if (existsSync(confPath)) {
    try { unlinkSync(confPath); } catch {}
  }
  try { execFileSync('sudo', ['nginx', '-s', 'reload'], { stdio: 'pipe' }); } catch {}

  // 3. Mark deleted in DB + decrement node counter
  db.prepare(`
    UPDATE tenants SET status = 'deleted', deleted_at = datetime('now') WHERE tenant_id = ?
  `).run(tenantId);
  registry.decrementAgents(nodeId);
}

export async function stopTenant(
  tenantId: string,
  db: Database.Database,
  registry: VpsRegistry,
): Promise<void> {
  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(tenantId) as any;
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
  const node = registry.get(tenant.vps_node_id ?? 1);
  const containerName = `hfsp_${tenantId}`;
  if (registry.isLocal(node)) {
    execFileSync('docker', ['stop', containerName], { stdio: 'pipe' });
  } else {
    sshRun(node, ['docker', 'stop', containerName]);
  }
  db.prepare("UPDATE tenants SET status = 'stopped' WHERE tenant_id = ?").run(tenantId);
}

export async function startTenant(
  tenantId: string,
  db: Database.Database,
  registry: VpsRegistry,
): Promise<void> {
  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(tenantId) as any;
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
  const node = registry.get(tenant.vps_node_id ?? 1);
  const containerName = `hfsp_${tenantId}`;
  if (registry.isLocal(node)) {
    execFileSync('docker', ['start', containerName], { stdio: 'pipe' });
  } else {
    sshRun(node, ['docker', 'start', containerName]);
  }
  db.prepare("UPDATE tenants SET status = 'active' WHERE tenant_id = ?").run(tenantId);
}
