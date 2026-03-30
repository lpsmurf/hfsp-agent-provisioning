#!/usr/bin/env bash
# Pack ~/.openclaw/secrets into an encrypted bundle for new VPS setup
set -euo pipefail

SECRETS_DIR="${SECRETS_DIR:-$HOME/.openclaw/secrets}"
OUTPUT="${1:-$HOME/secrets-bundle-$(date +%Y%m%d%H%M%S).tar.gz.enc}"

[[ -d "$SECRETS_DIR" ]] || { echo "ERROR: $SECRETS_DIR not found"; exit 1; }

echo "Packing secrets from: $SECRETS_DIR"
echo "Output:               $OUTPUT"
echo ""
read -rsp "Passphrase: " PASS; echo
read -rsp "Confirm:    " PASS2; echo
[[ "$PASS" == "$PASS2" ]] || { echo "Passphrases don't match"; exit 1; }
[[ ${#PASS} -ge 12 ]] || { echo "Passphrase must be at least 12 characters"; exit 1; }

tar -czf - -C "$(dirname "$SECRETS_DIR")" "$(basename "$SECRETS_DIR")" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -pass "pass:${PASS}" -out "$OUTPUT"

chmod 600 "$OUTPUT"
SIZE=$(du -sh "$OUTPUT" | cut -f1)
echo ""
echo "Done. Bundle: $OUTPUT ($SIZE)"
echo "Transfer this file securely and use unpack-secrets.sh on the new node."
unset PASS PASS2
