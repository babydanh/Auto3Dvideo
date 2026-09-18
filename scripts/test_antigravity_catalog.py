"""Validate the Antigravity task catalog without executing any catalog command."""
from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "configs" / "antigravity-task-catalog.yaml"


def main() -> int:
    value = yaml.safe_load(CATALOG.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit("catalog_root_not_object")
    if value.get("schema_version") != "1.0.0":
        raise SystemExit("catalog_schema_version_invalid")
    if value.get("locale") != "vi-VN":
        raise SystemExit("catalog_locale_invalid")
    policy = value.get("execution_policy")
    if not isinstance(policy, dict):
        raise SystemExit("execution_policy_missing")
    for key in ("allow_network", "allow_publish", "allow_paid_generation", "allow_external_processes"):
        if policy.get(key) is not False:
            raise SystemExit(f"policy_not_locked={key}")
    tasks = value.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise SystemExit("tasks_missing")
    task_ids: set[str] = set()
    for task in tasks:
        if not isinstance(task, dict):
            raise SystemExit("task_not_object")
        task_id = task.get("id")
        if not isinstance(task_id, str) or task_id in task_ids:
            raise SystemExit(f"duplicate_or_invalid_task={task_id}")
        task_ids.add(task_id)
        commands = task.get("commands")
        if not isinstance(commands, list) or not commands or any(not isinstance(command, list) or not command for command in commands):
            raise SystemExit(f"commands_invalid={task_id}")
        if task.get("requires_native") and task.get("human_confirmation_required") is not True:
            raise SystemExit(f"native_task_missing_confirmation={task_id}")
    print("ANTIGRAVITY_TASK_CATALOG_TEST=PASS")
    print(f"tasks={len(tasks)}")
    print("locale=vi-VN")
    print("side_effect_defaults=locked")
    print("commands_not_executed=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
