"""Planning-stage validator for sanitized Auto3Dvideo project artifacts."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
import sys


REQUIRED_FILES = (
    "README.md",
    "AGENTS.md",
    "MANIFEST.json",
    "contracts/project.schema.json",
    "contracts/job.schema.json",
    "contracts/provider-profile.schema.json",
    "contracts/provider-request.schema.json",
    "contracts/provider-result.schema.json",
    ".env.example",
    "configs/provider-profiles.example.yaml",
    "workflows/example-local-free-pipeline.yaml",
)
INVENTORY_KEYS = (
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
IGNORED_DIRS = {".git", "__pycache__", ".pytest_cache", "node_modules", "target", ".cargo-target-audit", "dist", "outputs", ".auto3dvideo"}


def is_local_secret_file(path: Path) -> bool:
    return path.name == ".env" or (path.name.startswith(".env.") and path.name != ".env.example")


def relative_files(root: Path) -> set[str]:
    files: set[str] = set()
    for path in root.rglob("*"):
        if not path.is_file() or is_local_secret_file(path) or any(part in IGNORED_DIRS for part in path.parts):
            continue
        files.add(path.relative_to(root).as_posix())
    return files


def parse_json_document(path: Path):
    text = path.read_text(encoding="utf-8")
    if path.name.startswith("tsconfig"):
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
        text = re.sub(r"(^|\s)//.*?$", r"\1", text, flags=re.MULTILINE)
        text = re.sub(r",\s*([}\]])", r"\1", text)
    return json.loads(text)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an Auto3Dvideo planning project")
    parser.add_argument("--project", required=True, type=Path)
    args = parser.parse_args()
    root = args.project.resolve()
    if not root.is_dir():
        print(f"ERROR: project directory not found: {root}", file=sys.stderr)
        return 2

    missing = [name for name in REQUIRED_FILES if not (root / name).is_file()]
    if missing:
        print("MISSING_FILES")
        print("\n".join(missing))
        return 1

    try:
        manifest = json.loads((root / "MANIFEST.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"INVALID_MANIFEST: {exc}")
        return 1

    inventory: list[str] = []
    duplicate_entries: list[str] = []
    for key in INVENTORY_KEYS:
        values = manifest.get(key, [])
        if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
            print(f"INVALID_MANIFEST_INVENTORY: {key} must be a string array")
            return 1
        inventory.extend(values)
        for name in sorted(set(values)):
            if values.count(name) > 1:
                duplicate_entries.append(f"{key}:{name}")
    inventory_set = set(inventory)
    missing_manifest_paths = sorted(name for name in inventory_set if not (root / name).is_file())
    unregistered_files = sorted(relative_files(root) - inventory_set)
    if duplicate_entries or missing_manifest_paths or unregistered_files:
        print("MANIFEST_INVENTORY_INVALID")
        if duplicate_entries:
            print("duplicate_entries=" + ",".join(duplicate_entries))
        if missing_manifest_paths:
            print("missing_manifest_paths=" + ",".join(missing_manifest_paths))
        if unregistered_files:
            print("unregistered_files=" + ",".join(unregistered_files))
        return 1

    json_errors: list[str] = []
    json_files = [
        path for path in sorted(root.rglob("*.json"))
        if not any(part in IGNORED_DIRS for part in path.parts)
    ]
    for path in json_files:
        try:
            parse_json_document(path)
        except (OSError, json.JSONDecodeError) as exc:
            json_errors.append(f"{path.relative_to(root)}: {exc}")
    if json_errors:
        print("INVALID_JSON")
        print("\n".join(json_errors))
        return 1

    yaml_files = sorted(root.rglob("*.yaml")) + sorted(root.rglob("*.yml"))
    yaml_files = [path for path in yaml_files if not any(part in IGNORED_DIRS for part in path.parts)]
    yaml_errors: list[str] = []
    yaml_mode = "not_available"
    try:
        import yaml  # type: ignore
    except ImportError:
        pass
    else:
        yaml_mode = "parsed_with_pyyaml"
        for path in yaml_files:
            try:
                yaml.safe_load(path.read_text(encoding="utf-8"))
            except (OSError, yaml.YAMLError) as exc:
                yaml_errors.append(f"{path.relative_to(root)}: {exc}")
    if yaml_errors:
        print("INVALID_YAML")
        print("\n".join(yaml_errors))
        return 1

    env_errors: list[str] = []
    env_path = root / ".env.example"
    for line_number, line in enumerate(env_path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        if key.endswith("_API_KEY") and value.strip():
            env_errors.append(f".env.example:{line_number}: API key placeholder must be empty")
    if env_errors:
        print("ENV_TEMPLATE_INVALID")
        print("\n".join(env_errors))
        return 1

    print("AUTO3DVIDEO_PROJECT_VALID")
    print(f"project={root}")
    print(f"manifest_inventory_files={len(inventory_set)}")
    print(f"physical_files_checked={len(relative_files(root))}")
    print(f"json_files_checked={len(json_files)}")
    print(f"yaml_files_checked={len(yaml_files)}")
    print(f"semantic_yaml_validation={yaml_mode}")
    print("env_template_validation=passed")
    print("external_tools=not_executed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
