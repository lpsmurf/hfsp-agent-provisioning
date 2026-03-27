# HFSP Agent Provisioning

Telegram-first control plane for provisioning one isolated OpenClaw runtime per customer.

## Current scope
- Telegram onboarding / wizard flow
- Tenant provisioning
- Pairing flow
- Private dashboard access

## Canonical docs
- ARCHITECTURE.md
- PROJECT_MANAGER.md
- API.md
- DEPLOYMENT.md
- SECURITY.md
- MULTI_SURFACE_ARCHITECTURE.md
- WEBAPP_EXTENSION_BUILD_PLAN.md
- VIBECODING_STRATEGY.md
- TRADING_BOT.md
- GRID_TOKEN.md

## Phase 1 goal
Validate the OpenClaw Docker image and prove a simple container lifecycle:
create → start → healthcheck → stop → remove.
