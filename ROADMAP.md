# Roadmap

## Next: v0.4.0 — Multi-VPS

- [ ] VPS registry: JSON/DB list of known nodes with capacity metadata
- [ ] `RemoteProvisioner`: SSH-based provisioner that targets a specific node
- [ ] Provisioner router: select least-loaded node before provisioning
- [ ] Secrets bundle workflow: encrypted tar.gz for fast new-node setup
- [ ] Cross-node admin dashboard: aggregate view across all nodes

## v0.5.0 — Tenant lifecycle

- [ ] Tenant deletion flow: Telegram-initiated delete with confirmation
- [ ] Agent upgrade flow: change model preset without full re-provision
- [ ] Stopped agent restart: user can resume a stopped agent from bot
- [ ] Usage metrics: token usage per tenant, stored in DB

## v0.6.0 — Billing & limits

- [ ] Plan tiers: free (1 agent, fast model) / pro (3 agents, any model)
- [ ] Usage caps: token limits per billing period
- [ ] Stripe integration: subscription management
- [ ] Waitlist: gate signups when servers are at capacity

## Parked (not in current scope)

- Webapp deploy wizard
- Chrome extension surface
- Trading / strategy sandbox
- $GRID token gating
