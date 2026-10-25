#!/usr/bin/env python3
"""A tiny Hindsight-compatible mock for local tests.

It implements only the endpoints this project uses:
  GET  /health
  POST /v1/default/banks/{bank}/memories
  POST /v1/default/banks/{bank}/memories/recall
  GET  /v1/default/banks/{bank}/memories/list

Facts are kept in memory and optionally persisted to a JSON file. This is a
test double, not a replacement for Hindsight's extraction, reranking, or graph.
"""

from __future__ import annotations

import argparse
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


class Store:
    def __init__(self, persist: Path | None):
        self.persist = persist
        self.lock = threading.Lock()
        self.banks: dict[str, list[dict]] = {}
        self.load()

    def load(self) -> None:
        if self.persist and self.persist.exists():
            try:
                self.banks = json.loads(self.persist.read_text(encoding="utf-8"))
            except Exception:
                self.banks = {}

    def save(self) -> None:
        if self.persist:
            self.persist.parent.mkdir(parents=True, exist_ok=True)
            self.persist.write_text(json.dumps(self.banks, ensure_ascii=False, indent=2), encoding="utf-8")

    def retain(self, bank: str, items: list[dict]) -> dict:
        with self.lock:
            bank_items = self.banks.setdefault(bank, [])
            existing = {item.get("document_id") for item in bank_items}
            stored = 0
            for index, item in enumerate(items):
                content = str(item.get("content") or "").strip()
                if not content:
                    continue
                document_id = item.get("document_id") or f"mock-{len(bank_items)}-{index}"
                if document_id in existing:
                    bank_items[:] = [entry for entry in bank_items if entry.get("document_id") != document_id]
                bank_items.append(
                    {
                        "id": f"mem-{len(bank_items) + 1}",
                        "text": content,
                        "type": "world",
                        "context": item.get("context"),
                        "document_id": document_id,
                        "tags": item.get("tags") or [],
                        "metadata": item.get("metadata") or {},
                        "mentioned_at": "2026-10-25T12:00:00Z",
                        "scores": {"final": 1.0, "reranker": 1.0},
                    }
                )
                existing.add(document_id)
                stored += 1
            self.save()
            return {"success": True, "bank_id": bank, "items_count": stored, "async": False}

    def recall(self, bank: str, query: str, max_tokens: int = 4096) -> dict:
        with self.lock:
            items = list(self.banks.get(bank, []))
        if not items:
            return {"results": []}
        terms = [term for term in re.split(r"[\s，。,.!?？；;：:]+", query.lower()) if term]
        if not terms:
            terms = list(query)
        scored = []
        for item in items:
            text = item["text"]
            score = 0.0
            for term in terms:
                if term and term in text:
                    score += 1.0 + len(term) / max(1, len(text))
                for size in (2, 3):
                    for index in range(0, max(1, len(term) - size + 1)):
                        gram = term[index:index + size]
                        if gram and gram in text:
                            score += 0.15
            if score > 0:
                scored.append((score, item))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        results = []
        for score, item in scored[:8]:
            copy = dict(item)
            copy["scores"] = {"final": round(min(0.99, 0.35 + score / 10), 4)}
            results.append(copy)
        return {"results": results}

    def list(self, bank: str) -> dict:
        with self.lock:
            items = list(self.banks.get(bank, []))
        return {"items": items, "total": len(items), "limit": len(items), "offset": 0}


STORE: Store


class Handler(BaseHTTPRequestHandler):
    server_version = "MockHindsight/0.1"

    def log_message(self, fmt: str, *args) -> None:  # noqa: N802
        print(f"[mock-hindsight] {self.address_string()} {fmt % args}", flush=True)

    def send_json(self, status: int, value: dict) -> None:
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict:
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in ("/health", "/health/ready", "/health/live"):
            self.send_json(200, {"status": "ok"})
            return
        match = re.fullmatch(r"/v1/default/banks/([^/]+)/memories/list", parsed.path)
        if match:
            bank = match.group(1)
            query = parse_qs(parsed.query).get("q", [""])[0]
            result = STORE.list(bank)
            if query:
                result["items"] = [item for item in result["items"] if query.lower() in item["text"].lower()]
                result["total"] = len(result["items"])
            self.send_json(200, result)
            return
        self.send_json(404, {"detail": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/asr":
            length = int(self.headers.get("content-length") or 0)
            if length <= 0:
                self.send_json(400, {"message": "empty audio"})
                return
            self.rfile.read(length)
            self.send_json(200, {"text": "我想去冰岛看极光。"})
            return
        match = re.fullmatch(r"/v1/default/banks/([^/]+)/memories", parsed.path)
        if match:
            body = self.read_json()
            self.send_json(200, STORE.retain(match.group(1), body.get("items") or []))
            return
        match = re.fullmatch(r"/v1/default/banks/([^/]+)/memories/recall", parsed.path)
        if match:
            body = self.read_json()
            query = str(body.get("query") or "")
            self.send_json(200, STORE.recall(match.group(1), query, int(body.get("max_tokens") or 4096)))
            return
        self.send_json(404, {"detail": "not found"})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8899)
    parser.add_argument("--persist", type=Path, default=None)
    args = parser.parse_args()
    global STORE
    STORE = Store(args.persist)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[mock-hindsight] listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
