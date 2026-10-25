#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env; fill HINDSIGHT_API_LLM_API_KEY and SILICONFLOW_API_KEY." >&2
fi

bash scripts/setup-voice.sh

if [ "${START_HINDSIGHT:-0}" = "1" ]; then
  docker compose up -d
fi

cat <<'EOF'

Next:
  1. Fill .env with the Hindsight extraction model key and SiliconFlow key.
  2. docker compose up -d
  3. scripts/install-dsh.sh <profile>
  4. See docs/iphone-tailscale.md for phone access.
EOF
