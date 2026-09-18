"""Host-side deterministic checks for blender_quality_toolkit.py.

These tests deliberately do not import Blender or launch a process.
"""
from __future__ import annotations

import ast
import importlib.util
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "blender_quality_toolkit.py"


def load_module():
    spec = importlib.util.spec_from_file_location("blender_quality_toolkit", SOURCE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_constants_and_parser():
    module = load_module()
    assert module.ALLOWED_OPERATIONS == {"inspect", "setup_lookdev", "setup_camera", "preview"}
    parser = module.build_parser()
    args = parser.parse_args([
        "--operation", "inspect",
        "--workspace", ".",
        "--scene", "scene.blend",
        "--output-dir", "outputs/quality",
        "--engine", "BLENDER_EEVEE",
    ])
    assert args.operation == "inspect"
    assert args.frame_start == 1
    assert args.frame_end == 1


def test_workspace_containment():
    module = load_module()
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        safe = module.workspace_path(str(root), "outputs/report.json")
        assert safe.parent == root / "outputs"
        try:
            module.workspace_path(str(root), "../outside.json")
        except ValueError as exc:
            assert "escapes" in str(exc)
        else:
            raise AssertionError("path traversal was accepted")


def test_source_has_no_network_or_shell_surface():
    source = SOURCE.read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    imported.update({alias.name for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) for alias in node.names})
    assert not imported.intersection({"subprocess", "socket", "requests", "urllib"})
    calls = {node.func.id for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
    assert not calls.intersection({"eval", "exec", "system"})
    assert "must run inside Blender" in source


if __name__ == "__main__":
    for test in (test_constants_and_parser, test_workspace_containment, test_source_has_no_network_or_shell_surface):
        test()
    print("BLENDER_QUALITY_TOOLKIT_TESTS_PASS=3")
