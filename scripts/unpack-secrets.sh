#!/usr/bin/env bash
# Restore secrets bundle on a new VPS node
set -euo pipefail

INPUT="${1:?Usage: unpack-secrets.sh <encrypted-bundle>}"
DEST="${DEST_DIR:-$HOME/.openclaw}"

[[ -f "$INPUT" ]] || { echo "ERROR: File not found: $INPUT"; exit 1; }

echo "Unpacking: $INPUT"
echo "Destination: $DEST"
echo ""
read -rsp "Passphrase: " PASS; echo

mkdir -p "$DEST"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass "pass:${PASS}" -in "$INPUT" \
  | tar -xzf - -C "$DEST"

chmod 700 "$DEST/secrets"
chmod 600 "$DEST/secrets"/*
echo ""
echo "Secrets restored to $DEST/secrets/"
echo "Verify with: ls -la $DEST/secrets/"
unset PASS
