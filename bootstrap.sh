#!/usr/bin/env bash
# ============================================================
# HFSP VPS Bootstrap Script
# Turns a fresh Ubuntu 24.04 VPS into an HFSP agent node.
#
# Usage:
#   sudo bash bootstrap.sh \
#     --hostname piercalito2 \
#     --domain agents2.hfsp.cloud \
#     --repo-url git@github.com:your-org/hfsp-agent-provisioning.git \
#     --secrets-bundle /path/to/secrets.tar.gz.enc
#
# Required: run as root on a fresh Ubuntu 24.04 VPS.
# ============================================================
set -euo pipefail

# ── Defaults ────────────────────────────────────────────────
VPS_HOSTNAME=""
DOMAIN=""
REPO_URL=""
SECRETS_BUNDLE=""         # encrypted tar.gz of ~/.openclaw/secrets/
HFSP_UID=1002
HFSP_USER=hfsp
REPO_DIR="/home/${HFSP_USER}/hfsp-agent-provisioning"
NODE_VERSION=22

usage() {
  echo "Usage: $0 --hostname NAME --domain DOMAIN --repo-url URL [--secrets-bundle FILE]"
  exit 1
}

# ── Parse args ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hostname) VPS_HOSTNAME="$2"; shift 2 ;;
    --domain)   DOMAIN="$2"; shift 2 ;;
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --secrets-bundle) SECRETS_BUNDLE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; usage ;;
  esac
done

[[ -z "$VPS_HOSTNAME" || -z "$DOMAIN" || -z "$REPO_URL" ]] && usage

echo "========================================"
echo " HFSP Bootstrap — $(date -u)"
echo " hostname: $VPS_HOSTNAME  domain: $DOMAIN"
echo "========================================"

# ── 1. System hostname ───────────────────────────────────────
hostnamectl set-hostname "$VPS_HOSTNAME"
echo "✓ hostname set to $VPS_HOSTNAME"

# ── 2. System packages ───────────────────────────────────────
apt-get update -qq
apt-get install -y -qq \
  curl git nginx certbot python3-certbot-nginx \
  sqlite3 python3 ca-certificates gnupg lsb-release \
  build-essential
echo "✓ system packages installed"

# ── 3. Docker ────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io
  systemctl enable --now docker
fi
echo "✓ Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ── 4. Node.js ───────────────────────────────────────────────
if ! node --version 2>/dev/null | grep -q "^v${NODE_VERSION}"; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -qq nodejs
fi
echo "✓ Node.js $(node --version)"

# ── 5. hfsp user ─────────────────────────────────────────────
if ! id "$HFSP_USER" &>/dev/null; then
  useradd -m -u "$HFSP_UID" -s /bin/bash "$HFSP_USER"
  usermod -aG docker "$HFSP_USER"
fi
echo "✓ user $HFSP_USER (UID=$(id -u $HFSP_USER))"

# ── 6. Repo clone ─────────────────────────────────────────────
if [[ ! -d "$REPO_DIR/.git" ]]; then
  sudo -u "$HFSP_USER" git clone "$REPO_URL" "$REPO_DIR"
fi
sudo -u "$HFSP_USER" bash -c "cd $REPO_DIR && npm install --quiet"
echo "✓ repo cloned + npm install"

