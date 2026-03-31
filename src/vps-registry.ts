/**
 * VPS Node Registry
 * Manages distributed provisioning across multiple VPS nodes
 */
// @ts-ignore - better-sqlite3 import
import Database from 'better-sqlite3';
import { execSync } from 'child_process';

export interface VpsNode {
  id: string;
  name: string;
  host: string;
  sshUser: string;
  sshKeyPath: string;
  portRangeStart: number;
  portRangeEnd: number;
  status: 'active' | 'draining' | 'offline' | 'maintenance';
  maxContainers: number;
  cpuLimitPercent: number;
  memoryLimitMb: number;
  lastHealthCheck: string | null;
  lastHealthStatus: string | null;
  addedAt: string;
  updatedAt: string;
}

export interface NodeCapacity {
  nodeId: string;
  totalContainers: number;
  activeContainers: number;
  availableCapacity: number;
  cpuUsagePercent: number;
  memoryUsageMb: number;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
}

export class VpsRegistry {
  constructor(private db: any) {  // Database from better-sqlite3
    this.ensureSchema();
  }

  private ensureSchema() {
    // Schema already created by migration
  }

  // ─── Node Management ──────────────────────────────────────────────────────

  /**
   * Add a new VPS node to the registry
   */
  addNode(opts: {
    id: string;
    name: string;
    host: string;
    sshUser?: string;
    sshKeyPath?: string;
    portRangeStart: number;
    portRangeEnd: number;
    maxContainers?: number;
  }): VpsNode {
    this.db.prepare(`
      INSERT INTO vps_nodes (
        id, name, host, ssh_user, ssh_key_path,
        port_range_start, port_range_end, max_containers, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      opts.id,
      opts.name,
      opts.host,
      opts.sshUser ?? 'hfsp',
      opts.sshKeyPath ?? '~/.ssh/id_ed25519',
      opts.portRangeStart,
      opts.portRangeEnd,
      opts.maxContainers ?? 100
    );

    const node = this.db.prepare('SELECT * FROM vps_nodes WHERE id = ?').get(opts.id) as any;
    return this.mapNode(node);
  }

  /**
   * Remove a VPS node (mark as offline)
   */
  removeNode(nodeId: string): void {
    this.db.prepare(`
      UPDATE vps_nodes
      SET status = 'offline', updated_at = datetime('now')
      WHERE id = ?
    `).run(nodeId);
  }

  /**
   * Get a specific node
   */
  getNode(nodeId: string): VpsNode | null {
    const node = this.db.prepare('SELECT * FROM vps_nodes WHERE id = ?').get(nodeId) as any;
    return node ? this.mapNode(node) : null;
  }

  /**
   * List all nodes (active by default)
   */
  listNodes(activeOnly = true): VpsNode[] {
    const query = activeOnly
      ? 'SELECT * FROM vps_nodes WHERE status = ? ORDER BY added_at'
      : 'SELECT * FROM vps_nodes ORDER BY added_at';
    const rows = this.db.prepare(query).all(...(activeOnly ? ['active'] : [])) as any[];
    return rows.map(r => this.mapNode(r));
  }

  /**
   * Update node status
   */
  setNodeStatus(nodeId: string, status: 'active' | 'draining' | 'offline' | 'maintenance'): void {
    this.db.prepare(`
      UPDATE vps_nodes
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, nodeId);
  }

  // ─── Capacity & Health ────────────────────────────────────────────────────

  /**
   * Get capacity info for a node
   */
  getNodeCapacity(nodeId: string): NodeCapacity {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    // Count containers on this node
    const containerCount = (this.db.prepare(`
      SELECT COUNT(*) as cnt FROM tenants
      WHERE vps_node_id = ? AND deleted_at IS NULL
    `).get(nodeId) as any).cnt ?? 0;

    const activeCount = (this.db.prepare(`
      SELECT COUNT(*) as cnt FROM tenants
      WHERE vps_node_id = ? AND status IN ('active','provisioning')
      AND deleted_at IS NULL
    `).get(nodeId) as any).cnt ?? 0;

    return {
      nodeId,
      totalContainers: containerCount,
      activeContainers: activeCount,
      availableCapacity: Math.max(0, node.maxContainers - activeCount),
      cpuUsagePercent: 0, // TODO: Query from node or monitoring service
      memoryUsageMb: 0,   // TODO: Query from node or monitoring service
      healthStatus: 'unknown', // TODO: Check health endpoint
    };
  }

