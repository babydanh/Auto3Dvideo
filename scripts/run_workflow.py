"""Planning-stage dry-run runner for Auto3Dvideo.

This prototype intentionally performs no external process execution. The production
runner will be implemented in Rust/Tokio after the contracts and safety tests pass.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect an Auto3Dvideo workflow safely")
    parser.add_argument("--workflow", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    workflow = args.workflow.resolve()
    if not workflow.is_file():
        print(f"ERROR: workflow not found: {workflow}", file=sys.stderr)
        return 2
    if not args.dry_run:
        print("BLOCKED: planning prototype only supports --dry-run; no jobs were started.", file=sys.stderr)
        return 3

    text = workflow.read_text(encoding="utf-8")
    stage_count = sum(1 for line in text.splitlines() if line.startswith("  - id:"))
    print("AUTO3DVIDEO_DRY_RUN")
    print(f"workflow={workflow}")
    print(f"stages_detected={stage_count}")
    print("paid_generation=blocked")
    print("external_publish=blocked")
    print("external_processes=not_started")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
