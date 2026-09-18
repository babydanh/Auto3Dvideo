"""Unit tests for the local topic-to-video workers.

These tests use only mocked gateway responses and temporary local files. They never
read the repository .env and never contact a real provider.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError


ROOT = Path(__file__).resolve().parent


def load_worker(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SCRIPT_WORKER = load_worker("local_script_worker_test_target", "local_script_worker.py")
SCENE_WORKER = load_worker("local_scene_worker_test_target", "local_scene_worker.py")
SPACE_WORKER = load_worker("local_space_25d_worker_test_target", "local_space_25d_worker.py")
COLLECTOR = load_worker("collect_licensed_footage_test_target", "collect_licensed_footage.py")
LICENSED_WORKER = load_worker("local_licensed_footage_worker_test_target", "local_licensed_footage_worker.py")
VIENEU_WORKER = load_worker("vieneu_tts_worker_test_target", "vieneu_tts_worker.py")
SUBTITLE_WORKER = load_worker("subtitle_worker_test_target", "subtitle_worker.py")


class VieneuWorkerValidationTests(unittest.TestCase):
    def test_temperature_is_bounded(self):
        self.assertEqual(VIENEU_WORKER.validate_temperature(0.8), 0.8)
        self.assertEqual(VIENEU_WORKER.validate_temperature(1), 1.0)
        with self.assertRaises(ValueError):
            VIENEU_WORKER.validate_temperature(0.59)
        with self.assertRaises(ValueError):
            VIENEU_WORKER.validate_temperature(1.21)
        with self.assertRaises(ValueError):
            VIENEU_WORKER.validate_temperature(True)

    def test_reference_audio_requires_explicit_consent(self):
        self.assertFalse(VIENEU_WORKER.validate_clone_consent(None, False))
        self.assertTrue(VIENEU_WORKER.validate_clone_consent("references/my.wav", True))
        with self.assertRaises(ValueError):
            VIENEU_WORKER.validate_clone_consent("references/my.wav", False)
        with self.assertRaises(ValueError):
            VIENEU_WORKER.validate_clone_consent(None, "yes")


class SubtitleWorkerTests(unittest.TestCase):
    def valid_document(self, entries=None):
        return {
            "schemaVersion": "1.0.0",
            "documentId": "subtitle-test",
            "sourceVideoPath": "assets/source.mp4",
            "sourceLanguage": "vi-VN",
            "targetLanguage": "vi-VN",
            "durationSeconds": 4,
            "format": "srt",
            "entries": entries or [{"entryId": "entry-0001", "startSeconds": 0.1, "endSeconds": 1.2, "text": "Xin chào."}],
            "rightsStatus": "pending",
            "reviewState": "draft",
            "networkCallsMade": False,
        }

    def test_srt_and_vtt_parse_serialize_with_stable_milliseconds(self):
        content = """1
00:00:00,100 --> 00:00:01,800
Xin chào vũ trụ.

