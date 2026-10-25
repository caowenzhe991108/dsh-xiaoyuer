#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv="$root/.venv"
python_bin="${PYTHON:-python3}"

"$python_bin" -m venv "$venv"
"$venv/bin/python" -m pip install --upgrade pip edge-tts

probe="$root/.test/voice-probe.mp3"
mkdir -p "$(dirname "$probe")"
for attempt in 1 2 3; do
  if "$venv/bin/python" -m edge_tts --voice zh-CN-XiaoxiaoNeural --rate=+0% --pitch=+0Hz \
      --text "你好，我是小雨。" --write-media "$probe" \
      && [ "$(wc -c < "$probe")" -gt 1000 ]; then
    rm -f "$probe"
    dsh_home="${DSH_HOME:-$HOME/.dsh}"
    mkdir -p "$dsh_home/xiaoyuer"
    printf '%s\n' "$venv/bin/python" > "$dsh_home/xiaoyuer/python.txt"
    echo "Edge TTS ready: $venv/bin/python"
    exit 0
  fi
  echo "Edge TTS probe failed (attempt $attempt), retrying..." >&2
  sleep "$attempt"
done
echo "Edge TTS probe failed" >&2
exit 1
