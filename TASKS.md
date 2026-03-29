# HFSP Agent Provisioning — Tasks

## Phase 1 — Backend provisioning ✅ COMPLETE

### 1. Freeze the proof-of-concept into a documented contract ✅
- [x] Document the OpenClaw image name and build path
- [x] Document required runtime env and mounts
- [x] Document create/start/healthcheck/stop/remove lifecycle
- [x] Document expected success/failure modes
- See: `OPENCLAW_IMAGE_CONTRACT.md`

### 2. Convert the POC into a reusable provisioner module ✅
- [x] `src/provisioner.ts` — ShellProvisioner class
- [x] Accepts tenantId, surface, config, image
- [x] Creates container with correct mounts and env
- [x] Waits for running state (30s)
- [x] Health checks gateway via bash TCP probe (30s)
- [x] Returns structured ProvisionResult
- [x] Cleans up and releases port on failure

### 3. Port allocation ✅
- [x] `src/port-registry.ts` — file-based JSON registry
- [x] Range: 19000–19999 (1000 tenant slots)
- [x] Idempotent allocate, atomic POSIX rename write
- [x] Auto-release on remove() or failed provision
- [x] Parallel tenant test: two tenants, unique ports, health passed

### 4. Idempotency ✅
- [x] Same tenant → reconcile existing container before creating
- [x] Port registry is idempotent — returns existing port if already allocated

### 5. Define tenant lifecycle states ✅ (in ARCHITECTURE.md)
- drafted → provisioning → provisioned → waiting_pair → live → stopped → deleted / failed

---

## Phase 2 — Persistence + routing

### 6. DB persistence
- [ ] Finalize `schema.sql` — tenants table with lifecycle state, port, container name
- [ ] Add SQLite or Postgres client
- [ ] Persist ProvisionResult on successful provision
- [ ] Update state on stop / remove

### 7. Reverse proxy routing
- [ ] nginx or caddy config on PIERCALITO
- [ ] Route by tenant ID or subdomain to correct `ws://127.0.0.1:{PORT}`
- [ ] TLS termination

### 8. Telegram bot wiring
- [ ] `/start` command → trigger provisioning
- [ ] Return gateway URL to user on success
- [ ] Error handling + retry flow
- [ ] Admin confirm step before provisioning

---

## Phase 3 — Extended surfaces (after Phase 2 is stable)

- [ ] Web deploy surface
- [ ] Chrome extension surface
- [ ] Trading/execution shell (only after all above are audited)

---

## Rule
Do not start Phase 3 until Phase 2 backend is stable and tested.
