"""Validate one supervised execution-attempt record without starting a worker."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path
from typing import Any

ALLOWED_STATES = {
    "pending",
    "running",
    "succeeded",
    "failed",
    "cancel_requested",
    "cancelled",
    "expired",
    "blocked",
    "reconciliation_required",
}
ALLOWED_EXECUTABLES = {"blender", "ffmpeg", "ffprobe", "node", "obs", "python", "mock"}
ALLOWED_EXECUTION_MODES = {"external_process", "in_process_mock"}
ALLOWED_TERMINATION = {"none", "cooperative", "tree_soft", "tree_force"}
ALLOWED_MEDIA_KINDS = {"video", "audio", "image", "subtitle", "thumbnail", "metadata", "image_sequence"}
ALLOWED_OUTPUT_STATES = {"pending", "valid", "invalid", "missing", "not_checked"}
REQUIRED_FIELDS = {
    "schemaVersion",
    "attemptId",
    "jobId",
    "attemptNumber",
    "state",
    "timeoutSeconds",
    "maxLogBytes",
    "processStarted",
    "externalSideEffectUnknown",
    "createdAt",
    "updatedAt",
}
TOP_LEVEL_FIELDS = {
    "schemaVersion",
    "attemptId",
    "jobId",
    "attemptNumber",
    "state",
    "workerId",
    "executionMode",
    "executableId",
    "leaseOwner",
    "leaseExpiresAt",
    "heartbeatAt",
    "startedAt",
    "finishedAt",
    "cancellationRequestedAt",
    "terminationMode",
    "timeoutSeconds",
    "maxLogBytes",
    "stdoutBytes",
    "stderrBytes",
    "processStarted",
    "externalSideEffectUnknown",
    "retryable",
    "errorCode",
    "redactedMessage",
    "outputs",
    "createdAt",
    "updatedAt",
}
OUTPUT_FIELDS = {
    "relativePath",
    "mediaKind",
    "contentHash",
    "sizeBytes",
    "validationState",
    "validationMessage",
}
IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
SHA256_RE = re.compile(r"^[a-fA-F0-9]{64}$")
SECRET_MARKERS = ("api_key=", "apikey=", "access_token=", "authorization:", "authorization=", "bearer ", "client_secret=", "password=", "secret=", "token=")


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("execution attempt root must be an object")
    return value


def is_datetime(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def safe_relative(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    normalized = value.strip().replace("\\", "/")
    if normalized.startswith("/") or (len(normalized) >= 2 and normalized[1] == ":"):
        return False
    return "\x00" not in normalized and ".." not in normalized.split("/")


def secret_like(value: str) -> bool:
    lower = value.lower()
    return any(marker in lower for marker in SECRET_MARKERS) or lower.startswith(("sk-", "key_"))


def validate_attempt(attempt: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    unknown = sorted(set(attempt) - TOP_LEVEL_FIELDS)
    if unknown:
        errors.append(f"unknown top-level fields: {', '.join(unknown)}")
    missing = sorted(REQUIRED_FIELDS - set(attempt))
    if missing:
        errors.append(f"missing required fields: {', '.join(missing)}")
    if attempt.get("schemaVersion") != "1.0.0":
        errors.append("schemaVersion must be 1.0.0")
    for field in ("attemptId", "jobId"):
        if not isinstance(attempt.get(field), str) or not IDENTIFIER_RE.fullmatch(attempt[field]):
            errors.append(f"{field} is invalid")
    number = attempt.get("attemptNumber")
    if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= 10:
        errors.append("attemptNumber must be an integer in 1..10")
    state = attempt.get("state")
    if state not in ALLOWED_STATES:
        errors.append("state is unsupported")
    execution_mode = attempt.get("executionMode", "external_process")
    if execution_mode not in ALLOWED_EXECUTION_MODES:
        errors.append("executionMode is unsupported")
    executable_id = attempt.get("executableId")
    if executable_id is not None and executable_id not in ALLOWED_EXECUTABLES:
        errors.append("executableId is unsupported")
    for field in ("workerId", "leaseOwner"):
        value = attempt.get(field)
        if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 128):
            errors.append(f"{field} is invalid")
    for field in ("leaseExpiresAt", "heartbeatAt", "startedAt", "finishedAt", "cancellationRequestedAt", "createdAt", "updatedAt"):
        if field in attempt and attempt[field] is not None and not is_datetime(attempt[field]):
            errors.append(f"{field} must be ISO-8601")
    termination = attempt.get("terminationMode", "none")
    if termination not in ALLOWED_TERMINATION:
        errors.append("terminationMode is unsupported")
    timeout = attempt.get("timeoutSeconds")
    if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 604800:
        errors.append("timeoutSeconds must be an integer in 1..604800")
    max_log = attempt.get("maxLogBytes")
    if isinstance(max_log, bool) or not isinstance(max_log, int) or not 1024 <= max_log <= 104857600:
        errors.append("maxLogBytes must be an integer in 1024..104857600")
    for field in ("stdoutBytes", "stderrBytes"):
        value = attempt.get(field, 0)
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 1073741824:
            errors.append(f"{field} is invalid")
    for field in ("processStarted", "externalSideEffectUnknown"):
        if not isinstance(attempt.get(field), bool):
            errors.append(f"{field} must be boolean")
    if "retryable" in attempt and not isinstance(attempt["retryable"], bool):
        errors.append("retryable must be boolean")
    redacted_message = attempt.get("redactedMessage")
    if redacted_message is not None and (not isinstance(redacted_message, str) or len(redacted_message) > 4096):
        errors.append("redactedMessage is invalid")
    if isinstance(redacted_message, str) and secret_like(redacted_message):
        errors.append("redactedMessage looks like it contains a secret")

    outputs = attempt.get("outputs", [])
    if not isinstance(outputs, list) or len(outputs) > 256:
        errors.append("outputs must be an array with at most 256 items")
        outputs = []
    for index, output in enumerate(outputs):
        prefix = f"outputs[{index}]"
        if not isinstance(output, dict):
            errors.append(f"{prefix} must be an object")
            continue
        unknown_output = sorted(set(output) - OUTPUT_FIELDS)
        if unknown_output:
            errors.append(f"{prefix} has unknown fields: {', '.join(unknown_output)}")
        if not safe_relative(output.get("relativePath")):
            errors.append(f"{prefix}.relativePath is unsafe")
        if output.get("mediaKind") not in ALLOWED_MEDIA_KINDS:
            errors.append(f"{prefix}.mediaKind is unsupported")
        content_hash = output.get("contentHash")
        if content_hash is not None and (not isinstance(content_hash, str) or not SHA256_RE.fullmatch(content_hash)):
            errors.append(f"{prefix}.contentHash is invalid")
        size = output.get("sizeBytes")
        if size is not None and (isinstance(size, bool) or not isinstance(size, int) or not 0 <= size <= 10737418240):
            errors.append(f"{prefix}.sizeBytes is invalid")
        if output.get("validationState") not in ALLOWED_OUTPUT_STATES:
            errors.append(f"{prefix}.validationState is unsupported")
        message = output.get("validationMessage")
        if message is not None and (not isinstance(message, str) or len(message) > 2048 or secret_like(message)):
            errors.append(f"{prefix}.validationMessage is invalid or secret-like")

    process_started = attempt.get("processStarted") is True
    side_effect_unknown = attempt.get("externalSideEffectUnknown") is True
    if state == "pending" and process_started:
        errors.append("pending attempt cannot have processStarted")
    if side_effect_unknown and state != "reconciliation_required":
        errors.append("unknown external side effect requires reconciliation_required")
    if state == "running":
        if execution_mode == "external_process" and not process_started:
            errors.append("external_process running requires processStarted")
        if execution_mode == "in_process_mock" and process_started:
            errors.append("in_process_mock running must keep processStarted=false")
        if attempt.get("startedAt") is None:
            errors.append("running requires startedAt")
        if attempt.get("finishedAt") is not None:
            errors.append("running cannot have finishedAt")
        if attempt.get("leaseExpiresAt") is None or attempt.get("heartbeatAt") is None:
            errors.append("running requires leaseExpiresAt and heartbeatAt")
    if state == "cancel_requested":
        if execution_mode == "external_process" and not process_started:
            errors.append("external_process cancel_requested requires processStarted")
        if execution_mode == "in_process_mock" and process_started:
            errors.append("in_process_mock cancel_requested must keep processStarted=false")
        if attempt.get("cancellationRequestedAt") is None:
            errors.append("cancel_requested requires cancellationRequestedAt")
        if attempt.get("finishedAt") is not None:
            errors.append("cancel_requested cannot have finishedAt")
    if state in {"succeeded", "failed", "cancelled", "expired", "blocked", "reconciliation_required"} and attempt.get("finishedAt") is None:
        errors.append(f"{state} requires finishedAt")
    if state == "succeeded":
        if side_effect_unknown:
            errors.append("succeeded cannot have unknown external side effect")
        if attempt.get("errorCode") is not None:
            errors.append("succeeded cannot have errorCode")
        if any(output.get("validationState") in {"invalid", "missing"} for output in outputs if isinstance(output, dict)):
            errors.append("succeeded cannot contain invalid or missing outputs")
    if state == "reconciliation_required" and not side_effect_unknown:
        errors.append("reconciliation_required requires externalSideEffectUnknown")
    if state == "blocked" and process_started:
        errors.append("blocked attempt cannot have processStarted")
    if state in {"failed", "expired", "blocked"} and not attempt.get("errorCode") and not redacted_message:
        errors.append(f"{state} requires errorCode or redactedMessage")
    if state == "cancelled" and process_started and termination == "none":
        errors.append("cancelled process attempt requires termination evidence")
    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attempt", required=True, help="Path to an execution-attempt JSON file")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        attempt = read_json(Path(args.attempt))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"EXECUTION_ATTEMPT_INVALID: {error}")
        return 1
    errors = validate_attempt(attempt)
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 1
    print("EXECUTION_ATTEMPT_VALID")
    print(f"attempt={Path(args.attempt).expanduser().resolve()}")
    print("process_spawned=false")
    print("logs_redacted=true")
    print("reconciliation_required=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
