"""Deterministic local mechanism-explainer renderer.

This worker turns a validated event graph into an original frame sequence and SRT
sidecar. It intentionally uses procedural 2D/2.5D/pseudo-3D primitives instead
of social footage, downloaded assets, arbitrary model calls or shell commands.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

MAX_PLAN_BYTES = 512 * 1024
MAX_EVENTS = 64
ALLOWED_SIZE = (720, 1280)
ALLOWED_FPS = 30


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if payload.get("status") == "succeeded" else 1


def safe_relative(value: Any, field: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty relative path")
    raw = value.strip().replace("\\", "/")
    path = Path(raw)
    if path.is_absolute() or "://" in raw or (len(raw) > 1 and raw[1] == ":"):
        raise ValueError(f"{field} must be workspace-relative")
    if any(part in {"", ".", ".."} for part in raw.split("/")):
        raise ValueError(f"{field} contains an unsafe path segment")
    return path


def read_plan(workspace: Path, relative: str) -> dict[str, Any]:
    path = workspace / safe_relative(relative, "planPath")
    if not path.is_file() or path.stat().st_size > MAX_PLAN_BYTES:
        raise ValueError("plan does not exist or exceeds the size limit")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("plan must be a JSON object")
    return document


def validate_plan(plan: dict[str, Any]) -> list[dict[str, Any]]:
    if plan.get("schemaVersion") != "1.0.0":
        raise ValueError("unsupported mechanism plan schema")
    fmt = plan.get("format")
    if not isinstance(fmt, dict) or fmt.get("aspectRatio") != "9:16" or fmt.get("width") != 720 or fmt.get("height") != 1280 or fmt.get("frameRate") != 30:
        raise ValueError("only the bounded 720x1280/30fps vertical profile is allowed")
    policy = plan.get("policy")
    if not isinstance(policy, dict) or policy.get("allowNetwork") is not False or policy.get("externalAssetsAllowed") is not False or policy.get("paidGeneration") is not False:
        raise ValueError("mechanism worker requires local-only, no-external-asset policy")
    events = plan.get("events")
    if not isinstance(events, list) or not 3 <= len(events) <= MAX_EVENTS:
        raise ValueError("plan must contain 3 to 64 events")
    previous_end = 0
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for index, event in enumerate(events, start=1):
        if not isinstance(event, dict):
            raise ValueError(f"event {index} must be an object")
        event_id = event.get("eventId")
        if not isinstance(event_id, str) or event_id in seen:
            raise ValueError(f"event {index} has an invalid or duplicate eventId")
        if event.get("sequence") != index:
            raise ValueError("events must have contiguous sequence numbers")
        start = event.get("startFrame")
        end = event.get("endFrame")
        duration = event.get("durationFrames")
        if not all(isinstance(value, int) and not isinstance(value, bool) for value in (start, end, duration)):
            raise ValueError(f"event {event_id} timing must use integer frames")
        if start != previous_end or end <= start or duration != end - start:
            raise ValueError(f"event {event_id} has a gap, overlap or duration mismatch")
        if start < 0 or end > 864000:
            raise ValueError(f"event {event_id} timing is outside the bound")
        depends = event.get("dependsOn")
        if not isinstance(depends, list) or any(dep not in seen for dep in depends):
            raise ValueError(f"event {event_id} depends on a missing or future event")
        for required in ("narration", "caption", "claim", "sourceNotes", "visualMode", "visualSpec", "transitionIn", "transitionOut", "reviewState"):
            if required not in event:
                raise ValueError(f"event {event_id} missing {required}")
        if event.get("reviewState") not in {"draft", "needs_review", "approved", "rejected"}:
            raise ValueError(f"event {event_id} reviewState is invalid")
        visual_spec = event.get("visualSpec")
        if not isinstance(visual_spec, dict) or visual_spec.get("sceneKind") not in {"hook", "powder_contact", "water_infiltration", "hydration_reaction", "network_growth", "hardening", "takeaway"}:
            raise ValueError(f"event {event_id} sceneKind is not supported")
        seen.add(event_id)
        normalized.append(event)
        previous_end = end
    if plan.get("reviewState") != "needs_review":
        raise ValueError("render requires plan reviewState=needs_review")
    return normalized


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


LABEL = load_font(20, True)
SMALL = load_font(19, False)
TITLE = load_font(57, True)
BODY = load_font(27, False)
HUGE = load_font(112, True)


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    output: list[str] = []
    for paragraph in text.split("\n"):
        current = ""
        for word in paragraph.split():
            candidate = f"{current} {word}".strip()
            if current and draw.textbbox((0, 0), candidate, font=font)[2] > max_width:
                output.append(current)
                current = word
            else:
                current = candidate
        if current:
            output.append(current)
    return output or [""]


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))  # type: ignore[return-value]


def base_frame(index: int, event_index: int, event: dict[str, Any]) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", ALLOWED_SIZE, (5, 10, 23))
    draw = ImageDraw.Draw(image)
    top = (5 + event_index * 3, 12 + event_index * 2, 32 + event_index * 5)
    bottom = (7, 26 + event_index * 3, 55 + event_index * 5)
    for y in range(0, ALLOWED_SIZE[1], 16):
        draw.rectangle((0, y, ALLOWED_SIZE[0], y + 16), fill=mix(top, bottom, y / 1279))
    drift = int(math.sin(index / 32 + event_index) * 18)
    draw.ellipse((450 + drift, -190, 900 + drift, 270), fill=(25, 51, 91))
    draw.ellipse((-250 - drift, 1010, 290 - drift, 1510), fill=(11, 47, 78))
    draw.rounded_rectangle((42, 42, 678, 1238), radius=30, outline=(59, 98, 136), width=3)
    accent = (94, 230, 210)
    draw.text((76, 82), f"AUTO3DVIDEO  ·  EVENT {event_index + 1:02d}", font=LABEL, fill=accent)
    draw.text((76, 117), str(event["visualMode"]).upper().replace("_", " "), font=SMALL, fill=(151, 178, 207))
    draw.line((76, 160, 248, 160), fill=accent, width=4)
    return image, draw


def title_body(draw: ImageDraw.ImageDraw, event: dict[str, Any]) -> None:
    spec = event["visualSpec"]
    title = str(event["caption"])
    y = 208
    for line in wrap(draw, title, TITLE, 568)[:3]:
        draw.text((76, y), line, font=TITLE, fill=(242, 247, 255))
        y += 68
    y = 430 if y <= 345 else 520
    for line in wrap(draw, str(spec["visibleAction"]), BODY, 568)[:4]:
        draw.text((76, y), line, font=BODY, fill=(190, 211, 233))
        y += 40


def footer(draw: ImageDraw.ImageDraw, event_index: int, phase: float, total: int) -> None:
    draw.line((76, 1050, 644, 1050), fill=(59, 98, 136), width=3)
    draw.text((76, 1090), "MINH HỌA GIÁO DỤC · CẦN KIỂM TRA CLAIM", font=SMALL, fill=(154, 180, 207))
    draw.rounded_rectangle((76, 1190, 644, 1202), radius=6, fill=(27, 52, 79))
    progress = int(568 * ((event_index + phase) / total))
    draw.rounded_rectangle((76, 1190, 76 + max(8, progress), 1202), radius=6, fill=(94, 230, 210))


def particle(draw: ImageDraw.ImageDraw, x: int, y: int, radius: int, color: tuple[int, int, int], outline: tuple[int, int, int] = (236, 247, 255)) -> None:
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color, outline=outline, width=3)


def draw_hook(draw: ImageDraw.ImageDraw, frame: int) -> None:
    cx, cy = 430, 790
    pulse = int(12 * math.sin(frame / 8))
    draw.ellipse((cx - 130 - pulse, cy - 130 - pulse, cx + 130 + pulse, cy + 130 + pulse), outline=(233, 163, 74), width=7)
    draw.ellipse((cx - 80, cy - 80, cx + 80, cy + 80), fill=(107, 91, 76), outline=(229, 191, 134), width=4)
    draw.ellipse((cx + 80, cy - 210 - frame // 5, cx + 145, cy - 145 - frame // 5), fill=(94, 211, 239), outline=(220, 250, 255), width=4)
    draw.line((cx + 112, cy - 145 - frame // 5, cx + 35, cy - 22), fill=(94, 211, 239), width=5)
    draw.text((145, 930), "?", font=HUGE, fill=(233, 163, 74))


def draw_powder(draw: ImageDraw.ImageDraw, frame: int) -> None:
    for i in range(16):
        x = 145 + (i * 71) % 430
        y = 820 + (i * 37) % 175
        particle(draw, x, y, 18 + (i % 3) * 4, (106 + i * 4, 113 + i * 3, 122 + i * 2), (184, 198, 211))
    for i in range(5):
        x = 180 + ((i * 105 + frame * 4) % 340)
        y = 620 + ((i * 57 + frame * 6) % 250)
        draw.line((x, y, x - 8, y + 30), fill=(102, 218, 239), width=4)
        draw.ellipse((x - 7, y - 10, x + 7, y + 10), fill=(102, 218, 239))
    draw.text((170, 1000), "NƯỚC TIẾP XÚC VỚI HẠT", font=LABEL, fill=(102, 218, 239))


def draw_infiltration(draw: ImageDraw.ImageDraw, frame: int) -> None:
    cx, cy = 360, 805
    draw.ellipse((cx - 190, cy - 190, cx + 190, cy + 190), fill=(93, 101, 114), outline=(204, 218, 232), width=5)
    for i in range(12):
        angle = i * math.tau / 12 + frame / 180
        px = cx + int(math.cos(angle) * 118)
        py = cy + int(math.sin(angle) * 118)
        particle(draw, px, py, 26, (123, 131, 142), (229, 235, 240))
    for i in range(7):
        t = (frame / 120 + i / 7) % 1
        x = int(170 + t * 380)
        y = int(610 + 210 * math.sin(t * math.pi) + i * 10)
        draw.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(94, 230, 240))
        draw.line((x, y, cx + int((x - cx) * 0.45), cy + int((y - cy) * 0.45)), fill=(94, 230, 240), width=3)
    draw.text((158, 1000), "NƯỚC ĐI VÀO CẤU TRÚC", font=LABEL, fill=(94, 230, 240))


def draw_reaction(draw: ImageDraw.ImageDraw, frame: int) -> None:
    cx, cy = 360, 805
    draw.ellipse((cx - 160, cy - 160, cx + 160, cy + 160), fill=(105, 113, 125), outline=(229, 236, 245), width=5)
    draw.pieslice((cx - 145, cy - 145, cx + 145, cy + 145), 205, 350, fill=(72, 80, 94))
    for ring in range(3):
        radius = 180 + ((frame * 3 + ring * 65) % 260)
        alpha = max(40, 230 - radius // 2)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=(242, 166, 75, alpha), width=5)
    for i in range(9):
        angle = frame / 70 + i * math.tau / 9
        x = cx + int(math.cos(angle) * 230)
        y = cy + int(math.sin(angle) * 230)
        particle(draw, x, y, 10, (242, 166, 75), (255, 236, 174))
    draw.text((200, 1000), "HYDRAT HÓA", font=LABEL, fill=(242, 166, 75))


def draw_network(draw: ImageDraw.ImageDraw, frame: int) -> None:
    nodes = [(180, 700), (330, 650), (500, 720), (190, 900), (370, 850), (550, 930), (280, 1030), (470, 1050)]
    edge_list = [(0, 1), (1, 2), (0, 3), (1, 4), (2, 4), (2, 5), (3, 4), (4, 5), (3, 6), (4, 6), (4, 7), (5, 7), (6, 7)]
    reveal = min(1.0, frame / 110)
    for edge_index, (a, b) in enumerate(edge_list):
        if reveal * len(edge_list) >= edge_index:
            draw.line((nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1]), fill=(94, 230, 210), width=6)
    for i, (x, y) in enumerate(nodes):
        particle(draw, x, y, 34, (112, 120, 133), (238, 246, 255))
        if i % 2 == 0:
            draw.ellipse((x - 11, y - 11, x + 11, y + 11), fill=(242, 166, 75))
    draw.text((178, 1125), "C-S-H · MẠNG LIÊN KẾT", font=LABEL, fill=(94, 230, 210))


def draw_hardening(draw: ImageDraw.ImageDraw, frame: int) -> None:
    phase = min(1.0, frame / 135)
    x0 = int(165 + 60 * phase)
    y0 = int(840 - 30 * phase)
    width = int(390 - 30 * phase)
    height = int(180 + 60 * phase)
    draw.rounded_rectangle((x0, y0, x0 + width, y0 + height), radius=int(40 - 18 * phase), fill=(111, 120, 133), outline=(231, 239, 247), width=6)
    for i in range(10):
        x = x0 + 35 + ((i * 71 + frame * 2) % max(50, width - 70))
        y = y0 + 35 + ((i * 43 + frame) % max(50, height - 70))
        draw.line((x, y, x + 24, y - 18), fill=(94, 230, 210), width=4)
    draw.text((216, 1080), "PASTE → ĐÔNG KẾT → CỨNG DẦN", font=LABEL, fill=(242, 166, 75))


def draw_takeaway(draw: ImageDraw.ImageDraw, frame: int) -> None:
    labels = [(115, "NƯỚC", (94, 230, 240)), (245, "HYDRAT", (242, 166, 75)), (390, "C-S-H", (178, 139, 238)), (525, "RẮN", (216, 228, 241))]
    for i, (x, label, color) in enumerate(labels):
        y = 780 + int(math.sin(frame / 15 + i) * 16)
        draw.rounded_rectangle((x, y, x + 100, y + 100), radius=18, fill=color)
        draw.text((x + 12, y + 124), label, font=SMALL, fill=(232, 242, 252))
        if i < len(labels) - 1:
            draw.line((x + 108, y + 50, x + 130, y + 50), fill=(242, 166, 75), width=6)
            draw.polygon([(x + 130, y + 50), (x + 116, y + 40), (x + 116, y + 60)], fill=(242, 166, 75))
    draw.text((150, 1040), "KHÔNG PHẢI TAN · LÀ PHẢN ỨNG", font=LABEL, fill=(94, 230, 210))


def render_event(draw: ImageDraw.ImageDraw, event: dict[str, Any], frame: int) -> None:
    kind = event["visualSpec"]["sceneKind"]
    if kind == "hook":
        draw_hook(draw, frame)
    elif kind in {"powder_contact", "water_infiltration"}:
        draw_powder(draw, frame) if kind == "powder_contact" else draw_infiltration(draw, frame)
    elif kind == "hydration_reaction":
        draw_reaction(draw, frame)
    elif kind == "network_growth":
        draw_network(draw, frame)
    elif kind == "hardening":
        draw_hardening(draw, frame)
    else:
        draw_takeaway(draw, frame)


def srt_time(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def render(workspace: Path, plan_relative: str, output_relative: str) -> int:
    try:
        plan = read_plan(workspace, plan_relative)
        events = validate_plan(plan)
        output_dir = workspace / safe_relative(output_relative, "outputDir")
        frames_dir = output_dir / "frames"
        output_dir.mkdir(parents=True, exist_ok=True)
        frames_dir.mkdir(parents=True, exist_ok=True)
        total_frames = events[-1]["endFrame"]
        frame_no = 1
        manifest_events: list[dict[str, Any]] = []
        captions: list[str] = []
        for event_index, event in enumerate(events):
            first = frame_no
            duration = event["durationFrames"]
            for local_frame in range(duration):
                image, draw = base_frame(local_frame, event_index, event)
                title_body(draw, event)
                render_event(draw, event, local_frame)
                footer(draw, event_index, local_frame / max(1, duration - 1), len(events))
                image.save(frames_dir / f"frame-{frame_no:06d}.png", format="PNG", optimize=True)
                frame_no += 1
            manifest_events.append({
                "eventId": event["eventId"],
                "sequence": event["sequence"],
                "startFrame": event["startFrame"],
                "endFrame": event["endFrame"],
                "durationFrames": duration,
                "visualMode": event["visualMode"],
                "sceneKind": event["visualSpec"]["sceneKind"],
                "transitionIn": event["transitionIn"],
                "transitionOut": event["transitionOut"],
                "reviewState": "needs_review",
                "rightsStatus": "generated-local",
                "externalAssetsUsed": False,
            })
            captions.append(f"{event_index + 1}\n{srt_time(event['startFrame'] / ALLOWED_FPS)} --> {srt_time(event['endFrame'] / ALLOWED_FPS)}\n{event['caption']}\n")
        manifest = {
            "schemaVersion": "1.0.0",
            "planId": plan["planId"],
            "width": ALLOWED_SIZE[0],
            "height": ALLOWED_SIZE[1],
            "frameRate": ALLOWED_FPS,
            "frameCount": total_frames,
            "durationSeconds": total_frames / ALLOWED_FPS,
            "framePattern": "frames/frame-%06d.png",
            "events": manifest_events,
            "captionsPath": "captions.srt",
            "sourcePlanSha256": hashlib.sha256(json.dumps(plan, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest(),
            "networkCallsMade": False,
            "externalAssetsUsed": False,
            "audioStatus": "not_generated",
            "rightsStatus": "generated-local",
            "reviewState": "needs_review",
            "message": "Original procedural mechanism-explainer frames; pseudo-3D is illustrative and not a scientific simulation.",
        }
        (output_dir / "scene-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (output_dir / "captions.srt").write_text("\n".join(captions), encoding="utf-8")
        return emit({"status": "succeeded", "frameCount": total_frames, "durationSeconds": total_frames / ALLOWED_FPS, "eventCount": len(events), "manifestPath": str((output_dir / "scene-manifest.json").relative_to(workspace)).replace("\\", "/"), "networkCallsMade": False, "externalAssetsUsed": False})
    except Exception as error:
        return emit({"status": "failed", "errorType": type(error).__name__, "message": str(error)[:500], "networkCallsMade": False, "externalAssetsUsed": False})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    return render(Path.cwd().resolve(), args.plan, args.output_dir)


if __name__ == "__main__":
    sys.exit(main())
