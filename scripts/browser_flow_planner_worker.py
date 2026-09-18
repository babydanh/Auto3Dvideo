#!/usr/bin/env python3
"""Bounded Google Flow BrowserMCP planner.

The model may propose one typed browser action from a fresh accessibility
snapshot plus the matching BrowserMCP screenshot. It never receives browser
credentials, never executes a tool, and never receives permission to invent a
ref. Rust validates the returned action against the fresh snapshot before
calling BrowserMCP.
"""

from __future__ import annotations

import json
import base64
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

MAX_REQUEST_BYTES = 384 * 1024
MAX_PROMPT_CHARS = 72_000
MAX_RESPONSE_CHARS = 12_000
MAX_TOKENS = 512
MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
COMMAND_CODE_BASE_URL = "https://api.commandcode.ai/provider/v1"
LOCAL_GATEWAY_BASE_URL = "http://localhost:20128/v1"
ALLOWED_BASE_URLS = {
    COMMAND_CODE_BASE_URL,
    LOCAL_GATEWAY_BASE_URL,
    "http://127.0.0.1:20128/v1",
}
ALLOWED_MODELS = {
    "poolside/laguna-s-2.1-free",
    "cmd/poolside/laguna-s-2.1-free",
    "cmd/meta/muse-spark-1.2-contributor",
    "cmc/meta/muse-spark-1.3-contributor",
    "ag/gemini-3.8-flash-medium",
    "ag/gemini-3.8-flash-low",
    "ag/gemini-3.8-flash-high",
    "ag/gemini-3.7-flash-medium",
    "ag/gemini-3.7-flash-low",
    "ag/gemini-3.7-flash-high",
    "antigravity/gemini-3.8-flash-medium",
    "antigravity/gemini-3.8-flash-low",
    "antigravity/gemini-3.8-flash-high",
    "antigravity/gemini-3.7-flash-medium",
    "antigravity/gemini-3.7-flash-low",
    "antigravity/gemini-3.7-flash-high",
}


def emit(payload: dict[str, Any]) -> int:
    # The Windows external-process boundary may expose stdout as CP1252.
    # Escaped Unicode keeps the one-line JSON protocol valid for Vietnamese
    # prompts/reasons instead of crashing after a successful provider response.
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
    """Read the active key from 9router's own local credential store.

    The project .env may contain a provider key, but it is not a 9router key.
    When the configured endpoint is the local 9router gateway, prefer the key
    owned by 9router and never print or persist it in the project.
    """
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


