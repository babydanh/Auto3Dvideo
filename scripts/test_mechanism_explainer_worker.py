from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

WORKER_PATH = Path(__file__).with_name("mechanism_explainer_worker.py")
SPEC = importlib.util.spec_from_file_location("mechanism_explainer_worker", WORKER_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MechanismWorkerTests(unittest.TestCase):
    def base_plan(self) -> dict:
        def event(number: int, start: int, end: int, scene_kind: str, depends: list[str]) -> dict:
            return {
                "eventId": f"event-{number:03d}",
                "sequence": number,
                "dependsOn": depends,
                "startFrame": start,
                "endFrame": end,
                "durationFrames": end - start,
                "narration": "Giải thích một bước của cơ chế.",
                "caption": "Bước của cơ chế",
                "claim": "Claim cần review.",
                "sourceNotes": [],
                "visualMode": "pseudo_3d",
                "visualSpec": {
                    "sceneKind": scene_kind,
                    "subject": ["cement"],
                    "visibleAction": "Các hạt thay đổi và liên kết.",
                    "camera": "macro push-in",
                    "continuityAnchors": ["gray cement"],
                    "negativeConstraints": ["no logo"],
                },
                "transitionIn": "cut",
                "transitionOut": "cut",
                "reviewState": "needs_review",
            }

        return {
            "schemaVersion": "1.0.0",
            "planId": "cement-test-plan",
            "language": "vi-VN",
            "title": "Test",
            "topic": "Test mechanism",
            "format": {"aspectRatio": "9:16", "width": 720, "height": 1280, "frameRate": 30},
            "style": {"visualLanguage": "mechanism_explainer", "palette": ["#07111F", "#5EE7D2", "#E8A34B"], "captionStyle": "sidecar", "referenceUse": "moodboard_only"},
            "events": [
                event(1, 0, 30, "hook", []),
                event(2, 30, 60, "powder_contact", ["event-001"]),
                event(3, 60, 90, "takeaway", ["event-002"]),
            ],
            "policy": {"rightsRequired": True, "humanReviewRequired": True, "allowNetwork": False, "externalAssetsAllowed": False, "paidGeneration": False},
            "reviewState": "needs_review",
        }

    def test_valid_plan_has_contiguous_events(self) -> None:
        events = MODULE.validate_plan(self.base_plan())
        self.assertEqual([event["eventId"] for event in events], ["event-001", "event-002", "event-003"])

    def test_gap_is_rejected(self) -> None:
        plan = self.base_plan()
        plan["events"][1]["startFrame"] = 31
        with self.assertRaises(ValueError):
            MODULE.validate_plan(plan)

    def test_future_dependency_is_rejected(self) -> None:
        plan = self.base_plan()
        plan["events"][1]["dependsOn"] = ["event-003"]
        with self.assertRaises(ValueError):
            MODULE.validate_plan(plan)

    def test_network_policy_is_rejected(self) -> None:
        plan = self.base_plan()
        plan["policy"]["allowNetwork"] = True
        with self.assertRaises(ValueError):
            MODULE.validate_plan(plan)

    def test_traversal_plan_path_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            MODULE.safe_relative("../secret.json", "planPath")

    def test_render_writes_manifest_and_srt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            plan_path = workspace / "plan.json"
            plan_path.write_text(json.dumps(self.base_plan(), ensure_ascii=False), encoding="utf-8")
            result = MODULE.render(workspace, "plan.json", "out")
            self.assertEqual(result, 0)
            self.assertTrue((workspace / "out" / "scene-manifest.json").is_file())
            self.assertTrue((workspace / "out" / "captions.srt").is_file())
            self.assertEqual(len(list((workspace / "out" / "frames").glob("*.png"))), 90)


if __name__ == "__main__":
    unittest.main()
