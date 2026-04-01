# HFSP Admin Dashboard

Comprehensive management interface for HFSP tenants, users, billing, and VPS infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Admin Dashboard                            │
│                  (Frontend - 3000)                          │
│                                                             │
│  HTML5 + Vanilla JS                                        │
│  - Real-time metrics                                       │
│  - Tenant management                                       │
│  - Cluster monitoring                                      │
│  - Audit logs                                              │
└────────────────┬────────────────────────────────────────────┘
                 │
         HTTP REST API
                 │
┌────────────────▼────────────────────────────────────────────┐
│                  Admin API                                  │
│                  (Backend - 4000)                           │
│                                                             │
│  Express + SQLite                                          │
│  - /api/tenants         → CRUD                             │
│  - /api/users           → List & aggregate                 │
│  - /api/billing/*       → Usage metrics                    │
│  - /api/audit/logs      → Audit trail                      │
│  - /api/vps/*           → Cluster status                   │
└────────────────┬────────────────────────────────────────────┘
                 │
            SQLite DB
                 │
         (shared with bot)
```

## Services

### 1. Admin API (`services/admin-api/`)

Express.js REST API with 6 main endpoint groups:

#### Tenants Management
- `GET /api/tenants` - List all tenants (paginated, filterable)
- `GET /api/tenants/:tenantId` - Get tenant details
- `GET /api/tenants/:tenantId/status` - Real-time status
- `DELETE /api/tenants/:tenantId` - Soft-delete tenant

#### Users Management
- `GET /api/users` - List all users with aggregates
- `GET /api/users/:userId` - Get user + their tenants

#### Billing & Usage
- `GET /api/billing/subscriptions` - List subscriptions (when implemented)
- `GET /api/billing/usage` - Usage metrics by provider/status

#### Audit Logs
- `GET /api/audit/logs` - Audit trail (filterable by action)

#### VPS Cluster
- `GET /api/vps/nodes` - List cluster nodes with utilization
- `GET /api/vps/capacity` - Cluster capacity summary

#### Utility
- `GET /health` - Health check
- `GET /api/metrics` - System metrics

### 2. Admin Dashboard (`services/admin-dashboard/`)

Single-page web interface served from Express:

**Features:**
- 📊 **Overview Tab** - Real-time metrics (tenants, users, capacity)
- 📦 **Tenants Tab** - Full CRUD, status filtering, search
- 👥 **Users Tab** - User list with tenant aggregates
- 💰 **Billing Tab** - Usage breakdown by provider/status
- 🖥️ **VPS Nodes Tab** - Cluster nodes + utilization
- 📋 **Audit Logs Tab** - Action audit trail

**Technology:**
- Pure HTML5 + Vanilla JavaScript (no framework deps)
- Dark theme design (HFSP branding)
- Responsive grid layout
- Auto-refresh (30s intervals)
- Status badges, progress bars, tables

## Setup & Installation

### 1. Install Dependencies

```bash
# Admin API
cd services/admin-api
npm install

# Admin Dashboard
cd services/admin-dashboard
npm install
```

### 2. Environment Variables

**Admin API (.env or env vars):**
```bash
ADMIN_API_PORT=4000
DB_PATH=../storefront-bot/hfsp.db  # Path to shared SQLite DB
```

**Admin Dashboard (.env or env vars):**
```bash
ADMIN_DASHBOARD_PORT=3000
```

### 3. Run Both Services

```bash
# Terminal 1: Start Admin API
cd services/admin-api
npm run dev
# Output: 🚀 Admin API listening on http://localhost:4000

# Terminal 2: Start Admin Dashboard
cd services/admin-dashboard
npm start
# Output: 🎨 Admin Dashboard ready at http://localhost:3000
```

### 4. Access Dashboard

Open browser: **http://localhost:3000**

The dashboard will:
1. Connect to Admin API (http://localhost:4000/api)
2. Load metrics and display them
3. Auto-refresh every 30 seconds
4. Show connection status at top

## API Documentation

### Response Format

All endpoints return JSON:

```json
{
  "data": [ /* actual data */ ],
  "pagination": { "limit": 50, "offset": 0, "total": 100 },
  "message": "optional status message"
}
```

### Tenants Endpoints

**List Tenants**
```bash
GET /api/tenants?limit=50&offset=0&status=active
```

Response:
```json
{
  "data": [
    {
      "tenant_id": "t_abc123_def456",
      "telegram_user_id": 12345,
      "agent_name": "My Agent",
      "provider": "openai",
      "model_preset": "smart",
      "status": "active",
      "dashboard_port": 19042,
      "created_at": "2026-03-31T10:00:00Z",
      "updated_at": "2026-03-31T10:05:00Z",
      "deleted_at": null
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "total": 152 }
}
```

**Get Tenant Details**
```bash
GET /api/tenants/t_abc123_def456
```

**Get Tenant Status**
```bash
GET /api/tenants/t_abc123_def456/status
```

Response:
```json
{
  "data": {
    "tenantId": "t_abc123_def456",
    "status": "active",
    "containerName": "hfsp_t_abc123_def456",
    "dashboardPort": 19042,
    "vpsNode": "piercalito",
    "createdAt": "2026-03-31T10:00:00Z",
    "lastUpdated": "2026-03-31T16:30:00Z"
  }
}
```

**Delete Tenant**
```bash
DELETE /api/tenants/t_abc123_def456
```

### Users Endpoints

**List Users**
```bash
GET /api/users?limit=50&offset=0
```

Response:
```json
{
  "data": [
    {
      "telegram_user_id": 12345,
      "active_tenants": 3,
      "total_tenants": 5,
      "last_tenant_created": "2026-03-31T10:00:00Z",
      "first_tenant_created": "2026-03-20T10:00:00Z"
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "total": 87 }
}
```

**Get User Details**
```bash
GET /api/users/12345
```

Response:
```json
{
  "data": {
    "userId": 12345,
    "stats": {
      "active_tenants": 3,
      "total_tenants": 5
    },
    "tenants": [ /* array of tenant objects */ ]
  }
}
```

### VPS Endpoints

**List Nodes**
```bash
GET /api/vps/nodes
```

Response:
```json
{
  "data": [
    {
      "id": "piercalito",
      "host": "72.62.239.63",
      "ssh_user": "root",
      "max_containers": 80,
      "status": "active",
      "usedContainers": 42,
      "availableContainers": 38,
      "utilizationPercent": 52
    }
  ],
  "total": 1
}
```

**Cluster Capacity**
```bash
GET /api/vps/capacity
```

Response:
```json
{
  "data": {
    "totalCapacity": 160,
    "usedCapacity": 84,
    "availableCapacity": 76,
    "utilizationPercent": 52,
    "nodes": 2,
    "timestamp": "2026-03-31T16:30:00Z"
  }
}
```

### Metrics & Health

**System Metrics**
```bash
GET /api/metrics
```

Response:
```json
{
  "data": {
    "totalTenants": 152,
    "activeTenants": 142,
    "provisioningTenants": 5,
    "totalUsers": 87,
    "timestamp": "2026-03-31T16:30:00Z"
  }
}
```

**Health Check**
```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-03-31T16:30:00Z"
}
```

## Database Schema

The Admin API reads from the same SQLite DB as the bot:

### Tables Required

- `tenants` (existing) - Tenant records
- `users` (existing) - User records (via wizard_state)
- `vps_nodes` (from VPS Registry) - Node inventory
- `audit_logs` (optional) - Audit trail

### Missing Tables

These are optional but recommended:

```sql
-- Audit logs table
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  resource_id TEXT,
  details TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions table
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  telegram_user_id INTEGER,
  tier TEXT,  -- free, pro, enterprise
  status TEXT,  -- active, cancelled, expired
  created_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (telegram_user_id) REFERENCES wizard_state(user_id)
);
```

## Frontend Features

### Dashboard Tabs

1. **Overview**
   - Real-time metric cards
   - Cluster capacity summary
   - Auto-refresh every 30s

2. **Tenants**
   - Full table with all tenant details
   - Status filtering (active/provisioning/failed)
   - Search by ID
   - Delete button (with confirmation)

3. **Users**
   - User aggregates (active/total tenants)
   - Creation timestamps
   - Click to view user's tenants

4. **Billing**
   - Usage breakdown by provider (pie chart via bars)
   - Status breakdown (active/provisioning/failed)
   - Visual utilization bars

5. **VPS Nodes**
   - Node list with capacity
   - Per-node utilization percentage
   - Health status badges

6. **Audit Logs**
   - Action audit trail
   - Resource ID references
   - Detailed change logs

### UI Features

- **Dark theme** - HFSP branding (dark blue/slate)
- **Responsive grid** - Works on mobile/tablet/desktop
- **Status badges** - Color-coded (green=active, yellow=provisioning, red=failed, gray=deleted)
- **Progress bars** - Visual utilization indicators
- **Loading spinners** - Async operation feedback
- **Error states** - Connection failures, empty states
- **Pagination** - Large datasets handled with limit/offset
- **Search & filters** - Quick lookup and filtering

## Integration with Bot

The Admin API shares the same SQLite database as the bot (`services/storefront-bot/hfsp.db`), so:

1. **No sync needed** - Updates in bot reflect in admin immediately
2. **Audit logging** - Each action logged (optional)
3. **VPS Registry** - Multi-VPS provisioner state tracked
4. **Tenant lifecycle** - All states visible (provisioning → active → failed → deleted)

## Future Enhancements

### Phase 1 (Current)
- ✅ Tenants CRUD
- ✅ Users management
- ✅ Billing/usage metrics
- ✅ VPS cluster monitoring
- ✅ Audit logs

### Phase 2 (Next)
- [ ] Real-time container stats (CPU, memory via Docker API)
- [ ] Subscription management (pause, upgrade, cancel)
- [ ] User blocking/suspension
- [ ] Bulk operations (delete multiple tenants)
- [ ] Export data (CSV, JSON)

### Phase 3 (Later)
- [ ] Webhook config management
- [ ] LLM API key rotation
- [ ] Agent template management
- [ ] Analytics charts (vs tables)
- [ ] Dark/light theme toggle
- [ ] Role-based access control (RBAC)

## Troubleshooting

### "Failed to connect to Admin API"

Check:
1. Admin API is running on port 4000
2. CORS is enabled in admin-api/src/index.ts
3. Database path is correct in .env
4. SQLite DB file exists at specified path

### No data appearing in tables

Check:
1. Bot has created tenants (provision an agent first)
2. Database file is readable by Node process
3. Check admin-api logs: `npm run dev` shows SQL queries

### "Subscriptions table not yet created"

This is OK - subscriptions are optional. Implement when billing is ready.

### Dashboard styles not loading

Ensure dashboard is serving from http://localhost:3000 directly (not a subpath).

## Production Deployment

### Docker

```dockerfile
# Admin API
FROM node:18-alpine
WORKDIR /app
COPY services/admin-api .
RUN npm install --production
CMD ["npm", "start"]
EXPOSE 4000

# Admin Dashboard
FROM node:18-alpine
WORKDIR /app
COPY services/admin-dashboard .
RUN npm install --production
CMD ["npm", "start"]
EXPOSE 3000
```

### Docker Compose

```yaml
version: '3.8'
services:
  admin-api:
    build:
      context: .
      dockerfile: services/admin-api/Dockerfile
    ports:
      - "4000:4000"
    environment:
      - ADMIN_API_PORT=4000
      - DB_PATH=/data/hfsp.db
    volumes:
      - ./hfsp.db:/data/hfsp.db
  
  admin-dashboard:
    build:
      context: .
      dockerfile: services/admin-dashboard/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - ADMIN_DASHBOARD_PORT=3000
    depends_on:
      - admin-api
```

### Environment Setup

Production .env:
```bash
# Admin API
ADMIN_API_PORT=4000
DB_PATH=/data/hfsp.db

# Admin Dashboard  
ADMIN_DASHBOARD_PORT=3000

# Security (future)
ADMIN_SECRET=<strong-secret>
JWT_SECRET=<jwt-secret>
```

---

**Built as part of HFSP Agent Provisioning System**
