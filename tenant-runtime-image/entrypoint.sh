#!/usr/bin/env bash
set -euo pipefail

export HOME=/home/hfsp

SECRETS=/home/hfsp/.openclaw/secrets

# Config is mounted read-only at staging path.
# OpenClaw rewrites its config on startup, so copy to writable home dir.
mkdir -p /home/hfsp/.openclaw
cp /run/openclaw/openclaw.json /home/hfsp/.openclaw/openclaw.json

if [[ -f "$SECRETS/ssh_identity" ]]; then
  export SSH_IDENTITY="$(cat "$SECRETS/ssh_identity")"
else
  echo "[entrypoint] ERROR: $SECRETS/ssh_identity not found" >&2; exit 1
fi

if [[ -f "$SECRETS/ssh_known_hosts" ]]; then
  export SSH_KNOWN_HOSTS="$(cat "$SECRETS/ssh_known_hosts")"
else
  echo "[entrypoint] ERROR: $SECRETS/ssh_known_hosts not found" >&2; exit 1
fi

[[ -z "${ANTHROPIC_API_KEY:-}" ]] && [[ -f "$SECRETS/anthropic.key" ]] && \
  export ANTHROPIC_API_KEY="$(tr -d "\r\n" < "$SECRETS/anthropic.key")"

[[ -z "${OPENAI_API_KEY:-}" ]] && [[ -f "$SECRETS/openai.key" ]] && \
  export OPENAI_API_KEY="$(tr -d "\r\n" < "$SECRETS/openai.key")"

exec openclaw gateway run \
  --force \
  --allow-unconfigured \
  --bind lan \
  --port "${GATEWAY_PORT:-18789}" \
  --verbose
