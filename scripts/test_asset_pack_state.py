"""Test Asset Pack state transitions without starting providers or workers."""
from __future__ import annotations

from asset_pack_state import PACK_TRANSITIONS, can_transition, validate_transition


def main() -> int:
    happy_path = ["planned", "validated", "queued", "generating", "ingested", "needs_review", "approved"]
    if not all(can_transition(old, new) for old, new in zip(happy_path, happy_path[1:])):
        raise SystemExit("happy_path_invalid")
    if not all(can_transition(old, "failed") for old in ("planned", "validated", "queued", "generating", "ingested", "needs_review")):
        raise SystemExit("failure_path_invalid")
    forbidden = [("approved", "generating"), ("failed", "approved"), ("blocked", "queued"), ("planned", "approved")]
    if any(edge in PACK_TRANSITIONS for edge in forbidden):
        raise SystemExit("forbidden_transition_present")
    previous = {"packId": "pack-one", "projectId": "project-one", "status": "planned"}
    current = {"packId": "pack-one", "projectId": "project-one", "status": "validated"}
    if validate_transition(previous, current):
        raise SystemExit("valid_transition_rejected")
    if not validate_transition(previous, {**current, "packId": "other-pack"}):
        raise SystemExit("pack_id_change_accepted")
    print("ASSET_PACK_STATE_TEST=PASS")
    print("happy_path=PASS")
    print("failure_path=PASS")
    print("forbidden_transitions=PASS")
    print("immutable_identity=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
