# HFSP Agent Provisioning — Red Flags

## Absolute rule
**DO NOT TOUCH the live `clawd` user runtime.**

The `clawd` user is tied to the running OpenClaw + Telegram bot control-plane environment on PIERCALITO.
Do not chmod, chown, overwrite, reconfigure, or repurpose its live `.openclaw` runtime, home directory, or service files during testing.

## Use separate test identity
Any provisioning / runtime / Docker testing must use a separate user or isolated test environment.

## Why this matters
Changing the live `clawd` runtime can break:
- the storefront / Telegram bot
- live control-plane state
- active OpenClaw sessions
- existing secrets and config

## Safe alternatives
- create a dedicated test user (e.g. `hfsp`)
- use separate test config paths
- use separate tenant directories
- use separate test containers

## Non-negotiable
If a task risks modifying `clawd`’s live runtime, stop and isolate the test instead.
