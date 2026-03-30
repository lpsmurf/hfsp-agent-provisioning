import express = require('express');
import type { Request, Response, NextFunction } from 'express';
import Database = require('better-sqlite3');
import bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
const { rateLimit } = require('express-rate-limit') as typeof import('express-rate-limit');
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminUser {
  id: string;
  email: string;
  password_h: string;
  role: string;
  created_at: string;
}

interface JWTPayload {
  id: string;
  email: string;
  role: string;
}

interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

interface CapacityInfo {
  memTotalMb: number;
  memAvailMb: number;
  memUsedPct: number;
  diskTotalGb: number;
  diskUsedGb: number;
  diskAvailGb: number;
  diskUsedPct: number;
  portRegistry: Record<string, unknown>;
}

interface DockerStatLine {
  containerId: string;
  name: string;
  cpuPct: string;
  memUsage: string;
  memPct: string;
  netIO: string;
  blockIO: string;
  pids: string;
}

// ---------------------------------------------------------------------------
// JWT Secret — persisted to ~/.openclaw/secrets/admin_jwt.secret
// ---------------------------------------------------------------------------

function loadOrCreateJwtSecret(): string {
  const secretDir = path.join(os.homedir(), '.openclaw', 'secrets');
  const secretFile = path.join(secretDir, 'admin_jwt.secret');

  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }

  fs.mkdirSync(secretDir, { recursive: true });
  const secret = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

const JWT_SECRET = loadOrCreateJwtSecret();
const JWT_EXPIRY = '24h';

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const DB_PATH = process.env.DB_PATH
  ? process.env.DB_PATH
  : path.resolve(__dirname, '../../../data/storefront.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create admin_users table
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id         TEXT PRIMARY KEY,
    email      TEXT UNIQUE NOT NULL,
    password_h TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Create audit_logs table
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id     TEXT,
    actor_email  TEXT,
    action       TEXT NOT NULL,
    target_type  TEXT,
    target_id    TEXT,
    metadata     TEXT,
    ip           TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// First-run: auto-create default admin if no users exist
// ---------------------------------------------------------------------------

function bootstrapDefaultAdmin(): void {
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM admin_users').get() as { cnt: number }).cnt;
  if (count > 0) return;

  const password = crypto.randomBytes(8).toString('hex'); // 16 hex chars
  const hash = bcrypt.hashSync(password, 12);
  const id = crypto.randomUUID();

  db.prepare(
    'INSERT INTO admin_users (id, email, password_h, role) VALUES (?, ?, ?, ?)'
  ).run(id, 'admin@hfsp.cloud', hash, 'owner');

  const border = '═'.repeat(52);
  console.log(`
╔${border}╗
║          HFSP Admin — First-Run Credentials          ║
╠${border}╣
║  Email   : admin@hfsp.cloud                          ║
║  Password: ${password}                         ║
║  Role    : owner                                     ║
╠${border}╣
║  SAVE THESE CREDENTIALS — they won't be shown again  ║
╚${border}╝
`);
}

bootstrapDefaultAdmin();

// ---------------------------------------------------------------------------
// Helpers: getCapacity, getDockerStats
// ---------------------------------------------------------------------------

function getCapacity(): CapacityInfo {
  // Memory from /proc/meminfo
  let memTotalMb = 0;
  let memAvailMb = 0;
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const totalMatch = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
    const availMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (totalMatch) memTotalMb = Math.round(parseInt(totalMatch[1], 10) / 1024);
    if (availMatch) memAvailMb = Math.round(parseInt(availMatch[1], 10) / 1024);
  } catch {
    // Not Linux — skip
  }
  const memUsedPct = memTotalMb > 0
    ? Math.round(((memTotalMb - memAvailMb) / memTotalMb) * 100)
    : 0;

  // Disk from df
  let diskTotalGb = 0;
  let diskUsedGb = 0;
  let diskAvailGb = 0;
  let diskUsedPct = 0;
  try {
    const dfOut = execSync("df -BG / | tail -1", { encoding: 'utf8' });
    const parts = dfOut.trim().split(/\s+/);
    diskTotalGb = parseInt(parts[1], 10);
    diskUsedGb  = parseInt(parts[2], 10);
    diskAvailGb = parseInt(parts[3], 10);
    diskUsedPct = parseInt(parts[4], 10);
  } catch {
    // ignore
  }

  // Port registry
  let portRegistry: Record<string, unknown> = {};
  const registryPath = path.resolve(__dirname, '../../../data/port-registry.json');
  try {
    portRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    // ignore if missing
  }

  return { memTotalMb, memAvailMb, memUsedPct, diskTotalGb, diskUsedGb, diskAvailGb, diskUsedPct, portRegistry };
}

function getDockerStats(): DockerStatLine[] {
  try {
    const raw = execSync(
      "docker stats --no-stream --format '{{.ID}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}'",
      { encoding: 'utf8', timeout: 15000 }
    );
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [containerId, name, cpuPct, memUsage, memPct, netIO, blockIO, pids] = line.split('|');
        return { containerId, name, cpuPct, memUsage, memPct, netIO, blockIO, pids };
      });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

