/**
 * HFSP Admin Dashboard
 * Internal service — port 3002, protected by ADMIN_TOKEN header or query param.
 * Provides read + control API over tenants, users, and VPS capacity.
 */
import express from 'express';
import Database from 'better-sqlite3';
import { execSync, execFile } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const PORT = parseInt(process.env.ADMIN_PORT ?? '3002', 10);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? (() => {
  const f = path.join(process.env.HOME ?? '/home/hfsp', '.openclaw/secrets/admin.token');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : 'changeme';
})();
const DB_PATH = path.resolve(__dirname, '../../../data/storefront.sqlite');
const PORT_REGISTRY_PATH = path.join(process.env.HOME ?? '/home/hfsp', '.openclaw/port-registry.json');

const db = new Database(DB_PATH, { readonly: false });
db.pragma('journal_mode = WAL');

const app = express();
app.use(express.json());

// ── Auth middleware ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const token = req.headers['x-admin-token'] ?? req.query.token;
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────
function getCapacity() {
  const memKb = parseInt(
    execSync("awk '/MemAvailable/ {print $2}' /proc/meminfo").toString().trim(), 10
  );
  const memTotalKb = parseInt(
    execSync("awk '/MemTotal/ {print $2}' /proc/meminfo").toString().trim(), 10
  );
  const diskKb = parseInt(
    execSync("df --output=avail / | tail -1").toString().trim(), 10
  );
  const diskTotalKb = parseInt(
    execSync("df --output=size / | tail -1").toString().trim(), 10
  );

  let portUsed = 0;
  if (existsSync(PORT_REGISTRY_PATH)) {
    portUsed = Object.keys(JSON.parse(readFileSync(PORT_REGISTRY_PATH, 'utf8'))).length;
  }
  const PORT_MAX = 1000;

  return {
    memory: {
      availMb: Math.round(memKb / 1024),
      totalMb: Math.round(memTotalKb / 1024),
      usedPct: Math.round(((memTotalKb - memKb) / memTotalKb) * 100),
    },
    disk: {
      availGb: Math.round(diskKb / 1024 / 1024 * 10) / 10,
      totalGb: Math.round(diskTotalKb / 1024 / 1024 * 10) / 10,
      usedPct: Math.round(((diskTotalKb - diskKb) / diskTotalKb) * 100),
    },
    ports: {
      used: portUsed,
      total: PORT_MAX,
      usedPct: Math.round((portUsed / PORT_MAX) * 100),
    },
  };
}

