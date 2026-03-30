#!/usr/bin/env bash
# Renewal reminder + subscription expiry checker
# Runs every 12h via cron

set -euo pipefail

BOT_SERVICE="hfsp-bot"
DB="/home/hfsp/hfsp-agent-provisioning/data/storefront.sqlite"
TOKEN_FILE="/home/hfsp/.openclaw/secrets/hfsp_agent_bot.token"
BOT_TOKEN=$(cat "$TOKEN_FILE")
TELEGRAM_API="https://api.telegram.org/bot${BOT_TOKEN}"

send_message() {
  local chat_id="$1"
  local text="$2"
  curl -sf -X POST "${TELEGRAM_API}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\": ${chat_id}, \"text\": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$text"), \"parse_mode\": \"Markdown\"}" > /dev/null
}

# 1. Expire stale subscriptions
sqlite3 "$DB" "
  UPDATE subscriptions
  SET status = 'expired', updated_at = datetime('now')
  WHERE status = 'active' AND period_end < datetime('now');
"
EXPIRED=$(sqlite3 "$DB" "SELECT changes()")
[[ "$EXPIRED" -gt 0 ]] && echo "[renewal] Expired ${EXPIRED} subscriptions"

# 2. Send renewal reminders (3 days before expiry, once)
while IFS='|' read -r sub_id user_id plan_id period_end; do
  # Check if we already sent a reminder (use a simple flag file)
  FLAG="/tmp/hfsp_reminder_${sub_id}"
  [[ -f "$FLAG" ]] && continue

  PLAN_NAME=$(sqlite3 "$DB" "SELECT name FROM plans WHERE id = '${plan_id}'")
  MSG="⏰ *Renewal reminder*

Your *${PLAN_NAME}* subscription expires on \`${period_end:0:10}\`.

Send /renew to extend for another period."

  send_message "$user_id" "$MSG" && touch "$FLAG"
  echo "[renewal] Reminder sent to ${user_id} for sub ${sub_id}"
done < <(sqlite3 "$DB" "
  SELECT id, telegram_user_id, plan_id, period_end FROM subscriptions
  WHERE status = 'active'
    AND period_end <= datetime('now', '+3 days')
    AND period_end > datetime('now')
")

echo "[renewal] Check complete $(date -u +%Y-%m-%dT%H:%M:%SZ)"
