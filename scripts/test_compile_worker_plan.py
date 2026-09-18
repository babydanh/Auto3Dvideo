"""Test workflow-to-worker planning without spawning processes or making network calls."""
from __future__ import annotations

import copy
import json
import tempfile
from pathlib import Path

from compile_worker_plan import compile_worker_plan, load_yaml
from validate_worker_plan import validate_worker_plan

FIXTURE = Path(__file__).resolve().parents[1] / "workflows" / "example-local-free-pipeline.yaml"


def workflow() -> dict:
    return load_yaml(FIXTURE)


def expect_rejected(value: dict, label: str) -> None:
    plan, errors, _warnings = compile_worker_plan(value)
    if plan is not None or not errors:
        raise SystemExit(f"expected_rejection_missing={label}")


def main() -> int:
    plan, errors, warnings = compile_worker_plan(workflow())
    if errors or plan is None:
        raise SystemExit(f"local_workflow_compile_failed={errors}")
    if plan["dryRun"] is not True or plan["processesStarted"] or plan["networkCallsMade"]:
        raise SystemExit("worker_plan_side_effect_flags_mismatch")
    plan_errors = validate_worker_plan(plan)
    if plan_errors:
        raise SystemExit(f"compiled_plan_invalid={plan_errors}")
    with tempfile.TemporaryDirectory(prefix="auto3dvideo-worker-plan-") as directory:
        round_trip_path = Path(directory) / "worker-plan.json"
        round_trip_path.write_text(json.dumps(plan), encoding="utf-8")
        round_trip = json.loads(round_trip_path.read_text(encoding="utf-8"))
        if validate_worker_plan(round_trip):
            raise SystemExit("worker_plan_json_round_trip_invalid")
    if len(plan["stages"]) != 7:
        raise SystemExit(f"stage_count_mismatch={len(plan['stages'])}")
    if any(stage["attempt"]["state"] != "pending" for stage in plan["stages"]):
        raise SystemExit("stage_attempt_not_pending")
    if any(stage["attempt"]["processStarted"] for stage in plan["stages"]):
        raise SystemExit("stage_attempt_started_process")
    if not warnings == []:
        raise SystemExit(f"unexpected_fixture_warnings={warnings}")

    cycle = copy.deepcopy(workflow())
    cycle["stages"][0]["depends_on"] = [cycle["stages"][1]["id"]]
    expect_rejected(cycle, "dependency_cycle")

    unknown_dependency = copy.deepcopy(workflow())
    unknown_dependency["stages"][0]["depends_on"] = ["missing-stage"]
    expect_rejected(unknown_dependency, "unknown_dependency")

    publish = copy.deepcopy(workflow())
    publish["stages"].append({"id": "publish-now", "type": "publish", "executor": "mock", "outputs": ["published.mp4"]})
    expect_rejected(publish, "publish_stage")

    invalid_compiled = copy.deepcopy(plan)
    invalid_compiled["stages"][0]["attempt"]["state"] = "running"
    if not validate_worker_plan(invalid_compiled):
        raise SystemExit("invalid_compiled_plan_not_rejected")

    malformed_stage_id = copy.deepcopy(plan)
    malformed_stage_id["stages"][0]["stageId"] = ["not", "a", "string"]
    if not validate_worker_plan(malformed_stage_id):
        raise SystemExit("malformed_stage_id_not_rejected")

    raw_command = copy.deepcopy(workflow())
    raw_command["stages"][0]["shell_command"] = "ffmpeg -i input output"
    expect_rejected(raw_command, "raw_shell_command")

    unsafe_policy = copy.deepcopy(workflow())
    unsafe_policy["policy"]["external_publish"] = "enabled"
    expect_rejected(unsafe_policy, "external_publish_policy")

    ffmpeg_without_operation = copy.deepcopy(workflow())
    ffmpeg_without_operation["stages"].append({"id": "ffmpeg-stage", "type": "custom.media", "executor": "ffmpeg", "outputs": ["out.mp4"]})
    expect_rejected(ffmpeg_without_operation, "untyped_ffmpeg_operation")

    print("WORKER_PLAN_TEST=PASS")
    print("stage_mapping=PASS")
    print("pending_attempts=PASS")
    print("dependency_graph=PASS")
    print("publish_policy=PASS")
    print("raw_command_boundary=PASS")
    print("compiled_plan_validator=PASS")
    print("json_round_trip=PASS")
    print("malformed_stage_guard=PASS")
    print("ffmpeg_operation_boundary=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