function getDockerStats(): Record<string, { running: boolean; cpuPct?: number; memMb?: number }> {
  try {
    const raw = execSync(
      `docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' 2>/dev/null || true`
    ).toString().trim();
    const result: Record<string, any> = {};
    for (const line of raw.split('\n').filter(Boolean)) {
      const [name, cpu, mem] = line.split('|');
      const memMb = mem ? parseFloat(mem.split('/')[0].replace(/[^0-9.]/g, '')) : undefined;
      result[name.trim()] = {
        running: true,
        cpuPct: parseFloat(cpu?.replace('%', '') ?? '0'),
        memMb: memMb,
      };
    }
    return result;
  } catch {
    return {};
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /health — unauthenticated
app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /api/vps — VPS capacity snapshot
app.get('/api/vps', (_req, res) => {
  try {
    res.json({ ok: true, vps: { hostname: execSync('hostname').toString().trim(), ...getCapacity() } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/users — all users + tenant counts
app.get('/api/users', (_req, res) => {
  const rows = db.prepare(`
    SELECT u.telegram_user_id,
           u.created_at,
           COUNT(t.tenant_id) as tenant_count,
           SUM(CASE WHEN t.status IN ('active','provisioning') AND t.deleted_at IS NULL THEN 1 ELSE 0 END) as active_count
    FROM users u
    LEFT JOIN tenants t ON t.telegram_user_id = u.telegram_user_id
    GROUP BY u.telegram_user_id
    ORDER BY u.created_at DESC
  `).all();
  res.json({ ok: true, count: rows.length, users: rows });
});

// GET /api/tenants — all tenants with docker status
app.get('/api/tenants', (_req, res) => {
  const tenants = db.prepare(`
    SELECT t.*, u.created_at as user_created_at
    FROM tenants t
    LEFT JOIN users u ON u.telegram_user_id = t.telegram_user_id
    ORDER BY t.created_at DESC
  `).all();

  const dockerStats = getDockerStats();

  const enriched = tenants.map((t: any) => ({
    ...t,
    docker: dockerStats[`hfsp_${t.tenant_id}`] ?? { running: false },
  }));

  res.json({ ok: true, count: enriched.length, tenants: enriched });
});

// GET /api/tenants/:id — single tenant detail
app.get('/api/tenants/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM tenants WHERE tenant_id = ?`).get(req.params.id) as any;
  if (!row) { res.status(404).json({ ok: false, error: 'not found' }); return; }

  const dockerStats = getDockerStats();
  res.json({ ok: true, tenant: { ...row, docker: dockerStats[`hfsp_${row.tenant_id}`] ?? { running: false } } });
});

// POST /api/tenants/:id/stop — force-stop container
app.post('/api/tenants/:id/stop', (req, res) => {
  const name = `hfsp_${req.params.id}`;
  try {
    execSync(`docker stop ${name} 2>/dev/null || true`);
    db.prepare(`UPDATE tenants SET status='stopped' WHERE tenant_id = ?`).run(req.params.id);
    res.json({ ok: true, message: `${name} stopped` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/tenants/:id/start — restart stopped container
app.post('/api/tenants/:id/start', (req, res) => {
  const name = `hfsp_${req.params.id}`;
  try {
    execSync(`docker start ${name} 2>/dev/null`);
    db.prepare(`UPDATE tenants SET status='active' WHERE tenant_id = ?`).run(req.params.id);
    res.json({ ok: true, message: `${name} started` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// DELETE /api/tenants/:id — force-remove container + mark deleted
app.delete('/api/tenants/:id', (req, res) => {
  const name = `hfsp_${req.params.id}`;
  try {
    execSync(`docker rm -f ${name} 2>/dev/null || true`);
    db.prepare(`UPDATE tenants SET status='deleted', deleted_at=datetime('now') WHERE tenant_id = ?`).run(req.params.id);
    // Remove nginx conf if present
    const confPath = `/etc/nginx/conf.d/hfsp-tenants/${req.params.id}.conf`;
    execSync(`rm -f ${confPath} && sudo nginx -s reload 2>/dev/null || true`);
    res.json({ ok: true, message: `${name} removed` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET / — HTML dashboard
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(DASHBOARD_HTML);
});

// ── HTML Dashboard ─────────────────────────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HFSP Admin Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f13; color: #e2e8f0; min-height: 100vh; }
  header { background: #1a1a2e; border-bottom: 1px solid #2d2d44; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 18px; font-weight: 600; color: #a78bfa; }
  header .subtitle { font-size: 13px; color: #64748b; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: #1a1a2e; border: 1px solid #2d2d44; border-radius: 10px; padding: 18px; }
  .card-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin-bottom: 8px; }
  .card-value { font-size: 28px; font-weight: 700; color: #e2e8f0; }
  .card-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
  .bar-bg { background: #2d2d44; border-radius: 4px; height: 6px; margin-top: 10px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width .3s; }
  .bar-ok { background: #34d399; }
  .bar-warn { background: #fbbf24; }
  .bar-crit { background: #f87171; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { text-align: left; padding: 10px 12px; color: #64748b; font-weight: 500; border-bottom: 1px solid #2d2d44; }
  tbody tr { border-bottom: 1px solid #1e1e30; transition: background .15s; }
  tbody tr:hover { background: #1e1e30; }
  tbody td { padding: 10px 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge-active { background: #064e3b; color: #34d399; }
  .badge-stopped { background: #1c1917; color: #78716c; }
  .badge-failed { background: #450a0a; color: #f87171; }
  .badge-provisioning { background: #1e3a5f; color: #60a5fa; }
  .badge-deleted { background: #1c1917; color: #44403c; }
  .badge-running { background: #064e3b; color: #34d399; }
  .badge-down { background: #450a0a; color: #f87171; }
  .action-btn { background: #2d2d44; border: none; color: #e2e8f0; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-right: 4px; }
  .action-btn:hover { background: #3d3d5c; }
  .action-btn.danger { color: #f87171; }
  .section-title { font-size: 14px; font-weight: 600; color: #a78bfa; margin-bottom: 12px; text-transform: uppercase; letter-spacing: .05em; }
  .section { background: #1a1a2e; border: 1px solid #2d2d44; border-radius: 10px; padding: 20px; margin-bottom: 24px; }
  .refresh-btn { background: #7c3aed; border: none; color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-left: auto; display: block; margin-bottom: 16px; }
  .refresh-btn:hover { background: #6d28d9; }
  #last-updated { font-size: 11px; color: #64748b; text-align: right; margin-bottom: 8px; }
  .monospace { font-family: 'SF Mono', monospace; font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
<header>
  <div>
    <h1>⚡ HFSP Admin</h1>
    <div class="subtitle">Control Plane Dashboard</div>
  </div>
</header>
<div class="container">
  <button class="refresh-btn" onclick="loadAll()">↻ Refresh</button>
  <div id="last-updated"></div>

  <!-- VPS Capacity -->
  <div id="vps-section" class="grid"></div>

  <!-- Tenants -->
  <div class="section">
    <div class="section-title">Agents / Tenants</div>
    <div id="tenants-table"><div style="color:#64748b;font-size:13px">Loading…</div></div>
  </div>

  <!-- Users -->
  <div class="section">
    <div class="section-title">Users</div>
    <div id="users-table"><div style="color:#64748b;font-size:13px">Loading…</div></div>
  </div>
</div>

<script>
const TOKEN = new URLSearchParams(location.search).get('token') || '';

async function api(path, opts={}) {
  const r = await fetch(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN, opts);
  return r.json();
}

function barClass(pct) {
  if (pct >= 80) return 'bar-crit';
  if (pct >= 60) return 'bar-warn';
  return 'bar-ok';
}

async function loadVps() {
  const d = await api('/api/vps');
  if (!d.ok) return;
  const v = d.vps;
  const metrics = [
    { label: 'Memory Used', value: v.memory.usedPct + '%', sub: v.memory.availMb + ' MB free', pct: v.memory.usedPct },
    { label: 'Disk Used', value: v.disk.usedPct + '%', sub: v.disk.availGb + ' GB free', pct: v.disk.usedPct },
    { label: 'Ports Used', value: v.ports.usedPct + '%', sub: v.ports.used + ' / ' + v.ports.total + ' slots', pct: v.ports.usedPct },
    { label: 'Hostname', value: v.hostname, sub: 'PIERCALITO', pct: null },
  ];
  document.getElementById('vps-section').innerHTML = metrics.map(m => \`
    <div class="card">
      <div class="card-label">\${m.label}</div>
      <div class="card-value">\${m.value}</div>
      <div class="card-sub">\${m.sub}</div>
      \${m.pct !== null ? \`<div class="bar-bg"><div class="bar-fill \${barClass(m.pct)}" style="width:\${m.pct}%"></div></div>\` : ''}
    </div>
  \`).join('');
}

async function loadTenants() {
  const d = await api('/api/tenants');
  if (!d.ok) { document.getElementById('tenants-table').innerHTML = '<span style="color:#f87171">Error loading</span>'; return; }
  const rows = d.tenants.map(t => \`
    <tr>
      <td class="monospace">\${t.tenant_id}</td>
      <td>\${t.agent_name ?? '—'}</td>
      <td>\${t.telegram_user_id ?? '—'}</td>
      <td><span class="badge badge-\${t.status}">\${t.status}</span></td>
      <td><span class="badge \${t.docker.running ? 'badge-running' : 'badge-down'}">\${t.docker.running ? '▶ running' : '■ down'}</span></td>
      <td>\${t.docker.cpuPct != null ? t.docker.cpuPct.toFixed(1) + '%' : '—'}</td>
      <td>\${t.docker.memMb != null ? t.docker.memMb.toFixed(0) + ' MB' : '—'}</td>
      <td class="monospace">\${(t.created_at ?? '').slice(0,16)}</td>
      <td>
        \${t.status !== 'deleted' ? \`
          \${t.docker.running
            ? \`<button class="action-btn" onclick="action('stop','\${t.tenant_id}')">Stop</button>\`
            : \`<button class="action-btn" onclick="action('start','\${t.tenant_id}')">Start</button>\`}
          <button class="action-btn danger" onclick="action('delete','\${t.tenant_id}')">Delete</button>
        \` : '—'}
      </td>
    </tr>
  \`).join('');
  document.getElementById('tenants-table').innerHTML = \`
    <table>
      <thead><tr>
        <th>Tenant ID</th><th>Agent Name</th><th>User</th>
        <th>Status</th><th>Container</th><th>CPU</th><th>Mem</th>
        <th>Created</th><th>Actions</th>
      </tr></thead>
      <tbody>\${rows || '<tr><td colspan="9" style="color:#64748b;text-align:center;padding:20px">No tenants</td></tr>'}</tbody>
    </table>
    <div style="margin-top:8px;font-size:12px;color:#64748b">\${d.count} total</div>
  \`;
}

async function loadUsers() {
  const d = await api('/api/users');
  if (!d.ok) return;
  const rows = d.users.map(u => \`
    <tr>
      <td class="monospace">\${u.telegram_user_id}</td>
      <td>\${u.tenant_count}</td>
      <td>\${u.active_count}</td>
      <td class="monospace">\${(u.created_at ?? '').slice(0,16)}</td>
    </tr>
  \`).join('');
  document.getElementById('users-table').innerHTML = \`
    <table>
      <thead><tr><th>Telegram User ID</th><th>Total Agents</th><th>Active</th><th>Joined</th></tr></thead>
      <tbody>\${rows || '<tr><td colspan="4" style="color:#64748b;text-align:center;padding:20px">No users</td></tr>'}</tbody>
    </table>
    <div style="margin-top:8px;font-size:12px;color:#64748b">\${d.count} users</div>
  \`;
}

async function action(type, tenantId) {
  if (type === 'delete' && !confirm('Delete tenant ' + tenantId + '? This removes the container.')) return;
  const method = type === 'delete' ? 'DELETE' : 'POST';
  const url = '/api/tenants/' + tenantId + (type === 'delete' ? '' : '/' + type);
  const r = await api(url, { method });
  if (r.ok) loadAll();
  else alert('Error: ' + r.error);
}

async function loadAll() {
  await Promise.all([loadVps(), loadTenants(), loadUsers()]);
  document.getElementById('last-updated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

loadAll();
setInterval(loadAll, 30000);
</script>
</body>
</html>`;

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[admin] Dashboard running on http://127.0.0.1:${PORT}`);
  console.log(`[admin] Token: ${ADMIN_TOKEN === 'changeme' ? '⚠ WARNING: using default token' : '(from secrets file)'}`);
});
