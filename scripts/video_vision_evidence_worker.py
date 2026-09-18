"""Bounded local-only video evidence worker.

This worker never downloads media, calls a provider, runs OCR/STT, or loads a VLM.
FFprobe and FFmpeg extraction are intentionally owned by the Rust supervisor. The
worker reads a bounded frame directory, computes deterministic visual cues, and
writes a versioned evidence JSON for a later planner/VLM adapter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError:  # pragma: no cover - runtime fallback for minimal Python installs
    Image = None  # type: ignore[assignment]

SCHEMA_VERSION = "1.0.0"
MAX_REQUEST_BYTES = 1 * 1024 * 1024
MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024
MAX_FRAMES = 240
MAX_FRAME_BYTES = 20 * 1024 * 1024
SAFE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def safe_relative_path(value: str, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} phải là chuỗi")
    normalized = value.strip().replace("\\", "/")
    if (
        not normalized
        or normalized.startswith("/")
        or normalized.startswith("//")
        or "://" in normalized
        or (len(normalized) > 1 and normalized[1] == ":")
        or "\x00" in normalized
    ):
        raise ValueError(f"{field} không phải đường dẫn workspace an toàn")
    parts = normalized.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"{field} không được chứa path traversal")
    return normalized


def safe_id(value: str, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} không được rỗng")
    value = value.strip()
    if len(value) > 96 or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for ch in value):
        raise ValueError(f"{field} chứa ký tự không được phép")
    return value


def bounded_number(value: Any, field: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} phải là số")
    number = float(value)
    if not math.isfinite(number) or not (minimum <= number <= maximum):
        raise ValueError(f"{field} phải nằm trong khoảng {minimum}..{maximum}")
    return number


def bounded_int(value: Any, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} phải là số nguyên")
    if not (minimum <= value <= maximum):
        raise ValueError(f"{field} phải nằm trong khoảng {minimum}..{maximum}")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def rgb_hex(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(value))) for value in rgb)


def fallback_visual_cues() -> dict[str, Any]:
    return {
        "brightness": "unknown",
        "motion": "unknown",
        "palette": ["#808080"],
        "textVisibility": "unknown",
        "edgeDensity": 0.0,
    }


def image_cues(path: Path) -> tuple[dict[str, Any], list[float]]:
    if Image is None:
        return fallback_visual_cues(), []
    try:
        with Image.open(path) as opened:
            image = opened.convert("RGB").resize((64, 36))
            pixels = [image.getpixel((x, y)) for y in range(36) for x in range(64)]
    except Exception:
        return fallback_visual_cues(), []

    if not pixels:
        return fallback_visual_cues(), []
    luminance = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in pixels]
    mean_luminance = sum(luminance) / len(luminance)
    brightness = "low" if mean_luminance < 70 else "medium" if mean_luminance < 175 else "high"

    quantized = Counter((r // 32 * 32 + 16, g // 32 * 32 + 16, b // 32 * 32 + 16) for r, g, b in pixels)
    palette = [rgb_hex(rgb) for rgb, _count in quantized.most_common(5)] or ["#808080"]

    horizontal_edges = 0
    vertical_edges = 0
    threshold = 28.0
    width = 64
    height = 36
    for y in range(height):
        for x in range(width):
            index = y * width + x
            current = luminance[index]
            if x + 1 < width and abs(current - luminance[index + 1]) > threshold:
                horizontal_edges += 1
            if y + 1 < height and abs(current - luminance[index + width]) > threshold:
                vertical_edges += 1
    edge_density = clamp((horizontal_edges + vertical_edges) / (2 * width * height), 0.0, 1.0)
    return {
        "brightness": brightness,
        "motion": "unknown",
        "palette": palette,
        "textVisibility": "unknown",
        "edgeDensity": round(edge_density, 4),
    }, luminance


def frame_files(workspace: Path, frame_dir_value: str) -> list[Path]:
    frame_dir = workspace / safe_relative_path(frame_dir_value, "frameDir")
    if not frame_dir.is_dir():
        raise ValueError("frameDir không tồn tại hoặc không phải thư mục")
    files = sorted(
        path
        for path in frame_dir.iterdir()
        if path.is_file() and path.suffix.lower() in SAFE_EXTENSIONS and path.name.lower().startswith("frame-")
    )
    if not files:
        raise ValueError("Không tìm thấy frame-*.jpg/png trong frameDir")
    if len(files) > MAX_FRAMES:
        raise ValueError(f"Số frame vượt quá giới hạn {MAX_FRAMES}")
    for path in files:
        if path.stat().st_size <= 0 or path.stat().st_size > MAX_FRAME_BYTES:
            raise ValueError(f"Frame không hợp lệ hoặc quá lớn: {path.name}")
    return files


def motion_label(value: float) -> str:
    if value < 4:
        return "static"
    if value < 15:
        return "low"
    if value < 35:
        return "medium"
    return "high"


def parse_probe(request: dict[str, Any]) -> tuple[float, int, int, float, str, bool]:
    probe = request.get("probe")
    if not isinstance(probe, dict):
        raise ValueError("probe phải là object")
    duration = bounded_number(probe.get("durationSeconds"), "probe.durationSeconds", 0.001, 604800.0)
    width = bounded_int(probe.get("width"), "probe.width", 16, 16384)
    height = bounded_int(probe.get("height"), "probe.height", 16, 16384)
    fps = bounded_number(probe.get("fps"), "probe.fps", 0.001, 240.0)
    codec = probe.get("videoCodec")
    if not isinstance(codec, str) or not codec.strip() or len(codec.strip()) > 64:
        raise ValueError("probe.videoCodec không hợp lệ")
    audio_present = probe.get("audioPresent")
    if not isinstance(audio_present, bool):
        raise ValueError("probe.audioPresent phải là boolean")
    return duration, width, height, fps, codec.strip(), audio_present


def make_shots(
    frame_paths: list[Path],
    frame_visuals: list[dict[str, Any]],
    frame_times: list[float],
    duration: float,
    requested_fps: float,
    frame_dir_value: str,
) -> list[dict[str, Any]]:
    boundaries: list[int] = []
    previous_luminance: list[float] | None = None
    last_boundary_time = -1.0
    for index, path in enumerate(frame_paths):
        _ = path
        _visual, luminance = image_cues(path)
        if previous_luminance and luminance and len(previous_luminance) == len(luminance):
            diff = sum(abs(a - b) for a, b in zip(previous_luminance, luminance)) / len(luminance)
            frame_visuals[index]["motion"] = motion_label(diff)
            if diff >= 38.0 and frame_times[index] - last_boundary_time >= 0.5 and index > 0:
                boundaries.append(index)
                last_boundary_time = frame_times[index]
        previous_luminance = luminance or previous_luminance

    ranges: list[tuple[int, int]] = []
    start = 0
    for boundary in boundaries:
        ranges.append((start, boundary))
        start = boundary
    ranges.append((start, len(frame_paths)))

    shots: list[dict[str, Any]] = []
    for shot_index, (from_index, to_index) in enumerate(ranges, start=1):
        selected_visuals = frame_visuals[from_index:to_index]
        start_seconds = 0.0 if from_index == 0 else frame_times[from_index]
        end_seconds = duration if to_index >= len(frame_paths) else frame_times[to_index]
        end_seconds = max(start_seconds + 0.001, min(duration, end_seconds))
        palette_counter = Counter(
            color for visual in selected_visuals for color in visual.get("palette", [])
        )
        palette = [color for color, _count in palette_counter.most_common(5)] or ["#808080"]
        brightness_values = [visual.get("brightness") for visual in selected_visuals]
        brightness = Counter(brightness_values).most_common(1)[0][0] if brightness_values else "unknown"
        motion_values = [visual.get("motion") for visual in selected_visuals]
        motion = Counter(motion_values).most_common(1)[0][0] if motion_values else "unknown"
        edge_density = sum(float(visual.get("edgeDensity", 0.0)) for visual in selected_visuals) / max(len(selected_visuals), 1)
        refs = [f"{frame_dir_value}/{path.name}" for path in frame_paths[from_index:to_index]]
        shots.append({
            "shotId": f"shot-{shot_index:04d}",
            "startSeconds": round(start_seconds, 3),
            "endSeconds": round(end_seconds, 3),
            "durationSeconds": round(end_seconds - start_seconds, 3),
            "frameRefs": refs[:32],
            "boundaryMethod": "pixel_diff_heuristic" if boundaries else "single_sample",
            "visualCues": {
                "brightness": brightness if brightness in {"low", "medium", "high"} else "unknown",
                "motion": motion if motion in {"static", "low", "medium", "high"} else "unknown",
                "palette": palette,
                "textVisibility": "unknown",
                "edgeDensity": round(clamp(edge_density, 0.0, 1.0), 4),
            },
            "semanticStatus": "not_run",
            "semanticSummary": None,
            "ocrText": "",
            "transcriptText": "",
            "reviewState": "needs_review",
        })
    return shots


def handle(request: dict[str, Any], workspace: Path) -> dict[str, Any]:
    if request.get("operation") != "analyze_frames":
        raise ValueError("operation chỉ nhận analyze_frames")
    evidence_id = safe_id(request.get("evidenceId", ""), "evidenceId")
    source_path_value = safe_relative_path(request.get("sourceVideoPath", ""), "sourceVideoPath")
    frame_dir_value = safe_relative_path(request.get("frameDir", ""), "frameDir")
    output_path_value = safe_relative_path(request.get("outputPath", ""), "outputPath")
    requested_fps = bounded_number(request.get("requestedFps", 1.0), "requestedFps", 0.1, 2.0)
    max_frames = bounded_int(request.get("maxFrames", 120), "maxFrames", 1, MAX_FRAMES)
    frame_width = bounded_int(request.get("frameWidth", 320), "frameWidth", 16, 2048)
    frame_height = bounded_int(request.get("frameHeight", 180), "frameHeight", 16, 2048)
    duration, width, height, fps, codec, audio_present = parse_probe(request)

    source_path = workspace / source_path_value
    if not source_path.is_file():
        raise ValueError("sourceVideoPath không tồn tại")
    if source_path.stat().st_size <= 0 or source_path.stat().st_size > MAX_VIDEO_BYTES:
        raise ValueError("source video rỗng hoặc vượt giới hạn 4 GiB")
    output_path = workspace / output_path_value
    if output_path.exists():
        raise ValueError("outputPath đã tồn tại; không ghi đè evidence")

    files = frame_files(workspace, frame_dir_value)[:max_frames]
    frame_times = [min(duration, index / requested_fps) for index in range(len(files))]
    frame_visuals: list[dict[str, Any]] = []
    for path in files:
        visual, _luminance = image_cues(path)
        frame_visuals.append(visual)
    shots = make_shots(files, frame_visuals, frame_times, duration, requested_fps, frame_dir_value)

    audio_path_value = request.get("audioPath")
    if audio_present:
        if not isinstance(audio_path_value, str) or not audio_path_value.strip():
            raise ValueError("audioPresent=true nhưng thiếu audioPath")
        audio_path_value = safe_relative_path(audio_path_value, "audioPath")
        audio_path = workspace / audio_path_value
        if not audio_path.is_file() or audio_path.stat().st_size <= 0:
            raise ValueError("audioPath không tồn tại hoặc rỗng")
    else:
        audio_path_value = None

    evidence = {
        "schemaVersion": SCHEMA_VERSION,
        "evidenceId": evidence_id,
        "sourceVideoPath": source_path_value,
        "sourceSha256": sha256_file(source_path),
        "durationSeconds": round(duration, 3),
        "width": width,
        "height": height,
        "fps": round(fps, 6),
        "videoCodec": codec,
        "audioPresent": audio_present,
        "audioPath": audio_path_value,
        "sampling": {
            "requestedFps": requested_fps,
            "maxFrames": max_frames,
            "framesExtracted": len(files),
            "frameWidth": frame_width,
            "frameHeight": frame_height,
        },
        "shots": shots,
        "capabilities": {
            "ffprobe": True,
            "frameSampling": True,
            "shotBoundaryHeuristic": True,
            "audioExtraction": audio_present,
            "ocr": False,
            "transcript": False,
            "semanticVlm": False,
            "semanticAdapter": None,
        },
        "rightsStatus": "pending",
        "reviewState": "needs_review",
        "networkCallsMade": False,
        "costStatus": "local_only",
        "notes": "Evidence deterministic từ FFprobe/frame sampling; chưa chạy OCR, STT hoặc Qwen3-VL. Dùng làm input cho planner sau khi người dùng review quyền và chất lượng.",
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "status": "succeeded",
        "evidence": evidence,
        "outputPath": output_path_value,
        "message": "Đã tạo video evidence local; semantic VLM/OCR/STT chưa chạy và cần review.",
    }


def load_request(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > MAX_REQUEST_BYTES:
        raise ValueError("Request không tồn tại hoặc vượt quá 1 MiB")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Request phải là JSON object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Auto3Dvideo local video evidence worker")
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        request_path = Path(args.request)
        if request_path.is_absolute() or ".." in request_path.parts:
            raise ValueError("request path phải tương đối và không được vượt workspace")
        workspace = Path.cwd().resolve()
        result = handle(load_request(workspace / request_path), workspace)
    except Exception as error:
        emit({
            "status": "failed",
            "networkCallsMade": False,
            "costStatus": "local_only",
            "message": str(error)[:1000],
        })
        return 1
    emit(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
