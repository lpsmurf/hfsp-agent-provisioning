# HFSP / ClawDrop — Project Manager
**Last updated:** 2026-03-30  
**Repo:** `lpsmurf/hfsp-agent-provisioning` (79 commits)

---

## Current State: Production (Early Access)

| Metric | Value |
|--------|-------|
| Users | 2 |
| Active agents | 1 (`@hfsptest1bot` on PIERCALITO) |
| VPS nodes | 1 (PIERCALITO, 1/50 slots used) |
| MRR | $0 (payments built, not gated) |
| Plans configured | 6 (Starter/Operator/Node × monthly/yearly) |

---

## ✅ Phase 1 — OpenClaw Runtime
- Docker image `hfsp-openclaw-runtime:local` (1.12 GB)
- Container lifecycle: provision / stop / remove / health check
- Port registry: atomic allocation 19000–19999
- Parallel tenant isolation proven

## ✅ Phase 2 — Telegram Bot + Provisioning
- `@hfsp_agent_bot` — full wizard: name → BotFather → provider → API key → model → provision
- SQLite: users, tenants, wizard_state tables
- nginx per-tenant reverse proxy (`/ws/{tenantId}`)
- systemd service (`hfsp-bot.service`, port 3001)
- Health monitor: cron 5 min, Telegram alerts
- End-to-end proven: real user → `@hfsptest1bot` → Claude Opus 4.6 responding

## ✅ Phase 3A — Capacity Guardrails
- Pre-flight: refuses provision if <300 MB RAM or <2 GB disk
- Container limits: `--memory 512m --cpus 0.75`
- Agent name validation (rejects bot tokens, min 2 chars)
- Per-user agent cap enforced at provisioning gate

## ✅ Phase 3B — Bootstrap + Ops Scripts
- `bootstrap.sh`: fully automated Ubuntu 24.04 VPS setup
- `scripts/pack-secrets.sh` / `unpack-secrets.sh`: AES-256 encrypted bundle
- `services/renewal-reminder.sh`: daily cron, Telegram reminders 3 days before expiry

## ✅ Phase 3C — Admin Dashboard v2
- React SPA at `https://agents.hfsp.cloud/admin/`
- JWT auth (bcrypt + rate-limited login), RBAC (owner/admin/viewer)
- Audit log on all mutations
- Pages: Overview, Agents, Users, Billing, Audit Log, VPS Health, **VPS Nodes**

## ✅ Phase 4 — Multi-VPS + Agent Management
- `VpsRegistry`: SQLite-backed node registry, `getBestNode()` by load ratio
- `MultiVpsProvisioner`: local (ShellProvisioner) or SSH-remote provisioning
- `deprovisioner.ts`: shared stop/delete logic (bot + admin)
- Bot `/myagents`: list agents, inline delete (2-step confirm), start, change model
- Model change: fast ↔ smart, docker restart in-place
- Admin `/admin/#nodes`: add/drain/remove VPS nodes with capacity bars

## ✅ Payments Infrastructure (built, not yet gated)
- NOWPayments integration: BTC/ETH/SOL/USDC invoices
- Plans: Starter $19/mo, Operator $49/mo, Node $99/mo (yearly variants)
- DB: subscriptions, invoices, plans tables live
- IPN webhook receiver with HMAC-SHA512 verification
- Subscription manager: activate, renew, expire, guard provisioning
- **Bot payment wizard NOT YET WIRED** — users can still provision without paying

---

## VPS Topology

| Host | IP | Role | Capacity |
|------|----|------|----------|
| PIERCALITO | 72.62.239.63 | Control plane + worker node 1 | 1/50 agents, 16% mem, 14% disk |
| IRIS | 187.124.174.137 | Jump box / Vibecoder workspace | — |

## Services on PIERCALITO

| Service | Port | Unit | Status |
|---------|------|------|--------|
| HFSP Storefront Bot | 3001 | hfsp-bot.service | ✅ active |
| HFSP Admin Dashboard | 3002 | hfsp-admin.service | ✅ active |
| nginx (agents.hfsp.cloud) | 443/80 | nginx | ✅ active |
| Health monitor | — | cron 5 min | ✅ active |
| Renewal reminders | — | cron 09:00 UTC | ✅ active |

---

## Next Priorities

### 🔴 P0 — Revenue gate
**Wire payment wizard into provisioning** — users currently get agents free.
- Bot patches (plan select → currency → invoice → await payment → provision) were written but never applied due to zsh escaping issue
- Estimated: 2–3 hours to apply + test

### 🟠 P1 — $GRID tier check (T06)
- Phantom wallet connect page is built (`/wallet`)
- Need: $GRID token mint address, tier thresholds
- Solana RPC via Helius/QuickNode API key

### 🟠 P1 — Second VPS node
- Bootstrap script is ready (`bootstrap.sh`)
- Add node via admin `#nodes` page after setup
- Tests multi-VPS provisioning end-to-end

### 🟡 P2 — Public landing page
- `hfsp.cloud` root just serves "ok" right now
- Marketing page for ClawDrop

### 🟡 P2 — Tenant pairing polish
- Pairing code flow works but UX is rough
- Add `/pair <code>` shortcut in agent bot

### 🟢 P3 — Agent metrics in bot
- CPU/memory of your own agent visible via `/myagents`
- Currently only in admin dashboard

## What's Parked (not being built)
- Webapp wizard
- Chrome extension
- Trading shell / strategy sandbox
