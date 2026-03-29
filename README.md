# HFSP Agent Provisioning

Telegram-first control plane that provisions one isolated OpenClaw runtime per tenant.
Each tenant gets a dedicated Docker container with a live OpenClaw gateway.

## Status

**Phase 1 complete ✅** — provisioner module, port registry, Docker runtime, end-to-end test all working.

## What works today

- `ShellProvisioner` — full container lifecycle: provision / stop / remove / status
- `PortRegistry` — auto-allocates unique ports (19000–19999) per tenant, releases on cleanup
- `hfsp-openclaw-runtime:local` — Docker image with OpenClaw gateway, runs healthy in ~4s
- Parallel provisioning — two tenants, unique ports, both healthy

## Repo structure

```
src/                          core provisioner modules
tests/                        end-to-end tests
services/storefront-bot/      Telegram bot (Phase 2)
tenant-runtime-image/         Docker image for tenant runtime
archive/                      superseded POC scripts
docs/                         supplementary docs
```

## Canonical docs

| Doc | Purpose |
|-----|---------|
| ARCHITECTURE.md | System design, components, security posture |
| OPENCLAW_IMAGE_CONTRACT.md | Docker image build and runtime contract |
| TASKS.md | Phase tracker |
| SECURITY.md | Security requirements |
| DEPLOYMENT.md | Deploy procedures |

## Running the test

```bash
cd ~/hfsp-agent-provisioning
npx ts-node tests/provisioner-test.ts
```

## Next steps

Phase 2: DB persistence → reverse proxy → Telegram bot wiring.
See TASKS.md.
