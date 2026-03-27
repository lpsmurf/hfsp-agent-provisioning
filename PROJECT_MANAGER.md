# HFSP Agent Provisioning — Project Manager

## Current phase
Phase 1: Telegram provisioning core + OpenClaw runtime proof-of-concept

## Immediate goal
Validate that the OpenClaw Docker image exists and can be provisioned reliably.

## Sequence
1. Inspect repo structure and docs
2. Confirm OpenClaw Docker image runs locally or can be built
3. Build a single provisioner proof-of-concept script
4. Only after that, add more orchestration or surface work

## What to avoid for now
- Webapp wizard
- Chrome extension
- Trading shell
- Strategy sandbox
- Payment flow beyond documentation

## Exit criteria for Phase 1
- The OpenClaw image starts
- A container can be created
- Health check passes
- Container can be stopped and removed cleanly
- Provisioner script is repeatable

## Delivery rule
Do not start later phases until the provisioner proof-of-concept is stable.
