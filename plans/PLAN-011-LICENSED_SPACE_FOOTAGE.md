# PLAN-011 — Licensed Space Footage Recipe

## Mục tiêu

Mở rộng native local Topic-to-MP4 để một script đã được người dùng duyệt có thể chọn `visualMode: licensed-footage-space`, trỏ tới `footage-manifest.json` có provenance và ghép nhiều video nguồn thành MP4 dọc cùng narration VieNeu, SRT, FFprobe, hash và durable lifecycle evidence.

## Phạm vi

Change này bao gồm collector manifest-driven với HTTPS hostname allowlist; offline verification; worker `local_licensed_footage_worker.py`; schema `video-script`; native Rust worker selection và FFmpeg video-input path; unit tests; native opt-in E2E; rights ledger/attribution sidecars và workflow example. Không bao gồm social downloader, web scraping, login/cookie automation, watermark removal, repost automation, auto-publish, cloud video generation hoặc cài Blender.

## Trạng thái và cổng quyền

```text
source manifest approved for acquisition
  → collector download hoặc offline verify
  → footage-manifest có hash, credit, license, proof và needs_review
  → script có assetId từng shot + footageManifestPath
  → human duyệt script/claim/voice
  → worker chỉ map file local đã tồn tại và xác minh SHA-256
  → FFmpeg trim/scale/crop video-only → concat → mux VieNeu/SRT
  → FFprobe + hash + SQLite durable evidence
  → succeeded_needs_review
```

`needs_review` không được tự chuyển thành cleared-for-commercial-use. NASA asset dùng điều kiện theo NASA media guidelines; Commons CC BY cần credit, link license và ghi thay đổi. Quyết định `approved` phải gắn với nền tảng, lãnh thổ, phiên bản asset và monetization scope cụ thể.

## An toàn kỹ thuật

Tất cả path phải workspace-relative, không có `..`, absolute path hoặc URI. Collector chỉ nhận host HTTPS trong allowlist và extension video đã định nghĩa; offline mode không gọi mạng. Worker giới hạn số asset/segment, kiểm tra size, extension, rights fields, source/landing/proof, review state và SHA-256 trước khi phát scene. Rust truyền FFmpeg bằng structured arguments qua direct supervisor với timeout, cancellation và output validation.

## Acceptance

Collector offline tạo `footage-manifest.json` với `networkCallsMade=false`, `externalAssetsUsed=true`, SHA-256 và `reviewState=needs_review`. Python tests bao phủ happy path, host/filename/rights rejection, non-video rejection, worker mapping và missing asset. Rust suite pass; native opt-in E2E với ba footage thật tạo MP4 H.264/AAC 720×1280, WAV, SRT, FFprobe và SQLite lifecycle evidence. Artifact cuối vẫn phải được người dùng nghe/xem và review rights trước phát hành.
