# PLAN-010 — Space 2.5D Infographic Recipe

## Mục tiêu

Mở rộng luồng local Topic-to-MP4 để một script được người dùng duyệt có thể chọn `visualMode: space-25d`. Worker tạo frame sequence PNG 720×1280/30 fps bằng hình học procedural, sau đó native Rust dùng FFmpeg tạo clip từng scene, ghép audio VieNeu/SRT, chạy FFprobe và ghi manifest/hash/evidence như luồng hiện tại.

## Phạm vi change

Được phép thay đổi `scripts/local_space_25d_worker.py`, `scripts/test_local_pipeline_workers.py`, `desktop/src-tauri/src/local_video.rs`, `desktop/src/App.tsx`, `contracts/video-script.schema.json`, `docs/architecture/MEDIA_PROCESSING.md`, `workflows/example-space-25d-infographic.yaml`, `examples/space-25d/brief.md`, `research/RESEARCH_2_5D_BLENDER_WORKFLOW_2026-08-25.md` và `MANIFEST.json`. Không thay đổi dữ liệu project người dùng, không đọc `.env`, không thêm dependency hoặc cài model.

## Luồng trạng thái

```text
script pending
  → người dùng sửa/duyệt title, narration, claim/source
  → người dùng chọn space-25d nếu nội dung đúng chủ đề
  → Python tạo frame sequence + scene-manifest
  → Rust kiểm tra path/manifest
  → FFmpeg encode từng scene
  → FFmpeg mux audio + SRT timing
  → FFprobe + validator + SHA-256
  → jobs.succeeded_needs_review
```

Nếu script còn claim `needs_review`, script chưa được duyệt, visualMode sai, path có `..`/absolute/URI, frame thiếu, output rỗng hoặc FFprobe không đúng stream thì dừng ở trạng thái lỗi; không được coi là thành công.

## Thiết kế visual

Mỗi scene có lớp nền gradient/sao xa, lớp quỹ đạo elip, lớp Mặt Trời/hành tinh và lớp foreground gồm rocket marker/tia chuyển động cùng panel chữ. Vật thể có phase khác nhau theo `sceneIndex`, `frameIndex` và FPS cố định để frame đầu/cuối khác nhau và tái lập được. Không dùng video, ảnh, logo, watermark, giọng hoặc prompt của TikTok làm asset đầu vào.

## Quyền và nguồn

Chế độ mặc định là `procedural-only`, ghi `externalAssetsUsed=false`, `rightsStatus=generated-local`, `reviewState=needs_review`. Import footage chỉ được thêm ở change riêng với rights-record bắt buộc gồm owner, source URI, license/permission, derivative/commercial/platform scope, proof path, expiry và reviewer. Không thêm downloader, watermark removal, repost hoặc auto-publish.

## Blender compatibility

Máy Windows hiện chưa trả về `blender.exe` trong PATH/đường dẫn kiểm tra, nên change này không phụ thuộc Blender để tạo sample. Khi Blender được cấu hình hợp lệ, có thể tạo adapter riêng theo `BLENDER_INTEGRATION.md`; không tự cài Blender trong change này.

## Acceptance

Worker có test frame count, output containment, moving-frame evidence và unsafe-path rejection. Rust compile/test, frontend build, project validator và native E2E phải pass. Artifact vẫn phải gắn human review; không tuyên bố publishable/monetizable chỉ từ kiểm tra kỹ thuật.
