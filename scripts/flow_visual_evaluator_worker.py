"""Bounded Gemini visual evaluator for one downloaded Google Flow image.

This worker is deliberately separate from the browser action planner.  It gets
one validated local image plus the current shot contract, asks the configured
9router model for strict JSON, and never performs a browser action or approves
paid generation.  A malformed/ambiguous answer is an explicit review block.
"""

from __future__ import annotations

import base64
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

MAX_REQUEST_BYTES = 96 * 1024
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_REFERENCE_BYTES = 4 * 1024 * 1024
MAX_REFERENCES = 3
MAX_PROMPT_CHARS = 12_000
MAX_RESPONSE_CHARS = 16_000
MAX_TOKENS = 900
COMMAND_CODE_BASE_URL = "https://api.commandcode.ai/provider/v1"
LOCAL_GATEWAY_BASE_URL = "http://localhost:20128/v1"
ALLOWED_BASE_URLS = {
    COMMAND_CODE_BASE_URL,
    LOCAL_GATEWAY_BASE_URL,
    "http://127.0.0.1:20128/v1",
}
ALLOWED_MODELS = {
    "ag/gemini-3.8-flash-high",
    "ag/gemini-3.8-flash-medium",
    "antigravity/gemini-3.8-flash-high",
    "antigravity/gemini-3.8-flash-medium",
}
IMAGE_MIMES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")), flush=True)
    return 0 if payload.get("status") == "succeeded" else 1


def read_dotenv_value(path: Path, target_key: str) -> str:
    if not path.is_file() or path.stat().st_size > 128 * 1024:
        return ""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            assignment = stripped.removeprefix("export ")
            key, separator, raw_value = assignment.partition("=")
            if separator and key.strip() == target_key:
                value = raw_value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                    value = value[1:-1]
                return value
    except (OSError, UnicodeError):
        return ""
    return ""


def find_dotenv() -> Path | None:
    explicit = os.environ.get("AUTO3DVIDEO_DOTENV_PATH", "").strip()
    candidates = [Path(explicit)] if explicit else []
    current = Path.cwd()
    candidates.append(current / ".env")
    if current.name.lower() == "desktop" and current.parent:
        candidates.append(current.parent / ".env")
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    return None


def read_local_router_api_key(base_url: str) -> str:
    if base_url not in {LOCAL_GATEWAY_BASE_URL, "http://127.0.0.1:20128/v1"}:
        return ""
    candidates: list[Path] = []
    appdata = os.environ.get("APPDATA", "").strip()
    if appdata:
        candidates.append(Path(appdata) / "9router" / "db" / "data.sqlite")
    candidates.append(Path.home() / "AppData" / "Roaming" / "9router" / "db" / "data.sqlite")
    candidates.append(
        Path.home()
        / "AppData"
        / "Roaming"
        / "npm"
        / "node_modules"
        / "9router"
        / "app"
        / "cli"
        / ".build-home"
        / ".9router"
        / "db"
        / "data.sqlite"
    )
    seen: set[Path] = set()
    for database in candidates:
        try:
            database = database.resolve()
        except OSError:
            continue
        if database in seen or not database.is_file():
            continue
        seen.add(database)
        try:
            with sqlite3.connect(str(database), timeout=0.5) as connection:
                row = connection.execute(
                    "SELECT key FROM apiKeys WHERE isActive = 1 "
                    "ORDER BY createdAt DESC LIMIT 1"
                ).fetchone()
            key = row[0].strip() if row and isinstance(row[0], str) else ""
            if key.startswith("sk-") and len(key) <= 256:
                return key
        except (OSError, sqlite3.Error):
            continue
    return ""


def safe_relative_path(raw: Any, field: str) -> Path:
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 512:
        raise ValueError(f"{field} không hợp lệ")
    relative = Path(raw.replace("\\", "/"))
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.as_posix().split("/")):
        raise ValueError(f"{field} phải là đường dẫn tương đối trong workspace")
    return relative


def local_image_data_url(raw_path: Any, field: str, max_bytes: int) -> tuple[str, str]:
    relative = safe_relative_path(raw_path, field)
    root = Path.cwd().resolve()
    target = (root / relative).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError(f"{field} vượt workspace") from error
    if target.suffix.lower() not in IMAGE_MIMES or not target.is_file():
        raise ValueError(f"{field} phải là PNG/JPEG/WebP tồn tại")
    data = target.read_bytes()
    if not data or len(data) > max_bytes:
        raise ValueError(f"{field} rỗng hoặc vượt giới hạn")
    mime = IMAGE_MIMES[target.suffix.lower()]
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}", relative.as_posix()