# ── 7. Secrets bundle ─────────────────────────────────────────
SECRETS_DIR="/home/${HFSP_USER}/.openclaw/secrets"
mkdir -p "$SECRETS_DIR"
if [[ -n "$SECRETS_BUNDLE" && -f "$SECRETS_BUNDLE" ]]; then
  # Decrypt: openssl enc -aes-256-cbc -d -in secrets.tar.gz.enc | tar xz -C ~/.openclaw/
  read -rsp "Secrets bundle passphrase: " PASS
  echo
  openssl enc -aes-256-cbc -d -pass "pass:$PASS" -in "$SECRETS_BUNDLE" \
    | tar xz -C "/home/${HFSP_USER}/.openclaw/"
  chown -R "${HFSP_USER}:${HFSP_USER}" "/home/${HFSP_USER}/.openclaw/"
  chmod 700 "$SECRETS_DIR"
  chmod 600 "$SECRETS_DIR"/*
  echo "✓ secrets bundle extracted"
else
  echo "⚠ No secrets bundle provided. Manually copy to $SECRETS_DIR:"
  echo "  ssh_identity, ssh_known_hosts, anthropic.key, openai.key"
  echo "  hfsp_agent_bot.token, monitor_chat_id"
fi

# ── 8. openclaw.json base config ──────────────────────────────
OPENCLAW_CONF="/home/${HFSP_USER}/.openclaw/openclaw.json"
if [[ ! -f "$OPENCLAW_CONF" ]]; then
  cat > "$OPENCLAW_CONF" << 'JSON'
{
  "version": "1",
  "gateway": {},
  "identity": { "name": "HFSP Agent", "emoji": "🤖" }
}
JSON
  chown "${HFSP_USER}:${HFSP_USER}" "$OPENCLAW_CONF"
  chmod 600 "$OPENCLAW_CONF"
fi
echo "✓ openclaw base config"

# ── 9. Tenant directories ─────────────────────────────────────
mkdir -p "/home/${HFSP_USER}/tenants"
chown "${HFSP_USER}:${HFSP_USER}" "/home/${HFSP_USER}/tenants"
mkdir -p "/home/${HFSP_USER}/.openclaw"
chown -R "${HFSP_USER}:${HFSP_USER}" "/home/${HFSP_USER}/.openclaw"
echo "✓ directories"

# ── 10. Build Docker image ─────────────────────────────────────
echo "Building hfsp-openclaw-runtime:local (this takes ~2 min)..."
sudo -u "$HFSP_USER" docker build \
  -t hfsp-openclaw-runtime:local \
  "$REPO_DIR/tenant-runtime-image/" \
  --quiet
echo "✓ Docker image built"

# ── 11. nginx ─────────────────────────────────────────────────
TENANTS_CONF_DIR="/etc/nginx/conf.d/hfsp-tenants"
mkdir -p "$TENANTS_CONF_DIR"

cat > "/etc/nginx/conf.d/${DOMAIN}.conf" << NGINXEOF
server {
  server_name ${DOMAIN};

  include /etc/nginx/conf.d/hfsp-tenants/*.conf;

  location / {
    return 200 "ok\n";
    add_header Content-Type text/plain;
  }

  location /telegram/webhook {
    proxy_pass http://127.0.0.1:3001/telegram/webhook;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  listen 80;
}
NGINXEOF

nginx -t && systemctl reload nginx
echo "✓ nginx configured for $DOMAIN"
echo "  → Run: certbot --nginx -d $DOMAIN  (after DNS is pointed)"

# ── 12. sudoers ───────────────────────────────────────────────
cat > "/etc/sudoers.d/hfsp-${VPS_HOSTNAME}" << SUDOEOF
# HFSP operator — allow nginx reload and service management
${HFSP_USER} ALL=(ALL) NOPASSWD: /bin/nginx -s reload
${HFSP_USER} ALL=(ALL) NOPASSWD: /usr/bin/nginx -s reload
${HFSP_USER} ALL=(ALL) NOPASSWD: /bin/systemctl restart hfsp-bot
${HFSP_USER} ALL=(ALL) NOPASSWD: /bin/systemctl restart hfsp-storefront
${HFSP_USER} ALL=(ALL) NOPASSWD: /bin/systemctl status hfsp-bot
${HFSP_USER} ALL=(ALL) NOPASSWD: /bin/systemctl status hfsp-storefront
SUDOEOF
chmod 440 "/etc/sudoers.d/hfsp-${VPS_HOSTNAME}"
echo "✓ sudoers"

# ── 13. systemd service ───────────────────────────────────────
cp "$REPO_DIR/services/storefront-bot/hfsp-bot.service" /etc/systemd/system/hfsp-bot.service
systemctl daemon-reload
systemctl enable hfsp-bot
echo "✓ systemd service installed (not started — configure secrets first)"

# ── 14. cron monitor ──────────────────────────────────────────
CRON_LINE="*/5 * * * * bash /home/${HFSP_USER}/hfsp-agent-provisioning/services/monitor.sh >> /tmp/hfsp-monitor.log 2>&1"
(crontab -u "$HFSP_USER" -l 2>/dev/null | grep -v monitor.sh; echo "$CRON_LINE") \
  | crontab -u "$HFSP_USER" -
echo "✓ monitor cron installed"

# ── 15. data dir ──────────────────────────────────────────────
mkdir -p "$REPO_DIR/data"
chown "${HFSP_USER}:${HFSP_USER}" "$REPO_DIR/data"
if [[ ! -f "$REPO_DIR/data/storefront.sqlite" ]]; then
  sudo -u "$HFSP_USER" sqlite3 "$REPO_DIR/data/storefront.sqlite" \
    < "$REPO_DIR/schema.sql"
  echo "✓ SQLite DB initialized"
fi

echo ""
echo "========================================"
echo " Bootstrap complete!"
echo ""
echo " NEXT STEPS:"
echo " 1. Point DNS: $DOMAIN → $(curl -sf ifconfig.me || echo '<this-ip>')"
echo " 2. TLS:  certbot --nginx -d $DOMAIN"
echo " 3. Secrets: verify $SECRETS_DIR has all required files"
echo " 4. Env: set TELEGRAM_BOT_TOKEN in /etc/systemd/system/hfsp-bot.service"
echo " 5. Start: systemctl start hfsp-bot"
echo " 6. Test:  curl http://127.0.0.1:3001/health"
echo "========================================"
