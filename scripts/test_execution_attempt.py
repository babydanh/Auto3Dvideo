"""Test durable attempt evidence semantics without starting a worker."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from validate_execution_attempt import validate_attempt

FIXTURE = Path(__file__).resolve().parents[1] / "examples" / "minimal-3d-video" / "execution-attempt.json"


def fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def expect_rejected(attempt: dict, label: str) -> None:
    errors = validate_attempt(attempt)
    if not errors:
        raise SystemExit(f"expected_rejection_missing={label}")


def main() -> int:
    if validate_attempt(fixture()):
        raise SystemExit("pending_fixture_should_be_valid")

    running = fixture()
    running.update(
        {
            "state": "running",
            "processStarted": True,
            "startedAt": "2026-08-23T00:00:01Z",
            "leaseExpiresAt": "2026-08-23T00:30:01Z",
            "heartbeatAt": "2026-08-23T00:00:02Z",
        }
    )
    if validate_attempt(running):
        raise SystemExit("running_attempt_should_be_valid")

    mock_running = fixture()
    mock_running.update(
        {
            "state": "running",
            "executionMode": "in_process_mock",
            "workerId": "mock-worker",
            "processStarted": False,
            "startedAt": "2026-08-23T00:00:01Z",
            "leaseExpiresAt": "2026-08-23T00:30:01Z",
            "heartbeatAt": "2026-08-23T00:00:02Z",
        }
    )
    if validate_attempt(mock_running):
        raise SystemExit("in_process_mock_running_should_be_valid")

    mock_cancel = copy.deepcopy(mock_running)
    mock_cancel.update(
        {
            "state": "cancel_requested",
            "cancellationRequestedAt": "2026-08-23T00:00:03Z",
        }
    )
    if validate_attempt(mock_cancel):
        raise SystemExit("in_process_mock_cancel_should_be_valid")

    succeeded = copy.deepcopy(running)
    succeeded.update(
        {
            "state": "succeeded",
            "finishedAt": "2026-08-23T00:00:10Z",
            "terminationMode": "none",
            "outputs": [
                {
                    "relativePath": "preview/mock-preview.mp4",
                    "mediaKind": "video",
                    "contentHash": "a" * 64,
                    "sizeBytes": 1024,
                    "validationState": "valid",
                    "validationMessage": None,
                }
            ],
        }
    )
    if validate_attempt(succeeded):
        raise SystemExit("succeeded_attempt_should_be_valid")

    bad_running = fixture()
    bad_running["state"] = "running"
    expect_rejected(bad_running, "running_requires_lease")

    pending_started = fixture()
    pending_started["processStarted"] = True
    expect_rejected(pending_started, "pending_started_process")

    unknown_field = fixture()
    unknown_field["shellCommand"] = "must never be accepted"
    expect_rejected(unknown_field, "raw_shell_command")

    traversal = fixture()
    traversal["outputs"][0]["relativePath"] = "../outside.mp4"
    expect_rejected(traversal, "output_traversal")

    reconciliation = fixture()
    reconciliation["state"] = "reconciliation_required"
    reconciliation["finishedAt"] = "2026-08-23T00:00:10Z"
    expect_rejected(reconciliation, "reconciliation_requires_unknown_side_effect")

    secret_message = fixture()
    secret_message["state"] = "failed"
    secret_message["finishedAt"] = "2026-08-23T00:00:10Z"
    secret_message["redactedMessage"] = "api_key=should-not-be-stored"
    expect_rejected(secret_message, "secret_like_message")

    cancelled_without_termination = copy.deepcopy(running)
    cancelled_without_termination.update(
        {
            "state": "cancelled",
            "finishedAt": "2026-08-23T00:00:10Z",
            "terminationMode": "none",
        }
    )
    expect_rejected(cancelled_without_termination, "cancelled_needs_termination_evidence")

    side_effect_success = copy.deepcopy(succeeded)
    side_effect_success["externalSideEffectUnknown"] = True
    expect_rejected(side_effect_success, "success_with_unknown_side_effect")

    side_effect_failed = copy.deepcopy(succeeded)
    side_effect_failed.update({"state": "failed", "errorCode": "FAILED_PROCESS_EXIT", "externalSideEffectUnknown": True})
    expect_rejected(side_effect_failed, "failed_with_unknown_side_effect")

    print("EXECUTION_ATTEMPT_TEST=PASS")
    print("pending_running_succeeded=PASS")
    print("in_process_mock_lifecycle=PASS")
    print("lease_requirements=PASS")
    print("cancellation_evidence=PASS")
    print("reconciliation_guard=PASS")
    print("pending_side_effect_guard=PASS")
    print("secret_redaction=PASS")
    print("output_path_safety=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