  /**
   * Select the best node for provisioning
   * Criteria: active status, has available capacity, lowest load
   */
  selectBestNode(): VpsNode {
    const activeNodes = this.listNodes(true);
    if (activeNodes.length === 0) throw new Error('No active nodes available');

    // Score each node: prefer highest available capacity
    const scored = activeNodes.map(node => {
      const capacity = this.getNodeCapacity(node.id);
      return {
        node,
        score: capacity.availableCapacity * 100 - capacity.activeContainers,
      };
    });

    // Sort by score (descending)
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (best.node.status !== 'active') {
      throw new Error(`Best node ${best.node.id} is not active`);
    }

    const capacity = this.getNodeCapacity(best.node.id);
    if (capacity.availableCapacity <= 0) {
      throw new Error(`No capacity available on any node`);
    }

    return best.node;
  }

  /**
   * Update health check for a node
   */
  updateHealthCheck(nodeId: string, status: string, statusMsg?: string): void {
    this.db.prepare(`
      UPDATE vps_nodes
      SET last_health_check = datetime('now'),
          last_health_status = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(statusMsg ?? status, nodeId);
  }

  // ─── Port Management ──────────────────────────────────────────────────────

  /**
   * Get the next available port for a node
   */
  getNextAvailablePort(nodeId: string): number {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    // Get all allocated ports for this node
    const allocated = this.db.prepare(`
      SELECT dashboard_port FROM tenants
      WHERE vps_node_id = ? AND deleted_at IS NULL AND dashboard_port IS NOT NULL
      ORDER BY dashboard_port ASC
    `).all(nodeId) as any[];

    const allocatedPorts = new Set(allocated.map((r: any) => r.dashboard_port));

    // Find first available port in range
    for (let port = node.portRangeStart; port <= node.portRangeEnd; port++) {
      if (!allocatedPorts.has(port)) return port;
    }

    throw new Error(`No available ports on node ${nodeId}`);
  }

  /**
   * Allocate a port for a tenant on a specific node
   */
  allocatePort(nodeId: string, tenantId: string): number {
    const port = this.getNextAvailablePort(nodeId);
    this.db.prepare(`
      UPDATE tenants
      SET dashboard_port = ?, vps_node_id = ?
      WHERE tenant_id = ?
    `).run(port, nodeId, tenantId);
    return port;
  }

  /**
   * Release a port when tenant is deleted
   */
  releasePort(tenantId: string): void {
    this.db.prepare(`
      UPDATE tenants
      SET dashboard_port = NULL
      WHERE tenant_id = ?
    `).run(tenantId);
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private mapNode(row: any): VpsNode {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      sshUser: row.ssh_user,
      sshKeyPath: row.ssh_key_path,
      portRangeStart: row.port_range_start,
      portRangeEnd: row.port_range_end,
      status: row.status,
      maxContainers: row.max_containers,
      cpuLimitPercent: row.cpu_limit_percent,
      memoryLimitMb: row.memory_limit_mb,
      lastHealthCheck: row.last_health_check,
      lastHealthStatus: row.last_health_status,
      addedAt: row.added_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Generate a summary of all nodes and their capacity
   */
  getSummary(): string {
    const nodes = this.listNodes(false);
    const lines = ['VPS Registry Summary:', ''];

    for (const node of nodes) {
      const capacity = this.getNodeCapacity(node.id);
      lines.push(`${node.name} (${node.id})`);
      lines.push(`  Host: ${node.host}:${node.portRangeStart}-${node.portRangeEnd}`);
      lines.push(`  Status: ${node.status}`);
      lines.push(
        `  Capacity: ${capacity.activeContainers}/${node.maxContainers} active ` +
        `(${capacity.availableCapacity} available)`
      );
      lines.push('');
    }

    return lines.join('\n');
  }
}
