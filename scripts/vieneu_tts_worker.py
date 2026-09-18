"""Bounded local VieNeu-TTS worker used by the Rust process boundary.

The worker accepts only a project-relative request JSON path. It never accepts
credentials, shell commands, or arbitrary executable paths. Check mode imports
only the package and never downloads a model. Synthesis runs Hugging Face in
offline mode by default so a missing local model fails instead of triggering a
network download.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

MAX_TEXT_CHARS = 100_000
MAX_REQUEST_BYTES = 256 * 1024
MAX_REFERENCE_BYTES = 50 * 1024 * 1024
ALLOWED_REFERENCE_SUFFIXES = {".wav", ".mp3", ".flac", ".m4a", ".ogg"}
MIN_TEMPERATURE = 0.6
MAX_TEMPERATURE = 1.2


def emit(payload: dict[str, Any]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if payload.get("status") not in {"failed", "missing_package", "invalid_request"} else 1


def safe_relative_path(value: Any, field: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty relative path")
    raw = value.strip().replace("\\", "/")
    path = Path(raw)
    if path.is_absolute() or "://" in raw or (len(raw) > 1 and raw[1] == ":"):
        raise ValueError(f"{field} must be relative to the workspace")
    if any(part in {"", ".", ".."} for part in raw.split("/")):
        raise ValueError(f"{field} contains an unsafe path segment")
    return path


def bounded_request(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ValueError("request JSON does not exist")
    if path.stat().st_size > MAX_REQUEST_BYTES:
        raise ValueError("request JSON exceeds the size limit")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("request JSON must be an object")
    return document


def validate_temperature(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not MIN_TEMPERATURE <= float(value) <= MAX_TEMPERATURE:
        raise ValueError("temperature must be a number between 0.6 and 1.2")
    return float(value)


def validate_clone_consent(reference_value: Any, clone_consent: Any) -> bool:
    if not isinstance(clone_consent, bool):
        raise ValueError("cloneConsent must be boolean")
    if reference_value and not clone_consent:
        raise ValueError("cloneConsent is required when referenceAudioPath is provided")
    return clone_consent


def configure_local_cache(workspace: Path) -> Path:
    configured_root = os.environ.get("AUTO3DVIDEO_VIENEUTTS_CACHE", "").strip()
    cache_root = Path(configured_root).expanduser().resolve() if configured_root else workspace / ".auto3dvideo" / "cache"
    hf_home = cache_root / "huggingface"
    temp_root = cache_root / "tmp"
    hf_home.mkdir(parents=True, exist_ok=True)
    temp_root.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(hf_home))
    os.environ.setdefault("TEMP", str(temp_root))
    os.environ.setdefault("TMP", str(temp_root))
    os.environ.setdefault("TMPDIR", str(temp_root))
    return cache_root


def check(workspace: Path) -> int:
    package_spec = importlib.util.find_spec("vieneu")
    configured_cache = os.environ.get("AUTO3DVIDEO_VIENEUTTS_CACHE", "").strip()
    cache_root = Path(configured_cache).expanduser().resolve() if configured_cache else workspace / ".auto3dvideo" / "cache"
    model_cache = cache_root / "huggingface"
    model_cache_present = model_cache.is_dir() and any(path.is_file() for path in model_cache.rglob("*"))
    status = "ready" if package_spec and model_cache_present else "model_missing" if package_spec else "missing_package"
    payload: dict[str, Any] = {
        "status": status,
        "packageInstalled": package_spec is not None,
        "packageVersion": None,
        "modelId": "pnnbao-ump/VieNeu-TTS-v3-Turbo",
        "backend": "onnx",
        "modelCachePath": str(model_cache.relative_to(workspace)).replace("\\", "/") if model_cache.is_relative_to(workspace) else str(model_cache).replace("\\", "/"),
        "modelCachePresent": model_cache_present,
        "modelDownloadRequested": False,
        "networkCallsMade": False,
        "message": "VieNeu package và model cache đã sẵn sàng; check mode không tải model." if status == "ready" else "Đã cài package vieneu nhưng chưa thấy model cache local." if status == "model_missing" else "Chưa cài package vieneu trong Python đã cấu hình.",
    }
    if package_spec:
        try:
            import vieneu  # type: ignore[import-not-found]

            payload["packageVersion"] = getattr(vieneu, "__version__", None)
        except Exception as error:  # pragma: no cover - depends on local package
            payload["status"] = "package_import_failed"
            payload["message"] = f"Không import được vieneu: {type(error).__name__}"
    return emit(payload)


def prepare_model(workspace: Path) -> int:
    try:
        cache_root = configure_local_cache(workspace)
        os.environ.pop("HF_HUB_OFFLINE", None)
        from vieneu import Vieneu  # type: ignore[import-not-found]

        tts = Vieneu(backend="onnx", precision="int8")
        # Force model initialization with a fixed, non-user sample. The output
        # is only a temporary readiness artifact and is removed afterwards.
        prepare_output = cache_root / "vieneu-prepare-check.wav"
        audio = tts.infer("Đây là bài kiểm tra cài đặt VieNeu.", voice="Adam")
        tts.save(audio, str(prepare_output))
        size = prepare_output.stat().st_size
        prepare_output.unlink(missing_ok=True)
        return emit({
            "status": "ready",
            "packageInstalled": True,
            "modelId": "pnnbao-ump/VieNeu-TTS-v3-Turbo",
            "backend": "onnx",
            "precision": "int8",
            "modelDownloadRequested": True,
            "networkCallsMade": True,
            "prepareOutputBytes": size,
            "message": "VieNeu model đã được tải/khởi tạo vào cache local; không lưu bài kiểm tra tạm.",
        })
    except Exception as error:
        return emit({
            "status": "failed",
            "errorType": type(error).__name__,
            "message": str(error)[:2048],
            "modelDownloadRequested": True,
            "networkCallsMade": True,
        })


def synthesize(workspace: Path, request_path: Path) -> int:
    try:
        request = bounded_request(request_path)
        text = request.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS:
            raise ValueError("text must be non-empty and within the character limit")
        voice = request.get("voice", "Adam")
        if not isinstance(voice, str) or not voice.strip() or len(voice) > 128:
            raise ValueError("voice is invalid")
        output_relative = safe_relative_path(request.get("outputPath"), "outputPath")
        if output_relative.suffix.lower() != ".wav":
            raise ValueError("outputPath must end with .wav")
        output_path = workspace / output_relative
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_path.exists():
            raise ValueError("outputPath already exists; refusing to overwrite")

        temperature = validate_temperature(request.get("temperature", 0.8))
        reference_relative = request.get("referenceAudioPath")
        clone_consent = validate_clone_consent(reference_relative, request.get("cloneConsent", False))
        reference_path: Path | None = None
        if reference_relative:
            reference_relative_path = safe_relative_path(reference_relative, "referenceAudioPath")
            if reference_relative_path.suffix.lower() not in ALLOWED_REFERENCE_SUFFIXES:
                raise ValueError("referenceAudioPath has an unsupported audio suffix")
            reference_path = workspace / reference_relative_path
            if not reference_path.is_file():
                raise ValueError("referenceAudioPath does not exist")
            if reference_path.stat().st_size > MAX_REFERENCE_BYTES:
                raise ValueError("reference audio exceeds the size limit")

        configure_local_cache(workspace)
        # Offline is deliberate: missing checkpoints must fail rather than
        # silently download a large model or access the network.
        os.environ["HF_HUB_OFFLINE"] = "1"
        from vieneu import Vieneu  # type: ignore[import-not-found]

        backend = request.get("backend", "onnx")
        precision = request.get("precision", "int8")
        if backend != "onnx" or precision not in {"int8", "fp32"}:
            raise ValueError("only the bounded onnx backend with int8/fp32 is allowed")
        tts = Vieneu(backend=backend, precision=precision)
        kwargs: dict[str, Any] = {"voice": voice, "temperature": temperature}
        if reference_path is not None:
            kwargs["ref_audio"] = str(reference_path)
            kwargs["denoise"] = True
        audio = tts.infer(text, **kwargs)
        tts.save(audio, str(output_path))
        return emit(
            {
                "status": "succeeded",
                "outputPath": str(output_relative).replace("\\", "/"),
                "voice": voice,
                "modelId": "pnnbao-ump/VieNeu-TTS-v3-Turbo",
                "backend": backend,
                "precision": precision,
                "temperature": temperature,
                "referenceAudioUsed": reference_path is not None,
                "cloneConsent": clone_consent,
                "modelDownloadRequested": False,
                "networkCallsMade": False,
            }
        )
    except Exception as error:  # keep raw tracebacks out of the process log
        return emit(
            {
                "status": "failed",
                "errorType": type(error).__name__,
                "message": str(error)[:2048],
                "modelDownloadRequested": False,
                "networkCallsMade": False,
            }
        )


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--prepare-model", action="store_true")
    parser.add_argument("--synthesize", action="store_true")
    parser.add_argument("--request")
    args = parser.parse_args()
    workspace = Path.cwd().resolve()
    modes = [args.check, args.prepare_model, args.synthesize]
    if sum(modes) != 1:
        return emit({"status": "invalid_request", "message": "choose exactly one worker mode"})
    if args.check:
        return check(workspace)
    if args.prepare_model:
        return prepare_model(workspace)
    if not args.request:
        return emit({"status": "invalid_request", "message": "--request is required"})
    try:
        request_path = safe_relative_path(args.request, "request")
    except ValueError as error:
        return emit({"status": "invalid_request", "message": str(error)})
    return synthesize(workspace, workspace / request_path)


if __name__ == "__main__":
    sys.exit(main())
