"""Regression tests for the NarrativeVisualPlan semantic validator."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from validate_narrative_visual_plan import validate_plan

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "examples" / "minimal-3d-video" / "narrative-visual-plan.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def assert_invalid(name: str, mutate) -> None:
    document = load_fixture()
    mutate(document)
    errors, _ = validate_plan(document, ROOT)
    assert errors, f"{name} unexpectedly passed"


def main() -> int:
    valid_errors, valid_warnings = validate_plan(load_fixture(), ROOT)
    assert not valid_errors, valid_errors
    assert valid_warnings and "No media was generated" in valid_warnings[0]

    assert_invalid("non-contiguous sequence", lambda doc: doc["beats"][1].update({"sequence": 3}))
    assert_invalid("incomplete narration coverage", lambda doc: doc["beats"][2]["narration"].update({"endUnit": 2}))
    assert_invalid("unsafe output path", lambda doc: doc["beats"][0]["expectedAsset"].update({"relativePath": "../../escape.png"}))
    assert_invalid(
        "persistent entity drift",
        lambda doc: doc["beats"][1]["entities"][0]["identityAnchors"].append("red hat"),
    )
    assert_invalid(
        "ungrounded visual evidence",
        lambda doc: doc["beats"][0]["visualEvidence"]["requiredElements"].append("unrelated spaceship"),
    )
    assert_invalid("raw command field", lambda doc: doc["beats"][0].update({"shell": "ffmpeg --help"}))
    assert_invalid("paid generation bypass", lambda doc: doc["policy"].update({"paidGeneration": True}))
    assert_invalid("wrong beat identity", lambda doc: doc["beats"][0].update({"beatId": "beat-002"}))

    # Ensure the test itself does not mutate the loaded fixture between cases.
    untouched = copy.deepcopy(load_fixture())
    assert untouched["beats"][0]["candidate"]["selectionState"] == "not_generated"
    print("NARRATIVE_VISUAL_PLAN_TEST=PASS")
    print("valid_fixture=PASS")
    print("coverage_and_sequence_guards=PASS")
    print("entity_continuity_guard=PASS")
    print("prompt_visual_grounding_guard=PASS")
    print("path_and_raw_command_guards=PASS")
    print("policy_lock_guards=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
