#!/usr/bin/env python3
"""File-based Edge TTS bridge used by the DSH host plugin.

Reads one JSON request from --input, writes MP3 to --output, and writes a
traceback to --error on failure. File I/O avoids command-line quoting and
captured-pipe limitations on confined hosts.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import traceback
from pathlib import Path

import edge_tts


async def synthesize(request: dict, output: Path) -> None:
    text = str(request.get("text") or "").strip()
    if text == "":
        raise ValueError("empty text")
    voice = str(request.get("voice") or "zh-CN-XiaoxiaoNeural")
    rate = str(request.get("rate") or "+0%")
    pitch = str(request.get("pitch") or "+0Hz")
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await communicate.save(str(output))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--error", required=True)
    args = parser.parse_args()
    error_path = Path(args.error)
    try:
        request = json.loads(Path(args.input).read_text(encoding="utf-8"))
        asyncio.run(synthesize(request, Path(args.output)))
        if not Path(args.output).exists() or Path(args.output).stat().st_size == 0:
            raise RuntimeError("edge-tts produced no audio")
        return 0
    except Exception:
        error_path.write_text(traceback.format_exc(), encoding="utf-8")
        return 1


if __name__ == "__main__":
    sys.exit(main())
