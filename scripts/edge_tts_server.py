#!/usr/bin/env python3
"""Local Edge TTS HTTP helper for DSH.

DSH may run its plugin host in a restricted process that blocks child-process
network access or its temp directories. This helper is launched outside DSH and
speaks HTTP on 127.0.0.1. It shells out to the edge-tts CLI per request, which
avoids a long-lived asyncio loop inside a threaded HTTP handler.

POST /tts  {"text": "...", "voice": "...", "rate": "+0%", "pitch": "+0Hz"}
  -> audio/mpeg
GET  /health -> {"ok": true, "voice": ...}
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
MAX_CHARS = 1_500


class Handler(BaseHTTPRequestHandler):
    server_version = "XiaoyuerEdgeTTS/1.1"
    voice = DEFAULT_VOICE
    python = sys.executable

    def log_message(self, fmt: str, *args) -> None:  # noqa: N802
        print(f"[edge-tts] {self.address_string()} {fmt % args}", flush=True)

    def send_json(self, status: int, value: dict) -> None:
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("/health", ""):
            self.send_json(200, {"ok": True, "voice": self.voice})
            return
        self.send_json(404, {"ok": False, "message": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/tts":
            self.send_json(404, {"ok": False, "message": "not found"})
            return
        try:
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > 64 * 1024:
                self.send_json(400, {"ok": False, "message": "invalid request body"})
                return
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            text = str(body.get("text") or "").strip()
            if not text:
                self.send_json(400, {"ok": False, "message": "empty text"})
                return
            text = " ".join(text.split())[:MAX_CHARS]
            voice = str(body.get("voice") or self.voice)
            rate = str(body.get("rate") or "+0%")
            pitch = str(body.get("pitch") or "+0Hz")
            fd, name = tempfile.mkstemp(prefix="xiaoyuer-tts-", suffix=".mp3")
            os.close(fd)
            output = Path(name)
            try:
                process = subprocess.run(
                    [
                        self.python,
                        "-m",
                        "edge_tts",
                        "--voice",
                        voice,
                        f"--rate={rate}",
                        f"--pitch={pitch}",
                        "--text",
                        text,
                        "--write-media",
                        str(output),
                    ],
                    capture_output=True,
                    timeout=120,
                    check=False,
                )
                if process.returncode != 0:
                    detail = (process.stderr or process.stdout or b"").decode("utf-8", "replace")[-500:]
                    self.send_json(502, {"ok": False, "message": f"edge-tts exit {process.returncode}: {detail}"})
                    return
                data = output.read_bytes()
            finally:
                output.unlink(missing_ok=True)
            if len(data) < 100:
                self.send_json(502, {"ok": False, "message": "empty audio"})
                return
            self.send_response(200)
            self.send_header("content-type", "audio/mpeg")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as error:  # noqa: BLE001
            self.send_json(502, {"ok": False, "message": f"Edge TTS failed: {error}"})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5050)
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    args = parser.parse_args()
    Handler.voice = args.voice
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[edge-tts] listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
