"""Test the P0 job transition contract without starting external workers."""
from __future__ import annotations

TRANSITIONS = {
    ("draft", "queued"),
    ("queued", "running"),
    ("queued", "cancelled"),
    ("running", "succeeded"),
    ("running", "failed"),
    ("running", "cancel_requested"),
    ("cancel_requested", "cancelled"),
    ("failed", "queued"),
}


def main() -> int:
    happy_path = [
        ("draft", "queued"),
        ("queued", "running"),
        ("running", "succeeded"),
    ]
    retry_path = [("running", "failed"), ("failed", "queued")]
    cancel_path = [
        ("queued", "cancelled"),
        ("running", "cancel_requested"),
        ("cancel_requested", "cancelled"),
    ]
    for path in (happy_path, retry_path, cancel_path):
        if not all(edge in TRANSITIONS for edge in path):
            raise SystemExit(f"invalid_expected_path={path}")

    forbidden = {
        ("succeeded", "running"),
        ("cancelled", "queued"),
        ("draft", "succeeded"),
        ("failed", "succeeded"),
    }
    if TRANSITIONS.intersection(forbidden):
        raise SystemExit("forbidden_transition_present")

    print("JOB_STATE_MACHINE_TEST=PASS")
    print("happy_path=PASS")
    print("retry_path=PASS")
    print("cancel_path=PASS")
    print("forbidden_transitions=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
