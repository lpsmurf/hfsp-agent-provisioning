# OpenClaw Image Contract

## Purpose
Runtime contract for the `hfsp-openclaw-runtime:local` Docker image used by the HFSP provisioner.

---

## Build

| Property | Value |
|----------|-------|
| Build context | `tenant-runtime-image/` |
| Dockerfile | `tenant-runtime-image/Dockerfile` |
| Pinned version file | `tenant-runtime-image/OPENCLAW_VERSION` |
| Current pinned version | `2026.3.22` |
| Build command | `docker build --build-arg OPENCLAW_VERSION=$(cat OPENCLAW_VERSION) -t hfsp-openclaw-runtime:local .` |

---

## Runtime user

| Property | Value |
|----------|-------|
| Username | `hfsp` |
| UID | `1002` (must match host `hfsp` UID for bind mount permissions) |
| Home | `/home/hfsp` |
| Workdir | `/home/hfsp` |

---

## Required mounts

| Host path | Container path | Mode | Purpose |
|-----------|---------------|------|---------|
| `~/.openclaw/openclaw.json` | `/run/openclaw/openclaw.json` | `:ro` | Config staging — entrypoint copies to writable `~/.openclaw/` |
| `~/.openclaw/secrets/` | `/home/hfsp/.openclaw/secrets/` | `:ro` | SSH creds + API keys |
| `/tmp/ws_{tenantId}` | `/tenant/workspace` | `rw` | Tenant workspace |

**Why staging path for config:** OpenClaw rewrites its config on startup.
Mounting directly as `:ro` to `~/.openclaw/openclaw.json` causes `EBUSY rename`.
The entrypoint copies from `/run/openclaw/openclaw.json` → `~/.openclaw/openclaw.json` before starting.

---

## Required secrets

Files expected inside the secrets mount:

| File | Required | Purpose |
|------|----------|---------|
| `ssh_identity` | Yes | SSH private key — loaded as `SSH_IDENTITY` env var |
| `ssh_known_hosts` | Yes | SSH known hosts — loaded as `SSH_KNOWN_HOSTS` env var |
| `anthropic.key` | No | Loaded as `ANTHROPIC_API_KEY` if present |
| `openai.key` | No | Loaded as `OPENAI_API_KEY` if present |

---

## Required environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `HOME` | Yes | — | Must be `/home/hfsp` |
| `GATEWAY_PORT` | No | `18789` | Port the gateway listens on inside the container |

---

## Gateway startup

Entrypoint runs:
```bash
openclaw gateway run \
  --force \
  --allow-unconfigured \
  --bind loopback \
  --port ${GATEWAY_PORT:-18789} \
  --verbose
```

Gateway listens on `ws://127.0.0.1:{GATEWAY_PORT}`.

---

## Health check

The provisioner probes the gateway using bash's built-in TCP device:
```bash
(exec 3<>/dev/tcp/127.0.0.1/${PORT}) 2>/dev/null && echo ok || echo fail
```
Run inside the container via `docker exec`. No external tools required.

---

## Lifecycle contract

1. `docker create` with required mounts + env
2. `docker start`
3. Poll `docker inspect` until `State.Running == true` (30s timeout)
4. Poll gateway TCP probe until port accepts connections (30s timeout)
5. `docker stop`
6. `docker rm -f`

---

## Known failure modes

| Failure | Cause | Fix |
|---------|-------|-----|
| `EBUSY rename` on startup | Config mounted `:ro` at `~/.openclaw/openclaw.json` | Use staging path `/run/openclaw/openclaw.json` |
| `Permission denied` reading config | Container UID ≠ host UID | Ensure Dockerfile `useradd -u 1002` matches host |
| `ssh_identity not found` | Secrets mount missing or wrong path | Check `~/.openclaw/secrets/ssh_identity` exists on host |
| `mkdir /tenant failed` | `/tenant` doesn't exist, `hfsp` can't create root dirs | Dockerfile creates `/tenant/workspace` as root before `USER hfsp` |
| `Invalid --bind` | Wrong value passed to `--bind` | Valid values: `loopback`, `lan`, `tailnet`, `auto`, `custom` |
| Gateway timeout | Port mismatch between `GATEWAY_PORT` env and health check | Both must use the same port |
