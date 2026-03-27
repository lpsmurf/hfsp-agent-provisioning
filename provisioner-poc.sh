#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:-}"
if [[ -z "$IMAGE" ]]; then
  echo "usage: $0 <openclaw-image>" >&2
  exit 1
fi
NAME="hfsp-poc-$(date +%s)"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

echo "Creating container: $NAME"
docker create --name "$NAME" "$IMAGE" >/dev/null

echo "Starting container"
docker start "$NAME" >/dev/null

for i in {1..30}; do
  if docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null | grep -qx true; then
    break
  fi
  sleep 1
done

if ! docker inspect -f '{{.State.Running}}' "$NAME" | grep -qx true; then
  echo "Container did not start" >&2
  exit 2
fi

echo "Health check"
if docker exec "$NAME" bash -lc 'echo ok' >/dev/null 2>&1; then
  echo "Health check passed"
else
  echo "Health check failed" >&2
  exit 3
fi

echo "Stopping container"
docker stop "$NAME" >/dev/null

echo "Removing container"
docker rm "$NAME" >/dev/null
trap - EXIT
echo "POC complete"
