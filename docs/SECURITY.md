# Security

## Current posture
- One container per tenant
- Secrets should not be printed to logs
- Secrets at rest should be encrypted before real-user launch

## Human review required
- Any auth boundary
- Any sandbox boundary
- Any cross-tenant routing logic

## Rule
Security docs must match the actual implementation state, not the aspirational one.
