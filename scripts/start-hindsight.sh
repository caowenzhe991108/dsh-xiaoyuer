#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

[ -f .env ] || {
  cp .env.example .env
  echo "Created .env; fill HINDSIGHT_API_LLM_API_KEY and retry." >&2
  exit 1
}

docker compose up -d
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8888/health >/dev/null 2>&1; then
    echo "Hindsight is ready on http://127.0.0.1:8888"
    exit 0
  fi
  sleep 2
done
docker compose logs --tail 80 hindsight
echo "Hindsight did not become ready in 90s" >&2
exit 1
