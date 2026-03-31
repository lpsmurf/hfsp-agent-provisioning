import { execFileSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';

const NGINX_TENANT_CONF_DIR = '/etc/nginx/conf.d/hfsp-tenants';

interface NodeRow {
  id: number;
  host: string;
  ssh_user: string;
  ssh_key_path: string;
}

function isLocal(host: string): boolean {
  return host === '72.62.239.63' || host === 'localhost' || host === '127.0.0.1';
}

function sshRun(node: NodeRow, cmd: string): void {
  const key = node.ssh_key_path.replace('~', process.env.HOME ?? '/home/hfsp');
  execFileSync('ssh', [
    '-i', key,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${node.ssh_user}@${node.host}`,
    cmd,
  ], { stdio: 'pipe', timeout: 30_000 });
}

function getNode(db: any, nodeId: number): NodeRow | null {
  return db.prepare('SELECT id, host, ssh_user, ssh_key_path FROM vps_nodes WHERE id = ?')
    .get(nodeId) as NodeRow | null;
}

export async function deprovisionTenant(tenantId: string, db: any): Promise<void> {
  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(tenantId) as any;
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  const nodeId = tenant.vps_node_id ?? 1;
  const node = getNode(db, nodeId);
  const name = `hfsp_${tenantId}`;

  if (!node || isLocal(node.host)) {
    try { execFileSync('docker', ['stop', name], { stdio: 'pipe' }); } catch {}
    try { execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' }); } catch {}
  } else {
    try { sshRun(node, `docker stop ${name} 2>/dev/null || true`); } catch {}
    try { sshRun(node, `docker rm -f ${name} 2>/dev/null || true`); } catch {}
  }

  const confPath = `${NGINX_TENANT_CONF_DIR}/${tenantId}.conf`;
  if (existsSync(confPath)) try { unlinkSync(confPath); } catch {}
  try { execFileSync('sudo', ['nginx', '-s', 'reload'], { stdio: 'pipe' }); } catch {}

  db.prepare(`
    UPDATE tenants SET status = 'deleted', deleted_at = datetime('now') WHERE tenant_id = ?
  `).run(tenantId);
}

export async function stopTenant(tenantId: string, db: any): Promise<void> {
  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(tenantId) as any;
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  const node = getNode(db, tenant.vps_node_id ?? 1);
  const name = `hfsp_${tenantId}`;

  if (!node || isLocal(node.host)) {
    execFileSync('docker', ['stop', name], { stdio: 'pipe' });
  } else {
    sshRun(node, `docker stop ${name}`);
  }
  db.prepare("UPDATE tenants SET status = 'stopped' WHERE tenant_id = ?").run(tenantId);
}

export async function startTenant(tenantId: string, db: any): Promise<void> {
  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(tenantId) as any;
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  const node = getNode(db, tenant.vps_node_id ?? 1);
  const name = `hfsp_${tenantId}`;

  if (!node || isLocal(node.host)) {
    execFileSync('docker', ['start', name], { stdio: 'pipe' });
  } else {
    sshRun(node, `docker start ${name}`);
  }
  db.prepare("UPDATE tenants SET status = 'active' WHERE tenant_id = ?").run(tenantId);
}
