"""Check that an Antigravity agent is operating in the correct repository root."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

REQUIRED_CONTEXT = (
    "AGENTS.md",
    "README.md",
    "MANIFEST.json",
    "plans/MASTER_IMPLEMENTATION_PLAN.md",
    "contracts/README.md",
    "workflows/example-local-free-pipeline.yaml",
    "docs/PROJECT_STATUS.md",
    ".env.example",
)
MANIFEST_KEYS = (
    "rootFiles",
    "entrypoints",
    "planningFiles",
    "architectureFiles",
    "decisionFiles",
    "policyFiles",
    "operationalDocs",
    "researchFiles",
    "contractFiles",
    "workflowExamples",
    "configurationFiles",
    "scripts",
    "examples",
    "desktopAppFiles",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.project.expanduser().resolve()
    if not root.is_dir():
        print(f"AGENT_WORKSPACE_INVALID: project directory not found: {root}")
        return 1

    missing = [relative for relative in REQUIRED_CONTEXT if not (root / relative).is_file()]
    if missing:
        print("AGENT_WORKSPACE_INVALID")
        print("missing_context=" + ",".join(missing))
        return 1

    try:
        manifest = json.loads((root / "MANIFEST.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"AGENT_WORKSPACE_INVALID: manifest unreadable or invalid: {error}")
        return 1
    invalid_keys = [key for key in MANIFEST_KEYS if not isinstance(manifest.get(key), list)]
    if invalid_keys:
        print("AGENT_WORKSPACE_INVALID")
        print("manifest_arrays_invalid=" + ",".join(invalid_keys))
        return 1

    # Do not open or print .env. Existence is intentionally not reported because
    # even a filename can reveal information in some managed environments.
    print("AGENT_WORKSPACE_VALID")
    print(f"project={root}")
    print("required_context=PASS")
    print("manifest_shape=PASS")
    print("secret_content=not_read")
    print("external_processes=not_started")
    print("network_calls=not_made")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
