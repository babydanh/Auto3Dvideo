"""Offline contract tests for the bounded OmniVoice worker."""

from __future__ import annotations

import json
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "scripts" / "omnivoice_tts_worker.py"

SPEC = importlib.util.spec_from_file_location("omnivoice_tts_worker", WORKER)
assert SPEC and SPEC.loader
WORKER_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER_MODULE)


class OmniVoiceWorkerTests(unittest.TestCase):
    def test_inline_emotion_tags_are_split_and_normalized(self) -> None:
        segments = WORKER_MODULE.parse_inline_emotion_markup(
            "Mở đầu. [EXCITED] Nó lao tới! [SHOUTING] Tránh ra!"
        )
        self.assertEqual(
            [(item["emotionCode"], item["text"]) for item in segments],
            [
                ("neutral", "Mở đầu."),
                ("excited", "Nó lao tới!"),
                ("shouting", "Tránh ra!"),
            ],
        )

    def test_emotion_aliases_and_legacy_fallbacks(self) -> None:
        self.assertEqual(WORKER_MODULE.normalize_emotion_code("enthusiastic"), "excited")
        self.assertEqual(WORKER_MODULE.emotion_fallback_prefix("excited"), "[cười] ")
        self.assertEqual(WORKER_MODULE.emotion_fallback_prefix("sad"), "[thở dài] ")
        self.assertEqual(WORKER_MODULE.emotion_fallback_prefix("mysterious"), "")

    def test_unknown_explicit_emotion_tag_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            WORKER_MODULE.parse_inline_emotion_markup("[emotion:made_up] text")

    def test_check_does_not_download_or_call_network(self) -> None:
        with tempfile.TemporaryDirectory(prefix="auto3dvideo-omnivoice-check-") as directory:
            result = subprocess.run(
                [sys.executable, str(WORKER), "--check"],
                cwd=directory,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
        payload = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertIn(payload["status"], {"missing_package", "device_unavailable", "model_missing", "ready"})
        self.assertFalse(payload["networkCallsMade"])
        self.assertFalse(payload["modelDownloadRequested"])

    def test_synthesis_rejects_missing_local_model_without_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="auto3dvideo-omnivoice-synth-") as directory:
            workspace = Path(directory)
            request_dir = workspace / ".auto3dvideo" / "requests"
            request_dir.mkdir(parents=True)
            request_path = request_dir / "test.json"
            request_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": "1.0.0",
                        "requestId": "test-request",
                        "projectId": "project-test",
                        "voiceProfileId": "voice-test",
                        "modelId": "k2-fsa/OmniVoice",
                        "mode": "design",
                        "text": "A bounded offline test.",
                        "language": "en",
                        "instruct": "Calm documentary narrator.",
                        "outputPath": ".auto3dvideo/voices/voice-test/previews/test.wav",
                        "speed": 1.0,
                        "qualityPreset": "preview",
                        "cloneConsent": False,
                        "networkCallsAllowed": False,
                    }
                ),
                encoding="utf-8",
            )
            result = subprocess.run(
                [sys.executable, str(WORKER), "--synthesize", "--request", ".auto3dvideo/requests/test.json"],
                cwd=workspace,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            payload = json.loads(result.stdout.strip().splitlines()[-1])
            self.assertEqual(result.returncode, 1)
            self.assertEqual(payload["status"], "failed")
            self.assertFalse(payload["networkCallsMade"])
            self.assertIn("token", payload["message"])
            self.assertFalse((workspace / ".auto3dvideo" / "voices" / "voice-test" / "previews" / "test.wav").exists())


if __name__ == "__main__":
    unittest.main()
