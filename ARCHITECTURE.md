# HFSP Agent Provisioning — Architecture

## Overview
Telegram-first control plane that provisions one isolated OpenClaw runtime per tenant.
Each tenant gets a dedicated Docker container running the OpenClaw gateway.
The provisioner manages the full container lifecycle and port allocation.

---

## Host topology

| Host | IP | Role |
|------|-----|------|
| IRIS | 187.124.174.137 | Jump box / Vibecoder workspace |
| PIERCALITO | 72.62.239.63 | Control plane — provisioner, bot, Docker host |
| TENANT | 187.124.173.69 | Reserved for tenant routing / proxy gateway |

---

## PIERCALITO layout

```
/home/hfsp/
  hfsp-agent-provisioning/    ← this repo
  .openclaw/
    openclaw.json             ← base OpenClaw config (read-only source for containers)
    port-registry.json        ← live port allocation state (19000–19999)
    secrets/
      ssh_identity            ← SSH private key for OpenClaw sandbox backend
      ssh_known_hosts         ← known_hosts for SSH sandbox
      anthropic.key           ← ANTHROPIC_API_KEY (optional)
      openai.key              ← OPENAI_API_KEY (optional)
```

---

## Repo structure

```
hfsp-agent-provisioning/
  src/
    provisioner.ts            ← ShellProvisioner — container lifecycle
    port-registry.ts          ← PortRegistry — port allocation 19000–19999
  tests/
    provisioner-test.ts       ← end-to-end parallel tenant test
  services/
    storefront-bot/           ← Telegram bot (Phase 2)
  tenant-runtime-image/
    Dockerfile                ← OpenClaw runtime image
    entrypoint.sh             ← container startup script
    OPENCLAW_VERSION          ← pinned version
  archive/
    provisioner-poc.sh        ← original POC shell script (superseded)
  docs/
    STATE_MACHINE.md
    UX_FLOW.md
    OAUTH_CALLBACK.md
    SECURITY_NOTES.md
  schema.sql                  ← DB schema (Phase 2)
  ARCHITECTURE.md             ← this file
  OPENCLAW_IMAGE_CONTRACT.md
  TASKS.md
```

---

## Provisioner module (`src/provisioner.ts`)

`ShellProvisioner` handles the full container lifecycle:

```
provision(config)
  → allocate port (PortRegistry)
  → docker rm -f (reconcile)
  → docker create (mounts + env)
  → docker start
  → waitForRunning (30s poll)
  → waitForGateway (bash TCP probe, 30s)
  → return ProvisionResult { gatewayUrl, gatewayPort, ... }

stop(tenantId)   → docker stop
remove(tenantId) → docker rm -f + registry.release()
status(tenantId) → docker inspect + registry.get()
```

---

## Port registry (`src/port-registry.ts`)

File-based JSON registry at `~/.openclaw/port-registry.json`.

- Range: `19000–19999` (1000 tenant slots)
- `allocate(tenantId)` — idempotent, atomic POSIX rename write
- `release(tenantId)` — frees port on `remove()` or failed provision
- `get(tenantId)` — lookup without allocating

---

## Container runtime

Each tenant container:

| Property | Value |
|----------|-------|
| Image | `hfsp-openclaw-runtime:local` |
| User | `hfsp` (UID 1002) |
| Gateway | `ws://127.0.0.1:{PORT}` (loopback inside container) |
| Port mapping | `HOST_PORT:HOST_PORT` (same port, loopback bind) |
| Config mount | `/run/openclaw/openclaw.json:ro` → copied to `~/.openclaw/` by entrypoint |
| Secrets mount | `/home/hfsp/.openclaw/secrets:ro` |
| Workspace mount | `/tenant/workspace` (rw) |
| Restart policy | `unless-stopped` |

**Why staging config mount:** OpenClaw rewrites its config on every startup.
Mounting directly as `:ro` causes `EBUSY rename` error.
Entrypoint copies from `/run/openclaw/openclaw.json` to writable `~/.openclaw/` before starting the gateway.

---

## Tenant lifecycle states

```
drafted → provisioning → provisioned → waiting_pair → live → stopped → deleted
                                                              ↓
                                                           failed
```

---

## Security posture

- One container per tenant — no shared namespaces
- Secrets mounted read-only, never in env or logs
- Config staged read-only — container gets its own writable copy
- `hfsp` operator user isolated from `clawd` live runtime
- No root processes inside containers
- Human review required before any sandbox or auth boundary changes

---

## What is live (Phase 1 ✅)

- Docker image builds and runs
- Provisioner module: provision / stop / remove / status
- Port registry: auto-allocation, idempotent, atomic writes, cleanup on remove
- End-to-end test: two tenants in parallel, unique ports, health check passes

## What is next (Phase 2)

- DB persistence (schema.sql → tenants table)
- Reverse proxy routing by tenant (nginx/caddy)
- Telegram bot wiring: `/start` → provision → return gateway URL