2
00:00:02,000 --> 00:00:03,250
Đây là phụ đề thử nghiệm.
"""
        entries = SUBTITLE_WORKER.parse_blocks(content, "srt")
        document = SUBTITLE_WORKER.make_document({
            "sourceVideoPath": "assets/source.mp4",
            "sourceLanguage": "vi-VN",
            "targetLanguage": "vi-VN",
            "durationSeconds": 4,
            "documentId": "subtitle-test",
        }, entries)
        self.assertEqual(len(document["entries"]), 2)
        self.assertIn("00:00:00,100 --> 00:00:01,800", SUBTITLE_WORKER.serialize(document, "srt"))
        self.assertIn("WEBVTT", SUBTITLE_WORKER.serialize(document, "vtt"))
        self.assertIn("00:00:02.000 --> 00:00:03.250", SUBTITLE_WORKER.serialize(document, "vtt"))

    def test_validator_rejects_overlap_and_unsafe_path(self):
        document = self.valid_document([
            {"entryId": "entry-0001", "startSeconds": 0, "endSeconds": 2, "text": "Một"},
            {"entryId": "entry-0002", "startSeconds": 1.5, "endSeconds": 3, "text": "Hai"},
        ])
        errors, _, _ = SUBTITLE_WORKER.validate_document(document)
        self.assertTrue(any("overlap" in error for error in errors))
        with self.assertRaises(ValueError):
            SUBTITLE_WORKER.safe_relative_path("../outside.srt", "inputPath")

    def test_save_is_contained_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            document = self.valid_document()
            result = SUBTITLE_WORKER.handle({"operation": "save", "document": document, "outputPath": "captions/out.srt", "format": "srt"}, workspace)
            self.assertEqual(result["status"], "succeeded")
            with self.assertRaises(ValueError):
                SUBTITLE_WORKER.handle({"operation": "save", "document": document, "outputPath": "captions/out.srt", "format": "srt"}, workspace)


class FakeResponse:
    status = 200

    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit: int = -1) -> bytes:
        return json.dumps(self.payload, ensure_ascii=False).encode("utf-8")


def request_payload(text: str) -> dict:
    return {
        "choices": [{
            "message": {"content": text},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }


def base_request(output_path: str = ".auto3dvideo/pipeline/test/script.json") -> dict:
    return {
        "requestId": "request-test-001",
        "projectId": "project-test-001",
        "briefId": "brief-test-001",
        "profileId": "science-explainer",
        "promptTemplateId": "brief-to-script-v1",
        "topic": "Một thành phố hình học dưới ánh trăng",
        "objective": "Tạo video dọc sáng tạo, không đưa claim thực tế",
        "audience": "Người xem phổ thông",
        "language": "vi-VN",
        "durationSeconds": 30,
        "aspectRatio": "9:16",
        "width": 720,
        "height": 1280,
        "frameRate": 30,
        "outputPath": output_path,
        "approvalStatus": "approved",
    }


class LocalScriptWorkerTests(unittest.TestCase):
    def fake_success(self, request, timeout=45):
        body = json.loads(request.data.decode("utf-8"))
        prompt = body["messages"][1]["content"]
        field = next(name for name in ("TITLE", "HOOK", "NARRATION_1", "SCREEN_1", "NARRATION_2", "SCREEN_2") if name in prompt)
        return FakeResponse(request_payload({
            "TITLE": "Thành phố ánh trăng",
            "HOOK": "Hãy bước vào một thế giới hình học yên tĩnh.",
            "NARRATION_1": "Các khối sáng tạo nên nhịp điệu thị giác cho câu chuyện.",
            "SCREEN_1": "Ánh sáng và hình học",
            "NARRATION_2": "Mỗi khung hình là một lát cắt tưởng tượng, không phải tư liệu thực tế.",
            "SCREEN_2": "Một thế giới do ứng dụng tạo",
        }[field]))

    def run_worker(self, root: Path, request: dict, use_gateway: bool = True) -> tuple[int, str]:
        request_path = root / "request.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
        output = io.StringIO()
        env = {
            "AUTO3DVIDEO_LLM_API_KEY": "test-key-not-a-secret" if use_gateway else "",
            "AUTO3DVIDEO_LLM_BASE_URL": "http://127.0.0.1:20128/v1",
            "AUTO3DVIDEO_LLM_MODEL": "cmd/poolside/laguna-s-2.1-free",
            "AUTO3DVIDEO_DOTENV_PATH": str(root / "missing.env"),
        }
        with patch.dict("os.environ", env, clear=False), patch.object(SCRIPT_WORKER.Path, "cwd", return_value=root), contextlib.redirect_stdout(output):
            status = SCRIPT_WORKER.run(request_path)
        return status, output.getvalue()

    def test_success_writes_pending_claim_review_script(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output_path = ".auto3dvideo/pipeline/test/script.json"
            with patch.object(SCRIPT_WORKER.urllib.request, "urlopen", side_effect=self.fake_success):
                status, output = self.run_worker(root, base_request(output_path))
            self.assertEqual(status, 0)
            script = json.loads((root / output_path).read_text(encoding="utf-8"))
            self.assertEqual(script["approvalStatus"], "pending")
            self.assertTrue(all(segment["claimStatus"] == "needs_review" for segment in script["segments"]))
            self.assertTrue(all(segment["emotionCode"] == "neutral" for segment in script["segments"]))
            self.assertNotIn("test-key-not-a-secret", output)

    def test_explicit_twelve_shots_and_sixty_seconds_are_preserved(self):
        request = base_request()
        request["topic"] = "Tạo video cinematic 3D dài khoảng 60 giây, gồm 12 shot liên kết thành một câu chuyện."
        request["requestedShotCount"] = 12
        request["requestedDurationSeconds"] = 60.0
        values = {
            "TITLE": "Mười hai shot",
            "HOOK": "Một hành trình điện ảnh.",
            "NARRATION_1": "Mở đầu câu chuyện.",
            "SCREEN_1": "Mở đầu",
            "NARRATION_2": "Kết nối các diễn biến.",
            "SCREEN_2": "Kết nối",
        }
        script = SCRIPT_WORKER.validate_script(request, values)
        self.assertEqual(len(script["segments"]), 12)
        self.assertEqual(script["totalDurationSeconds"], 60.0)
        self.assertEqual(script["requestedShotCount"], 12)
        self.assertEqual(script["requestedDurationSeconds"], 60.0)

    def test_explicit_contract_rejects_stale_eight_shot_thirty_second_request(self):
        request = base_request()
        request["topic"] = "Tạo video dài khoảng 60 giây, gồm 12 shot liên kết."
        request["requestedShotCount"] = 12
        request["requestedDurationSeconds"] = 60.0
        values = {
            "TITLE": "Lệch hợp đồng",
            "HOOK": "Không được dùng cache cũ.",
            "NARRATION_1": "Mở đầu.",
            "SCREEN_1": "Mở đầu",
            "NARRATION_2": "Kết thúc.",
            "SCREEN_2": "Kết thúc",
        }
        original = SCRIPT_WORKER.infer_prompt_timing
        with patch.object(SCRIPT_WORKER, "infer_prompt_timing", return_value=(8, None, 30.0)):
            with self.assertRaisesRegex(ValueError, "Planner lệch số shot"):
                SCRIPT_WORKER.validate_script(request, values)
        self.assertIs(SCRIPT_WORKER.infer_prompt_timing, original)

    def test_reference_context_is_compiled_into_visual_prompts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            request = base_request()
            request["referenceContext"] = "Ảnh tham chiếu: assets/reference.png"
            with patch.object(SCRIPT_WORKER.urllib.request, "urlopen", side_effect=self.fake_success):
                status, _output = self.run_worker(root, request)
            self.assertEqual(status, 0)
            script = json.loads((root / ".auto3dvideo/pipeline/test/script.json").read_text(encoding="utf-8"))
            self.assertIn("assets/reference.png", script["segments"][0]["visualPrompt"])

    def test_multiline_prompt_is_normalized_and_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            request = base_request()
            request["topic"] = "Tàu ngầm đi xuống rãnh Mariana.\r\nKhám phá sinh vật phát quang."
            with patch.object(SCRIPT_WORKER.urllib.request, "urlopen", side_effect=self.fake_success):
                status, _output = self.run_worker(root, request)
            self.assertEqual(status, 0)
            script = json.loads((root / ".auto3dvideo/pipeline/test/script.json").read_text(encoding="utf-8"))
            self.assertIn("Tàu ngầm đi xuống rãnh Mariana.", script["segments"][0]["visualPrompt"])

    def test_missing_gateway_uses_transparent_local_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            status, output = self.run_worker(root, base_request(), use_gateway=False)
            self.assertEqual(status, 0)
            event = json.loads(output.strip().splitlines()[-1])
            self.assertEqual(event["status"], "succeeded_local_fallback")
            self.assertEqual(event["networkCallsMade"], False)
            self.assertTrue((root / ".auto3dvideo/pipeline/test/script.json").exists())
            script = json.loads((root / ".auto3dvideo/pipeline/test/script.json").read_text(encoding="utf-8"))
            self.assertTrue(all(segment["emotionCode"] == "neutral" for segment in script["segments"]))

    def test_empty_visible_content_uses_local_fallback(self):
        def empty_response(_request, timeout=45):
            return FakeResponse({"choices": [{"message": {"content": "", "reasoning_content": "hidden"}, "finish_reason": "length"}]})

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(SCRIPT_WORKER.urllib.request, "urlopen", side_effect=empty_response):
                status, output = self.run_worker(root, base_request())
            self.assertEqual(status, 0)
            self.assertIn("succeeded_local_fallback", output)
            self.assertTrue((root / ".auto3dvideo/pipeline/test/script.json").exists())

    def test_timeout_retries_once_for_the_failed_field(self):
        calls = {"count": 0}

        def timeout_then_success(request, timeout=45):
            calls["count"] += 1
            if calls["count"] == 1:
                raise URLError("timed out")
            return self.fake_success(request, timeout)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(SCRIPT_WORKER.urllib.request, "urlopen", side_effect=timeout_then_success), patch.object(SCRIPT_WORKER.time, "sleep"):
                status, _output = self.run_worker(root, base_request())
            self.assertEqual(status, 0)
            self.assertEqual(calls["count"], 7)

    def test_path_traversal_is_rejected_before_gateway_call(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(SCRIPT_WORKER.urllib.request, "urlopen") as urlopen:
                status, output = self.run_worker(root, base_request("../outside.json"))
            self.assertEqual(status, 1)
            self.assertIn("invalid_request", output)
            urlopen.assert_not_called()


class LocalSceneWorkerTests(unittest.TestCase):
    def test_scene_manifest_and_pngs_stay_inside_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = {
                "scriptId": "script-scene-test",
                "segments": [
                    {"onScreenText": "Đoạn một", "narration": "Nội dung một", "durationSeconds": 5},
                    {"onScreenText": "Đoạn hai", "narration": "Nội dung hai", "durationSeconds": 5},
                ],
            }
            (root / "script.json").write_text(json.dumps(script, ensure_ascii=False), encoding="utf-8")
            status = SCENE_WORKER.run(root, "script.json", "render/scenes", 720, 1280)
            self.assertEqual(status, 0)
            manifest_path = root / "render/scenes/scene-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(len(manifest["scenes"]), 2)
            for scene in manifest["scenes"]:
                scene_path = root / scene["relativePath"]
                self.assertTrue(scene_path.is_file())
                self.assertTrue(scene_path.resolve().is_relative_to(root.resolve()))
                self.assertEqual(scene_path.suffix, ".png")

    def test_space_topic_uses_deterministic_space_visual_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = {
                "scriptId": "script-space-test",
                "title": "Vũ trụ 2D",
                "segments": [
                    {"onScreenText": "Hành tinh xanh", "narration": "Bay qua những vì sao", "durationSeconds": 5},
                    {"onScreenText": "Quỹ đạo sáng", "narration": "Một chuyến đi hư cấu", "durationSeconds": 5},
                ],
            }
            (root / "script.json").write_text(json.dumps(script, ensure_ascii=False), encoding="utf-8")
            status = SCENE_WORKER.run(root, "script.json", "render/scenes", 720, 1280)
            self.assertEqual(status, 0)
            manifest = json.loads((root / "render/scenes/scene-manifest.json").read_text(encoding="utf-8"))
            self.assertTrue(all(scene["visualMode"] == "2d-space-motion" for scene in manifest["scenes"]))
            self.assertFalse(manifest["externalAssetsUsed"])

    def test_scene_path_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = {"scriptId": "script-safe", "segments": [{"onScreenText": "Một", "narration": "Một", "durationSeconds": 5}, {"onScreenText": "Hai", "narration": "Hai", "durationSeconds": 5}]}
            (root / "script.json").write_text(json.dumps(script), encoding="utf-8")
            status = SCENE_WORKER.run(root, "../script.json", "render/scenes", 720, 1280)
            self.assertEqual(status, 1)


def licensed_source_entry(asset_id: str, filename: str, *, host: str = "svs.gsfc.nasa.gov", review_state: str = "approved") -> dict:
    return {
        "assetId": asset_id,
        "downloadUrl": f"https://{host}/media/{filename}",
        "landingPage": f"https://{host}/landing/{asset_id}",
        "filename": filename,
        "credit": "Nguồn đã xác minh",
        "licenseName": "Public domain hoặc license được ghi trong proof",
        "commercialUse": "conditional",
        "derivativeUse": "conditional",
        "rightsStatus": "public_domain",
        "proofPath": "research/rights-proof.md",
        "reviewState": review_state,
        "notes": "Test fixture; cần human review trước xuất bản.",
    }


class LicensedFootageCollectorTests(unittest.TestCase):
    def test_offline_happy_path_hashes_assets_and_keeps_review_gate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output_dir = root / "assets"
            entries = [
                licensed_source_entry("nasa-earth-01", "earth.webm"),
                licensed_source_entry("commons-galaxy-01", "galaxy.webm", host="upload.wikimedia.org"),
            ]
            for entry, payload in zip(entries, [b"earth", b"galaxy"]):
                (output_dir / entry["filename"]).parent.mkdir(parents=True, exist_ok=True)
                (output_dir / entry["filename"]).write_bytes(b"\x1a\x45\xdf\xa3" + payload)
            source_manifest = root / "source-manifest.json"
            source_manifest.write_text(json.dumps({"assets": entries}, ensure_ascii=False), encoding="utf-8")
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                status = COLLECTOR.run(source_manifest, output_dir, offline=True)
            self.assertEqual(status, 0)
            manifest = json.loads((root / "footage-manifest.json").read_text(encoding="utf-8"))
            self.assertFalse(manifest["networkCallsMade"])
            self.assertTrue(manifest["externalAssetsUsed"])
            self.assertEqual(manifest["reviewState"], "needs_review")
            for entry in manifest["assets"]:
                source = root / entry["relativePath"]
                self.assertEqual(entry["sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
                self.assertEqual(len(entry["sha256"]), 64)
                self.assertEqual(entry["reviewState"], "needs_review")

    def test_rejects_unallowlisted_host_before_download(self):
        entry = licensed_source_entry("social-01", "social.webm", host="example.com")
        with self.assertRaises(ValueError):
            COLLECTOR.validate_entry(entry, 1)

    def test_rejects_missing_rights_fields_and_unapproved_entry(self):
        for field in ("credit", "licenseName", "proofPath"):
            with self.subTest(field=field):
                entry = licensed_source_entry("asset-01", "asset.webm")
                entry[field] = ""
                with self.assertRaises(ValueError):
                    COLLECTOR.validate_entry(entry, 1)
        entry = licensed_source_entry("asset-02", "asset.webm", review_state="pending")
        with self.assertRaises(ValueError):
            COLLECTOR.validate_entry(entry, 1)

    def test_rejects_unsafe_filename_and_non_video_offline_file(self):
        entry = licensed_source_entry("asset-03", "../escape.webm")
        with self.assertRaises(ValueError):
            COLLECTOR.validate_entry(entry, 1)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output_dir = root / "assets"
            safe_entry = licensed_source_entry("asset-04", "not-video.webm")
            (output_dir / "not-video.webm").parent.mkdir(parents=True, exist_ok=True)
            (output_dir / "not-video.webm").write_bytes(b"not a video")
            with self.assertRaises(ValueError):
                COLLECTOR.download_one(COLLECTOR.validate_entry(safe_entry, 1), output_dir, offline=True)


class LicensedFootageWorkerTests(unittest.TestCase):
    def test_maps_verified_local_assets_to_video_scenes_without_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            assets_dir = root / "assets"
            assets_dir.mkdir(parents=True, exist_ok=True)
            entries = [
                licensed_source_entry("nasa-earth-01", "earth.webm"),
                licensed_source_entry("nasa-big-bang-01", "big-bang.webm"),
                licensed_source_entry("commons-galaxy-01", "galaxy.webm", host="upload.wikimedia.org"),
            ]
            for entry in entries:
                (assets_dir / entry["filename"]).write_bytes(b"\x1a\x45\xdf\xa3" + entry["assetId"].encode())
            source_manifest = root / "source-manifest.json"
            source_manifest.write_text(json.dumps({"assets": entries}, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(COLLECTOR.run(source_manifest, assets_dir, offline=True), 0)
            script = {
                "schemaVersion": "1.0.0",
                "scriptId": "script-licensed-space",
                "visualMode": "licensed-footage-space",
                "footageManifestPath": "footage-manifest.json",
                "segments": [
                    {"assetId": "nasa-big-bang-01", "onScreenText": "Một điểm sáng", "narration": "Một cảnh mở đầu hư cấu.", "durationSeconds": 2},
                    {"assetId": "commons-galaxy-01", "onScreenText": "Thiên hà chuyển động", "narration": "Một chuyển động giàu sức gợi.", "durationSeconds": 2},
                    {"assetId": "nasa-earth-01", "onScreenText": "Nhìn về Trái Đất", "narration": "Khép lại bằng góc nhìn từ quỹ đạo.", "durationSeconds": 2},
                ],
            }
            (root / "script.json").write_text(json.dumps(script, ensure_ascii=False), encoding="utf-8")
            status = LICENSED_WORKER.run(root, "script.json", "render/scenes", 720, 1280)
            self.assertEqual(status, 0)
            manifest = json.loads((root / "render/scenes/scene-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["visualMode"], "licensed-footage-space")
            self.assertTrue(manifest["externalAssetsUsed"])
            self.assertEqual(manifest["reviewState"], "needs_review")
            self.assertEqual([scene["assetId"] for scene in manifest["scenes"]], [
                "nasa-big-bang-01", "commons-galaxy-01", "nasa-earth-01"
            ])
            self.assertTrue(all(scene["mediaType"] == "video" for scene in manifest["scenes"]))
            self.assertTrue(all((root / scene["relativePath"]).is_file() for scene in manifest["scenes"]))

    def test_rejects_segment_asset_not_in_footage_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "asset.webm").write_bytes(b"\\x1a\\x45\\xdf\\xa3video")
            (root / "footage-manifest.json").write_text(json.dumps({"assets": []}), encoding="utf-8")
            script = {
                "visualMode": "licensed-footage-space",
                "footageManifestPath": "footage-manifest.json",
                "segments": [
                    {"assetId": "missing-01", "onScreenText": "Một", "narration": "Một", "durationSeconds": 1},
                    {"assetId": "missing-01", "onScreenText": "Hai", "narration": "Hai", "durationSeconds": 1},
                ],
            }
            (root / "script.json").write_text(json.dumps(script), encoding="utf-8")
            self.assertEqual(LICENSED_WORKER.run(root, "script.json", "render/scenes", 720, 1280), 1)


class LocalSpace25DWorkerTests(unittest.TestCase):
    def test_writes_moving_frame_sequence_and_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = {
                "scriptId": "script-space-25d-test",
                "visualMode": "space-25d",
                "segments": [
                    {"onScreenText": "Tâm Mặt Trời", "narration": "Một hành trình hư cấu bắt đầu từ quỹ đạo sáng.", "durationSeconds": 1},
                    {"onScreenText": "Bay qua quỹ đạo", "narration": "Con tàu nhỏ lướt qua các lớp không gian.", "durationSeconds": 1},
                ],
            }
            (root / "script.json").write_text(json.dumps(script, ensure_ascii=False), encoding="utf-8")
            status = SPACE_WORKER.run(root, "script.json", "render/scenes", 720, 1280)
            self.assertEqual(status, 0)
            manifest = json.loads((root / "render/scenes/scene-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["animationMode"], "procedural-2.5d-space")
            self.assertFalse(manifest["externalAssetsUsed"])
            self.assertEqual(manifest["frameRate"], 30)
            self.assertEqual(sum(scene["frameCount"] for scene in manifest["scenes"]), 60)
            for scene in manifest["scenes"]:
                pattern = root / scene["framePattern"]
                self.assertTrue(pattern.parent.resolve().is_relative_to(root.resolve()))
                frames = sorted(pattern.parent.glob("frame-*.png"))
                self.assertEqual(len(frames), scene["frameCount"])
                self.assertNotEqual(frames[0].read_bytes(), frames[-1].read_bytes())

    def test_rejects_unsafe_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            status = SPACE_WORKER.run(root, "../script.json", "render/scenes", 720, 1280)
            self.assertEqual(status, 1)


if __name__ == "__main__":
    unittest.main()
