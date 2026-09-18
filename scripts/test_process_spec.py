"""Test the process-spec safety contract without spawning any process."""
from __future__ import annotations

import re
from dataclasses import dataclass

MAX_ARGUMENTS = 64
MAX_ARGUMENT_LENGTH = 4096
MAX_TOTAL_ARGUMENT_BYTES = 32 * 1024
MAX_TIMEOUT_SECONDS = 604_800
ALLOWED_EXECUTABLES = {
    "blender": "blender.exe",
    "ffmpeg": "ffmpeg.exe",
    "ffprobe": "ffprobe.exe",
    "node": "node.exe",
    "obs": "obs64.exe",
    "python": "python.exe",
}
SECRET_MARKERS = (
    "api_key=",
    "apikey=",
    "access_token=",
    "authorization=",
    "bearer ",
    "client_secret=",
    "password=",
    "secret=",
    "token=",
)


@dataclass(frozen=True)
class ProcessPlan:
    executable_id: str
    working_directory: str
    timeout_seconds: int
    process_started: bool
    side_effects_blocked: bool


def reject_secret_like(value: str) -> bool:
    lower = value.lower()
    return any(marker in lower for marker in SECRET_MARKERS) or lower.startswith(("sk-", "key_"))


def valid_relative_path(value: str) -> bool:
    normalized = value.strip().replace("\\", "/")
    if not normalized or normalized.startswith("/") or len(normalized) > 1024:
        return False
    if len(normalized) >= 2 and normalized[1] == ":":
        return False
    return ".." not in normalized.split("/") and "\x00" not in normalized


def validate_process_spec(spec: dict) -> ProcessPlan:
    executable_id = spec["executableId"]
    if executable_id not in ALLOWED_EXECUTABLES:
        raise ValueError("executable_not_allowlisted")
    args = spec.get("args", [])
    if len(args) > MAX_ARGUMENTS:
        raise ValueError("too_many_arguments")
    if sum(len(argument) for argument in args) > MAX_TOTAL_ARGUMENT_BYTES:
        raise ValueError("arguments_too_large")
    for argument in args:
        if len(argument) > MAX_ARGUMENT_LENGTH or "\x00" in argument or reject_secret_like(argument):
            raise ValueError("unsafe_argument")
    if not valid_relative_path(spec["workingDirectory"]):
        raise ValueError("unsafe_working_directory")
    for key, value in spec.get("environment", {}).items():
        if not re.fullmatch(r"AUTO3DVIDEO_[A-Z0-9_]{0,127}", key):
            raise ValueError("environment_key_not_allowlisted")
        if len(value) > 4096 or reject_secret_like(value):
            raise ValueError("unsafe_environment_value")
    timeout = spec["timeoutSeconds"]
    if not 1 <= timeout <= MAX_TIMEOUT_SECONDS:
        raise ValueError("timeout_out_of_range")
    for output in spec.get("expectedOutputs", []):
        if not valid_relative_path(output):
            raise ValueError("unsafe_expected_output")
    return ProcessPlan(
        executable_id=executable_id,
        working_directory=spec["workingDirectory"].strip(),
        timeout_seconds=timeout,
        process_started=False,
        side_effects_blocked=True,
    )


def valid_spec() -> dict:
    return {
        "schemaVersion": "1.0.0",
        "executableId": "ffmpeg",
        "args": ["-version"],
        "workingDirectory": "jobs/dry-run-preview",
        "environment": {},
        "timeoutSeconds": 60,
        "expectedOutputs": ["preview.mp4"],
    }


def expect_rejected(spec: dict, label: str) -> None:
    try:
        validate_process_spec(spec)
    except ValueError:
        return
    raise SystemExit(f"expected_rejection_missing={label}")


def main() -> int:
    plan = validate_process_spec(valid_spec())
    if plan.process_started or not plan.side_effects_blocked:
        raise SystemExit("dry_run_side_effect_boundary_failed")

    unknown = valid_spec()
    unknown["executableId"] = "powershell"
    expect_rejected(unknown, "unknown_executable")

    traversal = valid_spec()
    traversal["workingDirectory"] = "jobs/../outside"
    expect_rejected(traversal, "path_traversal")

    absolute = valid_spec()
    absolute["workingDirectory"] = r"C:\Windows"
    expect_rejected(absolute, "absolute_path")

    secret = valid_spec()
    secret["args"] = ["api_key=do-not-use"]
    expect_rejected(secret, "secret_argument")

    environment = valid_spec()
    environment["environment"] = {"PATH": "unsafe"}
    expect_rejected(environment, "unallowlisted_environment")

    timeout = valid_spec()
    timeout["timeoutSeconds"] = 0
    expect_rejected(timeout, "zero_timeout")

    output = valid_spec()
    output["expectedOutputs"] = ["../outside.mp4"]
    expect_rejected(output, "output_traversal")

    print("PROCESS_SPEC_TEST=PASS")
    print("allowlist=PASS")
    print("relative_paths=PASS")
    print("timeout_bounds=PASS")
    print("secret_boundary=PASS")
    print("dry_run_no_spawn=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
