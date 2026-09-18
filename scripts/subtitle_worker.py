"""Bounded local SRT/VTT parser and serializer for Subtitle Studio."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

MAX_ENTRIES = 10_000
MAX_TEXT = 500
TIME_RE = re.compile(r"^(?:(\d{2,}):)?(\d{2}):(\d{2})[,.](\d{3})$")
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


def parse_time(value: str) -> float:
    match = TIME_RE.fullmatch(value.strip())
    if not match:
        raise ValueError(f"timestamp không hợp lệ: {value}")
    hours = int(match.group(1) or "0")
    minutes = int(match.group(2))
    seconds = int(match.group(3))
    millis = int(match.group(4))
    if minutes > 59 or seconds > 59:
        raise ValueError(f"timestamp vượt giới hạn: {value}")
    return hours * 3600 + minutes * 60 + seconds + millis / 1000


def format_time(seconds: float, separator: str) -> str:
    millis_total = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(millis_total, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def parse_blocks(content: str, fmt: str) -> list[dict[str, Any]]:
    content = content.lstrip("\ufeff")
    raw_blocks = re.split(r"\r?\n\s*\r?\n", content.strip()) if content.strip() else []
    entries: list[dict[str, Any]] = []
    for block in raw_blocks:
        lines = [line.rstrip("\r") for line in block.splitlines()]
        if not lines:
            continue
        if fmt == "vtt" and lines[0].strip().upper().startswith("WEBVTT"):
            continue
        timing_index = next((index for index, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        timing = lines[timing_index].split("-->", 1)
        if len(timing) != 2:
            raise ValueError("cue timestamp phải có -->")
        start = parse_time(timing[0].strip().split(" ", 1)[0])
        end = parse_time(timing[1].strip().split(" ", 1)[0])
        text_lines = lines[timing_index + 1 :]
        text = "\n".join(text_lines).strip()
        if not text:
            raise ValueError("cue không được rỗng")
        entries.append({
            "entryId": f"entry-{len(entries) + 1:04d}",
            "startSeconds": start,
            "endSeconds": end,
            "text": text,
        })
    return entries


def validate_document(document: dict[str, Any]) -> tuple[list[str], list[str], float]:
    required = {"schemaVersion", "documentId", "sourceVideoPath", "sourceLanguage", "targetLanguage", "durationSeconds", "format", "entries", "rightsStatus", "reviewState", "networkCallsMade"}
    missing = sorted(required - document.keys())
    if missing:
        raise ValueError(f"document thiếu field: {', '.join(missing)}")
    if document["schemaVersion"] != "1.0.0":
        raise ValueError("schemaVersion không được hỗ trợ")
    safe_relative_path(document["sourceVideoPath"], "sourceVideoPath")
    if document["format"] not in {"srt", "vtt"}:
        raise ValueError("format chỉ nhận srt hoặc vtt")
    duration = document["durationSeconds"]
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 0 < float(duration) <= 604800:
        raise ValueError("durationSeconds không hợp lệ")
    entries = document["entries"]
    if not isinstance(entries, list) or len(entries) > MAX_ENTRIES:
        raise ValueError("entries phải là array tối đa 10000 cue")
    errors: list[str] = []
    warnings: list[str] = []
    previous_end = -1.0
    max_cps = 0.0
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"entries[{index}] phải là object")
            continue
        start = entry.get("startSeconds")
        end = entry.get("endSeconds")
        text = entry.get("text")
        if not isinstance(start, (int, float)) or isinstance(start, bool) or not isinstance(end, (int, float)) or isinstance(end, bool):
            errors.append(f"entries[{index}] timestamp phải là số")
            continue
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            errors.append(f"entries[{index}] text rỗng hoặc vượt {MAX_TEXT} ký tự")
            continue
        if start < 0 or end <= start:
            errors.append(f"entries[{index}] end phải lớn hơn start")
        if end > float(duration) + 0.05:
            errors.append(f"entries[{index}] vượt duration video")
        if start < previous_end - 0.001:
            errors.append(f"entries[{index}] bị overlap với cue trước")
        previous_end = max(previous_end, float(end))
        visible_chars = len(re.sub(r"\s+", "", text))
        cps = visible_chars / max(float(end) - float(start), 0.001)
        max_cps = max(max_cps, cps)
        if cps > 20:
            warnings.append(f"entries[{index}] có tốc độ {cps:.1f} ký tự/giây, cần review")
        if "\n" not in text and len(text) > 72:
            warnings.append(f"entries[{index}] dài hơn 72 ký tự trên một dòng")
    return errors, warnings, max_cps


def make_document(request: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    source_path = safe_relative_path(request.get("sourceVideoPath", request.get("inputPath")), "sourceVideoPath")
    fmt = request.get("format", "srt")
    document = {
        "schemaVersion": "1.0.0",
        "documentId": request.get("documentId", "subtitle-draft"),
        "sourceVideoPath": source_path,
        "sourceLanguage": request.get("sourceLanguage", "und"),
        "targetLanguage": request.get("targetLanguage", request.get("sourceLanguage", "und")),
        "durationSeconds": float(request.get("durationSeconds", max((entry["endSeconds"] for entry in entries), default=1.0))),
        "format": fmt,
        "entries": entries,
        "rightsStatus": request.get("rightsStatus", "pending"),
        "reviewState": "draft",
        "networkCallsMade": False,
        "costStatus": "local_only",
        "notes": "Draft phụ đề local; cần người dùng review nội dung và timestamp.",
    }
    errors, warnings, max_cps = validate_document(document)
    if errors:
        raise ValueError("; ".join(errors[:8]))
    document["reviewState"] = "needs_review"
    document["validation"] = {"valid": True, "warnings": warnings, "maxCps": round(max_cps, 3)}
    return document


def serialize(document: dict[str, Any], fmt: str) -> str:
    errors, _, _ = validate_document(document)
    if errors:
        raise ValueError("; ".join(errors[:8]))
    chunks: list[str] = []
    if fmt == "vtt":
        chunks.append("WEBVTT\n")
    for index, entry in enumerate(document["entries"], start=1):
        separator = "." if fmt == "vtt" else ","
        if fmt == "srt":
            chunks.append(str(index))
        chunks.append(f"{format_time(float(entry['startSeconds']), separator)} --> {format_time(float(entry['endSeconds']), separator)}")
        chunks.append(str(entry["text"]).strip())
        chunks.append("")
    return "\n".join(chunks).rstrip() + "\n"


def handle(request: dict[str, Any], workspace: Path) -> dict[str, Any]:
    operation = request.get("operation")
    if operation == "load":
        input_relative = safe_relative_path(request.get("inputPath"), "inputPath")
        input_path = workspace / input_relative
        if not input_path.is_file():
            raise ValueError("subtitle input không tồn tại trong workspace")
        fmt = request.get("format") or ("vtt" if input_path.suffix.lower() == ".vtt" else "srt")
        if fmt not in {"srt", "vtt"}:
            raise ValueError("subtitle input chỉ nhận .srt hoặc .vtt")
        entries = parse_blocks(input_path.read_text(encoding="utf-8-sig"), fmt)
        document = make_document(request, entries)
        document["sourceSubtitlePath"] = input_relative
        return {"status": "succeeded", "document": document, "networkCallsMade": False}
    if operation == "save":
        document = request.get("document")
        if not isinstance(document, dict):
            raise ValueError("document phải là object")
        output_relative = safe_relative_path(request.get("outputPath"), "outputPath")
        output_path = workspace / output_relative
        if output_path.exists():
            raise ValueError("subtitle output đã tồn tại; không ghi đè")
        fmt = request.get("format") or document.get("format", "srt")
        if fmt not in {"srt", "vtt"}:
            raise ValueError("format chỉ nhận srt hoặc vtt")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(serialize(document, fmt), encoding="utf-8", newline="\n")
        return {"status": "succeeded", "outputPath": output_relative, "format": fmt, "networkCallsMade": False}
    raise ValueError("operation không được hỗ trợ")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        request_path = Path(args.request)
        request = load_json(request_path)
        workspace = Path.cwd().resolve()
        result = handle(request, workspace)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:  # boundary result is intentionally concise and non-secret
        print(json.dumps({"status": "failed", "networkCallsMade": False, "message": str(error)}, ensure_ascii=False, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    sys.exit(main())
