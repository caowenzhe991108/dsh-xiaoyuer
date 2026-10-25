#!/usr/bin/env python3
"""Check relative Markdown links in the repository."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
missing: list[tuple[str, str]] = []

for path in ROOT.rglob("*.md"):
    if ".venv" in path.parts:
        continue
    for target in LINK.findall(path.read_text(encoding="utf-8")):
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        relative = target.split("#", 1)[0]
        if relative and not (path.parent / relative).resolve().exists():
            missing.append((str(path.relative_to(ROOT)), target))

if missing:
    for source, target in missing:
        print(f"missing: {source} -> {target}")
    sys.exit(1)
print("all relative Markdown links exist")
