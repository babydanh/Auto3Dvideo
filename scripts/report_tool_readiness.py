"""Report configured local-tool readiness without executing any tool."""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

ALLOWED_TOOLS = {"blender", "ffmpeg", "ffprobe", "python", "kdenlive", "davinci_resolve"}


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError as error:
        raise ValueError("PyYAML is required for tool-path config validation") from error
    with path.open("r", encoding="utf-8") as handle:
        value = yaml.safe_load(handle)
    if not isinstance(value, dict):
        raise ValueError("tool config root must be an object")
    return value


def path_available(raw_executable: Any) -> bool:
    if not isinstance(raw_executable, str) or not raw_executable.strip():
        return False
    candidate = Path(raw_executable.strip()).expanduser()
    if candidate.is_absolute():
        return candidate.is_file()
    return shutil.which(raw_executable.strip()) is not None


def build_readiness_report(config_path: Path) -> tuple[dict[str, Any], list[str]]:
    config_file = config_path.expanduser().resolve(strict=True)
    config = load_yaml(config_file)
    errors: list[str] = []
    tools = config.get("tools", {})
    if not isinstance(tools, dict):
        raise ValueError("tools must be an object")

    tool_reports: list[dict[str, Any]] = []
    required_missing: list[str] = []
    for tool_id, tool_config in sorted(tools.items()):
        if tool_id not in ALLOWED_TOOLS:
            errors.append(f"tool is not allowlisted: {tool_id}")
            continue
        if not isinstance(tool_config, dict):
            errors.append(f"tool config must be an object: {tool_id}")
            continue
        required = tool_config.get("required", False)
        if not isinstance(required, bool):
            errors.append(f"required must be boolean: {tool_id}")
            required = False
        executable = tool_config.get("executable")
        available = path_available(executable)
        status = "ready" if available else ("missing_required" if required else "optional_missing")
        if required and not available:
            required_missing.append(tool_id)
        tool_reports.append(
            {
                "toolId": tool_id,
                "required": required,
                "configured": isinstance(executable, str) and bool(executable.strip()),
                "available": available,
                "status": status,
            }
        )

    policy = config.get("policy", {})
    if not isinstance(policy, dict):
        errors.append("policy must be an object")
        policy = {}
    if policy.get("allow_shell_wrapper", False) is not False:
        errors.append("allow_shell_wrapper must remain false")
    if policy.get("reject_paths_outside_project", True) is not True:
        errors.append("reject_paths_outside_project must remain true")

    comfyui = config.get("comfyui", {})
    comfyui_configured = isinstance(comfyui, dict) and isinstance(comfyui.get("endpoint"), str) and bool(comfyui["endpoint"].strip())
    report = {
        "schemaVersion": "1.0.0",
        "configFileName": config_file.name,
        "tools": tool_reports,
        "requiredMissing": required_missing,
        "comfyui": {
            "configured": comfyui_configured,
            "networkChecked": False,
            "status": "not_checked",
        },
        "policy": {
            "allowShellWrapper": False,
            "rejectPathsOutsideProject": True,
            "externalProcessesStarted": False,
            "networkProbePerformed": False,
        },
        "status": "blocked" if errors or required_missing else "ready",
    }
    return report, errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/tool-paths.example.yaml")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        report, errors = build_readiness_report(Path(args.config))
    except (OSError, ValueError) as error:
        print(f"TOOL_READINESS_FAILED: {error}")
        return 1
    if errors:
        report["errors"] = errors
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] == "ready":
        print("TOOL_READINESS=READY")
        return 0
    print("TOOL_READINESS=BLOCKED")
    print("No tool was executed; install/configure required tools before live worker execution.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
