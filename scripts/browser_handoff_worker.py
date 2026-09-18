#!/usr/bin/env python3
"""Prepare a BrowserMCP web handoff pack without browser/network side effects."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

SCHEMA_VERSION = "1.0.0"
MAX_PROMPT_CHARS = 4000
MAX_ASSETS = 8
MAX_ASSET_BYTES = 4 * 1024 * 1024 * 1024
ALLOWED_HOSTS = {
    "ai.google.dev",
    "aistudio.google.com",
    "gemini.google.com",
    "labs.google",
    "flow.google",
}
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
SECRET_MARKERS = (
    "api_key",
    "apikey",
    "access_token",
    "authorization",
    "bearer ",
    "client_secret",
    "password",
    "secret",
    "token",
)


class HandoffError(ValueError):
    pass


def fail(message: str) -> None:
    raise HandoffError(message)


def validate_id(value: object, field: str) -> str:
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
        fail(f"{field} phải là safe id chữ thường, số và dấu gạch ngang")
    return value


def validate_relative(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{field} phải là đường dẫn không rỗng")
    normalized = value.strip().replace("\\", "/")
    if (
        normalized.startswith("/")
        or normalized.startswith("//")
        or "://" in normalized
        or (len(normalized) >= 2 and normalized[1] == ":")
        or "\x00" in normalized
        or any(part in {"", ".", ".."} for part in normalized.split("/"))
    ):
        fail(f"{field} phải là đường dẫn tương đối an toàn trong workspace")
    return normalized


def workspace_path(workspace: Path, relative: str, field: str) -> Path:
    path = (workspace / relative).resolve(strict=True)
    root = workspace.resolve(strict=True)
    if os.path.normcase(str(path)) != os.path.normcase(str(root)) and root not in path.parents:
        fail(f"{field} vượt ra ngoài workspace")
    return path


def output_path(workspace: Path, relative: str, field: str) -> Path:
    normalized = validate_relative(relative, field)
    path = (workspace / normalized).resolve(strict=False)
    root = workspace.resolve(strict=True)
    if os.path.normcase(str(path)) != os.path.normcase(str(root)) and root not in path.parents:
        fail(f"{field} vượt ra ngoài workspace")
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_target_url(value: object, allowed_hosts: object) -> tuple[str, list[str]]:
    if not isinstance(value, str) or len(value) > 500:
        fail("targetUrl phải là URL HTTPS hợp lệ")
    parsed = urlparse(value.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        fail("targetUrl chỉ được là HTTPS URL không kèm credential")
    if parsed.port is not None:
        fail("targetUrl không được chỉ định port")
    if not isinstance(allowed_hosts, list) or not allowed_hosts:
        fail("allowedHosts phải là danh sách không rỗng")
    hosts = []
    for host in allowed_hosts:
        if not isinstance(host, str) or host not in ALLOWED_HOSTS:
            fail(f"allowedHosts chứa host chưa allowlist: {host}")
        if host not in hosts:
            hosts.append(host)
    if parsed.hostname.lower() not in hosts:
        fail("targetUrl không nằm trong allowedHosts")
    return value.strip(), hosts


def validate_prompt(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        fail("prompt không được rỗng")
    prompt = value.strip()
    if len(prompt) > MAX_PROMPT_CHARS:
        fail(f"prompt vượt quá {MAX_PROMPT_CHARS} ký tự")
    lower = prompt.lower()
    if any(marker in lower for marker in SECRET_MARKERS) or lower.startswith(("sk-", "key_")):
        fail("prompt có dấu hiệu credential/secret")
    if "\x00" in prompt or "\r" in prompt:
        fail("prompt chứa ký tự không hợp lệ")
    return prompt


def validate_policy(policy: object) -> dict[str, object]:
    if not isinstance(policy, dict):
        fail("policy phải là object")
    if policy.get("networkRequired") is not True:
        fail("policy.networkRequired phải là true cho web handoff")
    if policy.get("humanReviewRequired") is not True:
        fail("policy.humanReviewRequired phải là true")
    if policy.get("externalPublish") is not False:
        fail("policy.externalPublish phải là false")
    rights = policy.get("rightsStatus")
    if rights not in {"pending", "user_owned", "licensed", "generated_local", "blocked"}:
        fail("policy.rightsStatus không hợp lệ")
    if not isinstance(policy.get("paidGeneration"), bool) or not isinstance(policy.get("termsReviewed"), bool):
        fail("policy paidGeneration/termsReviewed phải là boolean")
    return {
        "networkRequired": True,
        "paidGeneration": policy["paidGeneration"],
        "humanReviewRequired": True,
        "externalPublish": False,
        "rightsStatus": rights,
        "termsReviewed": policy["termsReviewed"],
    }


def prepare(request: dict[str, object], workspace: Path, output_dir_arg: str | None) -> dict[str, object]:
    if request.get("schemaVersion") != SCHEMA_VERSION:
        fail("schemaVersion không được hỗ trợ")
    handoff_id = validate_id(request.get("handoffId"), "handoffId")
    project_id = validate_id(request.get("projectId"), "projectId")
    if request.get("provider") != "browsermcp":
        fail("provider phải là browsermcp")
    if request.get("operation") != "prepare_web_handoff":
        fail("worker hiện chỉ hỗ trợ prepare_web_handoff")
    target_url, allowed_hosts = validate_target_url(request.get("targetUrl"), request.get("allowedHosts"))
    prompt = validate_prompt(request.get("prompt"))
    policy = validate_policy(request.get("policy"))

    approval = request.get("approval")
    if not isinstance(approval, dict) or any(approval.get(key) is not False for key in ("upload", "generate", "import")):
        fail("approval upload/generate/import phải false ở bước prepare")

    raw_assets = request.get("inputPaths")
    if not isinstance(raw_assets, list) or not raw_assets or len(raw_assets) > MAX_ASSETS:
        fail(f"inputPaths phải có 1..{MAX_ASSETS} asset")
    assets: list[dict[str, object]] = []
    seen: set[str] = set()
    for index, raw_asset in enumerate(raw_assets):
        if not isinstance(raw_asset, dict):
            fail(f"inputPaths[{index}] phải là object")
        relative = validate_relative(raw_asset.get("relativePath"), f"inputPaths[{index}].relativePath")
        if relative in seen:
            fail(f"inputPaths[{index}] bị trùng")
        seen.add(relative)
        media_kind = raw_asset.get("mediaKind")
        if media_kind not in {"video", "image", "audio", "metadata"}:
            fail(f"inputPaths[{index}].mediaKind không hợp lệ")
        path = workspace_path(workspace, relative, f"inputPaths[{index}]")
        if not path.is_file():
            fail(f"inputPaths[{index}] không phải file")
        size = path.stat().st_size
        if size <= 0 or size > MAX_ASSET_BYTES:
            fail(f"inputPaths[{index}] vượt giới hạn kích thước")
        assets.append({"relativePath": relative, "mediaKind": media_kind, "sha256": sha256_file(path), "sizeBytes": size})

    requested_output = output_dir_arg or request.get("outputDirectory")
    output_relative = validate_relative(requested_output, "outputDirectory")
    output_dir = output_path(workspace, output_relative, "outputDirectory")
    output_dir.mkdir(parents=True, exist_ok=True)
    handoff_file = output_dir / "handoff.json"
    prompt_file = output_dir / "prompt.txt"
    if handoff_file.exists() or prompt_file.exists():
        fail("handoff output đã tồn tại; không ghi đè")

    document = {
        "schemaVersion": SCHEMA_VERSION,
        "handoffId": handoff_id,
        "projectId": project_id,
        "provider": "browsermcp",
        "operation": "prepare_web_handoff",
        "targetUrl": target_url,
        "allowedHosts": allowed_hosts,
        "inputAssets": assets,
        "prompt": prompt,
        "outputDirectory": output_relative,
        "state": "prepared",
        "approval": {"upload": False, "generate": False, "import": False},
        "policy": policy,
        "notes": "Prepared locally. BrowserMCP extension/session, upload and Generate are not started.",
    }
    with handoff_file.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(document, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    with prompt_file.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(prompt + "\n")

    return {
        "status": "prepared",
        "handoffId": handoff_id,
        "projectId": project_id,
        "handoffPath": handoff_file.relative_to(workspace).as_posix(),
        "promptPath": prompt_file.relative_to(workspace).as_posix(),
        "inputAssets": assets,
        "state": "prepared",
        "networkCallsMade": False,
        "browserSessionAttached": False,
        "uploadPerformed": False,
        "generatePerformed": False,
        "importPerformed": False,
        "costStatus": "not_called",
        "humanReviewRequired": True,
        "message": "Đã chuẩn bị BrowserMCP Web Handoff pack local; chưa kết nối browser, chưa upload và chưa bấm Generate.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--output-dir")
    args = parser.parse_args()
    try:
        workspace = Path(args.workspace).resolve(strict=True)
        if not workspace.is_dir():
            fail("workspace phải là thư mục")
        request_path = workspace_path(workspace, validate_relative(args.request, "request"), "request")
        with request_path.open("r", encoding="utf-8") as handle:
            request = json.load(handle)
        if not isinstance(request, dict):
            fail("request phải là JSON object")
        result = prepare(request, workspace, args.output_dir)
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
        return 0
    except (HandoffError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "blocked", "error": str(error), "networkCallsMade": False, "processStarted": True}, ensure_ascii=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
