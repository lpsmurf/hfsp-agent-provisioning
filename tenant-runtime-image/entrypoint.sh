#!/usr/bin/env bash
set -euo pipefail

# Tenant runtime entrypoint
# Mounts:
#   /run/openclaw/openclaw.json  (ro) — config staging path
#   /home/hfsp/.openclaw/secrets/ (ro) — secrets dir
#
# OpenClaw rewrites ~/.openclaw/openclaw.json on startup.
# We mount config to /run/openclaw/ and copy it into the writable
# ~/.openclaw/ dir before starting the gateway.

export HOME=/home/hfsp

SECRETS=/home/hfsp/.openclaw/secrets

# Copy config from staging mount into writable home dir
mkdir -p /home/hfsp/.openclaw
cp /run/openclaw/openclaw.json /home/hfsp/.openclaw/openclaw.json

# SSH credentials required by openclaw.json sandbox.ssh config
if [[ -f "$SECRETS/ssh_identity" ]]; then
  export SSH_IDENTITY="$(cat "$SECRETS/ssh_identity")"
else
  echo "[entrypoint] ERROR: $SECRETS/ssh_identity not found" >&2
  exit 1
fi

if [[ -f "$SECRETS/ssh_known_hosts" ]]; then
  export SSH_KNOWN_HOSTS="$(cat "$SECRETS/ssh_known_hosts")"
else
  echo "[entrypoint] ERROR: $SECRETS/ssh_known_hosts not found" >&2
  exit 1
fi

# Optional provider API keys
if [[ -z "${ANTHROPIC_API_KEY:-}" ]] && [[ -f "$SECRETS/anthropic.key" ]]; then
  export ANTHROPIC_API_KEY="$(tr -d "\r\n" < "$SECRETS/anthropic.key")"
fi

if [[ -z "${OPENAI_API_KEY:-}" ]] && [[ -f "$SECRETS/openai.key" ]]; then
  export OPENAI_API_KEY="$(tr -d "\r\n" < "$SECRETS/openai.key")"
fi

exec openclaw gateway run \
  --force \
  --allow-unconfigured \
  --bind loopback \
  --port 18789 \
  --verbose
