"""Validate a compiled worker plan without spawning processes or contacting providers."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ALLOWED_EXECUTORS = {"mock", "comfyui", "blender", "ffmpeg", "provider_adapter", "interactive"}
ALLOWED_RESOURCES = {"cpu", "cpu_heavy", "gpu", "io_heavy", "network", "paid_api", "interactive"}
TOP_LEVEL_FIELDS = {"schemaVersion", "planId", "workflowId", "profile", "dryRun", "processesStarted", "networkCallsMade", "externalPublish", "paidGeneration", "maxAttemptsPerStage", "stages"}
STAGE_FIELDS = {"stageId", "stageType", "dependsOn", "executor", "executableId", "operation", "resourceClass", "approvalRequired", "outputs", "attempt"}
ATTEMPT_FIELDS = {"attemptId", "attemptNumber", "state", "timeoutSeconds", "processStarted", "externalSideEffectUnknown"}
IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
STAGE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("worker plan root must be an object")
    return value


def safe_relative(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    normalized = value.strip().replace("\\", "/")
    return not (
        normalized.startswith("/")
        or (len(normalized) >= 2 and normalized[1] == ":")
        or "\x00" in normalized
        or ".." in normalized.split("/")
    )


def validate_worker_plan(plan: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    unknown = sorted(set(plan) - TOP_LEVEL_FIELDS)
    if unknown:
        errors.append(f"unknown top-level fields: {', '.join(unknown)}")
    if plan.get("schemaVersion") != "1.0.0":
        errors.append("schemaVersion must be 1.0.0")
    for field in ("planId", "workflowId"):
        if not isinstance(plan.get(field), str) or not IDENTIFIER_RE.fullmatch(plan[field]):
            errors.append(f"{field} is invalid")
    if plan.get("profile") not in {"mock", "local", "hybrid", "cloud"}:
        errors.append("profile is unsupported")
    for field in ("dryRun", "processesStarted", "networkCallsMade", "externalPublish", "paidGeneration"):
        expected = field == "dryRun"
        if plan.get(field) is not expected:
            errors.append(f"{field} must be {str(expected).lower()}")
    max_attempts = plan.get("maxAttemptsPerStage")
    if isinstance(max_attempts, bool) or not isinstance(max_attempts, int) or not 1 <= max_attempts <= 10:
        errors.append("maxAttemptsPerStage must be an integer in 1..10")

    stages = plan.get("stages")
    if not isinstance(stages, list) or not stages:
        errors.append("stages must be a non-empty array")
        stages = []
    stage_ids: set[str] = set()
    declared_stage_ids = {
        stage.get("stageId")
        for stage in stages
        if isinstance(stage, dict) and isinstance(stage.get("stageId"), str) and STAGE_ID_RE.fullmatch(stage["stageId"])
    }
    dependency_map: dict[str, list[str]] = {}
    attempt_ids: set[str] = set()
    for index, stage in enumerate(stages):
        prefix = f"stages[{index}]"
        if not isinstance(stage, dict):
            errors.append(f"{prefix} must be an object")
            continue
        unknown_stage = sorted(set(stage) - STAGE_FIELDS)
        if unknown_stage:
            errors.append(f"{prefix} has unknown fields: {', '.join(unknown_stage)}")
        stage_id = stage.get("stageId")
        if not isinstance(stage_id, str) or not STAGE_ID_RE.fullmatch(stage_id):
            errors.append(f"{prefix}.stageId is invalid")
        elif stage_id in stage_ids:
            errors.append(f"duplicate stageId: {stage_id}")
        else:
            stage_ids.add(stage_id)
        if not isinstance(stage.get("stageType"), str) or not stage["stageType"].strip():
            errors.append(f"{prefix}.stageType is invalid")
        executor = stage.get("executor")
        if executor not in ALLOWED_EXECUTORS:
            errors.append(f"{prefix}.executor is unsupported")
        resource = stage.get("resourceClass")
        if resource not in ALLOWED_RESOURCES:
            errors.append(f"{prefix}.resourceClass is unsupported")
        if not isinstance(stage.get("approvalRequired"), bool):
            errors.append(f"{prefix}.approvalRequired must be boolean")
        dependencies = stage.get("dependsOn")
        if not isinstance(dependencies, list) or any(not isinstance(item, str) for item in dependencies):
            errors.append(f"{prefix}.dependsOn must be a string array")
        else:
            if isinstance(stage_id, str) and STAGE_ID_RE.fullmatch(stage_id):
                dependency_map[stage_id] = dependencies
            for dependency in dependencies:
                if dependency not in declared_stage_ids:
                    errors.append(f"{prefix}.dependsOn contains unknown stage: {dependency}")
        outputs = stage.get("outputs")
        if not isinstance(outputs, list) or not outputs:
            errors.append(f"{prefix}.outputs must be a non-empty array")
        elif any(not safe_relative(item) for item in outputs):
            errors.append(f"{prefix}.outputs contains an unsafe path")
        attempt = stage.get("attempt")
        if not isinstance(attempt, dict):
            errors.append(f"{prefix}.attempt must be an object")
            continue
        unknown_attempt = sorted(set(attempt) - ATTEMPT_FIELDS)
        if unknown_attempt:
            errors.append(f"{prefix}.attempt has unknown fields: {', '.join(unknown_attempt)}")
        attempt_id = attempt.get("attemptId")
        if not isinstance(attempt_id, str) or not IDENTIFIER_RE.fullmatch(attempt_id):
            errors.append(f"{prefix}.attempt.attemptId is invalid")
        elif attempt_id in attempt_ids:
            errors.append(f"duplicate attemptId: {attempt_id}")
        else:
            attempt_ids.add(attempt_id)
        if attempt.get("attemptNumber") != 1:
            errors.append(f"{prefix}.attempt.attemptNumber must be 1")
        if attempt.get("state") != "pending":
            errors.append(f"{prefix}.attempt.state must be pending")
        timeout = attempt.get("timeoutSeconds")
        if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 604800:
            errors.append(f"{prefix}.attempt.timeoutSeconds is invalid")
        if attempt.get("processStarted") is not False:
            errors.append(f"{prefix}.attempt.processStarted must be false")
        if attempt.get("externalSideEffectUnknown") is not False:
            errors.append(f"{prefix}.attempt.externalSideEffectUnknown must be false")
        expected_executable = {"blender": "blender", "ffmpeg": "ffmpeg"}.get(executor)
        if stage.get("executableId") != expected_executable:
            errors.append(f"{prefix}.executableId does not match executor")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(stage_id: str) -> None:
        if stage_id in visiting:
            errors.append(f"dependency cycle detected at {stage_id}")
            return
        if stage_id in visited:
            return
        visiting.add(stage_id)
        for dependency in dependency_map.get(stage_id, []):
            if dependency in declared_stage_ids:
                visit(dependency)
        visiting.remove(stage_id)
        visited.add(stage_id)

    for stage_id in declared_stage_ids:
        visit(stage_id)
    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, help="Path to a worker-plan JSON file")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        plan = read_json(Path(args.plan))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"WORKER_PLAN_INVALID: {error}")
        return 1
    errors = validate_worker_plan(plan)
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 1
    print("WORKER_PLAN_VALID")
    print(f"plan={Path(args.plan).expanduser().resolve()}")
    print("processes_started=false")
    print("network_calls_made=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
