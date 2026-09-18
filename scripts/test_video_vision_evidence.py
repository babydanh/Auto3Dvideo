from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "video_vision_evidence_worker_test_target", ROOT / "video_vision_evidence_worker.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load video_vision_evidence_worker.py")
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class VideoVisionEvidenceWorkerTests(unittest.TestCase):
    def make_fixture(self, root: Path) -> None:
        (root / "assets").mkdir(parents=True)
        (root / "frames").mkdir(parents=True)
        (root / "assets" / "source.mp4").write_bytes(b"synthetic-video-fixture")
        for index, color in enumerate([(24, 32, 48), (26, 34, 50), (240, 240, 240), (242, 242, 242)]):
            image = Image.new("RGB", (96, 54), color)
            image.save(root / "frames" / f"frame-{index + 1:04d}.jpg", quality=90)

    def request(self, output_path: str = "evidence/video-evidence.json") -> dict:
        return {
            "operation": "analyze_frames",
            "evidenceId": "evidence-test-001",
            "sourceVideoPath": "assets/source.mp4",
            "frameDir": "frames",
            "outputPath": output_path,
            "requestedFps": 1.0,
            "maxFrames": 120,
            "frameWidth": 96,
            "frameHeight": 54,
            "probe": {
                "durationSeconds": 4.0,
                "width": 1920,
                "height": 1080,
                "fps": 30.0,
                "videoCodec": "h264",
                "audioPresent": False,
            },
        }

    def test_creates_schema_shaped_evidence_and_detects_cut(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_fixture(root)
            result = WORKER.handle(self.request(), root)
            self.assertEqual(result["status"], "succeeded")
            evidence = result["evidence"]
            self.assertEqual(evidence["schemaVersion"], "1.0.0")
            self.assertEqual(len(evidence["shots"]), 2)
            self.assertEqual(evidence["shots"][0]["frameRefs"][0], "frames/frame-0001.jpg")
            self.assertEqual(evidence["shots"][1]["visualCues"]["brightness"], "high")
            self.assertFalse(evidence["capabilities"]["semanticVlm"])
            saved = json.loads((root / "evidence" / "video-evidence.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["sourceSha256"], evidence["sourceSha256"])
            self.assertFalse(evidence["networkCallsMade"])

    def test_rejects_traversal_and_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_fixture(root)
            with self.assertRaises(ValueError):
                WORKER.handle({**self.request(), "frameDir": "../frames"}, root)
            WORKER.handle(self.request(), root)
            with self.assertRaises(ValueError):
                WORKER.handle(self.request(), root)

    def test_audio_requires_extracted_audio_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_fixture(root)
            request = self.request()
            request["probe"]["audioPresent"] = True
            with self.assertRaises(ValueError):
                WORKER.handle(request, root)
            (root / "audio.wav").write_bytes(b"wav-fixture")
            request["audioPath"] = "audio.wav"
            evidence = WORKER.handle({**request, "outputPath": "evidence/audio.json"}, root)["evidence"]
            self.assertEqual(evidence["audioPath"], "audio.wav")
            self.assertTrue(evidence["capabilities"]["audioExtraction"])


if __name__ == "__main__":
    unittest.main()
