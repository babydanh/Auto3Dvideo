#!/usr/bin/env python3
"""Bounded Command Code chat connectivity worker.

This worker is deliberately a connectivity probe, not a general cloud generation
runner. It accepts only a project-relative request JSON, uses a fixed official
Command Code endpoint, reads the API key from a local dotenv path in memory, and
never prints credentials or raw HTTP bodies.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

MAX_REQUEST_BYTES = 256 * 1024
MAX_PROMPT_CHARS = 20_000
MAX_RESPONSE_CHARS = 16_000
MAX_TOKENS = 128
COMMAND_CODE_BASE_URL = "https://api.commandcode.ai/provider/v1"
LOCAL_GATEWAY_BASE_URL = "http://localhost:20128/v1"
ALLOWED_BASE_URLS = {COMMAND_CODE_BASE_URL, LOCAL_GATEWAY_BASE_URL, "http://127.0.0.1:20128/v1"}
ALLOWED_MODELS = {
    "poolside/laguna-s-2.1-free",
    "cmd/poolside/laguna-s-2.1-free",
    "cmd/meta/muse-spark-1.2-contributor",
    "cmc/meta/muse-spark-1.3-contributor",
    "ag/gemini-3.8-flash-medium",
    "ag/gemini-3.8-flash-low",
    "ag/gemini-3.8-flash-high",
    "antigravity/gemini-3.8-flash-medium",
    "antigravity/gemini-3.8-flash-low",
    "antigravity/gemini-3.8-flash-high",
    "antigravity/gemini-3.7-flash-medium",
    "antigravity/gemini-3.7-flash-low",
    "antigravity/gemini-3.7-flash-high",
}


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
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


def read_dotenv_key(path: Path) -> str:
    return read_dotenv_value(path, "AUTO3DVIDEO_LLM_API_KEY")


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
    """Prefer the active key owned by the local 9router instance."""
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
        raise ValueError("request JSON không tồn tại hoặc vượt giới hạn")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("request JSON phải là object")
    if set(document) - {"model", "messages", "maxTokens", "zeroDataRetention"}:
        raise ValueError("request chứa field không được phép")
    if document.get("model") not in ALLOWED_MODELS:
        raise ValueError("model không nằm trong allowlist connectivity probe")
    messages = document.get("messages")
    if not isinstance(messages, list) or not messages or len(messages) > 4:
        raise ValueError("messages phải có từ 1 đến 4 phần tử")
    total_chars = 0
    for message in messages:
        if not isinstance(message, dict) or set(message) - {"role", "content"}:
            raise ValueError("message chứa field không được phép")
        if message.get("role") not in {"system", "user", "assistant"}:
            raise ValueError("role không được phép")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("message content không được rỗng")
        total_chars += len(content)
    if total_chars > MAX_PROMPT_CHARS:
        raise ValueError("prompt vượt giới hạn")
    max_tokens = document.get("maxTokens", MAX_TOKENS)
    if not isinstance(max_tokens, int) or not 1 <= max_tokens <= MAX_TOKENS:
        raise ValueError("maxTokens phải trong khoảng 1..128")
    if document.get("zeroDataRetention") is not True:
        raise ValueError("connectivity probe phải bật zeroDataRetention")
    return document


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
    """Normalize JSON and SSE chat responses to one OpenAI-compatible payload."""
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
        configured_base_url = os.environ.get("AUTO3DVIDEO_LLM_BASE_URL", "").strip() or (read_dotenv_value(dotenv, "AUTO3DVIDEO_LLM_BASE_URL") if dotenv else "")
        configured_model = os.environ.get("AUTO3DVIDEO_LLM_MODEL", "").strip() or (read_dotenv_value(dotenv, "AUTO3DVIDEO_LLM_MODEL") if dotenv else "")
        key = read_local_router_api_key(configured_base_url) or os.environ.get(
            "AUTO3DVIDEO_LLM_API_KEY", ""
        ).strip() or (read_dotenv_key(dotenv) if dotenv else "")
        if not key:
            return emit({
                "status": "missing_credential",
                "model": configured_model or "ag/gemini-3.8-flash-medium",
                "networkCallsMade": False,
                "costStatus": "not_called",
                "message": "Không thấy AUTO3DVIDEO_LLM_API_KEY trong .env local.",
            })
        if configured_base_url not in ALLOWED_BASE_URLS:
            return emit({
                "status": "invalid_configuration",
                "model": configured_model or "ag/gemini-3.8-flash-medium",
                "networkCallsMade": False,
                "costStatus": "not_called",
                "message": "AUTO3DVIDEO_LLM_BASE_URL không nằm trong allowlist Command Code/local gateway.",
            })
        if configured_model not in ALLOWED_MODELS:
            return emit({
                "status": "invalid_configuration",
                "model": configured_model or "not-configured",
                "networkCallsMade": False,
                "costStatus": "not_called",
                "message": "AUTO3DVIDEO_LLM_MODEL không nằm trong allowlist probe.",
            })
        body = json.dumps({
            "model": request["model"],
            "messages": request["messages"],
            "max_tokens": request.get("maxTokens", MAX_TOKENS),
            "stream": True,
        }, ensure_ascii=False).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "x-cmd-zdr": "1",
            "User-Agent": "Auto3Dvideo-commandcode-probe/0.1",
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
                "model": configured_model,
                "networkCallsMade": True,
                "costStatus": "local_gateway_unreported" if configured_base_url != COMMAND_CODE_BASE_URL else "provider_deal_unverified",
                "message": safe_error_message(error.read(16_384)),
            })
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return emit({
                "status": "network_error",
                "model": configured_model,
                "networkCallsMade": True,
                "costStatus": "local_gateway_unreported" if configured_base_url != COMMAND_CODE_BASE_URL else "provider_deal_unverified",
                "message": f"Không kết nối được Command Code: {type(error).__name__}",
            })
        try:
            payload = parse_openai_response(response_body)
            choice = payload["choices"][0]
            response_message = choice["message"]["content"]
            if not isinstance(response_message, str):
                raise ValueError("response content không phải text")
        except (ValueError, KeyError, IndexError, TypeError) as error:
            return emit({
                "status": "invalid_response",
                "httpStatus": status_code,
                "model": configured_model,
                "networkCallsMade": True,
                "costStatus": "local_gateway_unreported" if configured_base_url != COMMAND_CODE_BASE_URL else "provider_deal_unverified",
                "message": f"Response không đúng OpenAI schema: {type(error).__name__}",
            })
        usage = payload.get("usage", {}) if isinstance(payload, dict) else {}
        if not isinstance(usage, dict):
            usage = {}
        return emit({
            "status": "succeeded",
            "httpStatus": status_code,
            "model": configured_model,
            "responseText": response_message[:MAX_RESPONSE_CHARS],
            "promptTokens": usage.get("prompt_tokens"),
            "completionTokens": usage.get("completion_tokens"),
            "totalTokens": usage.get("total_tokens"),
            "networkCallsMade": True,
            "costStatus": "local_gateway_unreported" if configured_base_url != COMMAND_CODE_BASE_URL else "provider_declared_free_while_capacity_last",
            "message": "Command Code trả response thành công; deal free vẫn phụ thuộc capacity và tài khoản.",
        })
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        return emit({
            "status": "invalid_request",
            "networkCallsMade": False,
            "costStatus": "not_called",
            "message": f"Request không hợp lệ: {type(error).__name__}",
        })


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "--request":
        return emit({"status": "invalid_request", "message": "worker cần --request <relative-json>"})
    request_path = Path(sys.argv[2])
    if request_path.is_absolute() or any(part in {"", ".", ".."} for part in request_path.as_posix().split("/")):
        return emit({"status": "invalid_request", "message": "request path phải tương đối an toàn"})
    return run(Path.cwd().resolve() / request_path)


if __name__ == "__main__":
    sys.exit(main())
