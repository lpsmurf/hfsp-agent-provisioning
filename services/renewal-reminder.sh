#!/usr/bin/env bash
# Renewal reminder — runs daily at 09:00 UTC via cron
# Sends Telegram message to users whose subscription expires within 3 days
set -euo pipefail

DB_PATH="${DB_PATH:-/home/hfsp/hfsp-agent-provisioning/data/storefront.sqlite}"
BOT_TOKEN_FILE="${BOT_TOKEN_FILE:-/home/hfsp/.openclaw/secrets/hfsp_agent_bot.token}"
LOG_PREFIX="[renewal-reminder $(date -u '+%Y-%m-%d %H:%M')]"

if [[ ! -f "$BOT_TOKEN_FILE" ]]; then
  echo "$LOG_PREFIX ERROR: bot token file not found at $BOT_TOKEN_FILE" >&2
  exit 1
fi
BOT_TOKEN="$(cat "$BOT_TOKEN_FILE")"
API="https://api.telegram.org/bot${BOT_TOKEN}"

echo "$LOG_PREFIX Starting"

# Find subscriptions expiring in next 3 days, not yet reminded in last 23h
sqlite3 -separator '|' "$DB_PATH" "
  SELECT s.id, s.telegram_user_id, s.plan_id, s.period_end
  FROM subscriptions s
  WHERE s.status = 'active'
    AND s.period_end <= datetime('now', '+3 days')
    AND s.period_end > datetime('now')
    AND (s.reminded_at IS NULL OR s.reminded_at < datetime('now', '-23 hours'))
" | while IFS='|' read -r sub_id user_id plan_id period_end; do

  days_left=$(sqlite3 "$DB_PATH" "SELECT CAST((julianday('$period_end') - julianday('now')) AS INTEGER)")
  plan_name=$(sqlite3 "$DB_PATH" "SELECT name FROM plans WHERE id = '$plan_id'" 2>/dev/null || echo "your plan")

  if [[ "$days_left" -le 1 ]]; then
    urgency="⚠️ *Last chance!*"
  else
    urgency="🔔 *Reminder:*"
  fi

  MSG="${urgency} Your *${plan_name}* subscription expires in *${days_left} day(s)* (${period_end/T/ } UTC).

Renew now to keep your agent running without interruption.

Use /start in this chat to manage your subscription."

  RESP=$(curl -sf -X POST "${API}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\":${user_id},\"text\":$(echo "$MSG" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))'),\"parse_mode\":\"Markdown\"}" 2>&1)

  if echo "$RESP" | grep -q '"ok":true'; then
    sqlite3 "$DB_PATH" "UPDATE subscriptions SET reminded_at = datetime('now') WHERE id = '${sub_id}'"
    echo "$LOG_PREFIX Reminded user ${user_id} (sub ${sub_id}, expires ${period_end})"
  else
    echo "$LOG_PREFIX WARN: Failed to message user ${user_id}: $RESP"
  fi
done

echo "$LOG_PREFIX Done"
