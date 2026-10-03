"""Deterministic 2.5D teaching-scene renderer for coding lessons.

The worker turns a validated coding script (see ``coding_lesson.validate_coding_script``)
into an original Pillow frame sequence: a readable code panel with a moving line highlight,
extruded array blocks with indices and an active lift, a variables/hash-map strip, architecture
nodes with directed flowing packets, a semantic state label, caption and note.

Every pixel is procedural and derived from the snapshot data. User code is displayed as text and
is never executed. There is no subprocess, no network access and no credential read.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, NamedTuple

HELPER_FILENAME = "coding_lesson.py"

FPS = 30
ANIMATION_MODE = "procedural-2.5d-coding"
VISUAL_MODE = "coding-25d"
DEFAULT_SIZE = (1280, 720)
ALLOWED_SIZES = {(1280, 720), (1920, 1080), (720, 1280)}
MAX_REQUEST_BYTES = 512 * 1024
MAX_SEGMENTS = 12
MIN_SEGMENT_SECONDS = 1.0
MAX_SEGMENT_SECONDS = 30.0
MAX_SEGMENT_FRAMES = MAX_SEGMENT_SECONDS * FPS
MAX_TOTAL_SECONDS = 180.0
MAX_TOTAL_FRAMES = 5400
MAX_CODE_LINES = 14
MAX_CODE_CHARS = 120
MAX_STATES = 16
MIN_CODE_FONT = 10
MAX_CODE_FONT = 20
MIN_VALUE_FONT = 9
MAX_VALUE_FONT = 24
TRANSITION_FRAMES = 8.0

# Single source of truth for every colour. Drawing code only references these tokens.
PALETTE: dict[str, tuple[int, int, int]] = {
    "bg.top": (11, 18, 38),
    "bg.bottom": (4, 7, 17),
    "bg.floor": (24, 44, 80),
    "bg.glow": (46, 92, 148),
    "bg.grid": (26, 40, 70),
    "panel.fill": (13, 21, 42),
    "panel.edge": (52, 80, 130),
    "panel.shadow": (1, 2, 8),
    "text.primary": (233, 241, 253),
    "text.muted": (152, 174, 206),
    "text.faint": (104, 124, 158),
    "accent": (94, 226, 210),
    "accent.warm": (232, 170, 90),
    "accent.hot": (238, 124, 108),
    "code.bg": (8, 14, 29),
    "code.row": (16, 26, 48),
    "code.text": (208, 223, 245),
    "code.gutter": (98, 122, 160),
    "code.guide": (26, 40, 68),
    "code.active.bg": (23, 57, 83),
    "code.active.text": (247, 251, 255),
    "code.active.bar": (94, 226, 210),
    "array.top": (40, 61, 101),
    "array.side": (19, 31, 58),
    "array.edge": (88, 126, 178),
    "array.active.top": (112, 216, 192),
    "array.active.side": (30, 99, 96),
    "array.active.edge": (228, 253, 246),
    "array.index": (142, 166, 202),
    "array.floor": (15, 25, 45),
    "node.top": (46, 69, 112),
    "node.side": (22, 36, 67),
    "node.edge": (98, 134, 188),
    "node.active.top": (233, 180, 98),
    "node.active.side": (131, 86, 34),
    "node.active.edge": (255, 233, 189),
    "node.label": (228, 239, 253),
    "edge.line": (92, 120, 168),
    "edge.active.line": (94, 226, 210),
    "edge.label": (170, 192, 222),
    "packet.fill": (255, 240, 200),
    "packet.active": (156, 246, 228),
    "packet.trail": (74, 142, 192),
    "state.label": (250, 252, 255),
    "state.flow": (150, 226, 214),
    "chip.fill": (19, 32, 58),
    "chip.edge": (60, 90, 142),
    "chip.changed": (94, 226, 210),
    "chip.name": (148, 178, 216),
    "chip.value": (237, 245, 255),
    "note.text": (164, 186, 216),
    "node.active.label": (36, 25, 8),
    "caption.text": (228, 238, 251),
    "badge.fill": (25, 42, 76),
    "badge.edge": (74, 110, 170),
    "badge.text": (170, 204, 242),
    "progress.track": (27, 42, 70),
    "progress.fill": (94, 226, 210),
    "progress.past": (46, 92, 122),
    "card.fill": (15, 26, 51),
    "card.edge": (88, 118, 172),
    "placeholder": (92, 114, 150),
}

_FONT_CACHE: dict[tuple[int, bool, bool], Any] = {}
_BACKGROUND_CACHE: dict[tuple[int, int], Any] = {}
_LAYOUT_CACHE: dict[tuple[Any, ...], "SceneLayout"] = {}
_METRIC_DRAW: Any = None


def emit(payload: dict[str, Any]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if payload.get("status") == "succeeded" else 1


# --------------------------------------------------------------------------------------
# colour and font primitives
# --------------------------------------------------------------------------------------


def mix(first: str | tuple[int, int, int], second: str | tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    start = PALETTE[first] if isinstance(first, str) else first
    end = PALETTE[second] if isinstance(second, str) else second
    ratio = min(1.0, max(0.0, amount))
    return tuple(int(round(a + (b - a) * ratio)) for a, b in zip(start, end))


def tint(amount: float, token: str) -> tuple[int, int, int, int]:
    red, green, blue = PALETTE[token]
    return (red, green, blue, max(0, min(255, int(round(amount * 255)))))


def metric_draw() -> Any:
    global _METRIC_DRAW
    if _METRIC_DRAW is None:
        from PIL import Image, ImageDraw  # type: ignore[import-not-found]

        _METRIC_DRAW = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    return _METRIC_DRAW


def font_candidates(size: int, bold: bool, mono: bool) -> list[Path]:
    windows = Path(r"C:\Windows\Fonts")
    if mono:
        names = ("consolab.ttf", "consola.ttf", "cour.ttf", "lucon.ttf")
    elif bold:
        names = ("segoeuib.ttf", "arialbd.ttf", "segoeui.ttf", "arial.ttf")
    else:
        names = ("segoeui.ttf", "arial.ttf", "segoeuib.ttf", "arialbd.ttf")
    linux = Path("/usr/share/fonts/truetype/dejavu") / (
        "DejaVuSansMono-Bold.ttf" if mono and bold else "DejaVuSansMono.ttf" if mono else
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    )
    return [windows / name for name in names] + [linux]


def load_font(size: int, bold: bool = False, mono: bool = False) -> Any:
    key = (max(6, int(size)), bool(bold), bool(mono))
    cached = _FONT_CACHE.get(key)
    if cached is not None:
        return cached
    from PIL import ImageFont  # type: ignore[import-not-found]

    font: Any = None
    for candidate in font_candidates(*key):
        if candidate.is_file():
            try:
                font = ImageFont.truetype(str(candidate), size=key[0])
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


def text_size(draw: Any, text: str, font: Any) -> tuple[int, int]:
    if not text:
        return (0, 0)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    return (right - left, bottom - top)


def draw_text(draw: Any, x: float, y: float, text: str, font: Any, fill: Any, align: str = "left", valign: str = "top") -> int:
    if not text:
        return int(y)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    width, height = right - left, bottom - top
    if align == "center":
        x -= width / 2
    elif align == "right":
        x -= width
    if valign == "middle":
        y -= height / 2
    elif valign == "bottom":
        y -= height
    draw.text((x - left, y - top), text, font=font, fill=fill)
    return int(y + height)


def wrap_text(draw: Any, text: str, font: Any, max_width: int, max_lines: int) -> list[str]:
    """Greedy word wrap; a single line is marked with an ellipsis when lines run out."""
    rows: list[str] = []
    for paragraph in str(text).split("\n"):
        current = ""
        for word in paragraph.split(" "):
            if not word:
                continue
            while len(word) > 1 and text_size(draw, word, font)[0] > max_width:
                cut = len(word) - 1
                while cut > 1 and text_size(draw, word[:cut], font)[0] > max_width:
                    cut -= 1
                if current:
                    rows.append(current)
                    current = ""
                rows.append(word[:cut])
                word = word[cut:]
            candidate = f"{current} {word}".strip()
            if current and text_size(draw, candidate, font)[0] > max_width:
                rows.append(current)
                current = word
            else:
                current = candidate
        rows.append(current)
    rows = [row for row in rows if row] or [""]
    if len(rows) > max_lines:
        rows = rows[:max_lines]
        rows[-1] = rows[-1].rstrip() + "…"
    return rows


def clip_text(draw: Any, text: str, font: Any, max_width: int) -> str:
    if text_size(draw, text, font)[0] <= max_width:
        return text
    trimmed = text
    while trimmed and text_size(draw, trimmed + "…", font)[0] > max_width:
        trimmed = trimmed[:-1]
    return (trimmed.rstrip() + "…") if trimmed else ""


def wrap_code_line(line: str, columns: int) -> list[str]:
    """Split one code line so that joining the parts reproduces the line exactly."""
    if columns < 8:
        raise ValueError("khung code quá hẹp để hiển thị chữ")
    if not line:
        return [""]
    rows: list[str] = []
    rest = line
    while len(rest) > columns:
        cut = rest.rfind(" ", 0, columns + 1)
        if cut <= 0:
            cut = columns
        rows.append(rest[:cut])
        rest = rest[cut:]
        if not rest.strip(" "):
            rest = ""
    rows.append(rest)
    return rows


def ease_in_out(amount: float) -> float:
    value = min(1.0, max(0.0, amount))
    return value * value * (3.0 - 2.0 * value)


def ease_out(amount: float) -> float:
    value = min(1.0, max(0.0, amount))
    return 1.0 - (1.0 - value) ** 3


# --------------------------------------------------------------------------------------
# scene validation used by the public render entry point
# --------------------------------------------------------------------------------------

SCENE_KINDS = {"array", "architecture", "code", "summary"}


def _integer(value: Any, low: int, high: int, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{field} nằm ngoài {low}..{high}")
    return value


def _text(value: Any, field: str, maximum: int, minimum: int = 0) -> str:
    if not isinstance(value, str) or not minimum <= len(value) <= maximum or "\0" in value:
        raise ValueError(f"{field} không hợp lệ")
    return value


def validate_render_scene(segment: Any) -> dict[str, Any]:
    """Normalise one segment into drawing data and reject malformed snapshot state."""
    if not isinstance(segment, dict):
        raise ValueError("segment không phải object")
    scene = segment.get("teachingScene")
    if not isinstance(scene, dict):
        raise ValueError("segment thiếu teachingScene")
    kind = scene.get("kind")
    if kind not in SCENE_KINDS:
        raise ValueError("teachingScene.kind không hợp lệ")

    code_raw = scene.get("code")
    if not isinstance(code_raw, list) or len(code_raw) > MAX_CODE_LINES:
        raise ValueError("teachingScene.code vượt 14 dòng")
    code: list[str] = []
    for line in code_raw:
        text = _text(line, "code line", MAX_CODE_CHARS)
        if "\n" in text or "\r" in text:
            raise ValueError("code line phải là một dòng")
        code.append(text)

    nodes: list[dict[str, Any]] = []
    node_ids: set[str] = set()
    cells: set[tuple[int, int]] = set()
    nodes_raw = scene.get("nodes")
    if not isinstance(nodes_raw, list) or len(nodes_raw) > 12:
        raise ValueError("teachingScene.nodes vượt 12 phần tử")
    for node in nodes_raw:
        if not isinstance(node, dict):
            raise ValueError("node không phải object")
        node_id = _text(node.get("id"), "node.id", 40, 1)
        label = _text(node.get("label"), "node.label", 48, 1)
        cell = (_integer(node.get("column"), 0, 3, "node.column"),
                _integer(node.get("row"), 0, 2, "node.row"))
        if node_id in node_ids or cell in cells:
            raise ValueError("node id hoặc ô bố trí bị trùng")
        node_ids.add(node_id)
        cells.add(cell)
        nodes.append({"id": node_id, "label": label, "column": cell[0], "row": cell[1]})

    edges_raw = scene.get("edges")
    if not isinstance(edges_raw, list) or len(edges_raw) > 24:
        raise ValueError("teachingScene.edges vượt 24 phần tử")
    edges: list[dict[str, str]] = []
    for edge in edges_raw:
        if not isinstance(edge, dict):
            raise ValueError("edge không phải object")
        source = _text(edge.get("from"), "edge.from", 40, 1)
        target = _text(edge.get("to"), "edge.to", 40, 1)
        if source not in node_ids or target not in node_ids:
            raise ValueError("edge trỏ tới node không tồn tại")
        edges.append({"from": source, "to": target, "label": _text(edge.get("label"), "edge.label", 48)})

    states_raw = scene.get("states")
    if not isinstance(states_raw, list) or not 1 <= len(states_raw) <= MAX_STATES:
        raise ValueError("teachingScene.states phải có 1..16 snapshot")
    states: list[dict[str, Any]] = []
    for state in states_raw:
        if not isinstance(state, dict):
            raise ValueError("state không phải object")
        values_raw = state.get("values")
        if not isinstance(values_raw, list) or len(values_raw) > 16:
            raise ValueError("state.values vượt 16 phần tử")
        values: list[str] = []
        for value in values_raw:
            if isinstance(value, str):
                values.append(_text(value, "state.value", 1, 1))
            else:
                _integer(value, -10**9, 10**9, "state.value")
                values.append(str(value))
        active_indices: list[int] = []
        indices_raw = state.get("activeIndices")
        if not isinstance(indices_raw, list) or len(indices_raw) > 16:
            raise ValueError("state.activeIndices không hợp lệ")
        for index in indices_raw:
            if not values:
                raise ValueError("state.activeIndices tham chiếu mảng rỗng")
            active_indices.append(_integer(index, 0, len(values) - 1, "state.activeIndex"))
        variables: list[tuple[str, str]] = []
        variables_raw = state.get("variables")
        if not isinstance(variables_raw, list) or len(variables_raw) > 6:
            raise ValueError("state.variables vượt 6 phần tử")
        for variable in variables_raw:
            if not isinstance(variable, dict):
                raise ValueError("variable không phải object")
            variables.append((_text(variable.get("name"), "variable.name", 24, 1),
                              _text(variable.get("value"), "variable.value", 180)))
        active_line_raw = state.get("activeLine")
        active_line: int | None = None
        if active_line_raw is not None:
            if not code:
                raise ValueError("state.activeLine tham chiếu danh sách code rỗng")
            active_line = _integer(active_line_raw, 0, len(code) - 1, "state.activeLine")
        active_nodes: list[str] = []
        nodes_active_raw = state.get("activeNodes")
        if not isinstance(nodes_active_raw, list) or len(nodes_active_raw) > 12:
            raise ValueError("state.activeNodes không hợp lệ")
        for node_id in nodes_active_raw:
            if not isinstance(node_id, str) or node_id not in node_ids:
                raise ValueError("state.activeNodes tham chiếu node không tồn tại")
            active_nodes.append(node_id)
        active_edges: list[int] = []
        edges_active_raw = state.get("activeEdges")
        if not isinstance(edges_active_raw, list) or len(edges_active_raw) > 24:
            raise ValueError("state.activeEdges không hợp lệ")
        for edge_index in edges_active_raw:
            if not edges:
                raise ValueError("state.activeEdges tham chiếu danh sách edge rỗng")
            active_edges.append(_integer(edge_index, 0, len(edges) - 1, "state.activeEdge"))
        states.append({
            "label": _text(state.get("label"), "state.label", 180, 1),
            "values": values,
            "activeIndices": active_indices,
            "variables": variables,
            "activeLine": active_line,
            "activeNodes": active_nodes,
            "activeEdges": active_edges,
        })

    return {
        "segmentId": _text(segment.get("segmentId", "segment"), "segmentId", 64, 1),
        "kind": kind,
        "code": code,
        "nodes": nodes,
        "edges": edges,
        "states": states,
        "note": _text(scene.get("note", ""), "scene.note", 400),
        "caption": _text(segment.get("onScreenText", ""), "onScreenText", 180),
        "narration": _text(segment.get("narration", ""), "narration", 1200),
    }


# --------------------------------------------------------------------------------------
# deterministic state timeline
# --------------------------------------------------------------------------------------


def state_window(frame_index: int, frame_count: int, state_count: int) -> tuple[int, float]:
    """Return (snapshot index, local progress) so the first and last snapshot are both shown."""
    if state_count < 1:
        raise ValueError("cần ít nhất một snapshot")
    if frame_count < 1:
        raise ValueError("frame_count phải >= 1")
    if not 0 <= frame_index < frame_count:
        raise ValueError("frame_index nằm ngoài frame_count")
    if state_count == 1 or frame_count == 1:
        return (0, 1.0)
    span = frame_count / state_count
    index = min(state_count - 1, int(frame_index / span))
    local = (frame_index - index * span) / span
    return (index, min(1.0, max(0.0, local)))


def transition_fraction(frame_count: int, state_count: int) -> float:
    frames_per_state = frame_count / max(1, state_count)
    return min(0.5, max(0.15, TRANSITION_FRAMES / max(1.0, frames_per_state)))


# --------------------------------------------------------------------------------------
# layout
# --------------------------------------------------------------------------------------


class Rect(NamedTuple):
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return max(0, self.right - self.left)

    @property
    def height(self) -> int:
        return max(0, self.bottom - self.top)

    @property
    def box(self) -> tuple[int, int, int, int]:
        return (self.left, self.top, self.right, self.bottom)


class SceneLayout:
    """Resolved geometry for one teaching scene; built once and cached across frames."""

    __slots__ = (
        "width", "height", "scale", "radius", "kind", "top_rect", "code_rect", "stage_rect", "band_rect",
        "code_rows", "code_line_height", "code_gutter", "code_header", "line_tops", "line_heights",
        "value_font", "cell_width", "block_height", "index_height", "node_boxes", "edge_paths",
        "label_height", "caption_rows", "narration_rows", "note_rows", "label_rows",
    )

    def __init__(self, **fields: Any) -> None:
        for name, value in fields.items():
            setattr(self, name, value)


def layout_key(width: int, height: int, scene: dict[str, Any]) -> tuple[Any, ...]:
    return (
        width, height, scene["kind"], tuple(scene["code"]),
        tuple((node["id"], node["label"], node["column"], node["row"]) for node in scene["nodes"]),
        tuple((edge["from"], edge["to"], edge["label"]) for edge in scene["edges"]),
        tuple(tuple(state["values"]) for state in scene["states"]),
        tuple(state["label"] for state in scene["states"]),
        scene["caption"], scene["narration"], scene["note"],
    )


def _code_rows(code: list[str], inner_width: int, inner_height: int) -> tuple[int, list[tuple[int, str]]]:
    draw = metric_draw()
    for size in range(MAX_CODE_FONT, MIN_CODE_FONT - 1, -1):
        font = load_font(size, mono=True)
        advance = max(1.0, text_size(draw, "0" * 10, font)[0] / 10.0)
        columns = int(inner_width / advance)
        line_height = int(round(size * 1.42))
        rows: list[tuple[int, str]] = []
        for line_index, line in enumerate(code):
            for part in wrap_code_line(line, columns):
                rows.append((line_index, part))
        if len(rows) * line_height <= inner_height:
            return (size, rows)
    longest = max((len(line) for line in code), default=0)
    raise ValueError(
        f"code {len(code)} dòng x {longest} ký tự không vừa khung đọc được ở kích thước này; cần rút gọn mã"
    )


def _clip_to_box(center: tuple[float, float], direction: tuple[float, float], half_w: float, half_h: float) -> tuple[float, float]:
    dx, dy = direction
    limit = math.inf
    if abs(dx) > 1e-6:
        limit = min(limit, half_w / abs(dx))
    if abs(dy) > 1e-6:
        limit = min(limit, half_h / abs(dy))
    if limit is math.inf:
        return center
    return (center[0] + dx * limit, center[1] + dy * limit)


def _segment_hits_rect(start: tuple[float, float], end: tuple[float, float], rect: tuple[int, int, int, int]) -> bool:
    """Liang-Barsky test: does the straight edge cross a node box it must stay clear of?"""
    dx, dy = end[0] - start[0], end[1] - start[1]
    low, high = 0.0, 1.0
    for p, q in ((-dx, start[0] - rect[0]), (dx, rect[2] - start[0]), (-dy, start[1] - rect[1]), (dy, rect[3] - start[1])):
        if abs(p) < 1e-9:
            if q < 0:
                return False
            continue
        ratio = q / p
        if p < 0:
            if ratio > high:
                return False
            low = max(low, ratio)
        else:
            if ratio < low:
                return False
            high = min(high, ratio)
    return low <= high


def _cumulative_lengths(points: list[tuple[float, float]]) -> list[float]:
    lengths = [0.0]
    for index in range(1, len(points)):
        lengths.append(lengths[-1] + math.hypot(points[index][0] - points[index - 1][0],
                                                 points[index][1] - points[index - 1][1]))
    return lengths


def _point_at(points: list[tuple[float, float]], cumulative: list[float], total: float, amount: float) -> tuple[float, float]:
    target = (amount % 1.0) * total
    for index in range(1, len(points)):
        if cumulative[index] >= target:
            span = cumulative[index] - cumulative[index - 1]
            ratio = 0.0 if span <= 0 else (target - cumulative[index - 1]) / span
            return (points[index - 1][0] + (points[index][0] - points[index - 1][0]) * ratio,
                    points[index - 1][1] + (points[index][1] - points[index - 1][1]) * ratio)
    return points[-1]


def _node_font(draw: Any, label: str, box_w: int, box_h: int) -> Any:
    for size in range(18, 8, -1):
        font = load_font(size, bold=True)
        rows = wrap_text(draw, label, font, box_w - 12, 3)
        fits = all(text_size(draw, row, font)[0] <= box_w - 12 and text_size(draw, row, font)[1] <= box_h - 10
                   for row in rows)
        if len(rows) <= 3 and fits:
            return font
    return load_font(9, bold=True)


def scene_layout(width: int, height: int, scene: dict[str, Any]) -> SceneLayout:
    key = layout_key(width, height, scene)
    cached = _LAYOUT_CACHE.get(key)
    if cached is not None:
        return cached

    scale = min(width, height) / 720.0
    margin = int(round(28 * scale))
    gap = int(round(16 * scale))
    radius = max(8, int(round(16 * scale)))
    portrait = height > width
    top_height = int(round(180 * scale)) if portrait else int(round(128 * scale))
    band_height = int(round(152 * scale)) if portrait else int(round(120 * scale))
    content_bottom = height - band_height - gap
    show_code = bool(scene["code"]) and scene["kind"] in {"array", "architecture", "code"}
    full_content = Rect(margin, top_height, width - margin, content_bottom)
    if not show_code:
        code_rect: Rect | None = None
        stage_rect = full_content
    elif scene["kind"] == "code":
        code_rect = full_content
        stage_rect = full_content
    elif portrait:
        code_height = int(round((content_bottom - top_height) * 0.52))
        code_rect = Rect(margin, top_height, width - margin, top_height + code_height)
        stage_rect = Rect(margin, top_height + code_height + gap, width - margin, content_bottom)
    else:
        code_width = int(round((width - margin * 2 - gap) * 0.46))
        code_rect = Rect(margin, top_height, margin + code_width, content_bottom)
        stage_rect = Rect(code_rect.right + gap, top_height, width - margin, content_bottom)
    band_rect = Rect(margin, content_bottom + gap, width - margin, height - margin)

    metrics = metric_draw()
    label_font = load_font(max(13, int(round(22 * scale))), bold=True)
    label_width = stage_rect.width - 8
    label_rows = tuple(tuple(wrap_text(metrics, state["label"], label_font, label_width, 2)) for state in scene["states"])
    label_lines = max(len(rows) for rows in label_rows)
    label_height = label_lines * int(round(25 * scale)) + int(round(8 * scale))
    label_height += int(round(26 * scale)) if scene["edges"] else 0
    caption_rows = tuple(wrap_text(metrics, scene["caption"], load_font(max(13, int(round(20 * scale)))),
                                 width - margin * 2, 2)) if scene["caption"] else ()
    narration_rows = tuple(wrap_text(metrics, scene["narration"], load_font(max(10, int(round(14 * scale)))),
                                    width - margin * 2, 2)) if scene["narration"] else ()
    note_rows = tuple(wrap_text(metrics, scene["note"], load_font(max(10, int(round(14 * scale)))),
                                width - margin * 2, 3)) if scene["note"] else ()

    code_rows: tuple[tuple[int, str], ...] = ()
    code_line_height = 0
    code_gutter = int(round(34 * scale))
    code_header = int(round(26 * scale))
    line_tops: tuple[int, ...] = ()
    line_heights: tuple[int, ...] = ()
    if code_rect is not None:
        inner_width = code_rect.width - 2 * int(round(14 * scale)) - code_gutter
        inner_height = code_rect.height - 2 * int(round(12 * scale)) - code_header
        size, rows = _code_rows(scene["code"], inner_width, inner_height)
        code_rows = tuple(rows)
        code_line_height = int(round(size * 1.42))
        tops = [0] * len(scene["code"])
        heights = [1] * len(scene["code"])
        for line_index in range(len(scene["code"])):
            positions = [position for position, (row_index, _) in enumerate(code_rows) if row_index == line_index]
            if positions:
                tops[line_index] = positions[0]
                heights[line_index] = len(positions)
        line_tops = tuple(tops)
        line_heights = tuple(heights)

    stage_pad = int(round(12 * scale))
    content_rect = Rect(stage_rect.left + stage_pad, stage_rect.top + label_height + stage_pad,
                        stage_rect.right - stage_pad, stage_rect.bottom - stage_pad)
    values = [value for state in scene["states"] for value in state["values"]]
    longest = max((len(value) for value in values), default=1)
    value_font = load_font(MIN_VALUE_FONT, bold=True)
    cell_width = 0
    for size in range(MAX_VALUE_FONT, MIN_VALUE_FONT - 1, -1):
        font = load_font(size, bold=True)
        needed = text_size(metric_draw(), "0" * longest, font)[0] + int(round(18 * scale))
        columns = max(1, content_rect.width // max(1, needed))
        if scene["kind"] in {"array", "summary"} or not values:
            value_font = font
            cell_width = min(content_rect.width // columns, int(round(190 * scale)))
            break
    if not cell_width:
        columns = max(1, content_rect.width // max(1, text_size(metric_draw(), "0" * longest, value_font)[0] + int(round(18 * scale))))
        value_font = load_font(MIN_VALUE_FONT, bold=True)
        cell_width = min(content_rect.width // columns, int(round(190 * scale)))
    cell_width = max(int(round(34 * scale)), cell_width)
    index_height = int(round(20 * scale))
    rows_needed = max(1, math.ceil(max(1, len(values)) / max(1, content_rect.width // cell_width)))
    free_height = content_rect.height - rows_needed * index_height - (rows_needed - 1) * int(round(14 * scale))
    block_height = max(int(round(28 * scale)), min(int(round(150 * scale)), int(free_height / max(1, rows_needed))))

    node_boxes: list[tuple[tuple[int, int, int, int], dict[str, Any], Any, tuple[str, ...], int]] = []
    edge_paths: list[dict[str, Any]] = []
    if scene["nodes"]:
        columns = max(node["column"] for node in scene["nodes"]) + 1
        rows = max(node["row"] for node in scene["nodes"]) + 1
        column_width = content_rect.width / columns
        row_height = content_rect.height / rows
        box_w = int(min(column_width * 0.62, 260 * scale))
        box_h = int(min(row_height * 0.55, 132 * scale))
        grid_w = box_w * columns + gap * (columns - 1)
        grid_h = box_h * rows + gap * (rows - 1)
        origin_x = content_rect.left + (content_rect.width - grid_w) / 2
        origin_y = content_rect.top + (content_rect.height - grid_h) / 2
        centers: dict[str, tuple[float, float]] = {}
        for node in scene["nodes"]:
            left = int(round(origin_x + node["column"] * (box_w + gap)))
            top = int(round(origin_y + node["row"] * (box_h + gap)))
            box = (left, top, left + box_w, top + box_h)
            font = _node_font(metrics, node["label"], box_w, box_h)
            rows = tuple(wrap_text(metrics, node["label"], font, box_w - 12, 3))
            node_boxes.append((box, node, font, rows, text_size(metrics, "Ag", font)[1] + 3))
            centers[node["id"]] = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        lane_gap = int(round(26 * scale))
        lane_above = min(box[1] for box, _, _, _, _ in node_boxes) - lane_gap
        lane_below = max(box[3] for box, _, _, _, _ in node_boxes) + lane_gap
        for edge_index, edge in enumerate(scene["edges"]):
            start_center, end_center = centers[edge["from"]], centers[edge["to"]]
            dx, dy = end_center[0] - start_center[0], end_center[1] - start_center[1]
            length = math.hypot(dx, dy) or 1.0
            direction = (dx / length, dy / length)
            start = _clip_to_box(start_center, direction, box_w / 2, box_h / 2)
            end = _clip_to_box(end_center, (-direction[0], -direction[1]), box_w / 2, box_h / 2)
            points = [start, end]
            blockers = [box for box, node, _, _, _ in node_boxes if node["id"] not in {edge["from"], edge["to"]}]
            if any(_segment_hits_rect(start, end, blocker) for blocker in blockers):
                lane_y = lane_above if lane_above >= content_rect.top else lane_below
                if content_rect.top <= lane_y <= content_rect.bottom and abs(start[0] - end[0]) > 1:
                    points = [start, (start[0], lane_y), (end[0], lane_y), end]
            edge_paths.append({"index": edge_index, "edge": edge, "points": points,
                               "cumulative": _cumulative_lengths(points),
                               "total": sum(_cumulative_lengths(points)) or 1.0})

    layout = SceneLayout(
        width=width, height=height, scale=scale, radius=radius, kind=scene["kind"],
        top_rect=Rect(margin, 0, width - margin, top_height - gap // 2),
        code_rect=code_rect, stage_rect=stage_rect, band_rect=band_rect,
        code_rows=code_rows, code_line_height=code_line_height, code_gutter=code_gutter,
        code_header=code_header, line_tops=line_tops, line_heights=line_heights,
        value_font=value_font, cell_width=cell_width,
        block_height=block_height, index_height=index_height,
        node_boxes=tuple(node_boxes), edge_paths=tuple(edge_paths), label_height=label_height,
        caption_rows=caption_rows, narration_rows=narration_rows, note_rows=note_rows, label_rows=label_rows,
    )
    if len(_LAYOUT_CACHE) > 64:
        _LAYOUT_CACHE.clear()
    _LAYOUT_CACHE[key] = layout
    return layout


# --------------------------------------------------------------------------------------
# background and panel primitives
# --------------------------------------------------------------------------------------


def background_image(width: int, height: int) -> Any:
    cached = _BACKGROUND_CACHE.get((width, height))
    if cached is None:
        from PIL import Image, ImageDraw  # type: ignore[import-not-found]

        image = Image.new("RGB", (width, height), PALETTE["bg.bottom"])
        draw = ImageDraw.Draw(image, "RGBA")
        for y in range(height):
            draw.line((0, y, width, y), fill=mix("bg.top", "bg.bottom", y / max(1, height - 1)) + (255,))
        step = max(28, int(min(width, height) / 20))
        for x in range(0, width + step, step):
            draw.line((x, 0, x, height), fill=(*PALETTE["bg.grid"], 26))
        for y in range(0, height + step, step):
            draw.line((0, y, width, y), fill=(*PALETTE["bg.grid"], 26))
        horizon = int(height * 0.62)
        draw.polygon([(0, horizon), (width, horizon), (int(width * 1.25), height), (int(-width * 0.25), height)],
                     fill=(*PALETTE["bg.floor"], 22))
        for center_x, center_y, radius, strength in (
            (int(width * 0.18), int(height * 0.24), int(min(width, height) * 0.40), 0.10),
            (int(width * 0.84), int(height * 0.80), int(min(width, height) * 0.46), 0.08),
            (int(width * 0.66), int(height * 0.10), int(min(width, height) * 0.26), 0.06),
        ):
            for step_no in range(8, 0, -1):
                current = int(radius * step_no / 8)
                draw.ellipse((center_x - current, center_y - current, center_x + current, center_y + current),
                             fill=(*PALETTE["bg.glow"], int(10 * strength * 8 / step_no)))
        for offset in range(0, int(min(width, height) * 0.3), 6):
            shade = (*PALETTE["bg.bottom"], max(0, 70 - offset))
            draw.line((offset, 0, offset, height), fill=shade)
            draw.line((0, offset, width, offset), fill=shade)
            draw.line((width - offset, 0, width - offset, height), fill=shade)
            draw.line((0, height - offset, width, height - offset), fill=shade)
        _BACKGROUND_CACHE[(width, height)] = image
        cached = image
    return cached.copy()


def panel(draw: Any, rect: Rect, radius: int, fill: str, edge: str, fill_amount: float = 0.9,
          edge_amount: float = 0.75, edge_width: int = 2, shadow: bool = True) -> None:
    if shadow:
        draw.rounded_rectangle((rect.left + 5, rect.top + 7, rect.right + 5, rect.bottom + 7), radius=radius,
                               fill=tint(0.45, "panel.shadow"))
    draw.rounded_rectangle(rect.box, radius=radius, fill=tint(fill_amount, fill),
                           outline=tint(edge_amount, edge), width=edge_width)


def slab(draw: Any, box: tuple[int, int, int, int], lift: int, top: str, side: str, edge: str,
         depth: tuple[int, int], radius: int, top_amount: float = 1.0, edge_amount: float = 0.9,
         shadow_height: int = 6) -> None:
    left, top_y, right, bottom = box
    offset_x, offset_y = depth
    shifted = (left + offset_x, top_y + lift + offset_y, right + offset_x, bottom + lift + offset_y)
    inset = (right - left) * 0.18
    draw.ellipse((left + offset_x + inset, shifted[3] - shadow_height // 2,
                  right + offset_x - inset, shifted[3] + shadow_height), fill=tint(0.26, "panel.shadow"))
    draw.rounded_rectangle(shifted, radius=radius, fill=mix(side, "bg.bottom", 0.25) + (255,))
    draw.rounded_rectangle((left, top_y + lift, right, bottom + lift), radius=radius,
                           fill=PALETTE[top] + (int(255 * top_amount),),
                           outline=tint(edge_amount, edge), width=2)


# --------------------------------------------------------------------------------------
# frame composition
# --------------------------------------------------------------------------------------


def _draw_top_bar(draw: Any, layout: SceneLayout, scene: dict[str, Any], state_index: int, frame_index: int,
                  frame_count: int) -> None:
    rect = layout.top_rect
    scale = layout.scale
    badge_font = load_font(max(11, int(round(15 * scale))), bold=True)
    caption_font = load_font(max(13, int(round(20 * scale))))
    badge = f"CODING 2.5D · {scene['kind'].upper()}"
    badge_w = text_size(draw, badge, badge_font)[0] + 20
    draw.rounded_rectangle((rect.left, rect.top + int(round(6 * scale)), rect.left + badge_w,
                            rect.top + int(round(6 * scale)) + int(round(22 * scale))),
                           radius=int(round(8 * scale)), fill=tint(0.9, "badge.fill"), outline=tint(0.7, "badge.edge"), width=1)
    draw_text(draw, rect.left + 10, rect.top + int(round(10 * scale)), badge, badge_font, tint(1.0, "badge.text"))
    counter = f"state {state_index + 1}/{len(scene['states'])}"
    draw_text(draw, rect.right, rect.top + int(round(10 * scale)), counter, badge_font, tint(0.9, "text.muted"), align="right")

    state_count = len(scene["states"])
    dot = max(4, int(round(6 * scale)))
    gap_dot = int(round(5 * scale))
    total_dots = state_count * dot + (state_count - 1) * gap_dot
    dot_x = rect.right - total_dots
    dot_y = rect.top + int(round(40 * scale))
    for index in range(state_count):
        if index < state_index:
            fill = tint(0.9, "progress.past")
        elif index == state_index:
            fill = tint(1.0, "progress.fill")
        else:
            fill = tint(0.9, "progress.track")
        draw.ellipse((dot_x, dot_y, dot_x + dot, dot_y + dot), fill=fill)
        dot_x += dot + gap_dot

    bar_y = rect.bottom - int(round(4 * scale))
    bar_h = max(3, int(round(4 * scale)))
    draw.rounded_rectangle((rect.left, bar_y, rect.right, bar_y + bar_h), radius=bar_h // 2, fill=tint(0.9, "progress.track"))
    done = rect.left + int((rect.right - rect.left) * (frame_index / max(1, frame_count)))
    if done > rect.left:
        draw.rounded_rectangle((rect.left, bar_y, done, bar_y + bar_h), radius=bar_h // 2, fill=tint(1.0, "progress.fill"))

    y = rect.top + int(round(36 * scale))
    for row in layout.caption_rows:
        draw_text(draw, rect.left, y, row, caption_font, tint(1.0, "caption.text"))
        y += int(round(24 * scale))
    if layout.narration_rows:
        narration_font = load_font(max(10, int(round(14 * scale))))
        y += int(round(4 * scale))
        for row in layout.narration_rows:
            draw_text(draw, rect.left, y, row, narration_font, tint(0.95, "text.muted"))
            y += int(round(18 * scale))


def _draw_code_panel(draw: Any, layout: SceneLayout, scene: dict[str, Any], state: dict[str, Any],
                     previous: dict[str, Any], morph: float) -> None:
    rect = layout.code_rect
    if rect is None:
        return
    scale = layout.scale
    panel(draw, rect, layout.radius, "panel.fill", "panel.edge")
    pad = int(round(14 * scale))
    header_font = load_font(max(10, int(round(13 * scale))), bold=True)
    draw_text(draw, rect.left + pad, rect.top + int(round(10 * scale)), "MÃ HIỂN THỊ · KHÔNG THỰC THI",
              header_font, tint(0.95, "badge.text"))
    code_font = load_font(max(MIN_CODE_FONT, int(round(16 * scale))), mono=True)
    line_height = layout.code_line_height
    text_left = rect.left + pad + layout.code_gutter
    inner_height = rect.height - 2 * pad - layout.code_header
    slack = max(0, inner_height - len(layout.code_rows) * line_height)
    top = rect.top + pad + layout.code_header + slack // 3

    def row_y(row_index: int) -> int:
        return top + row_index * line_height

    def row_center(row_index: int) -> float:
        return top + row_index * line_height + line_height / 2

    active_line = state["activeLine"]
    previous_line = previous["activeLine"]
    if active_line is not None and active_line < len(layout.line_tops):
        if previous_line is not None and previous_line != active_line and previous_line < len(layout.line_tops):
            start_row = layout.line_tops[previous_line]
            end_row = layout.line_tops[active_line]
            band_y = row_y(start_row) + (row_y(end_row) - row_y(start_row)) * ease_in_out(morph)
            band_h = line_height * (layout.line_heights[previous_line]
                                    + (layout.line_heights[active_line] - layout.line_heights[previous_line]) * ease_in_out(morph))
        else:
            band_y = row_y(layout.line_tops[active_line])
            band_h = line_height * layout.line_heights[active_line]
        draw.rounded_rectangle((rect.left + pad - 6, band_y, rect.right - pad, band_y + band_h),
                               radius=int(round(6 * scale)), fill=tint(0.95, "code.active.bg"))
        draw.rounded_rectangle((rect.left + pad - 6, band_y, rect.left + pad - 1, band_y + band_h),
                               radius=int(round(3 * scale)), fill=tint(1.0, "code.active.bar"))

    for row_index, (line_index, text) in enumerate(layout.code_rows):
        y = row_center(row_index)
        indent = len(text) - len(text.lstrip(" "))
        for guide in range(1, (indent // 4) + 1):
            guide_x = text_left + guide * int(round(7.5 * scale))
            draw.line((guide_x, y - line_height * 0.42, guide_x, y + line_height * 0.42), fill=tint(0.7, "code.guide"))
        color = "code.active.text" if line_index == active_line else "code.text"
        draw_text(draw, rect.left + pad + layout.code_gutter - 8, y, str(line_index + 1),
                  load_font(max(9, int(round(12 * scale)))), tint(0.9, "code.gutter"), align="right", valign="middle")
        draw_text(draw, text_left, y, text, code_font, tint(1.0, color), valign="middle")


def _draw_state_label(draw: Any, layout: SceneLayout, scene: dict[str, Any], state: dict[str, Any],
                     previous: dict[str, Any], morph: float, state_index: int) -> int:
    rect = layout.stage_rect
    scale = layout.scale
    label_font = load_font(max(13, int(round(22 * scale))), bold=True)
    flow_font = load_font(max(10, int(round(14 * scale))))
    start_y = rect.top + int(round(6 * scale))
    line_step = int(round(25 * scale))
    if state["label"] == previous["label"]:
        outgoing, incoming = 0.0, 1.0
    else:
        outgoing = max(0.0, 1.0 - morph / 0.4)
        incoming = max(0.0, (morph - 0.4) / 0.6)
    if outgoing > 0.0:
        y = start_y
        for row in layout.label_rows[max(0, state_index - 1)]:
            draw_text(draw, rect.left, y, row, label_font, tint(outgoing, "state.label"))
            y += line_step
    y = start_y
    for row in layout.label_rows[state_index]:
        draw_text(draw, rect.left, y, row, label_font, tint(incoming, "state.label"))
        y += line_step
    if scene["edges"]:
        flow = "   ".join(
            f"{scene['edges'][index]['label'] or 'flow'}: {scene['edges'][index]['from']} → {scene['edges'][index]['to']}"
            for index in state["activeEdges"][:3]
        )
        if flow:
            y += int(round(3 * scale))
            draw_text(draw, rect.left, y, clip_text(draw, flow, flow_font, rect.width), flow_font, tint(1.0, "state.flow"))
            y += int(round(20 * scale))
    return y


def _array_cell_geometry(layout: SceneLayout, content: Rect, count: int) -> list[tuple[int, int, int, int, int]]:
    per_row = max(1, min(count, content.width // max(1, layout.cell_width)))
    pitch_y = layout.block_height + layout.index_height + int(round(14 * layout.scale))
    grid_w = per_row * layout.cell_width
    origin_x = content.left + (content.width - grid_w) / 2
    origin_y = content.top + max(0, (content.height - (pitch_y * math.ceil(count / per_row) - int(round(14 * layout.scale)))) / 2)
    cells: list[tuple[int, int, int, int, int]] = []
    for index in range(count):
        row, column = divmod(index, per_row)
        left = int(round(origin_x + column * layout.cell_width))
        top = int(round(origin_y + row * pitch_y))
        cells.append((left + 3, top, left + layout.cell_width - 3, top + layout.block_height, index))
    return cells


def _draw_array(draw: Any, layout: SceneLayout, scene: dict[str, Any], state: dict[str, Any],
                previous: dict[str, Any], morph: float, content: Rect) -> None:
    scale = layout.scale
    eased = ease_in_out(morph)
    values = state["values"]
    previous_values = previous["values"]
    count = max(len(values), len(previous_values))
    if count == 0:
        placeholder_font = load_font(max(14, int(round(30 * scale))), bold=True)
        draw.rounded_rectangle((content.left, content.top + content.height // 2 - int(round(34 * scale)),
                                content.right, content.top + content.height // 2 + int(round(34 * scale))),
                               radius=layout.radius, outline=tint(0.8, "placeholder"), width=2)
        draw_text(draw, (content.left + content.right) / 2, content.top + content.height // 2, "—",
                  placeholder_font, tint(0.9, "placeholder"), align="center", valign="middle")
        return
    cells = _array_cell_geometry(layout, content, count)
    previous_active = previous["activeIndices"][0] if previous["activeIndices"] else None
    current_active = state["activeIndices"][0] if state["activeIndices"] else None
    lift = int(round(10 * scale))
    index_font = load_font(max(9, int(round(13 * scale))))
    ordered = sorted(range(count), key=lambda position: (position in state["activeIndices"], cells[position][1]))
    for position in ordered:
        left, top, right, bottom, array_index = cells[position]
        current = values[array_index] if array_index < len(values) else None
        old = previous_values[array_index] if array_index < len(previous_values) else None
        change = (1.0 - eased) if current is None else (1.0 if old == current else eased)
        active_now = array_index in state["activeIndices"]
        active_before = array_index in previous["activeIndices"]
        lift_amount = (1.0 - eased) * (1.0 if active_before else 0.0) + eased * (1.0 if active_now else 0.0)
        top_token = "array.active.top" if active_now else "array.top"
        side_token = "array.active.side" if active_now else "array.side"
        edge_token = "array.active.edge" if active_now else "array.edge"
        slab(draw, (left, top, right, bottom), int(lift * lift_amount), top_token, side_token, edge_token,
             (int(round(5 * scale)), int(round(9 * scale))), layout.radius,
             top_amount=max(0.3, change), edge_amount=0.55 + 0.45 * lift_amount)
        rise = 0 if current is None or current == old else int(round(6 * scale)) * (1.0 - change)
        text = current if current is not None else (old or "")
        color = "array.active.edge" if active_now else "text.primary"
        draw_text(draw, (left + right) / 2, (top + bottom) / 2 + rise - lift * lift_amount * 0.2, text,
                  layout.value_font, tint(0.3 + 0.7 * max(0.0, change), color), align="center", valign="middle")
        index_color = "array.active.edge" if active_now else "array.index"
        draw_text(draw, (left + right) / 2, bottom + int(round(13 * scale)), str(array_index), index_font,
                  tint(0.9, index_color), align="center")
    if previous_active is not None and current_active is not None and previous_active != current_active and count:
        start = cells[previous_active] if previous_active < count else None
        end = cells[current_active] if current_active < count else None
        if start and end:
            start_x = (start[0] + start[2]) / 2
            end_x = (end[0] + end[2]) / 2
            start_y = start[3] + int(round(4 * scale))
            end_y = end[3] + int(round(4 * scale)) - lift
            caret_x = start_x + (end_x - start_x) * eased
            caret_y = start_y + (end_y - start_y) * eased
            caret = int(round(6 * scale))
            draw.polygon([(caret_x - caret, caret_y), (caret_x + caret, caret_y), (caret_x, caret_y + caret)],
                         fill=tint(1.0, "accent.warm"))



def _draw_architecture(draw: Any, layout: SceneLayout, scene: dict[str, Any], state: dict[str, Any],
                       previous: dict[str, Any], morph: float, frame_index: int) -> None:
    scale = layout.scale
    eased = ease_in_out(morph)
    depth = (int(round(5 * scale)), int(round(9 * scale)))
    lift = int(round(9 * scale))
    active_nodes = set(state["activeNodes"])
    previous_nodes = set(previous["activeNodes"])
    for path in layout.edge_paths:
        index = path["index"]
        active_now = index in state["activeEdges"]
        active_before = index in previous["activeEdges"]
        amount = 1.0 if active_now else (1.0 - eased if active_before else 0.35)
        if amount <= 0.01:
            continue
        token = "edge.active.line" if active_now else "edge.line"
        points = path["points"]
        draw.line([(round(x), round(y)) for x, y in points], fill=tint(amount, token), width=3 if active_now else 2)
        end = points[-1]
        dx, dy = end[0] - points[-2][0], end[1] - points[-2][1]
        span = math.hypot(dx, dy) or 1.0
        direction = (dx / span, dy / span)
        head = max(7.0, 11.0 * scale)
        half = head * 0.45
        perpendicular = (-direction[1], direction[0])
        draw.polygon([(end[0], end[1]),
                      (end[0] - direction[0] * head + perpendicular[0] * half, end[1] - direction[1] * head + perpendicular[1] * half),
                      (end[0] - direction[0] * head - perpendicular[0] * half, end[1] - direction[1] * head - perpendicular[1] * half)],
                     fill=tint(amount, token))
    for index in sorted({index for index in state["activeEdges"]} | {index for index in previous["activeEdges"]}):
        if not 0 <= index < len(layout.edge_paths):
            continue
        path = layout.edge_paths[index]
        active_now = index in state["activeEdges"]
        alpha_amount = 1.0 if active_now else max(0.0, 1.0 - eased)
        if alpha_amount <= 0.02:
            continue
        for packet in range(3):
            travelled = (frame_index * 0.022 + packet / 3.0 + (0.0 if active_now else 0.5)) % 1.0
            for step_no, fade in ((0, 0.35), (1, 0.6), (2, 1.0)):
                position = (travelled - step_no * 0.035) % 1.0
                px, py = _point_at(path["points"], path["cumulative"], path["total"], position)
                token = "packet.active" if active_now else "packet.trail"
                size = max(3.0, (5.5 - step_no) * scale)
                draw.ellipse((px - size, py - size, px + size, py + size),
                             fill=tint(alpha_amount * fade, token if step_no == 0 else "packet.trail"))
    for box, node, font, rows, line_height in sorted(layout.node_boxes, key=lambda item: (item[1]["row"], item[1]["column"])):
        now = node["id"] in active_nodes
        before = node["id"] in previous_nodes
        lift_amount = (1.0 - eased) * (1.0 if before else 0.0) + eased * (1.0 if now else 0.0)
        top_token = "node.active.top" if now else "node.top"
        side_token = "node.active.side" if now else "node.side"
        edge_token = "node.active.edge" if now else "node.edge"
        slab(draw, box, int(lift * lift_amount), top_token, side_token, edge_token, depth, layout.radius,
             top_amount=1.0, edge_amount=0.6 + 0.4 * lift_amount)
        center_x = (box[0] + box[2]) / 2
        y = (box[1] + box[3]) / 2 - (len(rows) - 1) * line_height / 2 - int(lift * lift_amount * 0.2)
        for row in rows:
            draw_text(draw, center_x, y, row, font, tint(1.0, "node.active.label" if now else "node.label"),
                      align="center", valign="middle")
            y += line_height


def _draw_summary(draw: Any, layout: SceneLayout, state: dict[str, Any], content: Rect) -> None:
    scale = layout.scale
    card = Rect(content.left, content.top, content.right, min(content.bottom, content.top + int(round(240 * scale))))
    panel(draw, card, layout.radius, "card.fill", "card.edge")
    label_font = load_font(max(14, int(round(26 * scale))), bold=True)
    y = card.top + int(round(16 * scale))
    for row in wrap_text(draw, state["label"], label_font, card.width - int(round(36 * scale)), 3):
        draw_text(draw, (card.left + card.right) / 2, y, row, label_font, tint(1.0, "state.label"), align="center")
        y += int(round(30 * scale))
    if state["variables"]:
        draw.line((card.left + int(round(20 * scale)), y + int(round(6 * scale)),
                   card.right - int(round(20 * scale)), y + int(round(6 * scale))), fill=tint(0.7, "card.edge"), width=1)
        y += int(round(18 * scale))
        chip_font = load_font(max(10, int(round(16 * scale))))
        for name, value in state["variables"][:6]:
            draw_text(draw, card.left + int(round(20 * scale)), y, f"{name} = {value}", chip_font, tint(1.0, "chip.value"))
            y += int(round(22 * scale))


def _draw_band(draw: Any, layout: SceneLayout, scene: dict[str, Any], state: dict[str, Any],
               previous: dict[str, Any], morph: float) -> None:
    rect = layout.band_rect
    scale = layout.scale
    panel(draw, rect, layout.radius, "panel.fill", "panel.edge", fill_amount=0.85, edge_amount=0.6)
    pad = int(round(14 * scale))
    y = rect.top + pad
    if layout.kind == "code":
        focus_font = load_font(max(13, int(round(22 * scale))), bold=True)
        for row in wrap_text(draw, state["label"], focus_font, rect.width - 2 * pad, 2):
            draw_text(draw, rect.left + pad, y, row, focus_font, tint(1.0, "state.label"))
            y += int(round(25 * scale))
    variables = state["variables"]
    previous_variables = {name: value for name, value in previous["variables"]}
    if variables:
        chip_font = load_font(max(10, int(round(15 * scale))))
        name_font = load_font(max(9, int(round(13 * scale))))
        share = (rect.width - 2 * pad - int(round(10 * scale)) * (len(variables) - 1)) / len(variables)
        x = rect.left + pad
        for name, value in variables:
            label = f"{name} = {clip_text(draw, value, chip_font, max(20, int(share) - 16))}"
            chip_w = int(min(share, text_size(draw, label, chip_font)[0] + 18))
            changed = previous_variables.get(name) != value
            edge_token = "chip.changed" if changed else "chip.edge"
            amount = (0.45 + 0.55 * ease_out(morph)) if changed else 0.8
            draw.rounded_rectangle((x, y, x + chip_w, y + int(round(26 * scale))), radius=int(round(8 * scale)),
                                   fill=tint(0.85, "chip.fill"), outline=tint(0.9, edge_token), width=2 if changed else 1)
            name_w = text_size(draw, f"{name} =", name_font)[0]
            draw_text(draw, x + 9, y + int(round(13 * scale)), f"{name} =", name_font, tint(0.95, "chip.name"), valign="middle")
            draw_text(draw, x + 9 + name_w, y + int(round(13 * scale)), label[len(name) + 1:], chip_font,
                      tint(amount, "chip.value"), valign="middle")
            x += chip_w + int(round(10 * scale))
    else:
        draw_text(draw, rect.left + pad, y, "—", load_font(max(10, int(round(15 * scale)))), tint(0.8, "text.faint"), valign="middle")
    y += int(round(34 * scale))
    if layout.note_rows:
        note_font = load_font(max(10, int(round(14 * scale))))
        for row in layout.note_rows:
            draw_text(draw, rect.left + pad, y, row, note_font, tint(0.95, "note.text"))
            y += int(round(18 * scale))


def render_frame(width: int, height: int, segment: dict[str, Any], frame_index: int, frame_count: int) -> Any:
    """Render one deterministic 2.5D teaching frame as a PIL image."""
    from PIL import ImageDraw  # type: ignore[import-not-found]

    if (width, height) not in ALLOWED_SIZES:
        raise ValueError("kích thước coding 2.5D không nằm trong allowlist")
    if not isinstance(frame_count, int) or isinstance(frame_count, bool) or frame_count < 1:
        raise ValueError("frame_count phải là số nguyên >= 1")
    if not isinstance(frame_index, int) or isinstance(frame_index, bool) or not 0 <= frame_index < frame_count:
        raise ValueError("frame_index nằm ngoài frame_count")
    scene = validate_render_scene(segment)
    layout = scene_layout(width, height, scene)
    state_index, local = state_window(frame_index, frame_count, len(scene["states"]))
    state = scene["states"][state_index]
    previous = scene["states"][state_index - 1] if state_index else state
    morph = 0.0 if state_index == 0 else min(1.0, local / transition_fraction(frame_count, len(scene["states"])))

    image = background_image(width, height)
    draw = ImageDraw.Draw(image, "RGBA")
    _draw_top_bar(draw, layout, scene, state_index, frame_index, frame_count)
    if layout.code_rect is not None:
        _draw_code_panel(draw, layout, scene, state, previous, morph)
    stage_pad = int(round(12 * layout.scale))
    content = Rect(layout.stage_rect.left + stage_pad, layout.stage_rect.top + layout.label_height + stage_pad,
                   layout.stage_rect.right - stage_pad, layout.stage_rect.bottom - stage_pad)
    if layout.kind in {"array", "architecture"}:
        _draw_state_label(draw, layout, scene, state, previous, morph, state_index)
    if layout.kind == "array":
        _draw_array(draw, layout, scene, state, previous, morph, content)
    elif layout.kind == "architecture":
        _draw_architecture(draw, layout, scene, state, previous, morph, frame_index)
    elif layout.kind == "summary":
        _draw_summary(draw, layout, state, content)
    _draw_band(draw, layout, scene, state, previous, morph)
    return image


# --------------------------------------------------------------------------------------
# run and CLI
# --------------------------------------------------------------------------------------


def shared_validator() -> Any:
    """Load the shared lesson validator from the sibling file deployed beside this worker."""
    helper = Path(__file__).resolve().with_name(HELPER_FILENAME)
    if not helper.is_file():
        raise RuntimeError(f"thiếu helper {HELPER_FILENAME} cạnh worker")
    spec = importlib.util.spec_from_file_location("coding_lesson", helper)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"không nạp được helper {HELPER_FILENAME}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.validate_coding_script


def safe_relative_path(value: Any, field: str, suffix: str | None = None) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} phải là chuỗi không rỗng")
    raw = value.strip().replace("\\", "/")
    path = Path(raw)
    if path.is_absolute() or "://" in raw or (len(raw) > 1 and raw[1] == ":"):
        raise ValueError(f"{field} phải là đường dẫn tương đối an toàn")
    if any(part in {"", ".", ".."} for part in raw.split("/")):
        raise ValueError(f"{field} chứa đoạn đường dẫn không an toàn")
    if suffix and path.suffix.lower() != suffix.lower():
        raise ValueError(f"{field} phải kết thúc bằng {suffix}")
    return path


def contained_path(workspace: Path, value: str, field: str, suffix: str | None = None, must_exist: bool = False) -> Path:
    relative = safe_relative_path(value, field, suffix)
    root = Path(os.path.normcase(str(Path(workspace).resolve())))
    candidate = Path(os.path.normcase(str((Path(workspace) / relative).resolve())))
    if candidate != root and not candidate.is_relative_to(root):
        raise ValueError(f"{field} vượt ra ngoài workspace")
    resolved = Path(workspace) / relative
    if must_exist and not resolved.is_file():
        raise ValueError(f"{field} không tồn tại")
    return resolved


def bounded_script(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > MAX_REQUEST_BYTES:
        raise ValueError("script không tồn tại hoặc vượt giới hạn")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("script phải là JSON object")
    return document


def plan_scenes(segments: list[dict[str, Any]], width: int, height: int) -> list[dict[str, Any]]:
    """Validate every segment and compute its frame budget before any file is written."""
    if not 2 <= len(segments) <= MAX_SEGMENTS:
        raise ValueError("coding script phải có từ 2 đến 12 đoạn")
    plan: list[dict[str, Any]] = []
    total_frames = 0
    total_seconds = 0.0
    for index, segment in enumerate(segments, start=1):
        duration = segment.get("durationSeconds")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration):
            raise ValueError(f"duration segment {index} không hợp lệ")
        duration = float(duration)
        if not MIN_SEGMENT_SECONDS <= duration <= MAX_SEGMENT_SECONDS:
            raise ValueError(f"duration segment {index} nằm ngoài 1..30 giây")
        frame_count = max(1, round(duration * FPS))
        if frame_count > MAX_SEGMENT_FRAMES:
            raise ValueError(f"segment {index} vượt 900 frame")
        scene = validate_render_scene(segment)
        scene_layout(width, height, scene)
        state_window(0, frame_count, len(scene["states"]))
        state_window(frame_count - 1, frame_count, len(scene["states"]))
        total_frames += frame_count
        total_seconds += duration
        plan.append({"index": index, "frameCount": frame_count, "duration": duration, "scene": scene})
    if total_frames > MAX_TOTAL_FRAMES or total_seconds > MAX_TOTAL_SECONDS + 1e-6:
        raise ValueError("tổng thời lượng coding 2.5D vượt 180 giây/5400 frame")
    return plan


def run(workspace: Path, script_relative: str, output_relative: str, width: int, height: int) -> int:
    try:
        if (width, height) not in ALLOWED_SIZES:
            raise ValueError("kích thước coding 2.5D không nằm trong allowlist")
        root = Path(workspace).resolve()
        script_path = contained_path(root, script_relative, "scriptPath", ".json", must_exist=True)
        output_dir = contained_path(root, output_relative, "outputDir")
        script = bounded_script(script_path)
        if script.get("visualMode") != VISUAL_MODE:
            raise ValueError("script không phải visualMode coding-25d")
        segments = shared_validator()(script)
        plan = plan_scenes(segments, width, height)
        if output_dir.exists():
            if not output_dir.is_dir():
                raise ValueError("output path đã tồn tại và không phải thư mục")
            if any(output_dir.iterdir()):
                raise ValueError("output directory đã có dữ liệu; không ghi đè render cũ")

        output_dir.mkdir(parents=True, exist_ok=True)
        scene_records: list[dict[str, Any]] = []
        for entry in plan:
            frame_dir = output_dir / "frames" / f"scene-{entry['index']:02d}"
            frame_dir.mkdir(parents=True, exist_ok=True)
            segment = segments[entry["index"] - 1]
            for frame_index in range(entry["frameCount"]):
                frame = render_frame(width, height, segment, frame_index, entry["frameCount"])
                frame.save(frame_dir / f"frame-{frame_index + 1:04d}.png", format="PNG", optimize=True)
            first_frame = frame_dir / "frame-0001.png"
            scene_records.append({
                "sceneId": f"scene-{entry['index']:02d}",
                "relativePath": first_frame.relative_to(root).as_posix(),
                "framePattern": (frame_dir / "frame-%04d.png").relative_to(root).as_posix(),
                "frameRate": FPS,
                "frameCount": entry["frameCount"],
                "durationSeconds": entry["frameCount"] / FPS,
                "width": width,
                "height": height,
                "animationMode": ANIMATION_MODE,
                "visualMode": VISUAL_MODE,
                "rightsStatus": "generated-local",
                "reviewState": "needs_review",
            })
        manifest = {
            "schemaVersion": "1.0.0",
            "scriptId": script.get("scriptId"),
            "width": width,
            "height": height,
            "frameRate": FPS,
            "animationMode": ANIMATION_MODE,
            "visualMode": VISUAL_MODE,
            "rightsStatus": "generated-local",
            "reviewState": "needs_review",
            "scenes": scene_records,
            "networkCallsMade": False,
            "externalAssetsUsed": False,
            "message": "Đã tạo frame sequence 2.5D coding bằng hình học procedural local; mã chỉ hiển thị dạng chữ.",
        }
        manifest_path = output_dir / "scene-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return emit({
            "status": "succeeded",
            "sceneManifestPath": manifest_path.relative_to(root).as_posix(),
            "sceneCount": len(scene_records),
            "frameCount": sum(record["frameCount"] for record in scene_records),
            "visualMode": VISUAL_MODE,
            "audioMode": script.get("audioMode", "caption-only"),
            "networkCallsMade": False,
            "externalAssetsUsed": False,
            "message": "Đã tạo frame sequence coding 2.5D; cần duyệt nội dung kỹ thuật trước khi ghép video.",
        })
    except Exception as error:  # noqa: BLE001 - keep the one-line worker protocol
        return emit({"status": "failed", "networkCallsMade": False,
                     "message": f"Không tạo được scene coding 2.5D: {type(error).__name__}: {str(error)[:240]}"})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--script")
    parser.add_argument("--output-dir")
    parser.add_argument("--width", type=int, default=DEFAULT_SIZE[0])
    parser.add_argument("--height", type=int, default=DEFAULT_SIZE[1])
    args = parser.parse_args()
    if not args.script or not args.output_dir:
        return emit({"status": "invalid_request", "message": "Thiếu script hoặc output directory."})
    try:
        return run(Path.cwd().resolve(), args.script, args.output_dir, args.width, args.height)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        return emit({"status": "invalid_request", "message": f"Yêu cầu không hợp lệ: {str(error)[:240]}"})


if __name__ == "__main__":
    sys.exit(main())
