"""Test the typed media-plan validator without running FFmpeg or FFprobe."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from validate_media_plan import validate_media_plan

FIXTURE = Path(__file__).resolve().parents[1] / "examples" / "minimal-3d-video" / "media-plan.json"


def fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def expect_rejected(plan: dict, label: str) -> None:
    errors = validate_media_plan(plan)
    if not errors:
        raise SystemExit(f"expected_rejection_missing={label}")


def main() -> int:
    if validate_media_plan(fixture()):
        raise SystemExit("fixture_should_be_valid")

    wrong_probe = fixture()
    wrong_probe["operation"] = "probe"
    expect_rejected(wrong_probe, "probe_requires_ffprobe")

    absolute_input = fixture()
    absolute_input["inputs"][0]["relativePath"] = r"C:\outside\clip.mp4"
    expect_rejected(absolute_input, "absolute_input")

    traversal_output = fixture()
    traversal_output["output"]["relativePath"] = "../outside.mp4"
    expect_rejected(traversal_output, "traversal_output")

    raw_filter_graph = fixture()
    raw_filter_graph["filterGraph"] = "[0:v]unsafe"
    expect_rejected(raw_filter_graph, "raw_filter_graph")

    live_mode = fixture()
    live_mode["dryRun"] = False
    expect_rejected(live_mode, "live_mode_blocked")

    publish = fixture()
    publish["externalPublish"] = True
    expect_rejected(publish, "external_publish_blocked")

    paid = fixture()
    paid["paidGeneration"] = True
    expect_rejected(paid, "paid_generation_blocked")

    audio_required = fixture()
    audio_required["target"]["audioRequired"] = True
    expect_rejected(audio_required, "missing_audio_input")

    caption_required = fixture()
    caption_required["target"]["captionMode"] = "burned"
    expect_rejected(caption_required, "missing_subtitle_input")

    bad_timeout = fixture()
    bad_timeout["timeoutSeconds"] = 0
    expect_rejected(bad_timeout, "timeout_bound")

    unknown_input = fixture()
    unknown_input["inputs"][0]["args"] = ["-y"]
    expect_rejected(unknown_input, "unknown_input_field")

    print("MEDIA_PLAN_TEST=PASS")
    print("operation_mapping=PASS")
    print("path_safety=PASS")
    print("raw_filter_boundary=PASS")
    print("policy_locks=PASS")
    print("output_requirements=PASS")
    print("timeout_bounds=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
