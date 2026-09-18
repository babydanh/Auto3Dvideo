"""Validate a typed local media plan without spawning FFmpeg or FFprobe."""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

ALLOWED_OPERATIONS = {
    "probe",
    "normalize",
    "concat",
    "mux",
    "subtitle",
    "thumbnail",
    "variant",
    "image_sequence",
    "audio_normalize",
    "caption_generate",
}
ALLOWED_EXECUTABLES = {"ffmpeg", "ffprobe"}
ALLOWED_INPUT_KINDS = {"video", "audio", "image", "subtitle", "metadata", "image_sequence"}
ALLOWED_OUTPUT_KINDS = {"video", "audio", "thumbnail", "subtitle", "metadata"}
ALLOWED_CONTAINERS = {"mp4", "mov", "webm", "mkv", "wav", "mp3", "png", "srt", "vtt", "json"}
ALLOWED_VIDEO_CODECS = {"h264", "hevc", "vp9", "av1", "prores", "png"}
ALLOWED_AUDIO_CODECS = {"aac", "opus", "pcm_s16le", "mp3"}
TOP_LEVEL_FIELDS = {
    "schemaVersion",
    "planId",
    "operation",
    "executableId",
    "workingDirectory",
    "inputs",
    "output",
    "target",
    "expectedDurationSeconds",
    "timeoutSeconds",
    "dryRun",
    "externalPublish",
    "paidGeneration",
}
INPUT_FIELDS = {"relativePath", "kind", "required"}
OUTPUT_FIELDS = {"relativePath", "kind", "overwritePolicy"}
TARGET_FIELDS = {
    "width",
    "height",
    "frameRate",
    "container",
    "videoCodec",
    "audioCodec",
    "audioRequired",
    "captionMode",
    "captionLocale",
}
IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
LOCALE_RE = re.compile(r"^[a-z]{2}(?:-[A-Z]{2})?$")


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("media plan root must be an object")
    return value


def safe_relative(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    normalized = value.strip().replace("\\", "/")
    if normalized.startswith("/") or (len(normalized) >= 2 and normalized[1] == ":"):
        return False
    return "\x00" not in normalized and ".." not in normalized.split("/")


def finite_positive(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def validate_media_plan(plan: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    unknown = sorted(set(plan) - TOP_LEVEL_FIELDS)
    if unknown:
        errors.append(f"unknown top-level fields: {', '.join(unknown)}")
    if plan.get("schemaVersion") != "1.0.0":
        errors.append("schemaVersion must be 1.0.0")
    if not isinstance(plan.get("planId"), str) or not IDENTIFIER_RE.fullmatch(plan["planId"]):
        errors.append("planId is invalid")
    operation = plan.get("operation")
    executable_id = plan.get("executableId")
    if operation not in ALLOWED_OPERATIONS:
        errors.append("operation is unsupported")
    if executable_id not in ALLOWED_EXECUTABLES:
        errors.append("executableId is unsupported")
    if operation == "probe" and executable_id != "ffprobe":
        errors.append("probe must use ffprobe")
    if operation in ALLOWED_OPERATIONS - {"probe"} and executable_id != "ffmpeg":
        errors.append("media transform must use ffmpeg")
    if not safe_relative(plan.get("workingDirectory")):
        errors.append("workingDirectory must be relative and traversal-free")

    inputs = plan.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        errors.append("inputs must be a non-empty array")
        inputs = []
    input_kinds: set[str] = set()
    for index, item in enumerate(inputs):
        prefix = f"inputs[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix} must be an object")
            continue
        unknown_input = sorted(set(item) - INPUT_FIELDS)
        if unknown_input:
            errors.append(f"{prefix} has unknown fields: {', '.join(unknown_input)}")
        if not safe_relative(item.get("relativePath")):
            errors.append(f"{prefix}.relativePath is unsafe")
        kind = item.get("kind")
        if kind not in ALLOWED_INPUT_KINDS:
            errors.append(f"{prefix}.kind is unsupported")
        else:
            input_kinds.add(kind)
        if "required" in item and not isinstance(item["required"], bool):
            errors.append(f"{prefix}.required must be boolean")

    output = plan.get("output")
    if not isinstance(output, dict):
        errors.append("output must be an object")
        output = {}
    unknown_output = sorted(set(output) - OUTPUT_FIELDS)
    if unknown_output:
        errors.append(f"output has unknown fields: {', '.join(unknown_output)}")
    if not safe_relative(output.get("relativePath")):
        errors.append("output.relativePath is unsafe")
    if output.get("kind") not in ALLOWED_OUTPUT_KINDS:
        errors.append("output.kind is unsupported")
    if output.get("overwritePolicy") not in {"fail", "versioned"}:
        errors.append("output.overwritePolicy is unsupported")

    target = plan.get("target", {})
    if not isinstance(target, dict):
        errors.append("target must be an object")
        target = {}
    unknown_target = sorted(set(target) - TARGET_FIELDS)
    if unknown_target:
        errors.append(f"target has unknown fields: {', '.join(unknown_target)}")
    for field in ("width", "height"):
        if field in target and (isinstance(target[field], bool) or not isinstance(target[field], int) or not 16 <= target[field] <= 16384):
            errors.append(f"target.{field} is outside 16..16384")
    if "frameRate" in target and (not finite_positive(target["frameRate"]) or target["frameRate"] > 240):
        errors.append("target.frameRate is outside (0, 240]")
    if target.get("container") not in {None, *ALLOWED_CONTAINERS}:
        errors.append("target.container is unsupported")
    if target.get("videoCodec") not in {None, *ALLOWED_VIDEO_CODECS}:
        errors.append("target.videoCodec is unsupported")
    if target.get("audioCodec") not in {None, *ALLOWED_AUDIO_CODECS}:
        errors.append("target.audioCodec is unsupported")
    for field in ("audioRequired",):
        if field in target and not isinstance(target[field], bool):
            errors.append(f"target.{field} must be boolean")
    if target.get("captionMode") not in {None, "none", "sidecar", "burned"}:
        errors.append("target.captionMode is unsupported")
    if target.get("captionLocale") is not None and (
        not isinstance(target["captionLocale"], str) or not LOCALE_RE.fullmatch(target["captionLocale"])
    ):
        errors.append("target.captionLocale is invalid")
    if target.get("audioRequired") is True and "audio" not in input_kinds:
        errors.append("audioRequired needs an audio input")
    if target.get("captionMode") in {"sidecar", "burned"} and "subtitle" not in input_kinds and operation != "caption_generate":
        errors.append("caption mode needs a subtitle input or caption_generate operation")

    expected_duration = plan.get("expectedDurationSeconds")
    if expected_duration is not None and not finite_positive(expected_duration):
        errors.append("expectedDurationSeconds must be finite and positive")
    timeout = plan.get("timeoutSeconds")
    if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 604800:
        errors.append("timeoutSeconds must be an integer in 1..604800")
    if plan.get("dryRun") is not True:
        errors.append("dryRun must be true for this pre-native planner")
    if plan.get("externalPublish") is not False:
        errors.append("externalPublish must be false")
    if plan.get("paidGeneration") is not False:
        errors.append("paidGeneration must be false")
    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, help="Path to a media-plan JSON file")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        plan = read_json(Path(args.plan))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"MEDIA_PLAN_INVALID: {error}")
        return 1
    errors = validate_media_plan(plan)
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 1
    print("MEDIA_PLAN_VALID")
    print(f"plan={Path(args.plan).expanduser().resolve()}")
    print("dry_run=true")
    print("external_publish=false")
    print("paid_generation=false")
    print("process_spawned=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
