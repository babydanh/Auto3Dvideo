"""Bounded local OmniVoice worker for Auto3Dvideo.

The worker is intentionally offline for checks and synthesis. Model preparation
is the only mode allowed to access Hugging Face, and it is invoked explicitly
by the desktop setup action. Requests contain only project-relative paths and
structured generation fields; no shell command or credential is accepted.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import wave
from pathlib import Path
from typing import Any

MAX_TEXT_CHARS = 100_000
MAX_REQUEST_BYTES = 512 * 1024
MAX_REFERENCE_BYTES = 50 * 1024 * 1024
MAX_TRANSCRIPT_CHARS = 2_000
ALLOWED_REFERENCE_SUFFIXES = {".wav", ".mp3", ".flac", ".m4a", ".ogg"}
MODEL_ID = "k2-fsa/OmniVoice"
AUDIO_TOKENIZER_ID = "eustlb/higgs-audio-v2-tokenizer"
MIN_SPEED = 0.5
MAX_SPEED = 2.0
VALID_ENGLISH_INSTRUCTS = {
    "american accent",
    "australian accent",
    "british accent",
    "canadian accent",
    "child",
    "chinese accent",
    "elderly",
    "female",
    "high pitch",
    "indian accent",
    "japanese accent",
    "korean accent",
    "low pitch",
    "male",
    "middle-aged",
    "moderate pitch",
    "portuguese accent",
    "russian accent",
    "teenager",
    "very high pitch",
    "very low pitch",
    "whisper",
    "young adult",
}
VALID_CHINESE_INSTRUCTS = {
    "东北话",
    "中年",
    "中音调",
    "云南话",
    "低音调",
    "儿童",
    "四川话",
    "女",
    "宁夏话",
    "少年",
    "极低音调",
    "极高音调",
    "桂林话",
    "河南话",
    "济南话",
    "甘肃话",
    "男",
    "石家庄话",
    "老年",
    "耳语",
    "贵州话",
    "陕西话",
    "青年",
    "高音调",
    "青岛话",
}

# Provider-neutral emotion vocabulary.  The tag parser is deliberately kept
# separate from OmniVoice's small instruct vocabulary: the same script can be
# handed to a provider with native emotion control later, while the local
# OmniVoice adapter applies only the safe legacy cue fallback it understands.
EMOTION_CATALOG: dict[str, dict[str, str | None]] = {
    "neutral": {"fallbackCue": "none", "instructToken": None},
    "calm": {"fallbackCue": "none", "instructToken": None},
    "warm": {"fallbackCue": "none", "instructToken": None},
    "friendly": {"fallbackCue": "laugh", "instructToken": None},
    "happy": {"fallbackCue": "laugh", "instructToken": None},
    "excited": {"fallbackCue": "laugh", "instructToken": None},
    "joyful": {"fallbackCue": "laugh", "instructToken": None},
    "triumphant": {"fallbackCue": "laugh", "instructToken": None},
    "sad": {"fallbackCue": "sigh", "instructToken": None},
    "melancholic": {"fallbackCue": "sigh", "instructToken": None},
    "tender": {"fallbackCue": "sigh", "instructToken": None},
    "concerned": {"fallbackCue": "sigh", "instructToken": None},
    "fearful": {"fallbackCue": "sigh", "instructToken": None},
    "angry": {"fallbackCue": "clear_throat", "instructToken": None},
    "shouting": {"fallbackCue": "clear_throat", "instructToken": None},
    "urgent": {"fallbackCue": "clear_throat", "instructToken": None},
    "serious": {"fallbackCue": "clear_throat", "instructToken": None},
    "surprised": {"fallbackCue": "laugh", "instructToken": None},
    "mysterious": {"fallbackCue": "none", "instructToken": None},
    "curious": {"fallbackCue": "none", "instructToken": None},
    "sarcastic": {"fallbackCue": "none", "instructToken": None},
    "whisper": {"fallbackCue": "none", "instructToken": "whisper"},
}

EMOTION_ALIASES = {
    "normal": "neutral",
    "standard": "neutral",
    "joy": "joyful",
    "enthusiastic": "excited",
    "hype": "excited",
    "shout": "shouting",
    "yelling": "shouting",
    "despair": "melancholic",
    "soft": "tender",
    "dramatic": "serious",
    "suspense": "mysterious",
    "cười": "happy",
    "hào hứng": "excited",
    "thở dài": "sad",
    "hắng giọng": "serious",
}

INLINE_EMOTION_RE = re.compile(
    r"\[\s*((?:emotion\s*[:=]\s*)?[A-Za-zÀ-ỹ][A-Za-zÀ-ỹ0-9 _-]*)\s*\]",
    re.IGNORECASE,
)


def normalize_emotion_code(value: Any, *, default: str = "neutral") -> str:
    if value is None or not str(value).strip():
        return default
    raw = re.sub(r"^emotion\s*[:=]\s*", "", str(value).strip(), flags=re.IGNORECASE)
    raw = re.sub(r"\s+", " ", raw).replace("-", "_").lower()
    raw = EMOTION_ALIASES.get(raw, raw)
    if raw not in EMOTION_CATALOG:
        raise ValueError(
            f"emotionCode không hợp lệ: {value}; dùng một trong {', '.join(sorted(EMOTION_CATALOG))}"
        )
    return raw


def parse_inline_emotion_markup(text: str, default_emotion: Any = None) -> list[dict[str, str]]:
    """Split `[EXCITED] ... [SHOUTING] ...` without sending tags to TTS."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("text phải không rỗng")
    current = normalize_emotion_code(default_emotion)
    cursor = 0
    segments: list[dict[str, str]] = []
    found_tag = False
    for match in INLINE_EMOTION_RE.finditer(text):
        raw = match.group(1).strip()
        explicit = bool(re.match(r"^emotion\s*[:=]", raw, flags=re.IGNORECASE))
        try:
            code = normalize_emotion_code(raw)
        except ValueError:
            # Keep unrelated bracketed content such as [URL] or [1] as text;
            # an explicit [emotion:...] typo remains a useful hard error.
            if explicit:
                raise
            continue
        spoken = text[cursor:match.start()].strip()
        if spoken:
            segments.append({"text": spoken, "emotionCode": current})
        current = code
        cursor = match.end()
        found_tag = True
    tail = text[cursor:].strip()
    if tail:
        segments.append({"text": tail, "emotionCode": current})
    if not segments:
        return [{"text": text.strip(), "emotionCode": current}]
    # A tag with no following text is metadata only and should not create a
    # silent audio chunk.
    return segments if found_tag else [{"text": text.strip(), "emotionCode": current}]


