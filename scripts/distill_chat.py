#!/usr/bin/env python3
"""Distill exported chat logs into Hindsight fact entries.

The script is deliberately offline-first: it reads a chat export, filters
noise, extracts durable statements about "her", and writes Markdown/JSONL
artifacts. Passing ``--write`` sends the facts to a local Hindsight bank.

Typical use:
    python scripts/distill_chat.py tests/fixtures/sample_chat.txt \
      --out distill-output --write --min-facts 10

No third-party Python packages are required.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Sequence


MEDIA_NOISE = (
    "[图片]", "[表情]", "[语音]", "[视频]", "[文件]", "[位置]", "[链接]",
    "[动画表情]", "[转账]", "[红包]", "[名片]", "[音乐]", "[分享]",
)
SYSTEM_NOISE = (
    "撤回了一条消息", "以上是打招呼的内容", "你已添加了", "消息已发出",
    "但被对方拒收", "对方正在输入", "拍了拍", "加入了群聊", "退出了群聊",
)
LAUGHTER = {
    "哈哈", "哈哈哈", "哈哈哈哈", "呵呵", "嘿嘿", "嗯", "嗯嗯", "哦", "哦哦",
    "好", "好的", "好吧", "行", "可以", "在吗", "在", "晚安", "早安", "早",
    "午安", "收到", "没事", "算了", "随便", "不知道", "怎么了", "没事儿",
}
SENTENCE_SPLIT = re.compile(r"(?<=[。！？!?；;\n])")
FINAL_PARTICLES = ("呀", "呢", "吧", "嘛", "啦", "哦", "呗", "啊", "喔", "咯")
URL = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
TIMESTAMP_LIKE = re.compile(r"^\s*\d{2,4}[-/年]\d{1,2}[-/月]\d{1,2}.*$")

TIME_COLUMNS = ("time", "timestamp", "date", "datetime", "时间", "日期")
SENDER_COLUMNS = ("sender", "from", "speaker", "nickname", "name", "发送者", "昵称", "发言人")
TEXT_COLUMNS = ("text", "content", "message", "msg", "内容", "消息")


@dataclass
class Message:
    timestamp: str
    sender: str
    text: str


@dataclass
class Fact:
    text: str
    category: str
    source: str
    timestamp: str
    confidence: float


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "utf-16"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"无法解码文件：{path}")


def parse_txt(text: str) -> list[Message]:
    """Parse common WeChat/QQ text exports and simple ``name: text`` logs."""
    messages: list[Message] = []
    header = re.compile(
        r"^\s*(?:\[)?(?P<time>\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?)\]?\s*"
        r"(?P<sender>[^:：]{1,24})[:：]\s*(?P<text>.*)$"
    )
    bare = re.compile(r"^\s*(?P<sender>[^:：]{1,24})[:：]\s*(?P<text>.+)$")
    pending: Message | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line == "":
            continue
        match = header.match(line)
        if match is None:
            match = bare.match(line)
        if match is not None:
            if pending is not None:
                messages.append(pending)
            pending = Message(
                timestamp=match.groupdict().get("time", "") or "",
                sender=match.group("sender").strip(),
                text=match.group("text").strip(),
            )
            continue
        if pending is not None and pending.text:
            pending.text = f"{pending.text} {line}".strip()
        elif line:
            messages.append(Message(timestamp="", sender="", text=line))
    if pending is not None:
        messages.append(pending)
    return messages


def parse_csv_text(text: str) -> list[Message]:
    rows = list(csv.DictReader(text.splitlines()))
    if not rows:
        return []
    keys = {key.strip().lower(): key for key in rows[0] if key}
    time_key = next((keys[name] for name in TIME_COLUMNS if name in keys), None)
    sender_key = next((keys[name] for name in SENDER_COLUMNS if name in keys), None)
    text_key = next((keys[name] for name in TEXT_COLUMNS if name in keys), None)
    if text_key is None:
        raise SystemExit("CSV 缺少消息内容列（text/content/message/内容）。")
    messages = []
    for row in rows:
        content = (row.get(text_key) or "").strip()
        if content:
            messages.append(
                Message(
                    timestamp=(row.get(time_key) or "").strip() if time_key else "",
                    sender=(row.get(sender_key) or "").strip() if sender_key else "",
                    text=content,
                )
            )
    return messages


def parse_json_text(text: str) -> list[Message]:
    payload = json.loads(text)
    if isinstance(payload, dict):
        payload = payload.get("messages") or payload.get("data") or []
    if not isinstance(payload, list):
        raise SystemExit("JSON 必须是消息数组或包含 messages 数组。")
    messages = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        content = row.get("text") or row.get("content") or row.get("message") or ""
        if not isinstance(content, str) or content.strip() == "":
            continue
        messages.append(
            Message(
                timestamp=str(row.get("timestamp") or row.get("time") or row.get("date") or ""),
                sender=str(row.get("sender") or row.get("from") or row.get("speaker") or row.get("name") or ""),
                text=content.strip(),
            )
        )
    return messages


def read_messages(path: Path) -> list[Message]:
    suffix = path.suffix.lower()
    text = read_text(path)
    if suffix == ".json":
        return parse_json_text(text)
    if suffix == ".csv":
        return parse_csv_text(text)
    return parse_txt(text)


def clean_text(text: str) -> str:
    value = text
    for noise in MEDIA_NOISE:
        value = value.replace(noise, " ")
    value = URL.sub(" ", value)
    value = re.sub(r"@\S+", " ", value)
    value = value.replace("\u200b", " ").replace("\ufeff", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value.strip("，,。.!！?？~～ ")


def is_noise(sender: str, text: str) -> bool:
    value = clean_text(text)
    if len(value) < 3:
        return True
    if any(noise in text for noise in SYSTEM_NOISE):
        return True
    if TIMESTAMP_LIKE.match(value):
        return True
    if value in LAUGHTER:
        return True
    if re.fullmatch(r"[\W_]+", value, flags=re.UNICODE):
        return True
    if re.fullmatch(r"(哈|呵|嘿|嘻){2,}", value):
        return True
    if value.startswith("【") and value.endswith("】"):
        return True
    return False


def split_sentences(text: str) -> Iterator[str]:
    for chunk in SENTENCE_SPLIT.split(text):
        value = clean_text(chunk)
        if value:
            yield value


def shorten(value: str, limit: int = 46) -> str:
    value = value.strip(" ：:，,。.!！?？；;、")
    value = re.sub(r"(其实|就是|真的|反正|然后|那个|这个)", "", value)
    value = re.sub(r"\s+", "", value)
    value = value.strip("，,。.!！?？；;、")
    if len(value) > limit:
        value = value[:limit].rstrip("，,。.!！?？；;、")
    return value


def add_fact(facts: list[Fact], text: str, category: str, message: Message, source: str, confidence: float = 0.8) -> None:
    value = shorten(text)
    if len(value) < 4 or len(value) > 80:
        return
    if value in {"她", "我们", "她的", "我们的"}:
        return
    if "？" in value or "?" in value:
        return
    fact = Fact(
        text=value,
        category=category,
        source=source,
        timestamp=message.timestamp,
        confidence=confidence,
    )
    facts.append(fact)


LIKE = re.compile(r"我(?:很|超|最|比较|特别|挺|真的)?(?:喜欢|爱|偏爱)(.+)")
DISLIKE = re.compile(r"我(?:很|超|最|比较|特别|挺|真的)?(?:不喜欢|讨厌|受不了|嫌弃|反感)(.+)")
FEAR = re.compile(r"我(?:很|特别|有点|超)?(?:害怕|怕)(.+)")
HABIT = re.compile(r"我(?:习惯|每天|经常|总是|一般|通常|周末|从不|很少|每次)(.+)")
BIRTHDAY = re.compile(r"我(?:的)?生日(?:是|在)?(.+)")
SHARED = re.compile(r"我们(?:第一次|以前|曾经|一起|在|去|的)?(.+)")
WANT = re.compile(r"我(?:想|想要|计划|准备|打算)(.+)")
ALLERGY = re.compile(r"我对(.+?)过敏")
CANT_EAT = re.compile(r"我不能吃(.+)")
WORK = re.compile(r"我(?:在|是)(.{2,20}?)(?:工作|上班|读书|上学)")
THIRD_PERSON = re.compile(r"^她(?:很|超|最|比较|特别|挺)?(喜欢|讨厌|害怕|习惯|受不了|不爱|爱吃|爱喝)(.+)")


def extract_facts(messages: Sequence[Message], her_names: Sequence[str], source: str) -> list[Fact]:
    facts: list[Fact] = []
    for message in messages:
        if is_noise(message.sender, message.text):
            continue
        for sentence in split_sentences(message.text):
            if is_noise(message.sender, sentence):
                continue
            third = THIRD_PERSON.match(sentence)
            if third is not None:
                verb, rest = third.groups()
                category = "dislike" if verb in {"讨厌", "受不了", "不爱"} else "preference"
                add_fact(facts, f"她{verb}{rest}", category, message, source, 0.86)
                continue

            match = ALLERGY.search(sentence)
            if match is not None:
                add_fact(facts, f"她对{match.group(1)}过敏", "health", message, source, 0.9)
                continue
            match = CANT_EAT.search(sentence)
            if match is not None:
                add_fact(facts, f"她不能吃{match.group(1)}", "health", message, source, 0.86)
                continue
            match = BIRTHDAY.search(sentence)
            if match is not None:
                add_fact(facts, f"她的生日是{match.group(1)}", "date", message, source, 0.9)
                continue
            match = DISLIKE.search(sentence)
            if match is not None:
                add_fact(facts, f"她讨厌{match.group(1)}", "dislike", message, source, 0.86)
                continue
            match = FEAR.search(sentence)
            if match is not None:
                add_fact(facts, f"她害怕{match.group(1)}", "dislike", message, source, 0.84)
                continue
            match = LIKE.search(sentence)
            if match is not None:
                add_fact(facts, f"她喜欢{match.group(1)}", "preference", message, source, 0.86)
                continue
            match = HABIT.search(sentence)
            if match is not None:
                prefix = sentence[: sentence.find(match.group(1))].strip().replace("我", "她", 1)
                add_fact(facts, f"{prefix}{match.group(1)}", "habit", message, source, 0.82)
                continue
            match = WANT.search(sentence)
            if match is not None:
                add_fact(facts, f"她想{match.group(1)}", "goal", message, source, 0.72)
                continue
            match = WORK.search(sentence)
            if match is not None:
                add_fact(facts, f"她在{match.group(1)}工作", "life", message, source, 0.7)
                continue
            match = SHARED.search(sentence)
            if match is not None:
                add_fact(facts, f"我们{match.group(1)}", "shared", message, source, 0.76)
                continue

            # A plain self-description is lower confidence but still useful.
            if sentence.startswith("我") and 5 <= len(sentence) <= 40 and not sentence.startswith("我们"):
                add_fact(facts, sentence.replace("我", "她", 1), "life", message, source, 0.52)
    return dedupe(facts)


def dedupe(facts: Iterable[Fact]) -> list[Fact]:
    seen: dict[str, Fact] = {}
    for fact in facts:
        key = re.sub(r"[\s，,。.!！?？；;、~～]", "", fact.text)
        previous = seen.get(key)
        if previous is None or fact.confidence > previous.confidence:
            seen[key] = fact
    return sorted(seen.values(), key=lambda item: (-item.confidence, item.category, item.text))


def build_persona(messages: Sequence[Message], her_names: Sequence[str], facts: Sequence[Fact]) -> str:
    her_messages = [
        message for message in messages
        if not is_noise(message.sender, message.text)
        and (not her_names or any(name and name in message.sender for name in her_names))
    ]
    sample = her_messages or [message for message in messages if not is_noise(message.sender, message.text)]
    endings: Counter[str] = Counter()
    for message in sample:
        text = clean_text(message.text)
        for particle in FINAL_PARTICLES:
            if text.endswith(particle):
                endings[particle] += 1
                break
    reusable = Counter()
    for message in sample:
        text = clean_text(message.text)
        if 2 <= len(text) <= 12:
            reusable[text] += 1
    common = [text for text, count in reusable.most_common(8) if count >= 2]
    snippets = []
    for message in sorted(sample, key=lambda item: len(clean_text(item.text)), reverse=True):
        text = clean_text(message.text)
        if 6 <= len(text) <= 48 and text not in snippets:
            snippets.append(text)
        if len(snippets) >= 8:
            break

    lines = [
        "# 她的人设备忘（离线蒸馏）",
        "",
        "> 这是从聊天记录中统计出的表达习惯，只用于让角色说话更像她。它不是她本人，也不能替代现实中的她。",
        "",
        "## 语言习惯",
        "",
        f"- 样本消息数：{len(sample)}",
        f"- 常用句尾语气：{'、'.join(name for name, _ in endings.most_common(5)) or '样本不足'}",
        f"- 高频短句：{'、'.join(common) if common else '样本不足'}",
        "",
        "## 可参考的原话片段",
        "",
    ]
    if snippets:
        lines.extend(f"- “{snippet}”" for snippet in snippets)
    else:
        lines.append("- 样本不足")
    lines.extend(
        [
            "",
            "## 已提取的稳定事实",
            "",
        ]
    )
    if facts:
        for fact in facts[:40]:
            lines.append(f"- {fact.text}")
    else:
        lines.append("- 未提取到稳定事实")
    lines.extend(
        [
            "",
            "## 使用提醒",
            "",
            "- 只学句长、语气和关心方式，不要复制原话去伪造具体事件。",
            "- 记忆里没有的日期、礼物、承诺、争吵，不要编造。",
            "- 不把统计性模仿说成“她本人回来了”。",
            "",
        ]
    )
    return "\n".join(lines)


def write_markdown(path: Path, facts: Sequence[Fact], meta: dict) -> None:
    lines = [
        "# 记忆事实清单",
        "",
        f"- 来源：`{meta['source']}`",
        f"- 生成时间：{meta['generated_at']}",
        f"- 事实数：{len(facts)}",
        f"- 过滤后消息数：{meta['messages']}",
        "",
        "| # | 事实 | 类别 | 置信度 | 时间 |",
        "|---|---|---|---|---|",
    ]
    for index, fact in enumerate(facts, start=1):
        text = fact.text.replace("|", "\\|")
        lines.append(f"| {index} | {text} | {fact.category} | {fact.confidence:.2f} | {fact.timestamp or '-'} |")
    lines.extend(
        [
            "",
            "## 说明",
            "",
            "- 这些是统计性事实条目，不是对真人的还原。",
            "- 写入 Hindsight 前请确认聊天记录与声音的使用授权。",
            "- 写入使用稳定的 `document_id`，重复运行不会重复累积同一事实。",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def write_commands(path: Path, facts: Sequence[Fact]) -> None:
    lines = ["# 在 DSH 会话中逐条执行（前女友人设、记忆开启）", ""]
    lines.extend(f"/hindsight remember {fact.text}" for fact in facts)
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


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


def write_to_hindsight(
    facts: Sequence[Fact],
    endpoint: str,
    bank: str,
    api_key: str,
    batch_size: int,
    timeout: float,
) -> dict:
    base = endpoint.rstrip("/")
    url = f"{base}/v1/default/banks/{urllib.parse.quote(bank, safe='')}/memories"
    log: dict = {
        "endpoint": base,
        "bank": bank,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "batches": [],
        "stored": 0,
        "failed": 0,
    }
    for start in range(0, len(facts), batch_size):
        batch = facts[start:start + batch_size]
        items = []
        for fact in batch:
            digest = hashlib.sha256(fact.text.encode("utf-8")).hexdigest()
            items.append(
                {
                    "content": fact.text,
                    "document_id": f"distill:{digest}",
                    "context": "离线聊天记录蒸馏；用户已授权整理",
                    "tags": ["source:distill", "persona:ex", "kind:distilled"],
                    "metadata": {
                        "source": fact.source,
                        "category": fact.category,
                        "timestamp": fact.timestamp,
                    },
                }
            )
        try:
            result = request_json(url, {"items": items, "async": False}, api_key, timeout)
            stored = int(result.get("items_count") or len(items))
            log["stored"] += stored
            log["batches"].append({"from": start, "count": len(items), "ok": True, "items_count": stored})
            eprint(f"[distill] 写入 {start + len(items)}/{len(facts)} 条")
        except RuntimeError as error:
            log["failed"] += len(items)
            log["batches"].append({"from": start, "count": len(items), "ok": False, "error": str(error)})
            eprint(f"[distill] 批次 {start} 写入失败：{error}")
    log["finishedAt"] = datetime.now(timezone.utc).isoformat()
    return log


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="把聊天记录蒸馏为 Hindsight 事实条目")
    parser.add_argument("input", type=Path, help="聊天记录 txt/csv/json")
    parser.add_argument("--out", type=Path, default=Path("distill-output"), help="输出目录")
    parser.add_argument("--her-name", action="append", default=[], help="她的昵称，可重复")
    parser.add_argument("--endpoint", default=os.environ.get("HINDSIGHT_URL", "http://localhost:8888"))
    parser.add_argument("--bank", default=os.environ.get("HINDSIGHT_BANK", "xiaoyu"))
    parser.add_argument("--api-key", default=os.environ.get("HINDSIGHT_API_KEY", ""))
    parser.add_argument("--write", action="store_true", help="写入 Hindsight；默认只生成文件")
    parser.add_argument("--emit-commands", action="store_true", help="额外输出待执行的 /hindsight remember 命令")
    parser.add_argument("--min-facts", type=int, default=10, help="少于该数量时返回非零退出码")
    parser.add_argument("--max-facts", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--allow-few", action="store_true", help="允许少于 --min-facts 仍成功")
    args = parser.parse_args(argv)

    if not args.input.exists():
        eprint(f"输入文件不存在：{args.input}")
        return 2
    messages = read_messages(args.input)
    if not messages:
        eprint("没有读到消息。")
        return 2

    her_names = args.her_name or ["她", "前女友"]
    facts = extract_facts(messages, her_names, str(args.input))[: args.max_facts]
    args.out.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    meta = {
        "source": str(args.input),
        "generated_at": generated_at,
        "messages": len(messages),
        "facts": len(facts),
    }

    write_markdown(args.out / "memories.md", facts, meta)
    (args.out / "facts.jsonl").write_text(
        "\n".join(json.dumps(asdict(fact), ensure_ascii=False) for fact in facts) + ("\n" if facts else ""),
        encoding="utf-8",
    )
    (args.out / "persona.md").write_text(build_persona(messages, her_names, facts), encoding="utf-8")
    (args.out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.emit_commands:
        write_commands(args.out / "commands.txt", facts)

    eprint(f"[distill] {len(messages)} 条消息 -> {len(facts)} 条事实；输出 {args.out}")
    if len(facts) < args.min_facts and not args.allow_few:
        eprint(f"[distill] 事实数少于要求的 {args.min_facts} 条；用 --allow-few 可忽略。")
        return 3

    if args.write:
        log = write_to_hindsight(facts, args.endpoint, args.bank, args.api_key, max(1, args.batch_size), args.timeout)
        (args.out / "write-log.json").write_text(json.dumps(log, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if log["failed"] > 0:
            eprint(f"[distill] 有 {log['failed']} 条写入失败，详见 write-log.json")
            return 4
        eprint(f"[distill] 已写入 {log['stored']} 条到 {args.endpoint} / {args.bank}")
    else:
        eprint("[distill] 未写入 Hindsight（加 --write 执行写入）")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
