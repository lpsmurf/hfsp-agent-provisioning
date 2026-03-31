/**
 * Node Scaler — Hostinger API integration
 * Auto-provisions new VPS nodes when fleet is at capacity.
 */
import { execSync } from 'child_process';

const HOSTINGER_API = 'https://api.hostinger.com/v1';
const LOCAL_HOST = '72.62.239.63';
const CAPACITY_THRESHOLD = 0.85; // Trigger at 85% usage

interface HostingerVM {
  id: number;
  plan: string;
  hostname: string;
  state: string;
  cpus: number;
  memory: number;
  ipv4: Array<{ address: string }>;
}

async function hostingerRequest<T>(
  method: string,
  endpoint: string,
  body?: object
): Promise<T> {
  const token = process.env.HOSTINGER_API_TOKEN ?? '';
  const res = await fetch(`${HOSTINGER_API}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Hostinger API ${method} ${endpoint} → ${res.status}`);
  return res.json() as T;
}

export class NodeScaler {
  constructor(private db: any) {}

  /** Check overall fleet capacity, return % used */
  getFleetUsage(): number {
    const result = this.db.prepare(`
      SELECT
        SUM(capacity_agents_max) as total_max,
        SUM((
          SELECT COUNT(*) FROM tenants t
          WHERE t.vps_node_id = n.id
            AND t.status IN ('active','provisioning')
            AND t.deleted_at IS NULL
        )) as total_active
      FROM vps_nodes n
      WHERE n.status = 'active'
    `).get() as any;

    if (!result?.total_max || result.total_max === 0) return 0;
    return (result.total_active ?? 0) / result.total_max;
  }

  /** Returns true if a new node should be provisioned */
  shouldScale(): boolean {
    return this.getFleetUsage() >= CAPACITY_THRESHOLD;
  }

  /** List Hostinger VMs via API */
  async listHostingerVMs(): Promise<HostingerVM[]> {
    return hostingerRequest<HostingerVM[]>('GET', '/vps/virtual-machine');
  }

  /**
   * Register an existing Hostinger VM as a worker node.
   * Used when you've already purchased a VM via hPanel.
   */
  async registerExistingNode(opts: {
    hostingerVmId: number;
    portRangeStart: number;
    portRangeEnd: number;
    sshKeyPath?: string;
    maxContainers?: number;
  }): Promise<number> {
    const vms = await this.listHostingerVMs();
    const vm = vms.find(v => v.id === opts.hostingerVmId);
    if (!vm) throw new Error(`VM ${opts.hostingerVmId} not found in Hostinger`);
    if (!vm.ipv4?.[0]?.address) throw new Error(`VM ${opts.hostingerVmId} has no IPv4`);

    const ip = vm.ipv4[0].address;
    const name = vm.hostname.split('.')[0].toUpperCase();

    // Check if already registered
    const existing = this.db.prepare('SELECT id FROM vps_nodes WHERE host = ?').get(ip);
    if (existing) throw new Error(`Node ${ip} already registered`);

    const stmt = this.db.prepare(`
      INSERT INTO vps_nodes (name, host, ssh_user, ssh_key_path,
        port_range_start, port_range_end, capacity_agents_max, status)
      VALUES (?, ?, 'root', ?, ?, ?, ?, 'offline')
    `);
    const result = stmt.run(
      `${name} (Worker)`, ip,
      opts.sshKeyPath ?? '/home/hfsp/.ssh/id_ed25519',
      opts.portRangeStart, opts.portRangeEnd,
      opts.maxContainers ?? 40
    );
    const nodeId = result.lastInsertRowid as number;
    console.log(`[scaler] Registered ${name} (${ip}) as node ${nodeId}`);
    return nodeId;
  }

  /** Get fleet summary for admin dashboard */
  getFleetSummary() {
    const nodes = this.db.prepare(`
      SELECT n.*,
        (SELECT COUNT(*) FROM tenants t
         WHERE t.vps_node_id = n.id
           AND t.status IN ('active','provisioning')
           AND t.deleted_at IS NULL) as active_agents
      FROM vps_nodes n
      ORDER BY n.id
    `).all() as any[];

    const totalCapacity = nodes.reduce((s: number, n: any) => s + n.capacity_agents_max, 0);
    const totalActive   = nodes.reduce((s: number, n: any) => s + n.active_agents, 0);
    const usagePct = totalCapacity > 0
      ? Math.round((totalActive / totalCapacity) * 100) : 0;

    return {
      nodes: nodes.map((n: any) => ({
        id: n.id,
        name: n.name,
        host: n.host,
        status: n.status,
        activeAgents: n.active_agents,
        maxAgents: n.capacity_agents_max,
        usagePct: Math.round((n.active_agents / n.capacity_agents_max) * 100),
        portRange: `${n.port_range_start}–${n.port_range_end}`,
      })),
      fleet: { totalCapacity, totalActive, usagePct },
      needsScale: usagePct >= CAPACITY_THRESHOLD * 100,
    };
  }
}
