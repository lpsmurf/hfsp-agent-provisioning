# HFSP Agent Provisioning — Canonical Architecture

## Scope today
- Telegram-first provisioning control plane
- One isolated OpenClaw runtime per customer
- Pairing flow for tenant approval
- Private dashboard access via SSH tunnel / advanced path

## Out of scope for now
- Trading/execution shell
- User-loaded strategy sandbox
- Chrome extension surface
- Public webapp deploy wizard

## Core principles
- Keep tenant isolation strict
- Keep secrets encrypted at rest before launch
- Keep provisioning deterministic and auditable
- Do not expand scope until the current provisioning path is stable

## Current lifecycle
- drafted
- provisioned
- waiting_pair
- live
- stopped
- deleted

## Planned expansion path
1. Stabilize Telegram provisioning
2. Add web deploy surface if needed
3. Add extension surface if needed
4. Consider trading/execution only after the above are live and audited

## Security posture
- One container per tenant
- No shared workspace directories
- No secrets in logs
- Encrypt secrets at rest before handling real users
- Human review required for any sandbox boundary or auth boundary changes

## Source of truth
This repo’s docs should agree on the current scope.
If a feature is not in this architecture doc, it should not be assumed shipped.
