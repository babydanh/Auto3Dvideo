"""Deterministic tests for the bounded Moon story render helper.

These tests intentionally do not import Blender itself or render media. They cover
only the worker's path/argument boundary; the live Blender render remains opt-in.
"""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent


def load_render_worker():
    # The helper imports bpy, but its pure path functions do not call Blender.
    # A stub keeps this test runnable under the repository's regular Python.
    sys.modules.setdefault("bpy", types.SimpleNamespace())
    spec = importlib.util.spec_from_file_location(
        "render_moon_story_animation_test_target",
        ROOT / "render_moon_story_animation.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load render_moon_story_animation.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RENDER_WORKER = load_render_worker()


class MoonStoryRenderBoundaryTests(unittest.TestCase):
    def test_safe_relative_accepts_workspace_paths(self):
        self.assertEqual(
            RENDER_WORKER.safe_relative("outputs\\moon-story-pilot\\frames"),
            Path("outputs/moon-story-pilot/frames"),
        )

    def test_safe_relative_rejects_traversal_absolute_and_uri(self):
        for value in ("../outside", "/tmp/out", "C:/outside", "https://example.invalid/out"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    RENDER_WORKER.safe_relative(value)

    def test_parse_args_requires_blend_and_frames_directory(self):
        with patch.object(sys, "argv", ["blender", "--", "scene.blend", "render/frames"]):
            source, frames = RENDER_WORKER.parse_args()
        self.assertEqual(source, Path("scene.blend"))
        self.assertEqual(frames, Path("render/frames"))

    def test_parse_args_rejects_non_blend_and_wrong_arity(self):
        with patch.object(sys, "argv", ["blender", "--", "scene.json", "render/frames"]):
            with self.assertRaises(ValueError):
                RENDER_WORKER.parse_args()
        with patch.object(sys, "argv", ["blender", "--", "scene.blend"]):
            with self.assertRaises(ValueError):
                RENDER_WORKER.parse_args()


if __name__ == "__main__":
    unittest.main()