function audit(
  req: AuthenticatedRequest,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: Record<string, unknown>
): void {
  try {
    db.prepare(`
      INSERT INTO audit_logs (actor_id, actor_email, action, target_type, target_id, metadata, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user?.id ?? null,
      req.user?.email ?? null,
      action,
      targetType ?? null,
      targetId ?? null,
      metadata ? JSON.stringify(metadata) : null,
      req.ip ?? null
    );
  } catch (err) {
    console.error('[audit] failed to write log:', err);
  }
}

// ---------------------------------------------------------------------------
// MRR / ARR calculation
// ---------------------------------------------------------------------------

function calcMrrArr(): { mrr: number; arr: number } {
  try {
    const monthly = db.prepare(`
      SELECT COALESCE(SUM(p.price_usd), 0) as total
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'active' AND p.billing = 'monthly'
    `).get() as { total: number };

    const yearly = db.prepare(`
      SELECT COALESCE(SUM(p.price_usd), 0) as total
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'active' AND p.billing = 'yearly'
    `).get() as { total: number };

    const mrr = monthly.total + yearly.total / 12;
    const arr = mrr * 12;
    return { mrr: Math.round(mrr * 100) / 100, arr: Math.round(arr * 100) / 100 };
  } catch {
    return { mrr: 0, arr: 0 };
  }
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
    req.user = { id: payload.id, email: payload.email, role: payload.role };
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }
}

// ---------------------------------------------------------------------------
// RBAC middleware factory
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<string, number> = { viewer: 1, admin: 2, owner: 3 };

function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Not authenticated' });
      return;
    }
    const userRank = ROLE_RANK[req.user.role] ?? 0;
    const allowed = roles.some((r) => {
      const requiredRank = ROLE_RANK[r] ?? 999;
      return userRank >= requiredRank;
    });
    if (!allowed) {
      res.status(403).json({ ok: false, error: `Requires one of roles: ${roles.join(', ')}` });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// Static files for the React SPA
app.use('/admin', express.static(path.join(__dirname, '../public')));

// ---------------------------------------------------------------------------
// Rate limiter for login
// ---------------------------------------------------------------------------

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many login attempts. Please try again later.' },
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /admin/health
app.get('/admin/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// POST /admin/auth/login
app.post('/admin/auth/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ ok: false, error: 'email and password are required' });
    return;
  }

  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email) as AdminUser | undefined;
  if (!user) {
    res.status(401).json({ ok: false, error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_h);
  if (!valid) {
    res.status(401).json({ ok: false, error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  res.json({ ok: true, token, user: { id: user.id, email: user.email, role: user.role } });
});

// POST /admin/auth/logout
app.post('/admin/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  audit(req, 'auth.logout');
  res.json({ ok: true });
});

// GET /admin/auth/me
app.get('/admin/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({ ok: true, user: req.user });
});

// GET /admin/api/overview
app.get('/admin/api/overview', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const users = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
    const tenants = (db.prepare('SELECT COUNT(*) as cnt FROM tenants').get() as { cnt: number }).cnt;
    const activeSubs = (
      db.prepare("SELECT COUNT(*) as cnt FROM subscriptions WHERE status = 'active'").get() as { cnt: number }
    ).cnt;

    // activeAgents = tenants with active status in DB
    let activeAgents = 0;
    try {
      const dockerOut = execSync("docker ps --format '{{.Names}}' 2>/dev/null || true", {
        encoding: 'utf8',
        timeout: 10000,
      });
      activeAgents = dockerOut.trim().split('\n').filter(Boolean).length;
    } catch {
      // ignore
    }

    const { mrr, arr } = calcMrrArr();
    const vps = getCapacity();

    res.json({ ok: true, data: { users, tenants, activeAgents, mrrUsd: mrr, arrUsd: arr, activeSubs, vps } });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /admin/api/vps
app.get('/admin/api/vps', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const capacity = getCapacity();
    const dockerStats = getDockerStats();

    let hostname = '';
    try {
      hostname = execSync('hostname', { encoding: 'utf8' }).trim();
    } catch {
      // ignore
    }

    res.json({ ok: true, data: { hostname, capacity, dockerStats } });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /admin/api/tenants
app.get('/admin/api/tenants', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, search } = _req.query as { status?: string; search?: string };

    let query = 'SELECT * FROM tenants WHERE 1=1';
    const params: unknown[] = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (id LIKE ? OR email LIKE ? OR subdomain LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    query += ' ORDER BY created_at DESC';

    const tenants = db.prepare(query).all(...params);
    const dockerStats = getDockerStats();
    const statsMap = new Map(dockerStats.map((s) => [s.name, s]));

    const enriched = (tenants as Array<Record<string, unknown>>).map((t) => ({
      ...t,
      dockerStats: statsMap.get(`hfsp_${t['tenant_id']}`) ?? null,
    }));

    res.json({ ok: true, data: enriched });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /admin/api/tenants/:id
app.get('/admin/api/tenants/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(req.params.id);
    if (!tenant) {
      res.status(404).json({ ok: false, error: 'Tenant not found' });
      return;
    }
    res.json({ ok: true, data: tenant });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /admin/api/tenants/:id/stop
app.post(
  '/admin/api/tenants/:id/stop',
  requireAuth,
  requireRole('admin', 'owner'),
  (req: AuthenticatedRequest, res: Response) => {
    const id = String(req.params.id);
    try {
      execSync(`docker stop hfsp_${id} 2>/dev/null || true`, { timeout: 30000 });
      db.prepare("UPDATE tenants SET status = 'stopped' WHERE tenant_id = ?").run(id);
      audit(req, 'tenant.stop', 'tenant', id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  }
);

// POST /admin/api/tenants/:id/start
app.post(
  '/admin/api/tenants/:id/start',
  requireAuth,
  requireRole('admin', 'owner'),
  (req: AuthenticatedRequest, res: Response) => {
    const id = String(req.params.id);
    try {
      execSync(`docker start hfsp_${id} 2>/dev/null || true`, { timeout: 30000 });
      db.prepare("UPDATE tenants SET status = 'active' WHERE tenant_id = ?").run(id);
      audit(req, 'tenant.start', 'tenant', id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  }
);

// DELETE /admin/api/tenants/:id
app.delete(
  '/admin/api/tenants/:id',
  requireAuth,
  requireRole('owner'),
  (req: AuthenticatedRequest, res: Response) => {
    const id = String(req.params.id);
    try {
      // Remove docker container
      try {
        execSync(`docker rm -f hfsp_${id} 2>/dev/null || true`, {
          timeout: 30000,
        });
      } catch {
        // continue even if container doesn't exist
      }

      // Remove nginx config
      const nginxConfPaths = [
        `/etc/nginx/conf.d/hfsp-tenants/${id}.conf`,
      ];
      for (const confPath of nginxConfPaths) {
        try {
          fs.unlinkSync(confPath);
        } catch {
          // ignore missing files
        }
      }

      // Reload nginx
      try {
        execSync('nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null || true', {
          timeout: 10000,
        });
      } catch {
        // ignore
      }

      // Remove from DB
      db.prepare('DELETE FROM tenants WHERE tenant_id = ?').run(id);

      audit(req, 'tenant.delete', 'tenant', id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  }
);

// GET /admin/api/users
app.get('/admin/api/users', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { search } = _req.query as { search?: string };

    let query = 'SELECT * FROM users WHERE 1=1';
    const params: unknown[] = [];

    if (search) {
      query += ' AND (id LIKE ? OR email LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like);
    }

    query += ' ORDER BY created_at DESC';

    const users = db.prepare(query).all(...params);
    res.json({ ok: true, data: users });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /admin/api/billing
app.get('/admin/api/billing', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const subscriptions = db.prepare(`
      SELECT s.*, p.name as plan_name, p.price_usd, p.billing
      FROM subscriptions s
      LEFT JOIN plans p ON p.id = s.plan_id
      ORDER BY s.created_at DESC
    `).all();

    const invoices = db.prepare(`
      SELECT * FROM invoices ORDER BY created_at DESC LIMIT 200
    `).all();

    const { mrr, arr } = calcMrrArr();

    res.json({ ok: true, data: { subscriptions, invoices, mrr, arr } });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /admin/api/audit-logs
app.get('/admin/api/audit-logs', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const limit  = Math.min(parseInt(String(_req.query.limit  ?? '50'),  10), 500);
    const offset = parseInt(String(_req.query.offset ?? '0'),  10);
    const search = _req.query.search as string | undefined;

    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: unknown[] = [];

    if (search) {
      query += ' AND (action LIKE ? OR actor_email LIKE ? OR target_type LIKE ? OR target_id LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const total = (
      db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs WHERE 1=1${search ? ' AND (action LIKE ? OR actor_email LIKE ? OR target_type LIKE ? OR target_id LIKE ?)' : ''}`).get(
        ...(search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : [])
      ) as { cnt: number }
    ).cnt;

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = db.prepare(query).all(...params);

    res.json({ ok: true, data: { logs, total, limit, offset } });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /admin — serve SPA root
app.get('/admin', (_req: Request, res: Response) => {
  const spa = path.join(__dirname, '../public/index.html');
  res.sendFile(spa);
});

// GET /admin/* — catch-all SPA fallback
app.get('/admin/{*path}', (_req: Request, res: Response) => {
  const spa = path.join(__dirname, '../public/index.html');
  res.sendFile(spa);
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.ADMIN_PORT ?? '3002', 10);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[admin-dashboard] Listening on http://127.0.0.1:${PORT}/admin`);
});

export default app;
