"""Render deterministic vertical scene cards from a validated local script.

The worker uses only application-owned text and simple vector shapes. It performs no
network access, does not read credentials, and refuses paths outside the workspace.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

MAX_REQUEST_BYTES = 256 * 1024
MAX_SEGMENTS = 12
ALLOWED_SIZES = {(1080, 1920), (720, 1280), (1920, 1080), (1280, 720)}


def emit(payload: dict[str, Any]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if payload.get("status") == "succeeded" else 1


def relative_path(value: Any, field: str, suffix: str | None = None) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} phải là chuỗi không rỗng")
    raw = value.strip().replace("\\", "/")
    path = Path(raw)
    if path.is_absolute() or "://" in raw or (len(raw) > 1 and raw[1] == ":") or any(part in {"", ".", ".."} for part in raw.split("/") ):
        raise ValueError(f"{field} phải là đường dẫn tương đối an toàn")
    if suffix and path.suffix.lower() != suffix.lower():
        raise ValueError(f"{field} phải kết thúc bằng {suffix}")
    return path


def bounded_json(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > MAX_REQUEST_BYTES:
        raise ValueError("script JSON không tồn tại hoặc vượt giới hạn")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("script JSON phải là object")
    return document


def wrap_lines(draw: Any, text: str, font: Any, max_width: int) -> list[str]:
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
    return lines or [""]


def font_candidates(size: int) -> list[Path]:
    return [
        Path(r"C:\Windows\Fonts\segoeuib.ttf"),
        Path(r"C:\Windows\Fonts\segoeui.ttf"),
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]


def load_font(size: int, bold: bool = False) -> Any:
    from PIL import ImageFont  # type: ignore[import-not-found]

    candidates = font_candidates(size)
    if not bold:
        candidates = [candidates[1], candidates[3], candidates[5], *candidates]
    for candidate in candidates:
        if candidate.is_file():
            try:
                return ImageFont.truetype(str(candidate), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def is_space_theme(script: dict[str, Any]) -> bool:
    blob = json.dumps(script, ensure_ascii=False).casefold()
    keywords = (
        "vũ trụ", "vũ tru", "hành tinh", "ngân hà", "thiên hà", "mặt trăng",
        "lỗ đen", "lỗ den", "phi hành gia", "hệ mặt trời", "space", "planet",
        "galaxy", "moon", "astronaut", "nebula",
    )
    return any(keyword in blob for keyword in keywords)


def render_card(width: int, height: int, title: str, body: str, index: int, total: int, space_theme: bool = False) -> Any:
    from PIL import Image, ImageDraw  # type: ignore[import-not-found]

    image = Image.new("RGB", (width, height), (5, 8, 24) if space_theme else (7, 14, 28))
    draw = ImageDraw.Draw(image)
    accent = ((93 + index * 27) % 220, (212 - index * 9) % 220, (180 + index * 13) % 220)
    if space_theme:
        # Deterministic 2D astronomy motif: no downloaded assets and no random seed.
        for step in range(0, width, 12):
            blend = step / max(1, width - 1)
            color = (int(5 + 16 * blend), int(8 + 8 * blend), int(24 + 38 * blend))
            draw.line((step, 0, step, height), fill=color, width=12)
        for star in range(72):
            x = (star * 137 + index * 53) % width
            y = (star * 251 + index * 97) % height
            radius = 1 + ((star + index) % 3)
            brightness = 150 + ((star * 17 + index * 23) % 106)
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(brightness, brightness, min(255, brightness + 30)))
        planet_x = int(width * (0.72 if index % 2 else 0.28))
        planet_y = int(height * (0.25 if index % 2 else 0.74))
        planet_r = max(90, width // 7)
        draw.ellipse((planet_x - planet_r, planet_y - planet_r, planet_x + planet_r, planet_y + planet_r), fill=(35, 91, 155), outline=(120, 213, 255), width=5)
        draw.arc((planet_x - planet_r - 65, planet_y - planet_r // 2, planet_x + planet_r + 65, planet_y + planet_r // 2), 12, 168, fill=(223, 177, 91), width=8)
        draw.arc((planet_x - planet_r - 85, planet_y - planet_r // 3, planet_x + planet_r + 85, planet_y + planet_r // 3), 18, 160, fill=(143, 110, 214), width=4)
        draw.ellipse((width // 2 - 34, height // 2 - 34, width // 2 + 34, height // 2 + 34), fill=(255, 199, 93), outline=(255, 244, 182), width=4)
    else:
        for step in range(0, width, 12):
            blend = step / max(1, width - 1)
            color = (
                int(7 + 10 * blend),
                int(14 + 18 * blend),
                int(28 + 28 * blend),
            )
            draw.line((step, 0, step, height), fill=color, width=12)
        draw.ellipse((width - 420, -180, width + 100, 340), fill=tuple(min(255, c + 20) for c in accent))
        draw.ellipse((-220, height - 500, 260, height + 120), fill=(18, 47, 80))
    margin = int(width * 0.1)
    panel_fill = (8, 15, 40) if space_theme else None
    draw.rounded_rectangle((margin, margin, width - margin, height - margin), radius=36, outline=(45, 78, 112), width=4, fill=panel_fill)
    label_font = load_font(max(24, width // 32), bold=True)
    title_font = load_font(max(42, width // 16), bold=True)
    body_font = load_font(max(30, width // 27), bold=False)
    small_font = load_font(max(22, width // 38), bold=False)
    draw.text((margin + 48, margin + 54), f"AUTO3DVIDEO  •  {index:02d}/{total:02d}", font=label_font, fill=accent)
    title_lines = wrap_lines(draw, title, title_font, width - 2 * margin - 96)
    title_y = margin + 190
    for line in title_lines[:4]:
        draw.text((margin + 48, title_y), line, font=title_font, fill=(239, 246, 255))
        title_y += int(title_font.size * 1.18)
    body_y = max(title_y + 100, height // 2 - 40)
    for line in wrap_lines(draw, body, body_font, width - 2 * margin - 96)[:10]:
        draw.text((margin + 48, body_y), line, font=body_font, fill=(193, 210, 229))
        body_y += int(body_font.size * 1.35)
    draw.line((margin + 48, height - margin - 190, width - margin - 48, height - margin - 190), fill=(45, 78, 112), width=3)
    draw.text((margin + 48, height - margin - 130), "Nội dung cần người dùng kiểm tra claim trước khi phát hành", font=small_font, fill=(153, 169, 190))
    return image


def run(workspace: Path, script_relative: str, output_relative: str, width: int, height: int) -> int:
    try:
        script_path = workspace / relative_path(script_relative, "scriptPath", ".json")
        output_dir = workspace / relative_path(output_relative, "outputDir")
        if (width, height) not in ALLOWED_SIZES:
            raise ValueError("kích thước scene chưa được allowlist")
        script = bounded_json(script_path)
        segments = script.get("segments")
        if not isinstance(segments, list) or not 2 <= len(segments) <= MAX_SEGMENTS:
            raise ValueError("script phải có từ 2 đến 12 đoạn")
        from PIL import Image  # type: ignore[import-not-found]

        output_dir.mkdir(parents=True, exist_ok=True)
        output_prefix = output_dir.relative_to(workspace)
        scene_records: list[dict[str, Any]] = []
        for index, segment in enumerate(segments, start=1):
            if not isinstance(segment, dict):
                raise ValueError(f"segment {index} không hợp lệ")
            title = str(segment.get("onScreenText", "")).strip()[:180]
            body = str(segment.get("narration", "")).strip()[:600]
            if not title or not body:
                raise ValueError(f"segment {index} thiếu chữ hoặc lời dẫn")
            duration = float(segment.get("durationSeconds", 1))
            if not 1 <= duration <= 30:
                raise ValueError(f"duration segment {index} không hợp lệ")
            relative = output_prefix / "assets" / f"scene-{index:02d}.png"
            absolute = workspace / relative
            absolute.parent.mkdir(parents=True, exist_ok=True)
            space_theme = is_space_theme(script)
            image = render_card(width, height, title, body, index, len(segments), space_theme)
            image.save(absolute, format="PNG", optimize=True)
            scene_records.append({
                "sceneId": f"scene-{index:02d}",
                "relativePath": str(relative).replace("\\", "/"),
                "durationSeconds": duration,
                "width": width,
                "height": height,
                "rightsStatus": "generated-local",
                "reviewState": "needs_review",
                "visualMode": "2d-space-motion" if space_theme else "2d-motion-card",
            })
        manifest = {
            "schemaVersion": "1.0.0",
            "scriptId": script.get("scriptId"),
            "width": width,
            "height": height,
            "scenes": scene_records,
            "networkCallsMade": False,
            "externalAssetsUsed": False,
            "message": "Đã tạo scene PNG xác định; visual mode là 2D space motion nếu script có chủ đề vũ trụ, không dùng tài sản bên ngoài.",
        }
        manifest_path = output_dir / "scene-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return emit({"status": "succeeded", "sceneManifestPath": str(manifest_path.relative_to(workspace)).replace("\\", "/"), "sceneCount": len(scene_records), "networkCallsMade": False, "externalAssetsUsed": False, "message": "Đã tạo scene cục bộ; cần duyệt trước khi ghép video."})
    except Exception as error:
        return emit({"status": "failed", "networkCallsMade": False, "message": f"Không tạo được scene: {type(error).__name__}: {str(error)[:240]}"})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--script", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--height", type=int, default=1920)
    args = parser.parse_args()
    return run(Path.cwd().resolve(), args.script, args.output_dir, args.width, args.height)


if __name__ == "__main__":
    sys.exit(main())
