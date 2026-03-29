# HFSP Agent Provisioning

Telegram-first control plane that provisions isolated AI agent containers on demand. Each user gets a dedicated [OpenClaw](https://openclaw.dev) runtime in its own Docker container, routed through a shared reverse proxy.

## What it does

A user messages `@hfsp_agent_bot` on Telegram, completes a setup wizard, and gets a live AI agent (powered by Claude or GPT-4) connected to their own Telegram bot — fully isolated from other users.

```
User → @hfsp_agent_bot → Wizard → Docker container → OpenClaw gateway → User's bot
```

## Architecture

```
PIERCALITO (72.62.239.63)
├── nginx (agents.hfsp.cloud)
│   ├── /ws/{tenantId}/  → ws://127.0.0.1:{port}  (per-tenant)
│   ├── /telegram/webhook → hfsp-bot :3001
│   └── /admin/          → hfsp-admin :3002
│
├── hfsp-bot (port 3001)       Telegram storefront bot
├── hfsp-admin (port 3002)     Admin dashboard
│
└── Docker containers (one per tenant)
    ├── hfsp_ta_xxxx  → port 19000
    ├── hfsp_ta_yyyy  → port 19001
    └── ...           → port 19xxx  (up to 1000 slots)
```

Each container:
- Runs `hfsp-openclaw-runtime:local` (1.12 GB image)
- Capped at **512 MB RAM**, **0.75 CPUs**
- Mounts tenant config + secrets read-only
- Binds gateway port to loopback only (`127.0.0.1:PORT`)

## Repo structure

```
src/
  provisioner.ts          Container lifecycle: provision/stop/remove/status
  port-registry.ts        Port allocation 19000–19999, atomic JSON writes
  nginx-manager.ts        Per-tenant nginx location blocks + reload

services/
  storefront-bot/         Telegram onboarding bot (port 3001)
  admin-dashboard/        Admin control panel (port 3002)
  monitor.sh              Cron health monitor + Telegram alerts

tenant-runtime-image/
  Dockerfile              OpenClaw runtime image
  entrypoint.sh           Startup: stage config, load secrets, run gateway

bootstrap.sh              One-command setup for a new Ubuntu 24.04 VPS
schema.sql                SQLite schema: users, tenants, wizard_state
```

## Services

| Service | Port | Systemd unit | Purpose |
|---|---|---|---|
| Storefront bot | 3001 | `hfsp-bot.service` | Telegram wizard + provisioning |
| Admin dashboard | 3002 | `hfsp-admin.service` | Capacity + tenant management |
| Monitor | — | cron (*/5) | Health checks + alerts |

## Provisioner

`ShellProvisioner` manages the full container lifecycle:

```typescript
await provisioner.provision(config)  // allocate port → create → start → healthcheck → nginx
await provisioner.stop(tenantId)     // docker stop
await provisioner.remove(tenantId)   // docker rm -f + release port + remove nginx route
await provisioner.status(tenantId)   // docker inspect + port + public URL
```

Pre-flight checks before every provision: refuses if `< 300 MB RAM` or `< 2 GB disk` free.

## Admin dashboard

Protected by token at `~/.openclaw/secrets/admin.token`.

```
https://agents.hfsp.cloud/admin/?token=<token>
```

Endpoints:

| Method | Path | Description |
|---|---|---|
| GET | `/api/vps` | Memory, disk, port slot usage |
| GET | `/api/tenants` | All tenants + live Docker stats |
| GET | `/api/users` | All users + tenant counts |
| POST | `/api/tenants/:id/stop` | Force-stop container |
| POST | `/api/tenants/:id/start` | Restart stopped container |
| DELETE | `/api/tenants/:id` | Remove container + nginx route |

## Deploying a new VPS

```bash
sudo bash bootstrap.sh \
  --hostname piercalito2 \
  --domain agents2.hfsp.cloud \
  --repo-url git@github.com:lpsmurf/hfsp-agent-provisioning.git \
  --secrets-bundle /path/to/secrets.tar.gz.enc
```

Installs: Docker, Node 22, nginx, certbot, creates `hfsp` user (UID 1002), builds runtime image, configures systemd + cron + sudoers. Takes ~5 minutes on a fresh Ubuntu 24.04 VPS.

## Secrets layout

```
~/.openclaw/secrets/
  ssh_identity        SSH private key for OpenClaw sandbox backend
  ssh_known_hosts     SSH known_hosts
  anthropic.key       ANTHROPIC_API_KEY (shared fallback)
  openai.key          OPENAI_API_KEY (shared fallback)
  hfsp_agent_bot.token  Telegram bot token for @hfsp_agent_bot
  monitor_chat_id     Telegram chat ID for alert messages
  admin.token         Admin dashboard token
```

## Capacity

Current limits on one PIERCALITO node (8 GB RAM, 96 GB disk, 2 vCPU):

| Resource | Limit | Monitor alert |
|---|---|---|
| Agent slots | 1,000 (ports 19000–19999) | > 80% used |
| Memory | ~12–15 concurrent agents | < 400 MB free |
| Disk | ~70+ agents | < 3 GB free |

## Development

```bash
npm install
npx ts-node tests/provisioner-test.ts   # end-to-end: two tenants, parallel
```

Requires: Docker running locally, `hfsp-openclaw-runtime:local` image built.
