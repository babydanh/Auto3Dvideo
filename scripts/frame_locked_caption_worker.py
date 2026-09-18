"""Create frame-locked caption evidence and a derived SRT sidecar.

Integer frame ranges are canonical. SRT milliseconds are only a derived export,
so a later editor can reconstruct the exact cue boundaries from the JSON plan.
The worker is local, bounded and refuses overwrite/path traversal.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

MAX_CUES = 10_000
MAX_TEXT = 500
SAFE_RELATIVE_RE = re.compile(r"^[A-Za-z0-9_./\\-]+$")


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("request JSON phải là object")
    return value


def safe_relative_path(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} phải là đường dẫn tương đối không rỗng")
    normalized = value.strip().replace("\\", "/")
    if normalized.startswith(("/", "//")) or "://" in normalized or (len(normalized) > 1 and normalized[1] == ":"):
        raise ValueError(f"{field} phải nằm trong workspace")
    parts = normalized.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"{field} chứa path traversal hoặc segment rỗng")
    if not SAFE_RELATIVE_RE.fullmatch(normalized):
        raise ValueError(f"{field} chứa ký tự không được phép")
    return normalized


def require_int(value: Any, field: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{field} phải là số nguyên >= {minimum}")
    return value


def frame_to_millis(frame: int, frame_rate: float, end: bool = False) -> int:
    exact = frame * 1000.0 / frame_rate
    # The half-open frame interval [startFrame, endFrame) is preserved as far as
    # a millisecond sidecar allows. The frame JSON remains the exact source.
    return int(math.ceil(exact - 1e-9) if end else math.floor(exact + 1e-9))


def format_srt_time(milliseconds: int) -> str:
    milliseconds = max(0, int(milliseconds))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def validate_words(words: Any, cue_start: int, cue_end: int, index: int) -> None:
    if words is None:
        return
    if not isinstance(words, list) or len(words) > 500:
        raise ValueError(f"cues[{index}].words phải là array tối đa 500 phần tử")
    previous_end = cue_start
    for word_index, word in enumerate(words):
        if not isinstance(word, dict):
            raise ValueError(f"cues[{index}].words[{word_index}] phải là object")
        text = word.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 120:
            raise ValueError(f"cues[{index}].words[{word_index}].text không hợp lệ")
        start = require_int(word.get("startFrame"), f"cues[{index}].words[{word_index}].startFrame")
        end = require_int(word.get("endFrame"), f"cues[{index}].words[{word_index}].endFrame", 1)
        if start < cue_start or end > cue_end or end <= start:
            raise ValueError(f"cues[{index}].words[{word_index}] nằm ngoài cue hoặc có range rỗng")
        if start < previous_end:
            raise ValueError(f"cues[{index}].words[{word_index}] bị overlap")
        previous_end = end


def validate_cues(cues: Any, duration_frames: int, frame_rate: float) -> tuple[list[dict[str, Any]], list[str], float]:
    if not isinstance(cues, list) or not cues or len(cues) > MAX_CUES:
        raise ValueError(f"cues phải là array 1..{MAX_CUES} phần tử")
    normalized: list[dict[str, Any]] = []
    warnings: list[str] = []
    previous_end = 0
    max_cps = 0.0
    for index, raw in enumerate(cues):
        if not isinstance(raw, dict):
            raise ValueError(f"cues[{index}] phải là object")
        cue_id = raw.get("cueId", f"cue-{index + 1:04d}")
        if not isinstance(cue_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,95}", cue_id):
            raise ValueError(f"cues[{index}].cueId không hợp lệ")
        text = raw.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            raise ValueError(f"cues[{index}].text rỗng hoặc vượt {MAX_TEXT} ký tự")
        start = require_int(raw.get("startFrame"), f"cues[{index}].startFrame")
        end = require_int(raw.get("endFrame"), f"cues[{index}].endFrame", 1)
        if end <= start:
            raise ValueError(f"cues[{index}] endFrame phải lớn hơn startFrame")
        if end > duration_frames:
            raise ValueError(f"cues[{index}] vượt durationFrames")
        if start < previous_end:
            raise ValueError(f"cues[{index}] bị overlap với cue trước")
        validate_words(raw.get("words"), start, end, index)
        duration_seconds = (end - start) / frame_rate
        cps = len(re.sub(r"\s+", "", text)) / max(duration_seconds, 0.001)
        max_cps = max(max_cps, cps)
        if cps > 20:
            warnings.append(f"cues[{index}] có tốc độ {cps:.1f} ký tự/giây, cần review")
        if "\n" not in text and len(text) > 72:
            warnings.append(f"cues[{index}] dài hơn 72 ký tự trên một dòng")
        normalized.append({**raw, "cueId": cue_id, "startFrame": start, "endFrame": end, "text": text.strip()})
        previous_end = end
    return normalized, warnings, max_cps


def build_plan(request: dict[str, Any]) -> dict[str, Any]:
    frame_rate = request.get("frameRate", 30)
    if isinstance(frame_rate, bool) or not isinstance(frame_rate, (int, float)) or not math.isfinite(float(frame_rate)) or not 0 < float(frame_rate) <= 240:
        raise ValueError("frameRate phải là số hữu hạn trong (0, 240]")
    duration_frames = require_int(request.get("durationFrames"), "durationFrames", 1)
    cues, warnings, max_cps = validate_cues(request.get("cues", request.get("segments")), duration_frames, float(frame_rate))
    source_audio = safe_relative_path(request.get("sourceAudioPath"), "sourceAudioPath")
    source_video = safe_relative_path(request.get("sourceVideoPath"), "sourceVideoPath")
    language = request.get("language", "vi-VN")
    if not isinstance(language, str) or not re.fullmatch(r"[a-z]{2,3}(?:-[A-Z]{2})?", language):
        raise ValueError("language không hợp lệ")
    alignment_source = request.get("alignmentSource", "manual")
    if alignment_source not in {"whisperx", "whisper", "provider", "script", "manual", "mock"}:
        raise ValueError("alignmentSource không được hỗ trợ")
    plan_id = request.get("planId", "frame-caption-plan")
    if not isinstance(plan_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,95}", plan_id):
        raise ValueError("planId không hợp lệ")
    alignment_state = request.get("alignmentState", "needs_review")
    if alignment_state not in {"aligned", "needs_review", "blocked"}:
        raise ValueError("alignmentState không được hỗ trợ")
    rights_status = request.get("rightsStatus", "pending")
    if rights_status not in {"pending", "user_owned", "licensed", "public_domain", "blocked"}:
        raise ValueError("rightsStatus không được hỗ trợ")
    cost_status = request.get("costStatus", "local_only")
    if cost_status not in {"not_called", "local_only", "unknown", "estimated", "approved"}:
        raise ValueError("costStatus không được hỗ trợ")
    return {
        "schemaVersion": "1.0.0",
        "planId": plan_id,
        "sourceAudioPath": source_audio,
        "sourceVideoPath": source_video,
        "language": language,
        "frameRate": float(frame_rate),
        "durationFrames": duration_frames,
        "timebase": "integer_frames",
        "roundingRule": "frame_source_of_truth",
        "alignmentSource": alignment_source,
        "alignmentState": alignment_state,
        "cues": cues,
        "reviewState": "needs_review",
        "rightsStatus": rights_status,
        "networkCallsMade": bool(request.get("networkCallsMade", False)),
        "costStatus": cost_status,
        "validation": {"valid": True, "warnings": warnings, "maxCps": round(max_cps, 3)},
    }


def serialize_srt(plan: dict[str, Any]) -> str:
    fps = float(plan["frameRate"])
    chunks: list[str] = []
    for index, cue in enumerate(plan["cues"], start=1):
        start = frame_to_millis(int(cue["startFrame"]), fps, end=False)
        end = frame_to_millis(int(cue["endFrame"]), fps, end=True)
        chunks.extend([str(index), f"{format_srt_time(start)} --> {format_srt_time(end)}", str(cue["text"]).strip(), ""])
    return "\n".join(chunks).rstrip() + "\n"


def write_new(path: Path, content: str) -> None:
    if path.exists():
        raise ValueError(f"output đã tồn tại, không ghi đè: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def handle(request: dict[str, Any], workspace: Path) -> dict[str, Any]:
    if request.get("operation", "build") != "build":
        raise ValueError("operation chỉ hỗ trợ build")
    plan = build_plan(request)
    output_plan = request.get("outputPlanPath")
    output_srt = request.get("outputSrtPath")
    if output_plan:
        output_plan_relative = safe_relative_path(output_plan, "outputPlanPath")
        write_new(workspace / output_plan_relative, json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    else:
        output_plan_relative = None
    if output_srt:
        output_srt_relative = safe_relative_path(output_srt, "outputSrtPath")
        write_new(workspace / output_srt_relative, serialize_srt(plan))
    else:
        output_srt_relative = None
    return {"status": "succeeded", "plan": plan, "outputPlanPath": output_plan_relative, "outputSrtPath": output_srt_relative, "networkCallsMade": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        result = handle(load_json(Path(args.request)), Path.cwd().resolve())
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:
        print(json.dumps({"status": "failed", "networkCallsMade": False, "message": str(error)}, ensure_ascii=False, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    sys.exit(main())
