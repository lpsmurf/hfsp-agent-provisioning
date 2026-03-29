# HFSP Agent Provisioning — Project Manager

## Current phase
Phase 3: Scalability & Operations

## Completed phases

### Phase 1 ✅ — OpenClaw runtime proof-of-concept
- Docker image builds and runs (`hfsp-openclaw-runtime:local`, 1.12 GB)
- Container lifecycle: provision / stop / remove / status
- Port registry: auto-allocation 19000–19999, atomic writes
- Health check: host-side bash TCP probe
- Parallel tenant test: two containers, unique ports

### Phase 2 ✅ — Telegram bot + full provisioning flow
- SQLite persistence (`data/storefront.sqlite`): users, tenants, wizard_state
- Reverse proxy: nginx per-tenant location blocks in `/etc/nginx/conf.d/hfsp-tenants/`
- Telegram bot (`@hfsp_agent_bot`) — full wizard: template → provider → model → API key → bot token → provision
- systemd service: `hfsp-bot.service` (port 3001)
- Health monitor: cron every 5 min, Telegram alerts
- End-to-end proven: real user created agent, `@hfsptest1bot` responded with Claude Opus 4.6

### Phase 3A ✅ — Capacity guardrails
- Pre-flight checks in provisioner: refuses if <300 MB RAM or <2 GB disk free
- Container resource limits: `--memory 512m --memory-swap 512m --cpus 0.75`
- User-facing error messages: capacity / port exhaustion → friendly Telegram message
- Monitor extended: memory, disk, port % alerts + dangling Docker image pruning
- Agent name validation: rejects bot tokens as names, min 2 chars
- Per-user cap: max 1 active agent enforced at `provision:start`

### Phase 3B ✅ — VPS bootstrap script
- `bootstrap.sh`: fully automated Ubuntu 24.04 VPS setup
- Parameterized: `--hostname`, `--domain`, `--repo-url`, `--secrets-bundle`
- Installs: Docker, Node 22, nginx, certbot, sqlite3
- Creates hfsp user (UID 1002), clones repo, builds image
- Configures nginx, sudoers, systemd, cron monitor, SQLite DB

### Phase 3C ✅ — Central admin dashboard
- `services/admin-dashboard/` — Express + TypeScript, port 3002
- Token-protected (`~/.openclaw/secrets/admin.token`)
- Live metrics: memory %, disk %, port slot %
- Tenant table: agent name, status, container running, CPU %, mem
- User table: tenant counts, active agents
- Actions: stop / start / delete tenant containers
- Auto-refresh every 30 seconds

## Current VPS topology

| Host | IP | Role |
|------|----|------|
| PIERCALITO | 72.62.239.63 | Control plane — provisioner, bot, Docker host |
| IRIS | 187.124.174.137 | Jump box / Vibecoder workspace |

## PIERCALITO capacity

| Resource | Limit | Alert threshold |
|---|---|---|
| Ports | 1,000 (19000–19999) | 80% |
| Memory | 7.8 GB | <400 MB free |
| Disk | 96 GB | <3 GB free |
| CPU | 2 vCPU (AMD EPYC) | No hard limit (per-container 0.75 CPUs) |

## Services running

| Service | Port | Systemd unit |
|---|---|---|
| HFSP Storefront Bot | 3001 | hfsp-bot.service |
| HFSP Admin Dashboard | 3002 | hfsp-admin.service |
| nginx (agents.hfsp.cloud) | 443/80 | nginx |

## Next priorities

1. **Multi-VPS provisioner**: extend `ShellProvisioner` to SSH-target remote nodes; add VPS registry
2. **Secrets bundle workflow**: encrypted tar.gz with all node secrets for fast new VPS setup
3. **Billing / limits**: track usage per user, enforce plan-based caps (model tier, agent count)
4. **Tenant deletion flow**: Telegram-initiated delete with confirmation wizard
5. **Agent upgrade flow**: change model preset without re-provisioning

## What to avoid
- Webapp wizard (parked)
- Chrome extension (parked)
- Trading shell / strategy sandbox (separate concern)
- Payment flow (future)
