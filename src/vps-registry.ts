import Database from 'better-sqlite3';

export interface VpsNode {
  id: number;
  name: string;
  host: string;
  ssh_user: string;
  ssh_key_path: string;
  port_range_start: number;
  port_range_end: number;
  status: 'active' | 'draining' | 'offline';
  capacity_agents_max: number;
  agents_current: number;
  added_at: string;
}

export class VpsRegistry {
  constructor(private db: Database.Database) {}

  list(): VpsNode[] {
    return this.db.prepare('SELECT * FROM vps_nodes ORDER BY id').all() as VpsNode[];
  }

  get(id: number): VpsNode {
    const node = this.db.prepare('SELECT * FROM vps_nodes WHERE id = ?').get(id) as VpsNode | undefined;
    if (!node) throw new Error(`VPS node ${id} not found`);
    return node;
  }

  /** Pick the active node with the most remaining capacity */
  getBestNode(): VpsNode {
    const node = this.db.prepare(`
      SELECT * FROM vps_nodes
      WHERE status = 'active' AND agents_current < capacity_agents_max
      ORDER BY (agents_current * 1.0 / capacity_agents_max) ASC
      LIMIT 1
    `).get() as VpsNode | undefined;
    if (!node) throw new Error('No VPS nodes available — all at capacity or offline');
    return node;
  }

  add(node: Omit<VpsNode, 'id' | 'added_at' | 'agents_current'>): VpsNode {
    const result = this.db.prepare(`
      INSERT INTO vps_nodes (name, host, ssh_user, ssh_key_path, port_range_start, port_range_end, status, capacity_agents_max)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(node.name, node.host, node.ssh_user, node.ssh_key_path,
           node.port_range_start, node.port_range_end, node.status, node.capacity_agents_max);
    return this.get(result.lastInsertRowid as number);
  }

  update(id: number, patch: Partial<Pick<VpsNode, 'status' | 'capacity_agents_max' | 'name'>>): void {
    const fields = Object.keys(patch).map(k => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE vps_nodes SET ${fields} WHERE id = ?`)
      .run(...Object.values(patch), id);
  }

  remove(id: number): void {
    if (id === 1) throw new Error('Cannot remove the primary node (id=1)');
    this.db.prepare('DELETE FROM vps_nodes WHERE id = ?').run(id);
  }

  incrementAgents(nodeId: number): void {
    this.db.prepare('UPDATE vps_nodes SET agents_current = agents_current + 1 WHERE id = ?').run(nodeId);
  }

  decrementAgents(nodeId: number): void {
    this.db.prepare('UPDATE vps_nodes SET agents_current = MAX(0, agents_current - 1) WHERE id = ?').run(nodeId);
  }

  isLocal(node: VpsNode): boolean {
    return node.host === 'localhost' || node.host === '127.0.0.1';
  }
}
