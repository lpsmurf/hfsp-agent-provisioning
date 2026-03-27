# HFSP Agent Provisioning — Tasks

## Phase 1 — Backend first

### 1. Freeze the proof-of-concept into a documented contract
- [ ] Document the OpenClaw image name
- [ ] Document the build path
- [ ] Document required runtime env
- [ ] Document create/start/healthcheck/stop/remove lifecycle
- [ ] Document expected success/failure modes

### 2. Convert the POC into a reusable provisioner module
- [ ] Turn `provisioner-poc.sh` into a proper provisioning entrypoint
- [ ] Accept tenant ID
- [ ] Accept surface/runtime config
- [ ] Create container
- [ ] Wait for healthy state
- [ ] Record result
- [ ] Clean up on failure

### 3. Define tenant lifecycle states in code
- [ ] drafted
- [ ] provisioning
- [ ] provisioned
- [ ] waiting_pair
- [ ] live
- [ ] stopped
- [ ] deleted
- [ ] failed

### 4. Add idempotency rules
- [ ] Same tenant → same active container
- [ ] Reconcile existing container before creating another
- [ ] Clean up stale failed containers

### 5. Add logging/audit hooks
- [ ] Who triggered provisioning
- [ ] What image was used
- [ ] What container name was created
- [ ] Whether health check passed
- [ ] Whether cleanup happened

### 6. Only then hook it into the wizard/admin flow
- [ ] Telegram wizard
- [ ] Admin confirm step
- [ ] Future web/extension surfaces

## Rule
Do not start webapp/extension/trading work until the backend provisioning contract is stable.
