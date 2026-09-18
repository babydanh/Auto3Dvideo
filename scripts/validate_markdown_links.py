"""Validate relative Markdown links in the planning pack."""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys
from urllib.parse import urlparse

LINK_RE = re.compile(r"!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+['\"][^)]*['\"])?\)")
IGNORED_DIRS = {".git", "__pycache__", ".pytest_cache", "node_modules", "target"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate relative Markdown links")
    parser.add_argument("--project", required=True, type=Path)
    root = parser.parse_args().project.resolve()
    errors: list[str] = []
    links_checked = 0

    for source in sorted(root.rglob("*.md")):
        if any(part in IGNORED_DIRS for part in source.parts):
            continue
        text = source.read_text(encoding="utf-8")
        for raw_target in LINK_RE.findall(text):
            target = raw_target.strip().strip("<>")
            parsed = urlparse(target)
            if parsed.scheme or target.startswith("#"):
                continue
            links_checked += 1
            target_path = target.split("#", 1)[0]
            if not target_path:
                continue
            candidate = (source.parent / target_path).resolve()
            try:
                candidate.relative_to(root)
            except ValueError:
                errors.append(f"{source.relative_to(root)}: link escapes project: {target}")
                continue
            if not candidate.is_file():
                errors.append(f"{source.relative_to(root)}: missing target: {target}")

    if errors:
        print("MARKDOWN_LINKS_INVALID")
        print("\n".join(errors))
        return 1
    print("MARKDOWN_LINKS_VALID")
    print(f"links_checked={links_checked}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