def load_request(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > MAX_REQUEST_BYTES:
        raise ValueError("planner request không tồn tại hoặc vượt giới hạn")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("planner request phải là object")
    if set(document) - {
        "model",
        "messages",
        "maxTokens",
        "zeroDataRetention",
        "screenshotPath",
        "screenshotMimeType",
    }:
        raise ValueError("planner request chứa field không được phép")
    if document.get("model") not in ALLOWED_MODELS:
        raise ValueError("planner model không nằm trong allowlist")
    messages = document.get("messages")
    if not isinstance(messages, list) or not messages or len(messages) > 4:
        raise ValueError("messages phải có từ 1 đến 4 phần tử")
    total_chars = 0
    for message in messages:
        if not isinstance(message, dict) or set(message) - {"role", "content"}:
            raise ValueError("message chứa field không được phép")
        if message.get("role") not in {"system", "user"}:
            raise ValueError("planner chỉ nhận system/user message")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("message content không được rỗng")
        total_chars += len(content)
    if total_chars > MAX_PROMPT_CHARS:
        raise ValueError("planner prompt vượt giới hạn")
    max_tokens = document.get("maxTokens", MAX_TOKENS)
    if not isinstance(max_tokens, int) or not 64 <= max_tokens <= MAX_TOKENS:
        raise ValueError("maxTokens phải trong khoảng 64..512")
    if document.get("zeroDataRetention") is not True:
        raise ValueError("planner phải bật zeroDataRetention")
    screenshot_path = document.get("screenshotPath")
    if screenshot_path is not None and (
        not isinstance(screenshot_path, str)
        or not screenshot_path.strip()
        or len(screenshot_path) > 400
    ):
        raise ValueError("screenshotPath không hợp lệ")
    screenshot_mime = document.get("screenshotMimeType")
    if screenshot_mime is not None and screenshot_mime not in {
        "image/png",
        "image/jpeg",
        "image/webp",
    }:
        raise ValueError("screenshotMimeType không nằm trong allowlist")
    return document


def screenshot_data_url(request: dict[str, Any]) -> str | None:
    """Read one fresh workspace screenshot without allowing path escape."""
    raw_path = request.get("screenshotPath")
    if not raw_path:
        return None
    relative = Path(raw_path)
    if relative.is_absolute() or any(
        part in {"", ".", ".."} for part in relative.as_posix().split("/")
    ):
        raise ValueError("screenshotPath phải là đường dẫn tương đối trong workspace")
    root = Path.cwd().resolve()
    target = (root / relative).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError("screenshotPath vượt workspace") from error
    if not target.is_file():
        raise ValueError("screenshotPath không tồn tại")
    data = target.read_bytes()
    if not data or len(data) > MAX_SCREENSHOT_BYTES:
        raise ValueError("screenshot vượt giới hạn 4 MiB hoặc rỗng")
    mime = request.get("screenshotMimeType") or {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(target.suffix.lower())
    if mime not in {"image/png", "image/jpeg", "image/webp"}:
        raise ValueError("không xác định được MIME screenshot")
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def api_messages(request: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    """Attach the screenshot to the user message using OpenAI vision format."""
    image_url = screenshot_data_url(request)
    messages = [dict(message) for message in request["messages"]]
    if not image_url:
        return messages, False
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        text = message.get("content")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("message user content không phải text")
        message["content"] = [
            {"type": "text", "text": text},
            {
                "type": "image_url",
                "image_url": {"url": image_url, "detail": "high"},
            },
        ]
        return messages, True
    raise ValueError("planner cần một user message để gắn screenshot")


def safe_error_message(body: bytes) -> str:
    try:
        payload = json.loads(body[:16_384].decode("utf-8", errors="replace"))
        error = payload.get("error", {}) if isinstance(payload, dict) else {}
        if isinstance(error, dict):
            code = str(error.get("code", ""))[:100]
            message = str(error.get("message", ""))[:300]
            return f"{code}: {message}".strip(": ") or "provider trả lỗi không có message"
    except (ValueError, TypeError):
        pass
    return "provider trả lỗi không đọc được chi tiết"


def parse_openai_response(body: bytes) -> dict[str, Any]:
    text = body.decode("utf-8", errors="replace")
    if "data:" not in text:
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise ValueError("response không phải object")
        return payload
    content_parts: list[str] = []
    usage: dict[str, Any] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        fragment = line[5:].strip()
        if not fragment or fragment == "[DONE]":
            continue
        chunk = json.loads(fragment)
        if not isinstance(chunk, dict):
            continue
        if isinstance(chunk.get("usage"), dict):
            usage = chunk["usage"]
        choices = chunk.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            continue
        choice = choices[0]
        delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
        message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
        fragment_text = delta.get("content") or message.get("content") or choice.get("text")
        if isinstance(fragment_text, str):
            content_parts.append(fragment_text)
    content = "".join(content_parts).strip()
    if not content:
        raise ValueError("SSE response không có content")
    return {"choices": [{"message": {"content": content}}], "usage": usage}


def run(request_path: Path) -> int:
    try:
        request = load_request(request_path)
        dotenv = find_dotenv()
        configured_base_url = os.environ.get("AUTO3DVIDEO_LLM_BASE_URL", "").strip() or (
            read_dotenv_value(dotenv, "AUTO3DVIDEO_LLM_BASE_URL") if dotenv else ""
        )
        if configured_base_url not in ALLOWED_BASE_URLS:
            return emit({
                "status": "invalid_configuration",
                "model": request["model"],
                "networkCallsMade": False,
                "costStatus": "not_called",
                "message": "AUTO3DVIDEO_LLM_BASE_URL không nằm trong allowlist planner.",
            })
        key = read_local_router_api_key(configured_base_url) or os.environ.get(
            "AUTO3DVIDEO_LLM_API_KEY", ""
        ).strip() or (read_dotenv_value(dotenv, "AUTO3DVIDEO_LLM_API_KEY") if dotenv else "")
        if not key:
            return emit({
                "status": "missing_credential",
                "model": request["model"],
                "networkCallsMade": False,
                "costStatus": "not_called",
                "message": "Không thấy active API key của 9router local.",
            })
        messages, visual_attached = api_messages(request)
        body = json.dumps({
            "model": request["model"],
            "messages": messages,
            "max_tokens": request.get("maxTokens", MAX_TOKENS),
            "stream": True,
        }, ensure_ascii=False).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "x-cmd-zdr": "1",
            "User-Agent": "Auto3Dvideo-browser-flow-planner/0.1",
        }
        request_object = urllib.request.Request(
            f"{configured_base_url.rstrip('/')}/chat/completions",
            data=body,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request_object, timeout=60) as response:
                status_code = response.status
                response_body = response.read(2 * 1024 * 1024)
        except urllib.error.HTTPError as error:
            return emit({
                "status": "http_error",
                "httpStatus": error.code,
                "model": request["model"],
                "networkCallsMade": True,
                "costStatus": "provider_deal_unverified",
                "message": safe_error_message(error.read(16_384)),
            })
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return emit({
                "status": "network_error",
                "model": request["model"],
                "networkCallsMade": True,
                "costStatus": "provider_deal_unverified",
                "message": f"Không kết nối được planner provider: {type(error).__name__}",
            })
        try:
            payload = parse_openai_response(response_body)
            response_message = payload["choices"][0]["message"]["content"]
            if not isinstance(response_message, str) or not response_message.strip():
                raise ValueError("response content không phải text")
        except (ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
            return emit({
                "status": "invalid_response",
                "httpStatus": status_code,
                "model": request["model"],
                "networkCallsMade": True,
                "costStatus": "provider_deal_unverified",
                "message": f"Planner response không đúng OpenAI schema: {type(error).__name__}",
            })
        usage = payload.get("usage", {}) if isinstance(payload, dict) else {}
        if not isinstance(usage, dict):
            usage = {}
        return emit({
            "status": "succeeded",
            "httpStatus": status_code,
            "model": request["model"],
            "responseText": response_message[:MAX_RESPONSE_CHARS],
            "visualAttached": visual_attached,
            "promptTokens": usage.get("prompt_tokens"),
            "completionTokens": usage.get("completion_tokens"),
            "totalTokens": usage.get("total_tokens"),
            "networkCallsMade": True,
            "costStatus": "provider_declared_free_while_capacity_last",
            "message": "Planner trả về đề xuất; Rust còn phải kiểm tra action và ref trước khi chạy.",
        })
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        return emit({
            "status": "invalid_request",
            "networkCallsMade": False,
            "costStatus": "not_called",
            "message": f"Planner request không hợp lệ: {type(error).__name__}",
        })


def main() -> int:
    try:
        if len(sys.argv) != 3 or sys.argv[1] != "--request":
            return emit({"status": "invalid_request", "message": "planner cần --request <relative-json>"})
        request_path = Path(sys.argv[2])
        if request_path.is_absolute() or any(part in {"", ".", ".."} for part in request_path.as_posix().split("/")):
            return emit({"status": "invalid_request", "message": "request path phải tương đối an toàn"})
        return run(Path.cwd().resolve() / request_path)
    except Exception as error:  # noqa: BLE001 - preserve the one-line worker protocol
        # Never let an unexpected worker exception produce an empty stdout.
        # Rust can then report the real bounded failure instead of only EOF.
        return emit({
            "status": "internal_error",
            "networkCallsMade": False,
            "costStatus": "unknown",
            "message": f"Planner worker internal error: {type(error).__name__}",
        })


if __name__ == "__main__":
    sys.exit(main())