def emotion_fallback_prefix(emotion_code: str) -> str:
    cue = EMOTION_CATALOG[emotion_code]["fallbackCue"]
    return {
        "laugh": "[cười] ",
        "sigh": "[thở dài] ",
        "clear_throat": "[hắng giọng] ",
    }.get(cue or "", "")


def emotion_instruct(base_instruct: str | None, emotion_code: str, mode: str) -> str | None:
    token = EMOTION_CATALOG[emotion_code]["instructToken"]
    if mode != "design" or not token:
        return base_instruct
    items = [item.strip() for item in (base_instruct or "").split(",") if item.strip()]
    if token not in {item.lower() for item in items}:
        items.append(token)
    return ", ".join(items)


def emit(payload: dict[str, Any]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if payload.get("status") not in {"failed", "missing_package", "invalid_request", "model_missing", "device_unavailable"} else 1


def safe_error(error: Exception) -> str:
    # Keep the desktop log useful without returning tracebacks, absolute paths,
    # URLs, or a user's full spoken text.
    message = " ".join(str(error).replace("\r", " ").replace("\n", " ").split())
    message = re.sub(r"[A-Za-z]:[\\/][^\s'\"]+", "<path>", message)
    message = re.sub(r"\\\\[^\s'\"]+", "<path>", message)
    message = re.sub(r"https?://[^\s'\"]+", "<url>", message)
    message = re.sub(r"(?i)unsupported instruct items found in .*?(?=\. Valid English items:)", "unsupported instruct items found in <redacted>", message)
    message = re.sub(r"(?i)(text|ref_text|transcript|instruct)\s*[:=]\s*[^,;]+", r"\1=<redacted>", message)
    if not message:
        message = "không có chi tiết từ runtime"
    return f"{type(error).__name__}: {message}"[:2048]


def safe_relative_path(value: Any, field: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} phải là đường dẫn tương đối không rỗng")
    raw = value.strip().replace("\\", "/")
    path = Path(raw)
    if path.is_absolute() or "://" in raw or (len(raw) > 1 and raw[1] == ":"):
        raise ValueError(f"{field} phải nằm tương đối trong workspace")
    if any(part in {"", ".", ".."} for part in raw.split("/")):
        raise ValueError(f"{field} chứa path segment không an toàn")
    return path


def bounded_request(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ValueError("request JSON không tồn tại")
    if path.stat().st_size > MAX_REQUEST_BYTES:
        raise ValueError("request JSON vượt giới hạn kích thước")
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("request JSON phải là object")
    return document


def validate_design_instruct(language: str, instruct: Any) -> str:
    if not isinstance(instruct, str) or not instruct.strip():
        raise ValueError("design voice cần instruct")
    value = instruct.strip()
    if language.lower().startswith("en"):
        items = [item.strip().lower() for item in value.split(",") if item.strip()]
        invalid = [item for item in items if item not in VALID_ENGLISH_INSTRUCTS]
        if invalid:
            raise ValueError(
                "instruct tiếng Anh chỉ nhận token giọng được model hỗ trợ; "
                f"token không hợp lệ: {', '.join(invalid)}"
            )
    elif language.lower().startswith("zh"):
        items = [item.strip() for item in value.split("，") if item.strip()]
        invalid = [item for item in items if item not in VALID_CHINESE_INSTRUCTS]
        if invalid:
            raise ValueError(
                "instruct tiếng Trung chỉ nhận token giọng được model hỗ trợ; "
                f"token không hợp lệ: {'，'.join(invalid)}"
            )
    return value


def workspace_cache(workspace: Path) -> Path:
    configured = os.environ.get("AUTO3DVIDEO_OMNIVOICE_CACHE", "").strip()
    cache = Path(configured).expanduser().resolve() if configured else workspace / ".auto3dvideo" / "cache" / "omnivoice"
    cache.mkdir(parents=True, exist_ok=True)
    return cache


def configure_cache(workspace: Path) -> Path:
    cache = workspace_cache(workspace)
    hf_home = cache / "huggingface"
    temp_root = cache / "tmp"
    hf_home.mkdir(parents=True, exist_ok=True)
    temp_root.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(hf_home))
    os.environ.setdefault("TEMP", str(temp_root))
    os.environ.setdefault("TMP", str(temp_root))
    os.environ.setdefault("TMPDIR", str(temp_root))
    return cache


def model_cache_present(cache: Path) -> bool:
    hub = cache / "huggingface" / "hub"
    main = hub / "models--k2-fsa--OmniVoice"
    tokenizer = hub / "models--eustlb--higgs-audio-v2-tokenizer"
    main_has_weights = main.exists() and any(main.rglob("model.safetensors"))
    tokenizer_has_files = tokenizer.exists() and any(path.is_file() for path in tokenizer.rglob("*"))
    return main_has_weights and tokenizer_has_files


def find_device() -> str:
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return "cuda:0"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        if hasattr(torch, "xpu") and torch.xpu.is_available():
            return "xpu:0"
    except Exception:
        pass
    return "cpu"


def check(workspace: Path) -> int:
    cache = workspace_cache(workspace)
    package_spec = importlib.util.find_spec("omnivoice")
    torch_spec = importlib.util.find_spec("torch")
    present = model_cache_present(cache)
    device = find_device() if torch_spec else "unavailable"
    if not package_spec or not torch_spec:
        status = "missing_package"
    elif device == "unavailable":
        status = "device_unavailable"
    elif not present:
        status = "model_missing"
    else:
        status = "ready"
    return emit(
        {
            "status": status,
            "packageInstalled": package_spec is not None,
            "torchInstalled": torch_spec is not None,
            "modelId": MODEL_ID,
            "audioTokenizerId": AUDIO_TOKENIZER_ID,
            "modelCachePath": str(cache).replace("\\", "/"),
            "modelCachePresent": present,
            "device": device,
            "modelDownloadRequested": False,
            "networkCallsMade": False,
            "message": (
                "OmniVoice package, PyTorch, model và tokenizer đã sẵn sàng."
                if status == "ready"
                else "Chưa cài package omnivoice hoặc PyTorch."
                if status == "missing_package"
                else "Không nhận diện được device chạy PyTorch."
                if status == "device_unavailable"
                else "Chưa thấy model OmniVoice/tokenizer trong cache local; hãy bấm Cài model."
            ),
        }
    )


def prepare_model(workspace: Path) -> int:
    try:
        cache = configure_cache(workspace)
        if importlib.util.find_spec("omnivoice") is None:
            raise RuntimeError("Chưa cài package omnivoice trong Python đã cấu hình")
        from huggingface_hub import snapshot_download  # type: ignore

        snapshot_download(repo_id=MODEL_ID, repo_type="model", cache_dir=str(cache / "huggingface" / "hub"))
        snapshot_download(repo_id=AUDIO_TOKENIZER_ID, repo_type="model", cache_dir=str(cache / "huggingface" / "hub"))
        return emit(
            {
                "status": "ready" if model_cache_present(cache) else "failed",
                "modelId": MODEL_ID,
                "modelCachePresent": model_cache_present(cache),
                "modelCachePath": str(cache).replace("\\", "/"),
                "modelDownloadRequested": True,
                "networkCallsMade": True,
                "message": "Đã tải model và tokenizer OmniVoice vào cache local." if model_cache_present(cache) else "Đã tải nhưng chưa xác nhận đủ model files.",
            }
        )
    except Exception as error:
        return emit(
            {
                "status": "failed",
                "modelId": MODEL_ID,
                "modelDownloadRequested": True,
                "networkCallsMade": True,
                "message": safe_error(error),
            }
        )


def validate_common(request: dict[str, Any]) -> tuple[str, str, str, float, str]:
    text = request.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS:
        raise ValueError("text phải không rỗng và không vượt 100.000 ký tự")
    language = request.get("language")
    if not isinstance(language, str) or not language.strip() or len(language) > 16:
        raise ValueError("language phải là mã ngôn ngữ không rỗng")
    mode = request.get("mode")
    if mode not in {"clone", "design"}:
        raise ValueError("mode chỉ nhận clone hoặc design")
    output_relative = safe_relative_path(request.get("outputPath"), "outputPath")
    if output_relative.suffix.lower() != ".wav":
        raise ValueError("outputPath phải kết thúc bằng .wav")
    speed = request.get("speed", 1.0)
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not MIN_SPEED <= float(speed) <= MAX_SPEED:
        raise ValueError("speed phải trong khoảng 0.5 đến 2.0")
    quality = request.get("qualityPreset", "preview")
    if quality not in {"preview", "balanced", "quality"}:
        raise ValueError("qualityPreset không hợp lệ")
    return text.strip(), language.strip(), mode, float(speed), str(output_relative).replace("\\", "/")


def resolve_reference(workspace: Path, value: Any) -> Path:
    reference_relative = safe_relative_path(value, "referenceAudioPath")
    if reference_relative.suffix.lower() not in ALLOWED_REFERENCE_SUFFIXES:
        raise ValueError("referenceAudioPath có định dạng không được hỗ trợ")
    reference = workspace / reference_relative
    if not reference.is_file():
        raise ValueError("reference audio không tồn tại trong workspace")
    if reference.stat().st_size > MAX_REFERENCE_BYTES:
        raise ValueError("reference audio vượt 50MB")
    return reference


def wav_metadata(path: Path) -> tuple[int, float]:
    with wave.open(str(path), "rb") as handle:
        sample_rate = handle.getframerate()
        duration = handle.getnframes() / float(sample_rate or 1)
    return sample_rate, duration


def synthesize(workspace: Path, request_path: Path) -> int:
    try:
        request = bounded_request(request_path)
        text, language, mode, speed, output_relative = validate_common(request)
        emotion_segments = parse_inline_emotion_markup(text, request.get("emotionCode"))
        validated_instruct: str | None = None
        output = workspace / output_relative
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            raise ValueError("outputPath đã tồn tại; không ghi đè output cũ")
        consent = request.get("cloneConsent", False)
        if not isinstance(consent, bool):
            raise ValueError("cloneConsent phải là boolean")
        reference: Path | None = None
        ref_text = request.get("referenceTranscript")
        if mode == "clone":
            if not consent:
                raise ValueError("clone voice cần cloneConsent=true")
            if not isinstance(ref_text, str) or not ref_text.strip() or len(ref_text) > MAX_TRANSCRIPT_CHARS:
                raise ValueError("clone voice cần referenceTranscript hợp lệ")
            reference = resolve_reference(workspace, request.get("referenceAudioPath"))
        elif request.get("referenceAudioPath") or request.get("referenceTranscript"):
            raise ValueError("design voice không được nhận reference audio")
        else:
            validated_instruct = validate_design_instruct(language, request.get("instruct"))

        cache = configure_cache(workspace)
        if not model_cache_present(cache):
            raise RuntimeError("Chưa có model/tokenizer local; hãy chạy Cài model trước")
        os.environ["HF_HUB_OFFLINE"] = "1"
        import soundfile as sf  # type: ignore
        import torch  # type: ignore
        from omnivoice import OmniVoice  # type: ignore

        device = find_device()
        dtype = torch.float16 if device.startswith(("cuda", "xpu")) else torch.float32
        # HF_HOME/HF_HUB_CACHE are configured by the caller.  The official
        # loader does not accept cache_dir as a model argument.
        model = OmniVoice.from_pretrained(MODEL_ID, device_map=device, dtype=dtype)
        quality = request.get("qualityPreset", "preview")
        steps = {"preview": 16, "balanced": 24, "quality": 32}[quality]
        kwargs: dict[str, Any] = {
            "language": language,
            "speed": speed,
            "num_step": steps,
            "class_temperature": float(request.get("classTemperature", 0.0)),
            "position_temperature": float(request.get("positionTemperature", 5.0)),
            "normalize_text": bool(request.get("normalizeText", False)),
            "postprocess_output": bool(request.get("postprocessOutput", True)),
        }
        duration = request.get("durationSeconds")
        if duration is not None:
            if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 0.5 <= float(duration) <= 600:
                raise ValueError("durationSeconds phải trong khoảng 0.5 đến 600")
            if len(emotion_segments) == 1:
                kwargs["duration"] = float(duration)

        import numpy as np  # type: ignore

        generated_chunks: list[Any] = []
        emotion_codes_used: list[str] = []
        for segment in emotion_segments:
            emotion_code = normalize_emotion_code(segment["emotionCode"])
            emotion_codes_used.append(emotion_code)
            segment_kwargs = dict(kwargs)
            segment_kwargs["text"] = f"{emotion_fallback_prefix(emotion_code)}{segment['text']}"
            if mode == "clone" and reference is not None:
                segment_kwargs["ref_audio"] = str(reference)
                segment_kwargs["ref_text"] = ref_text.strip()
            else:
                segment_kwargs["instruct"] = emotion_instruct(validated_instruct, emotion_code, mode)
            audios = model.generate(**segment_kwargs)
            if not audios or len(audios[0]) == 0:
                raise RuntimeError(f"OmniVoice không trả audio cho emotionCode={emotion_code}")
            chunk = audios[0]
            if hasattr(chunk, "detach"):
                chunk = chunk.detach().cpu().numpy()
            chunk = np.asarray(chunk).reshape(-1)
            generated_chunks.append(chunk)

        if not generated_chunks:
            raise RuntimeError("OmniVoice không trả audio")
        if len(generated_chunks) == 1:
            rendered_audio = generated_chunks[0]
        else:
            silence = np.zeros(max(1, int(model.sampling_rate * 0.04)), dtype=generated_chunks[0].dtype)
            pieces: list[Any] = []
            for index, chunk in enumerate(generated_chunks):
                if index:
                    pieces.append(silence)
                pieces.append(chunk)
            rendered_audio = np.concatenate(pieces)
        sf.write(str(output), rendered_audio, int(model.sampling_rate))
        sample_rate, duration_seconds = wav_metadata(output)
        if output.stat().st_size <= 44:
            raise RuntimeError("WAV output rỗng hoặc không hợp lệ")
        return emit(
            {
                "status": "succeeded",
                "outputPath": output_relative,
                "modelId": MODEL_ID,
                "mode": mode,
                "language": language,
                "sizeBytes": output.stat().st_size,
                "durationSeconds": duration_seconds,
                "sampleRate": sample_rate,
                "device": device,
                "emotionCodesUsed": list(dict.fromkeys(emotion_codes_used)),
                "emotionSegments": len(emotion_segments),
                "emotionFallback": "legacy_omnivoice_cues",
                "modelDownloadRequested": False,
                "networkCallsMade": False,
                "outputValidated": True,
                "humanReviewRequired": True,
                "message": "Đã tạo WAV OmniVoice local; cần nghe và duyệt trước delivery.",
            }
        )
    except Exception as error:
        return emit(
            {
                "status": "failed",
                "modelId": MODEL_ID,
                "modelDownloadRequested": False,
                "networkCallsMade": False,
                "outputValidated": False,
                "humanReviewRequired": True,
                "message": safe_error(error),
            }
        )


def prepare_clone_profile(workspace: Path, request_path: Path) -> int:
    try:
        request = bounded_request(request_path)
        if not request.get("cloneConsent"):
            raise ValueError("clone voice cần cloneConsent=true")
        reference = resolve_reference(workspace, request.get("referenceAudioPath"))
        transcript = request.get("referenceTranscript")
        if not isinstance(transcript, str) or not transcript.strip():
            raise ValueError("clone voice cần referenceTranscript")
        configure_cache(workspace)
        if not model_cache_present(workspace_cache(workspace)):
            raise RuntimeError("Chưa có model/tokenizer local")
        os.environ["HF_HUB_OFFLINE"] = "1"
        import torch  # type: ignore
        from omnivoice import OmniVoice  # type: ignore

        device = find_device()
        dtype = torch.float16 if device.startswith(("cuda", "xpu")) else torch.float32
        model = OmniVoice.from_pretrained(MODEL_ID, device_map=device, dtype=dtype)
        prompt = model.create_voice_clone_prompt(str(reference), ref_text=transcript.strip())
        output_relative = safe_relative_path(request.get("outputPath"), "outputPath")
        output = workspace / output_relative
        if output.exists():
            raise ValueError("clone prompt đã tồn tại; không ghi đè")
        output.parent.mkdir(parents=True, exist_ok=True)
        prompt.save(str(output))
        return emit({"status": "succeeded", "outputPath": str(output_relative).replace("\\", "/"), "networkCallsMade": False, "message": "Đã tạo clone prompt local."})
    except Exception as error:
        return emit({"status": "failed", "networkCallsMade": False, "message": safe_error(error)})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--prepare-model", action="store_true")
    parser.add_argument("--prepare-clone-profile", action="store_true")
    parser.add_argument("--synthesize", action="store_true")
    parser.add_argument("--request")
    args = parser.parse_args()
    modes = [args.check, args.prepare_model, args.prepare_clone_profile, args.synthesize]
    if sum(modes) != 1:
        return emit({"status": "invalid_request", "message": "chọn đúng một worker mode"})
    workspace = Path.cwd().resolve()
    if args.check:
        return check(workspace)
    if args.prepare_model:
        return prepare_model(workspace)
    if not args.request:
        return emit({"status": "invalid_request", "message": "mode này cần --request"})
    try:
        request_relative = safe_relative_path(args.request, "request")
    except ValueError as error:
        return emit({"status": "invalid_request", "message": str(error)})
    request_path = workspace / request_relative
    if args.prepare_clone_profile:
        return prepare_clone_profile(workspace, request_path)
    return synthesize(workspace, request_path)


if __name__ == "__main__":
    sys.exit(main())
