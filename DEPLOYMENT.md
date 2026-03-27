# HFSP Agent Provisioning — Deployment

## Current deployment posture
- One isolated OpenClaw runtime per tenant
- Container-based tenant execution
- Private dashboard access via SSH tunnel / advanced access path

## Phase 1 deployment target
- Validate the OpenClaw Docker image
- Prove create/start/healthcheck/stop/remove lifecycle
- Keep deployment logic simple and deterministic

## Current rule
Do not introduce multi-surface deployment routing until the base provisioner is proven reliable.
