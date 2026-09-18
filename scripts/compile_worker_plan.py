"""Compile a workflow fixture into a safe, pending-only worker plan."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

ALLOWED_EXECUTORS = {"mock", "comfyui", "blender", "ffmpeg", "provider_adapter", "interactive"}
ALLOWED_RESOURCES = {"cpu", "cpu_heavy", "gpu", "io_heavy", "network", "paid_api", "interactive"}
ALLOWED_APPROVALS = {"none", "required"}
EXECUTABLE_BY_EXECUTOR = {"blender": "blender", "ffmpeg": "ffmpeg"}
ALLOWED_MEDIA_OPERATIONS = {"probe", "normalize", "concat", "mux", "subtitle", "thumbnail", "variant", "image_sequence", "audio_normalize", "caption_generate"}
FFMPEG_OPERATION_BY_TYPE = {
    "media.compose": "concat",
    "render.preview": "variant",
    "render.final": "variant",
    "caption.generate": "caption_generate",
}
STAGE_FIELDS = {
    "id",
    "stage_id",
    "type",
    "dependsOn",
    "depends_on",
    "resource",
    "executor",
    "operation",
    "provider",
    "modelProfile",
    "model_profile",
    "model",
    "endpointProfile",
    "endpoint_profile",
    "credentialRef",
    "credential_ref",
    "fallbackProfiles",
    "fallback_profiles",
    "approval",
    "outputs",
}
IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
STAGE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError as error:
        raise ValueError("PyYAML is required to compile workflow fixtures") from error
    with path.open("r", encoding="utf-8") as handle:
        value = yaml.safe_load(handle)
    if not isinstance(value, dict):
        raise ValueError("workflow root must be an object")
    return value


def get_value(data: dict[str, Any], camel: str, snake: str, default: Any = None) -> Any:
    return data[camel] if camel in data else data.get(snake, default)


def safe_relative(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    normalized = value.strip().replace("\\", "/")
    if normalized.startswith("/") or (len(normalized) >= 2 and normalized[1] == ":"):
        return False
    return "\x00" not in normalized and ".." not in normalized.split("/")


def bounded_identifier(prefix: str, suffix: str) -> str:
    raw = f"{prefix}-{suffix}"
    if len(raw) <= 63 and IDENTIFIER_RE.fullmatch(raw):
        return raw
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]
    safe_prefix = re.sub(r"[^a-z0-9-]", "-", prefix.lower()).strip("-") or "plan"
    safe_suffix = re.sub(r"[^a-z0-9-]", "-", suffix.lower()).strip("-") or "stage"
    raw = f"{safe_prefix[:24]}-{safe_suffix[:24]}-{digest}"
    return raw[:63].rstrip("-")


def policy_is_blocked(value: Any) -> bool:
    return value is False or value is None or (isinstance(value, str) and value in {"blocked", "disabled", "false"})


def validate_dependency_graph(stages: list[dict[str, Any]], stage_ids: set[str]) -> list[str]:
    errors: list[str] = []
    dependencies: dict[str, list[str]] = {}
    for stage in stages:
        stage_id = get_value(stage, "id", "stage_id")
        if not isinstance(stage_id, str):
            continue
        depends = get_value(stage, "dependsOn", "depends_on", [])
        if not isinstance(depends, list) or any(not isinstance(item, str) for item in depends):
            errors.append(f"stage {stage_id} dependsOn must be a string array")
            dependencies[stage_id] = []
            continue
        dependencies[stage_id] = depends
        for dependency in depends:
            if dependency not in stage_ids:
                errors.append(f"stage {stage_id} depends on unknown stage {dependency}")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(stage_id: str) -> None:
        if stage_id in visiting:
            errors.append(f"dependency cycle detected at {stage_id}")
            return
        if stage_id in visited:
            return
        visiting.add(stage_id)
        for dependency in dependencies.get(stage_id, []):
            if dependency in stage_ids:
                visit(dependency)
        visiting.remove(stage_id)
        visited.add(stage_id)

    for stage_id in stage_ids:
        visit(stage_id)
    return errors


def compile_worker_plan(workflow: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if workflow.get("schema_version", workflow.get("schemaVersion")) != "1.0.0":
        errors.append("schemaVersion must be 1.0.0")
    workflow_id = get_value(workflow, "workflowId", "workflow_id")
    if not isinstance(workflow_id, str) or not IDENTIFIER_RE.fullmatch(workflow_id):
        errors.append("workflowId is invalid")
    profile = workflow.get("profile")
    if not isinstance(profile, str) or profile not in {"mock", "local", "hybrid", "cloud"}:
        errors.append("profile is unsupported")
    policy = workflow.get("policy", {})
    if not isinstance(policy, dict):
        errors.append("policy must be an object")
        policy = {}
    external_publish = get_value(policy, "externalPublish", "external_publish", "blocked")
    paid_generation = get_value(policy, "paidGeneration", "paid_generation", "blocked")
    if not policy_is_blocked(external_publish):
        errors.append("externalPublish must be blocked/false in the pending-only compiler")
    if not policy_is_blocked(paid_generation):
        errors.append("paidGeneration must be blocked/false in the pending-only compiler")
    retry_value = get_value(policy, "maxRetriesPerShot", "max_retries_per_job", 0)
    if isinstance(retry_value, bool) or not isinstance(retry_value, int) or not 0 <= retry_value <= 9:
        errors.append("max retries must be an integer in 0..9")
        retry_value = 0
    max_attempts = retry_value + 1

    stages = workflow.get("stages")
    if not isinstance(stages, list) or not stages:
        errors.append("stages must be a non-empty array")
        stages = []
    stage_ids: set[str] = set()
    for index, stage in enumerate(stages):
        prefix = f"stages[{index}]"
        if not isinstance(stage, dict):
            errors.append(f"{prefix} must be an object")
            continue
        unknown = sorted(set(stage) - STAGE_FIELDS)
        if unknown:
            errors.append(f"{prefix} has unknown fields: {', '.join(unknown)}")
        stage_id = get_value(stage, "id", "stage_id")
        if not isinstance(stage_id, str) or not STAGE_ID_RE.fullmatch(stage_id):
            errors.append(f"{prefix}.id is invalid")
        elif stage_id in stage_ids:
            errors.append(f"duplicate stage id: {stage_id}")
        else:
            stage_ids.add(stage_id)
        stage_type = stage.get("type")
        if not isinstance(stage_type, str) or not stage_type.strip():
            errors.append(f"{prefix}.type is invalid")
    errors.extend(validate_dependency_graph(stages, stage_ids))

    compiled_stages: list[dict[str, Any]] = []
    for stage in stages:
        if not isinstance(stage, dict):
            continue
        stage_id = get_value(stage, "id", "stage_id")
        stage_type = stage.get("type")
        if not isinstance(stage_id, str) or not STAGE_ID_RE.fullmatch(stage_id) or not isinstance(stage_type, str) or not stage_type.strip():
            continue
        executor = stage.get("executor", "mock")
        if not isinstance(executor, str) or executor not in ALLOWED_EXECUTORS:
            errors.append(f"stage {stage_id} executor is unsupported")
            executor = "mock"
        resource = stage.get("resource", "cpu" if executor == "mock" else "io_heavy")
        if not isinstance(resource, str) or resource not in ALLOWED_RESOURCES:
            errors.append(f"stage {stage_id} resource is unsupported")
            resource = "cpu"
        approval = stage.get("approval", "none")
        if not isinstance(approval, str) or approval not in ALLOWED_APPROVALS:
            errors.append(f"stage {stage_id} approval is unsupported")
            approval = "none"
        outputs = stage.get("outputs", [])
        if not isinstance(outputs, list) or not outputs:
            errors.append(f"stage {stage_id} outputs must be a non-empty array")
            outputs = []
        safe_outputs: list[str] = []
        for output in outputs:
            if not safe_relative(output):
                errors.append(f"stage {stage_id} contains an unsafe output path")
            elif output not in safe_outputs:
                safe_outputs.append(output)
            else:
                errors.append(f"stage {stage_id} has duplicate output path: {output}")
        dependencies = get_value(stage, "dependsOn", "depends_on", [])
        if not isinstance(dependencies, list):
            dependencies = []
        executable_id = EXECUTABLE_BY_EXECUTOR.get(executor)
        operation = stage.get("operation")
        if executor == "ffmpeg" and operation is None:
            operation = FFMPEG_OPERATION_BY_TYPE.get(stage_type)
        if executor == "ffmpeg" and (not isinstance(operation, str) or operation not in ALLOWED_MEDIA_OPERATIONS):
            errors.append(f"stage {stage_id} needs an allowlisted typed FFmpeg operation")
        if executor == "comfyui" or executor == "provider_adapter":
            warnings.append(f"stage {stage_id} remains pending; network/provider call is not started")
        if executor == "interactive":
            warnings.append(f"stage {stage_id} remains pending; interactive approval is required")
        if stage_type == "publish" or stage_type.startswith("publish."):
            errors.append(f"stage {stage_id} publish stage is disabled")
        attempt_id = bounded_identifier(workflow_id, f"{stage_id}-attempt-1")
        compiled_stages.append(
            {
                "stageId": stage_id,
                "stageType": stage_type,
                "dependsOn": dependencies,
                "executor": executor,
                "executableId": executable_id,
                "operation": operation,
                "resourceClass": resource,
                "approvalRequired": approval == "required",
                "outputs": safe_outputs,
                "attempt": {
                    "attemptId": attempt_id,
                    "attemptNumber": 1,
                    "state": "pending",
                    "timeoutSeconds": 1800,
                    "processStarted": False,
                    "externalSideEffectUnknown": False,
                },
            }
        )

    if errors or not isinstance(workflow_id, str) or not IDENTIFIER_RE.fullmatch(workflow_id):
        return None, errors, warnings
    plan = {
        "schemaVersion": "1.0.0",
        "planId": bounded_identifier(workflow_id, "worker-plan"),
        "workflowId": workflow_id,
        "profile": profile,
        "dryRun": True,
        "processesStarted": False,
        "networkCallsMade": False,
        "externalPublish": False,
        "paidGeneration": False,
        "maxAttemptsPerStage": max_attempts,
        "stages": compiled_stages,
    }
    return plan, errors, warnings


def resolve_output_inside(project_root: Path, raw_output: str) -> Path:
    root = project_root.expanduser().resolve()
    candidate = Path(raw_output).expanduser()
    resolved = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if resolved == root:
        raise ValueError("worker-plan output must be a file inside the project root")
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError("worker-plan output must stay inside the project root") from error
    return resolved


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workflow", required=True, help="Path to a YAML workflow fixture")
    parser.add_argument("--output", default=None, help="Optional new JSON output file inside the project root")
    parser.add_argument("--project-root", default=".", help="Project root used for output containment")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        workflow = load_yaml(Path(args.workflow))
        plan, errors, warnings = compile_worker_plan(workflow)
    except (OSError, ValueError) as error:
        print(f"WORKER_PLAN_INVALID: {error}")
        return 1
    if errors or plan is None:
        print(json.dumps({"valid": False, "errors": errors, "warnings": warnings}, ensure_ascii=False, indent=2))
        return 1
    serialized_plan = json.dumps(plan, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        output_path = resolve_output_inside(Path(args.project_root), args.output)
        if output_path.exists():
            print(f"WORKER_PLAN_INVALID: refusing to overwrite existing output: {output_path}")
            return 1
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(serialized_plan, encoding="utf-8", newline="\n")
        print(f"worker_plan_output={output_path}")
    print("WORKER_PLAN_VALID")
    print(serialized_plan, end="")
    for warning in warnings:
        print(f"WARNING: {warning}")
    print("dry_run=true")
    print("processes_started=false")
    print("network_calls_made=false")
    print("publish=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
