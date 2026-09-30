"""Bounded adapter for the pinned ffroliva/gflow-cli checkout.

The Rust executor starts this worker with an allowlisted Python interpreter.
The worker calls the vendored CLI entrypoint; it does not scrape Flow or
invent a second browser transport. Each shot is persisted before and after
submission so a retry never silently resubmits a paid operation.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


def _emit_json_line(payload: dict[str, Any]) -> None:
    # stdout is a protocol pipe; ASCII escapes keep it valid under Windows code pages.
    print(json.dumps(payload, ensure_ascii=True))


def _fail(message: str, code: str = "GFLOW_WORKER_ERROR") -> int:
    _emit_json_line({"status": "fail", "error": {"code": code, "message": message}})
    return 1


def _safe_relative(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} phải là chuỗi không rỗng")
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"{field} phải là đường dẫn tương đối trong workspace")
    return value.replace("\\", "/")


def _load_request(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("gflow request phải là object JSON")
    if not isinstance(value.get("flowProjectId"), str) or not value["flowProjectId"].strip():
        raise ValueError("Thiếu flowProjectId; phải dùng project Google Flow hiện có")
    if not isinstance(value.get("segments"), list) or not value["segments"] or len(value["segments"]) > 24:
        raise ValueError("segments phải có từ 1 đến 24 shot")
    return value


def _extract_json_payload(raw: str) -> dict[str, Any] | None:
    """Find the CLI's complete JSON envelope, ignoring nested error objects."""
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    for index, char in enumerate(raw):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(raw[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and ("status" in value or "command" in value):
            candidates.append(value)
    for value in reversed(candidates):
        if value.get("command") in {"video t2v", "video i2v", "video r2v"}:
            return value
    return candidates[-1] if candidates else None

def _auth_status_failure(
    profile: str, payload: dict[str, Any], raw_tail: str
) -> tuple[str, str]:
    error = payload.get("error")
    detail = error.get("message") if isinstance(error, dict) else None
    if not isinstance(detail, str) or not detail.strip():
        detail = raw_tail
    detail = " ".join(detail.split()) if detail else ""
    if not detail:
        detail = "Hãy dùng Kết nối Google Flow trong app để xác thực lại."
    message = (
        f"gflow-cli profile '{profile}' chưa xác minh được phiên Flow; "
        f"chưa gửi yêu cầu tạo video. {detail[:1200]}"
    )
    return message, "GFLOW_AUTH_UNVERIFIED"


def _invoke(gflow_main: Any, args: list[str]) -> tuple[dict[str, Any], int, str]:
    stdout = io.StringIO()
    exit_code = 0
    try:
        with contextlib.redirect_stdout(stdout):
            gflow_main(args=args, standalone_mode=False)
    except SystemExit as exc:
        exit_code = int(exc.code or 0)
    except Exception as exc:
        exit_code = 1
        stdout.write(json.dumps({"status": "fail", "error": {"message": str(exc)}}))
    raw = stdout.getvalue()
    payload = _extract_json_payload(raw)
    if payload is None:
        payload = {"status": "fail", "error": {"message": raw[-2000:]}}
    return payload, exit_code, raw[-2000:]


def _load_state(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"schemaVersion": "1.1.0", "shots": {}}
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("shots", {}), dict):
        raise ValueError("gflow state file không đúng schema")
    return value


def _write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f"{path.stem}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(state, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _input_hash(request: dict[str, Any], segment: dict[str, Any], workspace: Path) -> str:
    refs: list[dict[str, str]] = []
    for reference in segment.get("referencePaths", []):
        relative = _safe_relative(reference, "referencePath")
        path = workspace / relative
        if not path.is_file():
            raise ValueError(f"Không tìm thấy reference local: {relative}")
        refs.append({"path": relative, "sha256": _sha256_file(path)})
    identity = {
        "projectId": request.get("projectId"),
        "flowProjectId": request.get("flowProjectId"),
        "profile": request.get("profile"),
        "model": request.get("model"),
        "aspect": request.get("aspect"),
        "shotId": segment.get("shotId"),
        "revisionId": segment.get("revisionId"),
        "prompt": segment.get("prompt"),
        "durationSeconds": segment.get("durationSeconds"),
        "references": refs,
    }
    encoded = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _probe_video(ffprobe: Path, output: Path) -> tuple[bool, str]:
    if not ffprobe.is_file():
        return False, "Không tìm thấy ffprobe đã cấu hình"
    try:
        result = subprocess.run(
            [str(ffprobe), "-v", "error", "-show_entries", "stream=codec_type,width,height,duration:format=duration", "-of", "json", str(output)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"ffprobe không chạy được: {str(exc)[:240]}"
    if result.returncode != 0:
        return False, result.stderr.strip()[:240] or "ffprobe trả mã lỗi"
    try:
        metadata = json.loads(result.stdout)
    except json.JSONDecodeError:
        return False, "ffprobe trả JSON không hợp lệ"
    streams = metadata.get("streams", []) if isinstance(metadata, dict) else []
    video = next((item for item in streams if isinstance(item, dict) and item.get("codec_type") == "video"), None)
    if not isinstance(video, dict):
        return False, "file không có video stream"
    width = video.get("width")
    height = video.get("height")
    raw_duration = video.get("duration") or (metadata.get("format", {}) or {}).get("duration")
    try:
        duration = float(raw_duration)
    except (TypeError, ValueError):
        duration = 0.0
    if not isinstance(width, int) or width <= 0 or not isinstance(height, int) or height <= 0 or not math.isfinite(duration) or duration <= 0:
        return False, "video stream thiếu width/height/duration dương"
    return True, "ok"


def _record(segment: dict[str, Any], input_hash: str, status: str, relative: str, message: str | None = None) -> dict[str, Any]:
    record = {
        "status": status,
        "shotId": segment.get("shotId"),
        "revisionId": segment.get("revisionId"),
        "promptSha256": segment.get("promptSha256"),
        "inputSha256": input_hash,
        "outputRelativePath": relative,
    }
    if message:
        record["message"] = message[:480]
    return record


def main() -> int:
    if len(sys.argv) != 3:
        return _fail("Cú pháp: gflow_cli_worker.py <request.json> <workspace>")
    request_path = Path(sys.argv[1]).resolve()
    workspace = Path(sys.argv[2]).resolve()
    try:
        request = _load_request(request_path)
        if not workspace.is_dir():
            raise ValueError("workspace không tồn tại")
        configured_source = os.environ.get("AUTO3DVIDEO_GFLOWSOURCE", "").strip()
        source_root = (Path(configured_source) if configured_source else Path(__file__).resolve().parents[1] / "vendor" / "gflow-cli" / "src").resolve()
        configured_site = os.environ.get("AUTO3DVIDEO_GFLOWSITE", "").strip()
        if configured_site:
            site_root = Path(configured_site).resolve()
            if not site_root.is_dir():
                raise ValueError("Không tìm thấy site-packages runtime gflow-cli đã cài")
            sys.path.insert(0, str(site_root))
        if not (source_root / "gflow_cli").is_dir():
            raise ValueError("Không tìm thấy pinned vendor/gflow-cli/src/gflow_cli")
        sys.path.insert(0, str(source_root))
        from gflow_cli.cli import main as gflow_main

        profile = str(request.get("profile") or "auto3dvideo").strip()
        auth_payload, auth_exit, auth_tail = _invoke(gflow_main, ["auth", "status", "--profile", profile])
        if auth_exit != 0:
            return _fail(*_auth_status_failure(profile, auth_payload, auth_tail))

        state_path = workspace / _safe_relative(request.get("stateRelativePath"), "stateRelativePath")
        state = _load_state(state_path)
        state.setdefault("shots", {})
        ffprobe_value = request.get("ffprobePath")
        if not isinstance(ffprobe_value, str) or not ffprobe_value.strip():
            raise ValueError("Thiếu ffprobePath để xác minh từng output trước khi ghi state")
        ffprobe = Path(ffprobe_value).resolve()
        results: list[dict[str, Any]] = []
        all_ok = True
        for raw_segment in request["segments"]:
            if not isinstance(raw_segment, dict):
                raise ValueError("segment không hợp lệ")
            segment = raw_segment
            shot_id = str(segment.get("shotId", ""))
            prompt = segment.get("prompt")
            if not shot_id or not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("shot thiếu shotId hoặc prompt")
            relative = _safe_relative(segment.get("outputRelativePath"), "outputRelativePath")
            output = workspace / relative
            input_hash = _input_hash(request, segment, workspace)
            previous = state["shots"].get(shot_id)
            if isinstance(previous, dict) and previous.get("inputSha256") == input_hash:
                if output.is_file():
                    valid, probe_message = _probe_video(ffprobe, output)
                    if valid:
                        state["shots"][shot_id] = _record(segment, input_hash, "validated", relative)
                        _write_state(state_path, state)
                        results.append({"shotId": shot_id, "status": "skipped_validated", "outputRelativePath": relative, "inputSha256": input_hash})
                        continue
                else:
                    probe_message = "state đã ghi nhận lần submit trước nhưng output không còn trên đĩa"
                results.append({"shotId": shot_id, "status": "blocked_unverified", "outputRelativePath": relative, "message": probe_message})
                all_ok = False
                break
            if output.exists():
                results.append({"shotId": shot_id, "status": "blocked_unverified", "outputRelativePath": relative, "message": "đường dẫn output đã có file nhưng state không khớp; không ghi đè hoặc submit lại"})
                all_ok = False
                break

            duration = int(segment.get("durationSeconds", 8))
            if duration not in (4, 6, 8, 10):
                duration = 8
            output.parent.mkdir(parents=True, exist_ok=True)
            mode = "r2v" if segment.get("referencePaths") else "t2v"
            args = ["video", mode, prompt]
            if mode == "r2v":
                for reference in segment["referencePaths"]:
                    args.extend(["--ref", str((workspace / _safe_relative(reference, "referencePath")).resolve())])
            args.extend([
                "--project", str(request["flowProjectId"]),
                "--model", str(request.get("model", "veo-fast")),
                "--aspect", str(request.get("aspect", "16:9")),
                "--duration", str(duration),
                "--output", str(output),
                "--json", "--ui-mode", "classic",
            ])
            if isinstance(request.get("profile"), str) and request["profile"].strip():
                args.extend(["--profile", request["profile"].strip()])

            state["shots"][shot_id] = _record(segment, input_hash, "submitted", relative, "gflow-cli submit đã bắt đầu; chưa xác minh output")
            _write_state(state_path, state)
            payload, exit_code, raw_tail = _invoke(gflow_main, args)
            succeeded = exit_code == 0 and payload.get("status") == "ok" and output.is_file()
            if succeeded:
                valid, probe_message = _probe_video(ffprobe, output)
                if valid:
                    state["shots"][shot_id] = _record(segment, input_hash, "validated", relative)
                    _write_state(state_path, state)
                    results.append({"shotId": shot_id, "status": "validated", "outputRelativePath": relative, "inputSha256": input_hash})
                    continue
                message = f"output có nhưng không hợp lệ: {probe_message}"
            else:
                provider_error = payload.get("error") if isinstance(payload, dict) else None
                provider_message = provider_error.get("message") if isinstance(provider_error, dict) else None
                message = str(provider_message or raw_tail or f"gflow-cli exit {exit_code}")[:480]
            state["shots"][shot_id] = _record(segment, input_hash, "unknown", relative, message)
            _write_state(state_path, state)
            results.append({"shotId": shot_id, "status": "blocked_unverified", "outputRelativePath": relative, "message": message})
            all_ok = False
            break

        report = {
            "status": "ok" if all_ok and len(results) == len(request["segments"]) else "partial" if results else "fail",
            "flowProjectId": request["flowProjectId"],
            "shots": results,
            "stateRelativePath": state_path.relative_to(workspace).as_posix(),
        }
        _emit_json_line(report)
        return 0
    except Exception as exc:
        return _fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
