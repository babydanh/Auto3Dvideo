"""Test tool-readiness reporting without executing binaries or probing endpoints."""
from __future__ import annotations

import tempfile
from pathlib import Path

from report_tool_readiness import build_readiness_report


def write_config(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="auto3dvideo-readiness-") as directory:
        root = Path(directory)
        blocked_config = root / "blocked.yaml"
        write_config(
            blocked_config,
            """schema_version: '1.0.0'
tools:
  ffmpeg:
    executable: 'C:/missing/ffmpeg.exe'
    required: true
  python:
    executable: 'python.exe'
    required: false
comfyui:
  endpoint: 'http://127.0.0.1:8188'
policy:
  allow_shell_wrapper: false
  reject_paths_outside_project: true
""",
        )
        report, errors = build_readiness_report(blocked_config)
        if errors or report["status"] != "blocked":
            raise SystemExit(f"blocked_tool_report_mismatch={errors}/{report['status']}")
        if report["requiredMissing"] != ["ffmpeg"]:
            raise SystemExit(f"required_missing_mismatch={report['requiredMissing']}")
        if report["policy"]["externalProcessesStarted"] or report["policy"]["networkProbePerformed"]:
            raise SystemExit("readiness_report_performed_side_effect")

        unsafe_config = root / "unsafe.yaml"
        write_config(
            unsafe_config,
            """tools:
  unknown_tool:
    executable: 'unknown.exe'
policy:
  allow_shell_wrapper: true
  reject_paths_outside_project: false
""",
        )
        unsafe_report, unsafe_errors = build_readiness_report(unsafe_config)
        if unsafe_report["status"] != "blocked" or len(unsafe_errors) != 3:
            raise SystemExit(f"unsafe_policy_not_blocked={unsafe_errors}")

    print("TOOL_READINESS_TEST=PASS")
    print("required_tool_detection=PASS")
    print("no_process_spawn=PASS")
    print("no_network_probe=PASS")
    print("policy_guard=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
