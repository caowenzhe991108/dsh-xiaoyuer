#!/usr/bin/env python3
"""Import stable persona-profile facts into Hindsight.

Style and speaking habits belong in the persona Markdown card; this script is
only for durable, recallable facts. Each fact is idempotent by content hash.

Usage:
    python scripts/import_persona_facts.py --file plugins/dsh-xiaoyuer/personas/profile-facts.example.json
    python scripts/import_persona_facts.py --file ... --write
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def request_json(url: str, payload: dict, api_key: str, timeout: float) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "content-type": "application/json; charset=utf-8",
            **({"authorization": f"Bearer {api_key}"} if api_key else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return json.loads(body) if body.strip() else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"无法连接 Hindsight：{error.reason}") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="把人设资料中的稳定事实写入 Hindsight")
    parser.add_argument("--file", type=Path, required=True)
    parser.add_argument("--endpoint", default=os.environ.get("HINDSIGHT_URL", "http://localhost:8888"))
    parser.add_argument("--bank", default=os.environ.get("HINDSIGHT_BANK", "xiaoyu"))
    parser.add_argument("--api-key", default=os.environ.get("HINDSIGHT_API_KEY", ""))
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--write", action="store_true", help="实际写入；默认只打印")
    args = parser.parse_args(argv)

    payload = json.loads(args.file.read_text(encoding="utf-8"))
    facts = [fact for fact in payload.get("facts", []) if str(fact.get("text", "")).strip()]
    if not facts:
        print("没有可写入的事实。", file=sys.stderr)
        return 2

    print(f"人设资料：{payload.get('subject', args.file.name)}")
    for index, fact in enumerate(facts, start=1):
        print(f"{index:02d}. [{fact.get('category', 'other')}] {fact['text'].strip()}")
    if not args.write:
        print("\n未写入（加 --write 执行）。", file=sys.stderr)
        return 0

    endpoint = args.endpoint.rstrip("/")
    bank = urllib.parse.quote(args.bank, safe="")
    url = f"{endpoint}/v1/default/banks/{bank}/memories"
    log = {
        "file": str(args.file),
        "endpoint": endpoint,
        "bank": args.bank,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "stored": 0,
        "failed": 0,
        "batches": [],
    }
    batch_size = max(1, args.batch_size)
    for start in range(0, len(facts), batch_size):
        batch = facts[start:start + batch_size]
        items = []
        for fact in batch:
            text = str(fact["text"]).strip()
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            items.append(
                {
                    "content": text,
                    "document_id": f"persona:example:{digest}",
                    "context": "用户提供的示例人设资料（虚构，仅用于演示）",
                    "tags": ["source:persona", "persona:ex", "kind:profile"],
                    "metadata": {"source": "profile-facts.example", "category": fact.get("category", "other")},
                }
            )
        try:
            result = request_json(url, {"items": items, "async": False}, args.api_key, args.timeout)
            stored = int(result.get("items_count") or len(items))
            log["stored"] += stored
            log["batches"].append({"from": start, "count": len(items), "ok": True, "items_count": stored})
            print(f"写入 {start + len(items)}/{len(facts)} 条")
        except RuntimeError as error:
            log["failed"] += len(items)
            log["batches"].append({"from": start, "count": len(items), "ok": False, "error": str(error)})
            print(f"批次 {start} 写入失败：{error}", file=sys.stderr)

    log["finishedAt"] = datetime.now(timezone.utc).isoformat()
    out = Path.cwd() / "persona-import-log.json"
    out.write_text(json.dumps(log, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"写入完成：{log['stored']} 条；日志 {out}")
    return 0 if log["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
