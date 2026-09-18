from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import frame_locked_caption_worker as worker


class FrameLockedCaptionWorkerTests(unittest.TestCase):
    def request(self) -> dict:
        return {
            "planId": "tiger-caption-plan",
            "sourceAudioPath": "audio/voice.wav",
            "sourceVideoPath": "video/master.mp4",
            "language": "vi-VN",
            "frameRate": 30,
            "durationFrames": 90,
            "alignmentSource": "whisperx",
            "cues": [
                {"cueId": "cue-001", "startFrame": 0, "endFrame": 30, "text": "Con hổ khổng lồ xuất hiện."},
                {"cueId": "cue-002", "startFrame": 30, "endFrame": 60, "text": "Nó bước vào thế giới khủng long."},
            ],
        }

    def test_build_keeps_integer_frames_and_derives_srt(self) -> None:
        plan = worker.build_plan(self.request())
        self.assertEqual(plan["timebase"], "integer_frames")
        self.assertEqual(plan["cues"][1]["startFrame"], 30)
        srt = worker.serialize_srt(plan)
        self.assertIn("00:00:00,000 --> 00:00:01,000", srt)
        self.assertIn("00:00:01,000 --> 00:00:02,000", srt)

    def test_word_alignment_must_stay_inside_cue(self) -> None:
        request = self.request()
        request["cues"][0]["words"] = [{"text": "Con", "startFrame": 0, "endFrame": 8}, {"text": "hổ", "startFrame": 8, "endFrame": 15}]
        plan = worker.build_plan(request)
        self.assertEqual(len(plan["cues"][0]["words"]), 2)

    def test_overlap_is_rejected(self) -> None:
        request = self.request()
        request["cues"][1]["startFrame"] = 29
        with self.assertRaises(ValueError):
            worker.build_plan(request)

    def test_fractional_frame_and_unsafe_path_are_rejected(self) -> None:
        request = self.request()
        request["cues"][0]["startFrame"] = 0.5
        with self.assertRaises(ValueError):
            worker.build_plan(request)
        request = self.request()
        request["sourceAudioPath"] = "../voice.wav"
        with self.assertRaises(ValueError):
            worker.build_plan(request)
        request = self.request()
        request["alignmentState"] = "approved_without_alignment"
        with self.assertRaises(ValueError):
            worker.build_plan(request)

    def test_outputs_refuse_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            request = {**self.request(), "outputPlanPath": "out/plan.json", "outputSrtPath": "out/captions.srt"}
            worker.handle(request, workspace)
            with self.assertRaises(ValueError):
                worker.handle(request, workspace)
            self.assertEqual(json.loads((workspace / "out/plan.json").read_text(encoding="utf-8"))["durationFrames"], 90)


if __name__ == "__main__":
    unittest.main()