def load_request(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > MAX_REQUEST_BYTES:
        raise ValueError("evaluator request không tồn tại hoặc vượt giới hạn")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("evaluator request phải là object")
    allowed = {
        "model", "shotId", "revisionId", "prompt", "negativePrompt", "continuityNotes",
        "imagePath", "referencePaths", "maxTokens", "zeroDataRetention",
    }
    if set(document) - allowed:
        raise ValueError("evaluator request chứa field không được phép")
    model = document.get("model")
    if model not in ALLOWED_MODELS:
        raise ValueError("evaluator model không nằm trong allowlist")
    for field in ("shotId", "revisionId"):
        value = document.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > 80:
            raise ValueError(f"{field} không hợp lệ")
    for field in ("prompt", "negativePrompt", "continuityNotes"):
        value = document.get(field, "")
        if not isinstance(value, str) or len(value) > MAX_PROMPT_CHARS:
            raise ValueError(f"{field} vượt giới hạn")
    if document.get("zeroDataRetention") is not True:
        raise ValueError("evaluator phải bật zeroDataRetention")
    references = document.get("referencePaths", [])
    if not isinstance(references, list) or len(references) > MAX_REFERENCES:
        raise ValueError("referencePaths phải có tối đa 3 ảnh")
    max_tokens = document.get("maxTokens", MAX_TOKENS)
    if not isinstance(max_tokens, int) or not 256 <= max_tokens <= MAX_TOKENS:
        raise ValueError("maxTokens phải trong khoảng 256..900")
    if not document.get("imagePath"):
        raise ValueError("thiếu imagePath")
    return document


def parse_openai_response(body: bytes) -> str:
    text = body.decode("utf-8", errors="replace")
    if "data:" not in text:
        payload = json.loads(text)
        return str(payload["choices"][0]["message"]["content"])
    parts: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        fragment = line[5:].strip()
        if not fragment or fragment == "[DONE]":
            continue
        chunk = json.loads(fragment)
        choices = chunk.get("choices") if isinstance(chunk, dict) else None
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            continue
        choice = choices[0]
        delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
        message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
        value = delta.get("content") or message.get("content") or choice.get("text")
        if isinstance(value, str):
            parts.append(value)
    if not parts:
        raise ValueError("SSE response không có content")
    return "".join(parts)


def response_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Gemini không trả object JSON")
    payload = json.loads(text[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("evaluator JSON không phải object")
    return payload


def validate_evaluation(payload: dict[str, Any]) -> dict[str, Any]:
    expected_fields = {
        "decision",
        "overallScore",
        "confidence",
        "criteria",
        "flags",
        "revisionInstruction",
        "summary",
    }
    if set(payload) != expected_fields:
        raise ValueError("evaluator JSON phải có đúng bộ field bắt buộc")
    decision = payload.get("decision")
    if decision not in {"pass", "revise", "needs_review"}:
        raise ValueError("decision không nằm trong allowlist")
    score = payload.get("overallScore")
    confidence = payload.get("confidence")
    if not isinstance(score, (int, float)) or not 0 <= float(score) <= 100:
        raise ValueError("overallScore phải nằm trong 0..100")
    if not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
        raise ValueError("confidence phải nằm trong 0..1")
    criteria = payload.get("criteria")
    if not isinstance(criteria, dict):
        raise ValueError("criteria phải là object")
    required_scores = {"promptAdherence", "identity", "composition", "lighting", "continuity"}
    if set(criteria) != required_scores:
        raise ValueError("criteria phải đủ đúng 5 điểm kiểm tra")
    for key, value in criteria.items():
        if not isinstance(value, (int, float)) or not 0 <= float(value) <= 100:
            raise ValueError(f"criteria.{key} không nằm trong 0..100")
    flags = payload.get("flags", [])
    if not isinstance(flags, list) or not all(isinstance(value, str) for value in flags[:12]):
        raise ValueError("flags không hợp lệ")
    revision = payload.get("revisionInstruction", "")
    summary = payload.get("summary", "")
    if not isinstance(revision, str) or len(revision) > 2_000:
        raise ValueError("revisionInstruction không hợp lệ")
    if not isinstance(summary, str) or not summary.strip() or len(summary) > 2_000:
        raise ValueError("summary không hợp lệ")
    return {
        "decision": decision,
        "overallScore": round(float(score), 2),
        "confidence": round(float(confidence), 3),
        "criteria": {key: round(float(criteria[key]), 2) for key in sorted(required_scores)},
        "flags": flags[:12],
        "revisionInstruction": revision,
        "summary": summary,
    }


def run(request_path: Path) -> int:
    try:
        request = load_request(request_path)
        image_url, image_path = local_image_data_url(request["imagePath"], "imagePath", MAX_IMAGE_BYTES)
        content: list[dict[str, Any]] = [{"type": "text", "text": (
            "SHOT_ID: " + request["shotId"] + "\nREVISION_ID: " + request["revisionId"] +
            "\nPROMPT:\n" + request.get("prompt", "") +
            "\nNEGATIVE:\n" + request.get("negativePrompt", "") +
            "\nCONTINUITY:\n" + request.get("continuityNotes", "") +
            "\nEvaluate only the attached output image."
        )}, {"type": "image_url", "image_url": {"url": image_url, "detail": "high"}}]
        reference_paths: list[str] = []
        for index, raw_path in enumerate(request.get("referencePaths", [])):
            reference_url, reference_path = local_image_data_url(raw_path, f"referencePaths[{index}]", MAX_REFERENCE_BYTES)
            reference_paths.append(reference_path)
            content.append({"type": "text", "text": f"REFERENCE_IMAGE_{index + 1}"})
            content.append({"type": "image_url", "image_url": {"url": reference_url, "detail": "low"}})

        system = (
            "You are a strict visual QA reviewer for one cinematic 3D shot. "
            "Compare the output image against the prompt, negative constraints, continuity notes, "
            "and optional reference images. Return JSON only with exactly these top-level fields: "
            "decision (pass|revise|needs_review), overallScore (0..100), confidence (0..1), "
            "criteria (object with exactly promptAdherence, identity, composition, lighting, continuity, each 0..100), "
            "flags (array of short strings), revisionInstruction (string), summary (string). "
            "Use revise for a concrete visual mismatch, needs_review for uncertainty/occlusion, and pass only when "
            "the image is usable as the current shot reference. Do not judge rights or payment. Do not invent details."
        )
        dotenv = find_dotenv()
        configured_base_url = os.environ.get("AUTO3DVIDEO_LLM_BASE_URL", "").strip() or (
            read_dotenv_value(dotenv, "AUTO3DVIDEO_LLM_BASE_URL") if dotenv else ""
        )
        if configured_base_url not in ALLOWED_BASE_URLS:
            return emit({"status": "invalid_configuration", "networkCallsMade": False, "costStatus": "not_called", "message": "LLM base URL không nằm trong allowlist evaluator."})
        key = read_local_router_api_key(configured_base_url) or os.environ.get("AUTO3DVIDEO_LLM_API_KEY", "").strip() or (
            read_dotenv_value(dotenv, "AUTO3DVIDEO_LLM_API_KEY") if dotenv else ""
        )
        if not key:
            return emit({"status": "missing_credential", "networkCallsMade": False, "costStatus": "not_called", "message": "Không thấy active API key của 9router local."})
        model = request["model"]
        messages = [{"role": "system", "content": system}, {"role": "user", "content": content}]
        body = json.dumps({"model": model, "messages": messages, "max_tokens": request.get("maxTokens", MAX_TOKENS), "stream": True}, ensure_ascii=False).encode("utf-8")
        request_object = urllib.request.Request(
            f"{configured_base_url.rstrip('/')}/chat/completions",
            data=body,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "text/event-stream", "x-cmd-zdr": "1", "User-Agent": "Auto3Dvideo-flow-visual-evaluator/0.1"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request_object, timeout=90) as response:
                status_code = response.status
                response_body = response.read(8 * 1024 * 1024)
        except urllib.error.HTTPError as error:
            return emit({"status": "http_error", "httpStatus": error.code, "networkCallsMade": True, "costStatus": "provider_deal_unverified", "message": "Evaluator provider trả HTTP error."})
        except (urllib.error.URLError, TimeoutError, OSError):
            return emit({"status": "network_error", "networkCallsMade": True, "costStatus": "provider_deal_unverified", "message": "Không kết nối được evaluator provider."})
        try:
            evaluated = validate_evaluation(response_json(parse_openai_response(response_body)))
        except (ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
            return emit({"status": "invalid_response", "httpStatus": status_code, "networkCallsMade": True, "costStatus": "provider_deal_unverified", "message": f"Gemini evaluator trả JSON không hợp lệ: {type(error).__name__}"})
        return emit({
            "status": "succeeded", "httpStatus": status_code, "model": model,
            "imagePath": image_path, "referencePaths": reference_paths,
            "networkCallsMade": True, "costStatus": "provider_declared_free_while_capacity_last",
            **evaluated,
        })
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        return emit({"status": "invalid_request", "networkCallsMade": False, "costStatus": "not_called", "message": f"Evaluator request không hợp lệ: {type(error).__name__}"})


def main() -> int:
    try:
        if len(sys.argv) != 3 or sys.argv[1] != "--request":
            return emit({"status": "invalid_request", "message": "evaluator cần --request <relative-json>"})
        request_path = Path(sys.argv[2])
        if request_path.is_absolute() or any(part in {"", ".", ".."} for part in request_path.as_posix().split("/")):
            return emit({"status": "invalid_request", "message": "request path phải tương đối an toàn"})
        return run(Path.cwd().resolve() / request_path)
    except Exception as error:  # noqa: BLE001 - preserve one-line protocol
        return emit({"status": "internal_error", "networkCallsMade": False, "costStatus": "unknown", "message": f"Evaluator worker internal error: {type(error).__name__}"})


if __name__ == "__main__":
    sys.exit(main())
