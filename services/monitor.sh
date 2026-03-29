#!/usr/bin/env bash
# HFSP stack health monitor
# Runs every 5 minutes via cron. Sends Telegram alert on failure.
set -euo pipefail

BOT_TOKEN_FILE="/home/hfsp/.openclaw/secrets/hfsp_agent_bot.token"
ALERT_CHAT_ID_FILE="/home/hfsp/.openclaw/secrets/monitor_chat_id"
LOG="/tmp/hfsp-monitor.log"
FAIL=0

BOT_TOKEN="$(cat "$BOT_TOKEN_FILE" 2>/dev/null || true)"
ALERT_CHAT_ID="$(cat "$ALERT_CHAT_ID_FILE" 2>/dev/null || true)"

alert() {
  local msg="$1"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ALERT: $msg" >> "$LOG"
  if [[ -n "$BOT_TOKEN" && -n "$ALERT_CHAT_ID" ]]; then
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      -d "chat_id=${ALERT_CHAT_ID}" \
      -d "text=⚠️ HFSP Monitor: ${msg}" \
      > /dev/null
  fi
}

ok() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) OK: $1" >> "$LOG"
}

# 1. hfsp-bot service
if ! systemctl is-active --quiet hfsp-bot 2>/dev/null; then
  alert "hfsp-bot service is DOWN — restarting"
  sudo /bin/systemctl restart hfsp-bot 2>/dev/null || true
  FAIL=1
else
  ok "hfsp-bot active"
fi

# 2. Bot HTTP health
if ! curl -sf --max-time 5 http://127.0.0.1:3001/health > /dev/null 2>&1; then
  alert "hfsp-bot health endpoint not responding"
  FAIL=1
else
  ok "hfsp-bot health ok"
fi

# 3. All running tenant containers + gateway probe
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  port=$(docker inspect -f '{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostPort}}{{end}}{{end}}' "$name" 2>/dev/null || true)
  if [[ -z "$port" ]]; then
    alert "Container $name: cannot read port"
    FAIL=1
    continue
  fi
  if ! bash -c "(exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null"; then
    alert "Container $name: gateway on port $port not responding"
    FAIL=1
  else
    ok "Container $name gateway:$port ok"
  fi
done < <(docker ps --filter "name=hfsp_" --format "{{.Names}}" 2>/dev/null)

# 4. Capacity checks
MEM_AVAIL_KB=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
DISK_AVAIL_KB=$(df --output=avail / 2>/dev/null | tail -1 || echo 0)
PORT_USED=$(python3 -c "import json,sys; d=json.load(open('/home/hfsp/.openclaw/port-registry.json')); print(len(d))" 2>/dev/null || echo 0)
PORT_MAX=1000

if [[ "$MEM_AVAIL_KB" -gt 0 && "$MEM_AVAIL_KB" -lt 400000 ]]; then
  alert "LOW MEMORY: only $((MEM_AVAIL_KB / 1024)) MB available"
  FAIL=1
else
  ok "memory ok ($(( MEM_AVAIL_KB / 1024 )) MB free)"
fi

if [[ "$DISK_AVAIL_KB" -gt 0 && "$DISK_AVAIL_KB" -lt 3145728 ]]; then  # < 3 GB
  alert "LOW DISK: only $((DISK_AVAIL_KB / 1024 / 1024)) GB available"
  FAIL=1
else
  ok "disk ok ($((DISK_AVAIL_KB / 1024 / 1024)) GB free)"
fi

PORT_PCT=$(( PORT_USED * 100 / PORT_MAX ))
if [[ "$PORT_PCT" -ge 80 ]]; then
  alert "PORT CAPACITY: ${PORT_USED}/${PORT_MAX} ports allocated (${PORT_PCT}%)"
  FAIL=1
else
  ok "ports ok (${PORT_USED}/${PORT_MAX} used)"
fi

# 5. Dangling image cleanup (runs quietly, alerts only on unexpected failure)
PRUNED=$(docker image prune -f 2>&1 || true)
if echo "$PRUNED" | grep -q "Total reclaimed"; then
  RECLAIMED=$(echo "$PRUNED" | grep "Total reclaimed" | awk '{print $NF}')
  ok "docker image prune ran, reclaimed ${RECLAIMED}"
fi

# Trim log to last 500 lines
tail -500 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"

exit $FAIL
