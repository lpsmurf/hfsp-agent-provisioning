# Changelog

## v0.3.0 — 2026-03-30

### Phase 3: Scalability & Operations

**Capacity guardrails**
- Provisioner pre-flight checks: refuses if < 300 MB RAM or < 2 GB disk free
- Container resource limits: `--memory 512m --memory-swap 512m --cpus 0.75`
- User-facing error messages for capacity and port exhaustion
- Agent name validation: rejects bot tokens as names, min 2 chars
- Per-user agent cap: max 1 active agent enforced at provision

**VPS bootstrap script (`bootstrap.sh`)**
- One-command Ubuntu 24.04 VPS setup: Docker, Node 22, nginx, certbot, systemd, cron
- Parameterized by `--hostname`, `--domain`, `--repo-url`, `--secrets-bundle`

**Admin dashboard (`services/admin-dashboard/`)**
- Express + TypeScript service on port 3002, token-protected
- Live VPS metrics: memory %, disk %, port slot usage
- Tenant table with live Docker stats (CPU %, memory, running state)
- User table with tenant counts
- Stop / start / delete actions per tenant
- Auto-refreshes every 30 seconds

**Monitor extended**
- Memory, disk, port % capacity alerts
- Dangling Docker image prune on every run

---

## v0.2.0 — 2026-03-27

### Phase 2: Telegram Bot + Full Provisioning Flow

- SQLite persistence: `users`, `tenants`, `wizard_state` tables
- Full Telegram onboarding wizard: template → provider → model → API key → bot token → provision
- Per-tenant nginx routing via `wss://agents.hfsp.cloud/ws/{tenantId}/`
- Pairing flow: `openclaw pairing approve telegram {code}` via `docker exec`
- `hfsp-bot.service` systemd unit (port 3001)
- Health monitor: cron every 5 min, Telegram alerts on failure
- End-to-end proven: real user agent live via Claude Opus 4.6

---

## v0.1.0 — 2026-03-22

### Phase 1: OpenClaw Runtime Proof-of-Concept

- `ShellProvisioner`: full container lifecycle (provision / stop / remove / status)
- `PortRegistry`: auto-allocation 19000–19999, atomic POSIX rename writes
- `hfsp-openclaw-runtime:local` Docker image (1.12 GB)
- Health check: host-side bash TCP probe (no `nc` required)
- Parallel provisioning test: two tenants, unique ports, both healthy
- Key fixes: UID 1002 match, staging config mount to avoid `EBUSY rename`, `--bind lan`
