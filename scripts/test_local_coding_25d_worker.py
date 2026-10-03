"""Behavioural tests for the local coding 2.5D renderer worker."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

WORKER_PATH = Path(__file__).with_name("local_coding_25d_worker.py")
LESSON_PATH = Path(__file__).with_name("coding_lesson.py")
SPEC = importlib.util.spec_from_file_location("local_coding_25d_worker", WORKER_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
LESSON_SPEC = importlib.util.spec_from_file_location("coding_lesson", LESSON_PATH)
assert LESSON_SPEC and LESSON_SPEC.loader
LESSON = importlib.util.module_from_spec(LESSON_SPEC)
LESSON_SPEC.loader.exec_module(LESSON)

WIDTH, HEIGHT = 1280, 720


def state(label: str, values: list, active: list[int] | None = None, line: int | None = None,
          nodes: list[str] | None = None, edges: list[int] | None = None,
          variables: list[dict] | None = None) -> dict:
    return {
        "label": label,
        "values": values,
        "activeIndices": active or [],
        "variables": variables or [],
        "activeLine": line,
        "activeNodes": nodes or [],
        "activeEdges": edges or [],
    }


def array_segment(states: list[dict], code: list[str] | None = None) -> dict:
    return {
        "segmentId": "segment-01",
        "onScreenText": "Trace the array",
        "narration": "Walk the trace one snapshot at a time.",
        "durationSeconds": 3.0,
        "teachingScene": {
            "kind": "array",
            "code": code if code is not None else ["def solve(nums):", "    for i, v in enumerate(nums):", "        pass"],
            "nodes": [],
            "edges": [],
            "states": states,
            "note": "O(n) time, O(n) space.",
        },
    }


def architecture_segment() -> dict:
    return {
        "segmentId": "segment-01",
        "onScreenText": "Cache read",
        "narration": "Follow the request path through the cache.",
        "durationSeconds": 3.0,
        "teachingScene": {
            "kind": "architecture",
            "code": ["def read(key):", "    return cache.get(key)"],
            "nodes": [
                {"id": "api", "label": "Api", "column": 0, "row": 0},
                {"id": "cache", "label": "Cache", "column": 1, "row": 0},
                {"id": "db", "label": "Database", "column": 2, "row": 0},
            ],
            "edges": [
                {"from": "api", "to": "cache", "label": "GET"},
                {"from": "api", "to": "db", "label": "SELECT"},
            ],
            "states": [state("Read", [], nodes=["api"], edges=[0, 1])],
            "note": "Cache-aside keeps the database authoritative.",
        },
    }


class StateTimelineTests(unittest.TestCase):
    def test_every_snapshot_is_shown_and_last_frame_holds_the_final_state(self) -> None:
        segment = array_segment([
            state("first", [1, 2, 3], [0], 0),
            state("second", [1, 2, 3], [1], 1),
            state("third", [1, 2, 3], [2], 2),
            state("final", [1, 2, 3], [], 1),
        ])
        scene = MODULE.validate_render_scene(segment)
        frame_count = 90
        seen: list[int] = [MODULE.state_window(index, frame_count, len(scene["states"]))[0] for index in range(frame_count)]
        self.assertEqual(seen[0], 0)
        self.assertEqual(seen[-1], len(scene["states"]) - 1)
        self.assertEqual(sorted(set(seen)), [0, 1, 2, 3])
        self.assertEqual(seen, sorted(seen))

    def test_frame_bounds_are_enforced(self) -> None:
        with self.assertRaises(ValueError):
            MODULE.state_window(30, 30, 4)
        with self.assertRaises(ValueError):
            MODULE.state_window(0, 0, 4)
        segment = array_segment([state("only", [1], [0], 0)])
        with self.assertRaises(ValueError):
            MODULE.render_frame(WIDTH, HEIGHT, segment, 30, 30)
        image = MODULE.render_frame(WIDTH, HEIGHT, segment, 0, 30)
        self.assertEqual(image.size, (WIDTH, HEIGHT))


class SceneValidationTests(unittest.TestCase):
    def test_active_index_outside_the_array_is_rejected(self) -> None:
        segment = array_segment([state("bad", [1, 2], [5], 0)])
        with self.assertRaises(ValueError):
            MODULE.render_frame(WIDTH, HEIGHT, segment, 0, 30)

    def test_active_line_beyond_the_code_is_rejected(self) -> None:
        segment = array_segment([state("bad", [1], [0], 9)])
        with self.assertRaises(ValueError):
            MODULE.render_frame(WIDTH, HEIGHT, segment, 0, 30)

    def test_unknown_active_node_is_rejected(self) -> None:
        segment = array_segment([state("bad", [1], [0], 0, nodes=["ghost"])])
        with self.assertRaises(ValueError):
            MODULE.render_frame(WIDTH, HEIGHT, segment, 0, 30)

    def test_active_edge_beyond_the_edge_list_is_rejected(self) -> None:
        segment = array_segment([state("bad", [1], [0], 0, edges=[4])])
        with self.assertRaises(ValueError):
            MODULE.render_frame(WIDTH, HEIGHT, segment, 0, 30)

    def test_dangling_edge_reference_is_rejected(self) -> None:
        segment = architecture_segment()
        segment["teachingScene"]["edges"].append({"from": "cache", "to": "nowhere", "label": "ghost"})
        with self.assertRaises(ValueError):
            MODULE.render_frame(WIDTH, HEIGHT, segment, 0, 30)

    def test_oversized_code_is_rejected_instead_of_clipped(self) -> None:
        code = [f"# {'x' * 118}" for _ in range(14)]
        segment = array_segment([state("only", [1], [0], 0)], code=code)
        with self.assertRaises(ValueError):
            MODULE.scene_layout(WIDTH, HEIGHT, MODULE.validate_render_scene(segment))

    def test_wrapped_code_keeps_every_character(self) -> None:
        line = "result = compute(" + " + ".join(f"value_{index}" for index in range(8)) + ")"
        segment = array_segment([state("only", [1], [0], 0)], code=[line])
        layout = MODULE.scene_layout(WIDTH, HEIGHT, MODULE.validate_render_scene(segment))
        self.assertEqual("".join(text for _, text in layout.code_rows), line)

    def test_long_edge_is_routed_around_the_intermediate_node(self) -> None:
        segment = architecture_segment()
        layout = MODULE.scene_layout(WIDTH, HEIGHT, MODULE.validate_render_scene(segment))
        bypass = next(path for path in layout.edge_paths if path["edge"]["label"] == "SELECT")
        cache_box = next(box for box, node, *_ in layout.node_boxes if node["id"] == "cache")
        self.assertGreater(len(bypass["points"]), 2)
        for x, y in bypass["points"]:
            self.assertFalse(cache_box[0] < x < cache_box[2] and cache_box[1] < y < cache_box[3])


class PathSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workspace = Path(tempfile.mkdtemp(prefix="coding25d-ws-"))
        self.outside = Path(tempfile.mkdtemp(prefix="coding25d-outside-"))
        self.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        import shutil

        shutil.rmtree(self.workspace, ignore_errors=True)
        shutil.rmtree(self.outside, ignore_errors=True)

    def write_script(self, name: str = "script.json", topic: str = "two sum nums=[2,7,11,15] target=9") -> str:
        request = {"topic": topic, "briefId": "brief-test", "language": "vi-VN",
                   "requestedShotCount": 2, "requestedDurationSeconds": 2}
        script = LESSON.build_local_script(request)
        LESSON.validate_coding_script(script)
        (self.workspace / name).write_text(json.dumps(script, ensure_ascii=False), encoding="utf-8")
        return name

    def invoke(self, script: str, output: str, width: int = WIDTH, height: int = HEIGHT) -> tuple[int, dict]:
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = MODULE.run(self.workspace, script, output, width, height)
        payload = json.loads(buffer.getvalue().strip().splitlines()[-1])
        return code, payload

    def test_valid_lesson_renders_frames_and_a_scene_manifest(self) -> None:
        script = self.write_script()
        code, payload = self.invoke(script, "render")
        self.assertEqual(code, 0)
        self.assertEqual(payload["status"], "succeeded")
        self.assertFalse(payload["networkCallsMade"])
        manifest = json.loads((self.workspace / payload["sceneManifestPath"]).read_text(encoding="utf-8"))
        self.assertEqual(manifest["visualMode"], "coding-25d")
        self.assertEqual(manifest["animationMode"], "procedural-2.5d-coding")
        self.assertEqual(manifest["frameRate"], 30)
        self.assertFalse(manifest["networkCallsMade"])
        self.assertFalse(manifest["externalAssetsUsed"])
        self.assertEqual(len(manifest["scenes"]), 2)
        for scene in manifest["scenes"]:
            self.assertEqual(scene["frameRate"], 30)
            self.assertEqual(scene["width"], WIDTH)
            self.assertEqual(scene["height"], HEIGHT)
            self.assertEqual(scene["reviewState"], "needs_review")
            self.assertAlmostEqual(scene["durationSeconds"], scene["frameCount"] / 30, places=6)
            frames = sorted((self.workspace / scene["framePattern"].replace("frame-%04d.png", "")).glob("frame-*.png"))
            self.assertEqual(len(frames), scene["frameCount"])

    def test_existing_output_is_never_overwritten(self) -> None:
        script = self.write_script()
        self.assertEqual(self.invoke(script, "render")[0], 0)
        manifest = (self.workspace / "render" / "scene-manifest.json").read_text(encoding="utf-8")
        code, payload = self.invoke(script, "render")
        self.assertEqual(code, 1)
        self.assertEqual(payload["status"], "failed")
        self.assertEqual((self.workspace / "render" / "scene-manifest.json").read_text(encoding="utf-8"), manifest)

    def test_path_traversal_outside_the_workspace_is_rejected(self) -> None:
        script = self.write_script()
        with self.assertRaises(ValueError):
            MODULE.contained_path(self.workspace, f"../{self.outside.name}/render", "outputDir")

    def test_symlinked_output_outside_the_workspace_is_rejected(self) -> None:
        link = self.workspace / "linked"
        try:
            os.symlink(self.outside, link, target_is_directory=True)
        except (OSError, NotImplementedError, AttributeError) as error:  # pragma: no cover - platform policy
            self.skipTest(f"symlink not permitted here: {error}")
        script = self.write_script()
        code, payload = self.invoke(script, "linked/render")
        self.assertEqual(code, 1)
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(list(self.outside.iterdir()), [])

    def test_unsupported_output_size_is_rejected(self) -> None:
        script = self.write_script()
        code, payload = self.invoke(script, "small", 640, 480)
        self.assertEqual(code, 1)
        self.assertEqual(payload["status"], "failed")
        self.assertFalse((self.workspace / "small").exists())

    def test_non_coding_script_is_rejected(self) -> None:
        (self.workspace / "legacy.json").write_text(json.dumps({
            "schemaVersion": "1.0.0", "scriptId": "script-x", "briefId": "brief-x", "language": "vi-VN",
            "title": "Legacy", "hook": "hook", "segments": [], "approvalStatus": "pending",
            "visualMode": "space-25d", "totalDurationSeconds": 4,
        }), encoding="utf-8")
        code, payload = self.invoke("legacy.json", "legacy-out")
        self.assertEqual(code, 1)
        self.assertEqual(payload["status"], "failed")


if __name__ == "__main__":
    unittest.main()
