import express, { Request, Response } from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';

/**
 * HFSP Admin API
 * REST endpoints for managing tenants, users, billing, and audit logs
 */

const app = express();
const PORT = process.env.ADMIN_API_PORT || 4000;
const DB_PATH = process.env.DB_PATH || '../storefront-bot/hfsp.db';

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
let db: Database.Database;
try {
  db = new Database(path.resolve(__dirname, DB_PATH));
  console.log('✅ Database connected');
} catch (err) {
  console.error('❌ Database connection failed:', err);
  process.exit(1);
}

// ============================================================================
// TENANTS API
// ============================================================================

/**
 * GET /api/tenants
 * List all tenants with pagination
 */
app.get('/api/tenants', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string; // optional filter

    let query = `SELECT 
      tenant_id,
      telegram_user_id,
      agent_name,
      provider,
      model_preset,
      status,
      dashboard_port,
      created_at,
      updated_at,
      deleted_at
    FROM tenants WHERE deleted_at IS NULL`;

    const params: any[] = [];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const tenants = db.prepare(query).all(...params) as any[];
    const totalResult = db.prepare(
      `SELECT COUNT(*) as count FROM tenants WHERE deleted_at IS NULL ${status ? 'AND status = ?' : ''}`
    ).get(...(status ? [status] : [])) as any;

    res.json({
      data: tenants,
      pagination: {
        limit,
        offset,
        total: totalResult.count
      }
    });
  } catch (err) {
    console.error('Error fetching tenants:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:tenantId
 * Get single tenant details
 */
app.get('/api/tenants/:tenantId', (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const tenant = db.prepare(
      `SELECT * FROM tenants WHERE tenant_id = ? AND deleted_at IS NULL`
    ).get(tenantId) as any;

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({ data: tenant });
  } catch (err) {
    console.error('Error fetching tenant:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * DELETE /api/tenants/:tenantId
 * Soft-delete a tenant (mark deleted_at)
 */
app.delete('/api/tenants/:tenantId', (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const timestamp = new Date().toISOString();

    db.prepare(`UPDATE tenants SET deleted_at = ?, status = 'deleted' WHERE tenant_id = ?`)
      .run(timestamp, tenantId);

    // Log audit
    logAudit('DELETE_TENANT', tenantId, { tenantId, deletedAt: timestamp });

    res.json({ success: true, message: `Tenant ${tenantId} deleted` });
  } catch (err) {
    console.error('Error deleting tenant:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:tenantId/status
 * Get real-time tenant status (container, resource usage)
 */
app.get('/api/tenants/:tenantId/status', (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const tenant = db.prepare(
      `SELECT * FROM tenants WHERE tenant_id = ? AND deleted_at IS NULL`
    ).get(tenantId) as any;

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({
      data: {
        tenantId,
        status: tenant.status,
        containerName: `hfsp_${tenantId}`,
        dashboardPort: tenant.dashboard_port,
        vpsNode: tenant.vps_node_id || 'piercalito',
        createdAt: tenant.created_at,
        // Note: real-time Docker stats would require VPS connection
        // For now, just show database state
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error fetching tenant status:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// USERS API
// ============================================================================

/**
 * GET /api/users
 * List all users
 */
app.get('/api/users', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const users = db.prepare(
      `SELECT 
        telegram_user_id,
        COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) as active_tenants,
        COUNT(*) as total_tenants,
        MAX(created_at) as last_tenant_created,
        MIN(created_at) as first_tenant_created
      FROM tenants
      GROUP BY telegram_user_id
      ORDER BY MAX(created_at) DESC
      LIMIT ? OFFSET ?`
    ).all(limit, offset) as any[];

    const totalResult = db.prepare(
      `SELECT COUNT(DISTINCT telegram_user_id) as count FROM tenants`
    ).get() as any;

    res.json({
      data: users,
      pagination: { limit, offset, total: totalResult.count }
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/users/:userId
 * Get user details and their tenants
 */
app.get('/api/users/:userId', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const tenants = db.prepare(
      `SELECT * FROM tenants WHERE telegram_user_id = ? ORDER BY created_at DESC`
    ).all(userId) as any[];

    const stats = db.prepare(
      `SELECT 
        COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) as active_tenants,
        COUNT(*) as total_tenants
      FROM tenants WHERE telegram_user_id = ?`
    ).get(userId) as any;

    res.json({
      data: {
        userId,
        stats,
        tenants
      }
    });
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// BILLING API
// ============================================================================

/**
 * GET /api/billing/subscriptions
 * List all subscriptions
 */
app.get('/api/billing/subscriptions', (req: Request, res: Response) => {
  try {
    // Check if subscriptions table exists
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions'`
    ).all();

    if (tables.length === 0) {
      return res.json({
        data: [],
        message: 'Subscriptions table not yet created',
        pagination: { limit: 0, offset: 0, total: 0 }
      });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string;

    let query = 'SELECT * FROM subscriptions WHERE 1=1';
    const params: any[] = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const subscriptions = db.prepare(query).all(...params) as any[];
    const totalResult = db.prepare(
      `SELECT COUNT(*) as count FROM subscriptions`
    ).get() as any;

    res.json({
      data: subscriptions,
      pagination: { limit, offset, total: totalResult.count }
    });
  } catch (err) {
    console.error('Error fetching subscriptions:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/billing/usage
 * Get usage metrics and billing info
 */
app.get('/api/billing/usage', (req: Request, res: Response) => {
  try {
    const totalTenants = (
      db.prepare(`SELECT COUNT(*) as count FROM tenants WHERE deleted_at IS NULL`).get() as any
    ).count;

    const tenantsByStatus = db.prepare(
      `SELECT status, COUNT(*) as count FROM tenants WHERE deleted_at IS NULL GROUP BY status`
    ).all() as any[];

    const tenantsByProvider = db.prepare(
      `SELECT provider, COUNT(*) as count FROM tenants WHERE deleted_at IS NULL GROUP BY provider`
    ).all() as any[];

    res.json({
      data: {
        totalTenants,
        tenantsByStatus: Object.fromEntries(tenantsByStatus.map(s => [s.status, s.count])),
        tenantsByProvider: Object.fromEntries(tenantsByProvider.map(p => [p.provider, p.count])),
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error fetching usage:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// AUDIT API
// ============================================================================

/**
 * GET /api/audit/logs
 * Get audit logs
 */
app.get('/api/audit/logs', (req: Request, res: Response) => {
  try {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'`
    ).all();

    if (tables.length === 0) {
      return res.json({
        data: [],
        message: 'Audit logs table not yet created',
        pagination: { limit: 0, offset: 0, total: 0 }
      });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const action = req.query.action as string;

    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: any[] = [];

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = db.prepare(query).all(...params) as any[];
    const totalResult = db.prepare(
      `SELECT COUNT(*) as count FROM audit_logs`
    ).get() as any;

    res.json({
      data: logs,
      pagination: { limit, offset, total: totalResult.count }
    });
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// VPS API (cluster management)
// ============================================================================

/**
 * GET /api/vps/nodes
 * List VPS nodes in cluster
 */
app.get('/api/vps/nodes', (req: Request, res: Response) => {
  try {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='vps_nodes'`
    ).all();

    if (tables.length === 0) {
      return res.json({
        data: [],
        message: 'VPS registry not yet initialized',
        total: 0
      });
    }

    const nodes = db.prepare(
      `SELECT * FROM vps_nodes WHERE status != 'deleted' ORDER BY created_at`
    ).all() as any[];

    // Calculate usage for each node
    const nodesWithUsage = nodes.map((node: any) => {
      const tenantCount = (
        db.prepare(
          `SELECT COUNT(*) as count FROM tenants WHERE vps_node_id = ? AND deleted_at IS NULL`
        ).get(node.id) as any
      ).count;

      return {
        ...node,
        usedContainers: tenantCount,
        availableContainers: node.max_containers - tenantCount,
        utilizationPercent: Math.round((tenantCount / node.max_containers) * 100)
      };
    });

    res.json({
      data: nodesWithUsage,
      total: nodes.length
    });
  } catch (err) {
    console.error('Error fetching VPS nodes:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/vps/capacity
 * Get cluster capacity summary
 */
app.get('/api/vps/capacity', (req: Request, res: Response) => {
  try {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='vps_nodes'`
    ).all();

    if (tables.length === 0) {
      return res.json({
        data: {
          totalCapacity: 0,
          usedCapacity: 0,
          availableCapacity: 0,
          utilizationPercent: 0,
          nodes: 0
        }
      });
    }

    const capacityResult = db.prepare(
      `SELECT 
        SUM(max_containers) as total,
        COUNT(*) as node_count
      FROM vps_nodes WHERE status != 'deleted'`
    ).get() as any;

    const usedResult = db.prepare(
      `SELECT COUNT(*) as count FROM tenants WHERE deleted_at IS NULL`
    ).get() as any;

    const totalCapacity = capacityResult.total || 0;
    const usedCapacity = usedResult.count || 0;
    const availableCapacity = totalCapacity - usedCapacity;
    const utilizationPercent = totalCapacity > 0 
      ? Math.round((usedCapacity / totalCapacity) * 100) 
      : 0;

    res.json({
      data: {
        totalCapacity,
        usedCapacity,
        availableCapacity,
        utilizationPercent,
        nodes: capacityResult.node_count || 0,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error calculating capacity:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// HEALTH & METRICS
// ============================================================================

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /api/metrics
 * System metrics
 */
app.get('/api/metrics', (req: Request, res: Response) => {
  try {
    const totalTenants = (
      db.prepare(`SELECT COUNT(*) as count FROM tenants WHERE deleted_at IS NULL`).get() as any
    ).count;

    const activeTenants = (
      db.prepare(`SELECT COUNT(*) as count FROM tenants WHERE status = 'active' AND deleted_at IS NULL`).get() as any
    ).count;

    const provisioningTenants = (
      db.prepare(`SELECT COUNT(*) as count FROM tenants WHERE status = 'provisioning' AND deleted_at IS NULL`).get() as any
    ).count;

    const totalUsers = (
      db.prepare(`SELECT COUNT(DISTINCT telegram_user_id) as count FROM tenants`).get() as any
    ).count;

    res.json({
      data: {
        totalTenants,
        activeTenants,
        provisioningTenants,
        totalUsers,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error fetching metrics:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Helper: Log audit events
 */
function logAudit(action: string, resourceId: string, details: any): void {
  try {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'`
    ).all();

    if (tables.length === 0) {
      console.warn('Audit logs table does not exist, skipping audit log');
      return;
    }

    db.prepare(
      `INSERT INTO audit_logs (action, resource_id, details, timestamp)
       VALUES (?, ?, ?, ?)`
    ).run(
      action,
      resourceId,
      JSON.stringify(details),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Error logging audit:', err);
  }
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: any, req: Request, res: Response) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`🚀 Admin API listening on http://localhost:${PORT}`);
  console.log(`📊 API Root: /api`);
  console.log(`  GET /api/tenants              - List tenants`);
  console.log(`  GET /api/users                - List users`);
  console.log(`  GET /api/billing/subscriptions - Subscriptions`);
  console.log(`  GET /api/billing/usage        - Usage metrics`);
  console.log(`  GET /api/audit/logs           - Audit logs`);
  console.log(`  GET /api/vps/nodes            - VPS cluster`);
  console.log(`  GET /api/vps/capacity         - Cluster capacity`);
});

export default app;
