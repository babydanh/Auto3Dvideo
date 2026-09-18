"""Discover video candidates from a public, license-labelled footage catalog.

This worker only reads the public Wikimedia Commons API. It does not log in,
scrape social profiles, bypass a challenge, download media, or infer that a
file is safe merely because it is visible on the web. Candidates are kept only
when the file page exposes a public-domain or adaptation-friendly license.
The final file-page, credit and third-party-rights review remains mandatory.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

API_URL = "https://commons.wikimedia.org/w/api.php"
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_RESULTS = 200
QUERIES = (
    "filetype:video nature",
    "filetype:video science",
    "filetype:video space",
    "filetype:video ocean",
    "filetype:video animal",
    "filetype:video technology",
    "filetype:video timelapse",
    "filetype:video animation",
)
VIDEO_EXTENSIONS = {".mp4", ".webm", ".ogv", ".ogg", ".mov", ".m4v"}
REUSE_LICENSE_HINTS = (
    "public domain",
    "public-domain",
    "cc0",
    "cc by",
    "cc-by",
    "cc by-sa",
    "cc-by-sa",
    "attribution",
)
BLOCKED_LICENSE_HINTS = (
    "non-commercial",
    "noncommercial",
    "nc ",
    "no derivatives",
    "no-derivatives",
    "nd ",
    "fair use",
    "copyrighted",
    "unknown",
)
LOW_VALUE_HINTS = (
    "tiktok",
    "douyin",
    "kuaishou",
    "youtube",
    "selfie",
    "vlog",
    "home video",
    "personal video",
    "concert",
    "music video",
    "song",
    "movie",
    "film",
    "television",
    " tv ",
    "broadcast",
    "film trailer",
    "tv show",
    "news report",
    "football",
    "soccer",
    "basketball",
    "wrestling",
)
POTENTIAL_HINTS = (
    "nature",
    "forest",
    "ocean",
    "sea",
    "water",
    "animal",
    "bird",
    "insect",
    "space",
    "galaxy",
    "planet",
    "earth",
    "science",
    "laboratory",
    "technology",
    "robot",
    "machine",
    "city",
    "aerial",
    "drone",
    "timelapse",
    "animation",
    "abstract",
    "volcano",
    "cloud",
    "fire",
)
INSTITUTION_HINTS = (
    "nasa",
    "esa",
    "noaa",
    "usgs",
    "smithsonian",
    "university",
    "museum",
    "archive",
    "government",
    "laboratory",
    "observatory",
)


def emit(payload: dict[str, Any]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if payload.get("status") in {"success", "partial"} else 1


def safe_relative_path(value: str, field: str) -> Path:
    raw = value.strip().replace("\\", "/")
    path = Path(raw)
    if not raw or path.is_absolute() or ":" in raw or any(part in {"", ".", ".."} for part in raw.split("/")):
        raise ValueError(f"{field} phải là đường dẫn tương đối an toàn")
    return path


def read_response(request: Request) -> dict[str, Any]:
    with urlopen(request, timeout=20) as response:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_RESPONSE_BYTES:
            raise ValueError("Wikimedia API trả response vượt giới hạn")
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("Wikimedia API trả response vượt giới hạn")
    value = json.loads(body.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Wikimedia API không trả JSON object")
    return value


def metadata_text(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("value", "")
    text = html.unescape(str(value or ""))
    return re.sub(r"<[^>]+>", " ", text).strip()


def metadata_value(metadata: dict[str, Any], *keys: str) -> str:
    for key in keys:
        if key in metadata:
            value = metadata_text(metadata[key])
            if value:
                return value
    return ""


def license_details(metadata: dict[str, Any]) -> tuple[str, str, str, str] | None:
    name = metadata_value(metadata, "LicenseShortName", "License", "UsageTerms")
    lower = f" {name.lower()} "
    if not name or any(hint in lower for hint in BLOCKED_LICENSE_HINTS):
        return None
    if not any(hint in lower for hint in REUSE_LICENSE_HINTS):
        return None
    url = metadata_value(metadata, "LicenseUrl")
    credit = metadata_value(metadata, "Credit", "Artist", "Author")
    rights = "public_domain" if any(hint in lower for hint in ("public domain", "public-domain", "cc0")) else "licensed"
    return name[:160], url[:500], credit[:240], rights


def parse_duration(value: str) -> float | None:
    if not value:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        return float(value)
    parts = value.strip().split(":")
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        return None
    if len(numbers) == 3:
        return numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    if len(numbers) == 2:
        return numbers[0] * 60 + numbers[1]
    return None


def file_page(title: str) -> str:
    return "https://commons.wikimedia.org/wiki/" + quote(title.replace(" ", "_"), safe=":()'-_.,")


def normalized_title(title: str) -> str:
    return re.sub(r"\s+", " ", title.removeprefix("File:")).strip()


def score_candidate(title: str, description: str, license_name: str, width: int, height: int, duration: float | None, credit: str) -> tuple[int, list[str]]:
    text = f"{title} {description}".lower()
    score = 30
    reasons = [f"license: {license_name}"]
    if "public domain" in license_name.lower() or "cc0" in license_name.lower():
        score += 15
        reasons.append("public domain/CC0")
    elif "cc by" in license_name.lower() or "attribution" in license_name.lower():
        score += 10
        reasons.append("được phép tạo tác phẩm phái sinh theo license; cần ghi nguồn")
    if height and width:
        ratio = height / width
        if ratio >= 1.15:
            score += 16
            reasons.append("khung dọc phù hợp short video")
        elif ratio >= 0.9:
            score += 7
            reasons.append("có thể crop sang dọc")
        else:
            score += 4
            reasons.append("khung ngang; cần crop sang dọc")
    if duration is not None:
        if 5 <= duration <= 90:
            score += 12
            reasons.append("độ dài phù hợp dựng clip ngắn")
        elif 2 <= duration <= 180:
            score += 5
            reasons.append("độ dài có thể cắt thành đoạn ngắn")
    if any(hint in text for hint in POTENTIAL_HINTS):
        score += 15
        reasons.append("chủ đề dễ làm footage nền cho voice-over")
    if any(hint in text for hint in INSTITUTION_HINTS) or any(hint in credit.lower() for hint in INSTITUTION_HINTS):
        score += 8
        reasons.append("có tín hiệu tư liệu/tổ chức")
    if any(hint in text for hint in LOW_VALUE_HINTS):
        score -= 35
        reasons.append("giảm điểm vì có tín hiệu video cá nhân/giải trí có sẵn")
    return max(0, min(100, score)), reasons


def fetch_candidates(max_results: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    candidates: list[dict[str, Any]] = []
    per_query = max(12, min(50, max_results // 2 + 8))
    for query in QUERIES:
        params = {
            "action": "query",
            "generator": "search",
            "gsrsearch": query,
            "gsrnamespace": "6",
            "gsrlimit": str(per_query),
            "prop": "imageinfo",
            "iiprop": "url|mime|size|extmetadata",
            "iiurlwidth": "640",
            "format": "json",
            "formatversion": "2",
        }
        request = Request(
            f"{API_URL}?{urlencode(params)}",
            headers={"User-Agent": "Auto3Dvideo-licensed-preview/1.0 (local desktop app)"},
        )
        document = read_response(request)
        pages = document.get("query", {}).get("pages", [])
        if not isinstance(pages, list):
            continue
        for page in pages:
            if not isinstance(page, dict):
                continue
            title = str(page.get("title", "")).strip()
            info_values = page.get("imageinfo", [])
            info = info_values[0] if isinstance(info_values, list) and info_values and isinstance(info_values[0], dict) else None
            if not title or not info:
                continue
            media_url = str(info.get("url", "")).strip()
            mime = str(info.get("mime", "")).lower().strip()
            extension = Path(media_url.split("?", 1)[0]).suffix.lower()
            if not mime.startswith("video/") and extension not in VIDEO_EXTENSIONS:
                continue
            details = license_details(info.get("extmetadata", {}))
            if not details:
                continue
            license_name, license_url, credit, rights = details
            if media_url in seen:
                continue
            seen.add(media_url)
            description = metadata_value(info.get("extmetadata", {}), "ImageDescription", "ObjectName")
            width = int(info.get("width", 0) or 0)
            height = int(info.get("height", 0) or 0)
            duration_text = metadata_value(info.get("extmetadata", {}), "Duration", "VideoLength")
            duration = parse_duration(duration_text)
            score, reasons = score_candidate(title, description, license_name, width, height, duration, credit)
            if any(hint in f" {title.lower()} {description.lower()} " for hint in LOW_VALUE_HINTS):
                continue
            if score < 48:
                continue
            title_text = normalized_title(title)
            candidates.append({
                "previewId": "preview-wikimedia-" + hashlib.sha256(media_url.encode("utf-8")).hexdigest()[:16],
                "platform": "wikimedia",
                "title": title_text[:240] or "Wikimedia footage",
                "author": credit or "Không rõ tác giả trên file page",
                "shareUrl": file_page(title),
                "embedUrl": None,
                "thumbnailUrl": str(info.get("thumburl", "")).strip() or None,
                "mediaUrl": media_url,
                "mediaMimeType": mime or None,
                "licenseName": license_name,
                "licenseUrl": license_url or "https://commons.wikimedia.org/wiki/Commons:Licensing",
                "sourceKind": "licensed_public_archive",
                "potentialScore": score,
                "potentialEvidence": "; ".join(reasons),
                "scannedAt": datetime.now(timezone.utc).isoformat(),
                "addedToPlan": False,
                "radarBuckets": ["potential"],
                "rankingEvidence": "; ".join(reasons),
                "reuseStatus": "license_candidate",
                "reuseEvidence": f"{license_name}; xem file page và xác nhận attribution/third-party rights trước khi tải.",
                "reviewStatus": "unreviewed",
            })
    candidates.sort(key=lambda item: (-int(item["potentialScore"]), item["title"].lower()))
    return candidates[:max_results]


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--max-results", type=int, required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        if not 1 <= args.max_results <= MAX_RESULTS:
            raise ValueError("max-results phải nằm trong khoảng 1..200")
        output = safe_relative_path(args.output, "output")
        candidates = fetch_candidates(args.max_results)
        output.parent.mkdir(parents=True, exist_ok=True)
        report = {
            "status": "success" if candidates else "blocked",
            "worker": "Wikimedia Commons · licensed footage discovery",
            "engine": "wikimedia_commons_public_api",
            "scanMode": "licensed_footage",
            "previewOnly": True,
            "platforms": ["wikimedia"],
            "maxResults": args.max_results,
            "platformResults": [{
                "platform": "wikimedia",
                "status": "success" if candidates else "empty",
                "scannedCount": len(candidates),
                "discoveryUrl": API_URL,
                "message": "Đã lọc candidate có license public-domain/CC phù hợp dựng lại; vẫn phải review file page, credit, logo, người và âm thanh.",
            }],
            "cards": candidates,
            "browserSessionAttached": False,
            "networkCallsMade": True,
            "message": (
                f"Đã tìm {len(candidates)} footage có tín hiệu license và tiềm năng dựng short; hãy xem preview và kiểm tra license từng file."
                if candidates else
                "Không tìm được footage đạt ngưỡng license và tiềm năng; không ghi kết quả giả."
            ),
        }
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return emit({"status": report["status"], "cardCount": len(candidates), "output": str(output).replace("\\", "/"), "message": report["message"]})
    except Exception as error:
        return emit({"status": "failed", "message": f"Không quét được kho footage: {type(error).__name__}: {str(error)[:240]}"})


if __name__ == "__main__":
    sys.exit(main())
