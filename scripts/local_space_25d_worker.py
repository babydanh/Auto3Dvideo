"""Create deterministic 2.5D space infographic frames for the local pipeline.

The worker uses only Pillow, application-owned text and procedural vector shapes.
It creates a frame sequence so objects move independently instead of repeating a still.
It performs no network access, does not read credentials, and rejects unsafe paths.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

MAX_REQUEST_BYTES = 256 * 1024
MAX_SEGMENTS = 12
MAX_TOTAL_FRAMES = 1800
ALLOWED_SIZES = {(1080, 1920), (720, 1280)}
FPS = 30


def emit(payload: dict[str, Any]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if payload.get("status") == "succeeded" else 1


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


def bounded_script(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > MAX_REQUEST_BYTES:
        raise ValueError("script không tồn tại hoặc vượt giới hạn")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("script phải là JSON object")
    return document


def font_candidates(size: int, bold: bool) -> list[Path]:
    windows = Path(r"C:\Windows\Fonts")
    names = ("segoeuib.ttf", "arialbd.ttf", "segoeui.ttf", "arial.ttf") if bold else ("segoeui.ttf", "arial.ttf")
    return [windows / name for name in names] + [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    ]


def load_font(size: int, bold: bool = False) -> Any:
    from PIL import ImageFont  # type: ignore[import-not-found]

    for candidate in font_candidates(size, bold):
        if candidate.is_file():
            try:
                return ImageFont.truetype(str(candidate), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def wrap_lines(draw: Any, text: str, font: Any, max_width: int, max_lines: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and draw.textbbox((0, 0), candidate, font=font)[2] > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(" .,;:") + "…"
    return lines or [""]


def draw_glow(draw: Any, center: tuple[int, int], radius: int, color: tuple[int, int, int], steps: int = 5) -> None:
    for step in range(steps, 0, -1):
        current = radius + step * 16
        alpha = int(28 / step)
        glow = tuple(min(255, int(channel * 0.55 + 255 * alpha / 255)) for channel in color)
        draw.ellipse((center[0] - current, center[1] - current, center[0] + current, center[1] + current), outline=glow, width=max(2, 8 // step))


def render_frame(width: int, height: int, title: str, body: str, scene_index: int, scene_total: int, frame_index: int, frame_count: int) -> Any:
    from PIL import Image, ImageDraw  # type: ignore[import-not-found]

    progress = frame_index / max(1, frame_count - 1)
    image = Image.new("RGB", (width, height), (4, 7, 24))
    draw = ImageDraw.Draw(image)

    # Deep-space gradient and deterministic star field.
    for y in range(0, height, 12):
        blend = y / max(1, height - 1)
        color = (int(4 + 9 * blend), int(7 + 12 * blend), int(24 + 35 * blend))
        draw.rectangle((0, y, width, min(height, y + 12)), fill=color)
    for star in range(96):
        base_x = (star * 149 + scene_index * 67) % width
        base_y = (star * 277 + scene_index * 113) % height
        drift = int((progress * (18 + (star % 5) * 7)) % width)
        x = (base_x + drift) % width
        y = base_y
        radius = 1 + ((star + scene_index) % 3)
        twinkle = 160 + int(70 * (0.5 + 0.5 * math.sin(progress * math.tau * (1 + star % 3) + star)))
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(twinkle, twinkle, min(255, twinkle + 35)))

    cx, cy = width // 2, int(height * 0.56)
    # Far orbit layer: thin, low-contrast elliptical rings.
    orbit_specs = [(int(width * 0.18), int(height * 0.07)), (int(width * 0.28), int(height * 0.11)), (int(width * 0.38), int(height * 0.15)), (int(width * 0.47), int(height * 0.19))]
    for orbit_no, (rx, ry) in enumerate(orbit_specs):
        draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), outline=(50, 115, 170), width=3)
        orbit_phase = progress * math.tau * (0.10 + orbit_no * 0.035) + scene_index * 0.8
        planet_x = int(cx + rx * math.cos(orbit_phase))
        planet_y = int(cy + ry * math.sin(orbit_phase))
        planet_r = max(10, int(width * (0.012 + orbit_no * 0.004)))
        planet_color = [(62, 195, 224), (120, 106, 225), (225, 166, 84), (72, 210, 137)][orbit_no]
        draw.ellipse((planet_x - planet_r, planet_y - planet_r, planet_x + planet_r, planet_y + planet_r), fill=planet_color, outline=(235, 248, 255), width=2)
        if orbit_no == 2:
            draw.arc((planet_x - planet_r * 2, planet_y - planet_r // 2, planet_x + planet_r * 2, planet_y + planet_r // 2), 10, 170, fill=(247, 211, 119), width=3)

    # Central sun and moving rocket marker form the middle layer.
    draw_glow(draw, (cx, cy), max(32, width // 17), (255, 164, 52))
    sun_r = max(30, width // 20)
    draw.ellipse((cx - sun_r, cy - sun_r, cx + sun_r, cy + sun_r), fill=(255, 183, 67), outline=(255, 245, 175), width=4)
    rocket_progress = (progress * (0.86 if scene_index % 2 == 0 else 1.15) + scene_index * 0.12) % 1.0
    rocket_x = int(width * (0.10 + 0.80 * rocket_progress))
    rocket_y = int(height * (0.76 - 0.31 * math.sin(rocket_progress * math.pi)))
    flame = [(rocket_x - 26, rocket_y + 18), (rocket_x - 48, rocket_y + 26), (rocket_x - 30, rocket_y + 4)]
    draw.polygon(flame, fill=(249, 112, 55))
    rocket = [(rocket_x - 22, rocket_y + 10), (rocket_x + 22, rocket_y), (rocket_x - 4, rocket_y - 22), (rocket_x - 24, rocket_y - 8)]
    draw.polygon(rocket, fill=(235, 241, 255), outline=(95, 196, 236))
    draw.ellipse((rocket_x - 2, rocket_y - 12, rocket_x + 9, rocket_y - 2), fill=(61, 154, 221))

    # Foreground text panel keeps a safe, readable social-video hierarchy.
    panel_margin = int(width * 0.08)
    panel_top = int(height * 0.08)
    panel_bottom = int(height * 0.34)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rounded_rectangle((panel_margin, panel_top, width - panel_margin, panel_bottom), radius=28, fill=(5, 12, 35, 224), outline=(76, 184, 225, 235), width=3)
    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(image)
    label_font = load_font(max(24, width // 34), bold=True)
    title_font = load_font(max(38, width // 18), bold=True)
    body_font = load_font(max(25, width // 29), bold=False)
    draw.text((panel_margin + 30, panel_top + 24), f"VŨ TRỤ 2.5D  •  {scene_index:02d}/{scene_total:02d}", font=label_font, fill=(112, 224, 239))
    title_lines = wrap_lines(draw, title, title_font, width - 2 * panel_margin - 60, 3)
    title_y = panel_top + 78
    for line in title_lines:
        draw.text((panel_margin + 30, title_y), line, font=title_font, fill=(244, 249, 255))
        title_y += int(title_font.size * 1.08)
    body_lines = wrap_lines(draw, body, body_font, width - 2 * panel_margin - 60, 3)
    body_y = panel_bottom - int(body_font.size * 1.25 * len(body_lines)) - 20
    for line in body_lines:
        draw.text((panel_margin + 30, body_y), line, font=body_font, fill=(188, 216, 236))
        body_y += int(body_font.size * 1.25)
    return image


def run(workspace: Path, script_relative: str, output_relative: str, width: int, height: int) -> int:
    try:
        script_path = workspace / safe_relative_path(script_relative, "scriptPath", ".json")
        output_dir = workspace / safe_relative_path(output_relative, "outputDir")
        if (width, height) not in ALLOWED_SIZES:
            raise ValueError("kích thước 2.5D chưa được allowlist")
        script = bounded_script(script_path)
        segments = script.get("segments")
        if not isinstance(segments, list) or not 2 <= len(segments) <= MAX_SEGMENTS:
            raise ValueError("script phải có từ 2 đến 12 đoạn")
        durations: list[float] = []
        for index, segment in enumerate(segments, start=1):
            if not isinstance(segment, dict):
                raise ValueError(f"segment {index} không hợp lệ")
            duration = segment.get("durationSeconds")
            if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not 1 <= float(duration) <= 30:
                raise ValueError(f"duration segment {index} không hợp lệ")
            if not str(segment.get("onScreenText", "")).strip() or not str(segment.get("narration", "")).strip():
                raise ValueError(f"segment {index} thiếu chữ hoặc lời dẫn")
            durations.append(float(duration))
        total_frames = sum(max(1, round(duration * FPS)) for duration in durations)
        if total_frames > MAX_TOTAL_FRAMES:
            raise ValueError("tổng số frame 2.5D vượt giới hạn")

        output_dir.mkdir(parents=True, exist_ok=True)
        output_prefix = output_dir.relative_to(workspace)
        scene_records: list[dict[str, Any]] = []
        for scene_index, (segment, duration) in enumerate(zip(segments, durations), start=1):
            frame_count = max(1, round(duration * FPS))
            frame_dir = output_dir / "frames" / f"scene-{scene_index:02d}"
            frame_dir.mkdir(parents=True, exist_ok=True)
            title = str(segment.get("onScreenText", "")).strip()[:180]
            body = str(segment.get("narration", "")).strip()[:600]
            for frame_index in range(frame_count):
                frame = render_frame(width, height, title, body, scene_index, len(segments), frame_index, frame_count)
                frame.save(frame_dir / f"frame-{frame_index + 1:04d}.png", format="PNG", optimize=True)
            first_frame = frame_dir / "frame-0001.png"
            pattern = frame_dir / "frame-%04d.png"
            scene_records.append({
                "sceneId": f"scene-{scene_index:02d}",
                "relativePath": str(first_frame.relative_to(workspace)).replace("\\", "/"),
                "framePattern": str(pattern.relative_to(workspace)).replace("\\", "/"),
                "frameRate": FPS,
                "frameCount": frame_count,
                "durationSeconds": duration,
                "width": width,
                "height": height,
                "animationMode": "procedural-2.5d-space",
                "visualMode": "space-25d",
                "rightsStatus": "generated-local",
                "reviewState": "needs_review",
            })
        manifest = {
            "schemaVersion": "1.0.0",
            "scriptId": script.get("scriptId"),
            "width": width,
            "height": height,
            "frameRate": FPS,
            "animationMode": "procedural-2.5d-space",
            "scenes": scene_records,
            "networkCallsMade": False,
            "externalAssetsUsed": False,
            "message": "Đã tạo chuỗi frame 2.5D vũ trụ bằng hình học procedural local; không dùng asset bên ngoài.",
        }
        manifest_path = output_dir / "scene-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return emit({
            "status": "succeeded",
            "sceneManifestPath": str(manifest_path.relative_to(workspace)).replace("\\", "/"),
            "sceneCount": len(scene_records),
            "frameCount": total_frames,
            "networkCallsMade": False,
            "externalAssetsUsed": False,
            "message": "Đã tạo frame sequence 2.5D; cần duyệt trước khi ghép video.",
        })
    except Exception as error:
        return emit({"status": "failed", "networkCallsMade": False, "message": f"Không tạo được scene 2.5D: {type(error).__name__}: {str(error)[:240]}"})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--script")
    parser.add_argument("--output-dir")
    parser.add_argument("--width", type=int, default=720)
    parser.add_argument("--height", type=int, default=1280)
    args = parser.parse_args()
    if not args.script or not args.output_dir:
        return emit({"status": "invalid_request", "message": "Thiếu script hoặc output directory."})
    try:
        return run(Path.cwd().resolve(), args.script, args.output_dir, args.width, args.height)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        return emit({"status": "invalid_request", "message": f"Yêu cầu không hợp lệ: {str(error)[:240]}"})


if __name__ == "__main__":
    sys.exit(main())
