# Asset Pipeline và Multi-Shot Builder Implementation

**Ngày:** 2026-08-27  
**Dự án:** Auto3Dvideo  
**Trạng thái:** `NEEDS_HUMAN_REVIEW`

## Tóm tắt

Đợt triển khai này chuyển workflow từ quality toolkit đơn scene sang nền tảng asset registry và multi-shot editorial previs. Mục tiêu là giữ continuity giữa nhiều shot, bảo toàn provenance, và chuẩn bị package có cấu trúc để sau này người dùng duyệt rồi mới chuyển sang beauty pass trên Google web.

> Đây là nền tảng production previs, không phải cam kết rằng primitive geometry sẽ tự đạt chất lượng hero model như video tham khảo. Chất lượng cuối vẫn phụ thuộc asset có detail/PBR hợp lệ, lighting, animation, render và beauty pass.

## Thành phần mới

| Thành phần | Vai trò | Safety boundary |
|---|---|---|
| `scripts/asset_registry_worker.py` | Hash file local, ghi MIME/size/kind, provenance và quyền sử dụng | Không download, upload, execute asset, hoặc tự approve quyền |
| `scripts/test_asset_registry_worker.py` | Kiểm thử path traversal, extension và rights default | Deterministic host test |
| `scripts/multishot_scene_builder.py` | Đọc shot spec, tạo collection/camera/marker từng shot, keyframe camera motion, ghi shot manifest | Chạy trong Blender; không socket, không network, không arbitrary code |
| `scripts/test_multishot_scene_builder_host.py` | Validate spec 10 shot, frame continuity và continuity asset IDs | Không cần Blender |
| `configs/pilot-space-10shot.json` | Pilot spec 10 event, 15 giây previs ở 30 fps | `approvalRequired=true`, `beautyPassEligible=false` |

## Shot builder contract

Shot spec yêu cầu `shotId`, `startFrame`, `endFrame`; các trường tùy chọn gồm event, visual grammar, camera type, camera motion và continuity asset IDs. Worker giới hạn tối đa 24 shot, từ chối frame range chồng lấn hoặc path thoát khỏi workspace, tạo marker đầu/cuối shot và ghi `shot-manifest.json`.

Mỗi shot có camera riêng dạng `CAM-{shotId}`. Các motion macro hiện tại gồm `locked`, `push_in`, `orbit` và `rise`. Đây là previs motion có thể được thay thế bằng animation thực ở bước polish; worker không tự nhận rằng motion đơn giản là final cinematic animation.

## Kiểm thử đã chạy

```text
MULTISHOT_HOST_TESTS_PASS=4
ASSET_REGISTRY_WORKER_TESTS_PASS=2
BLENDER_BUILDER_RUN_PASS
BLENDER_VERSION=5.2.1 LTS
BLENDER_FPS=30
BLENDER_SHOT_COUNT=10
BLENDER_FRAME_RANGE=1..450
BLENDER_QUALITY_PREVIEW_PASS
PREVIEW_DIMENSIONS=1080x1920
CONTACT_SHEET_RENDER_PASS
CONTACT_FRAME_COUNT=10
CONTACT_SHEET_DIMENSIONS=1422x996
AUTO3DVIDEO_PROJECT_VALID
manifest_inventory_files=287
physical_files_checked=287
json_files_checked=55
yaml_files_checked=16
semantic_yaml_validation=parsed_with_pyyaml
env_template_validation=passed
```

Đã tìm thấy và chạy Blender 5.2.1 LTS tại `D:\Auto3DvideoTools\blender-5.2.1-windows-x64\blender.exe`. Builder đã tạo scene thật với 10 shot, 450 frames, 30 fps, hero moon proxy procedural, Earth/Sun continuity proxies, orbit ring và star FX anchors. Contact-sheet renderer đã tạo 10 frame đại diện theo camera riêng từng shot ở kích thước review 270×480; contact sheet đã được ghép để QA framing. Import asset có license và polish material vẫn là bước tiếp theo.

## Lệnh chạy sau khi có Blender

```bat
cd /d D:\Duancanhan\Auto3Dvideo
"D:\Path\To\blender.exe" -b --python scripts\multishot_scene_builder.py -- ^
  --workspace D:\Duancanhan\Auto3Dvideo ^
  --spec configs\pilot-space-10shot.json ^
  --output-dir outputs\pilot-space-10shot-previs
```

Sau đó dùng quality toolkit để setup lookdev/preview và exporter để tạo reference package. Chỉ sau khi người dùng xem `shot-manifest.json`, preview và evidence package thì mới có thể mở human approval gate cho BrowserMCP/Google beauty pass.

## Quyết định kỹ thuật

Asset registry mặc định `rightsStatus=unknown`, `status=rights_pending`, `qualityReviewState=needs_review`. Điều này ngăn pipeline biến một file bất kỳ thành asset được phép dùng chỉ vì file tồn tại local. `sourceUri` chỉ được ghi nếu caller cung cấp rõ ràng.

Multi-shot builder không import asset từ internet và không tự tìm model trên mạng. Điều này giữ pipeline local-first, tránh làm mờ provenance và tránh đưa media không rõ license vào final delivery. Asset hợp lệ nên được thêm qua registry với rights record riêng trước khi dùng trong shot.

## Việc còn lại

Đã cấu hình đường dẫn Blender thật và chạy builder. Việc còn lại là bổ sung import/normalize cho asset được duyệt, tạo multi-view contact sheet, tích hợp nút scene.build vào UI/Rust job routing nếu muốn gọi từ desktop, và chạy timeline composer. BrowserMCP/Google Omni/Veo vẫn là bước sau approval; chưa có upload hoặc generation tự động trong đợt này.

## Desktop Flow Handoff follow-up — 2026-08-28

Status: **NEEDS_HUMAN_REVIEW**.

The desktop Browser Handoff panel was verified and reused rather than duplicated. It already exposes local pack preparation, BrowserMCP probe, target navigation, snapshot/screenshot checks, approval-state transitions and local candidate import with FFprobe. The default target was changed to `https://labs.google/fx/tools/flow` so the intended Blender-to-Flow route is explicit.

The Rust and Node BrowserMCP allowlists now accept the contract-approved Google hosts: `ai.google.dev`, `aistudio.google.com`, `gemini.google.com`, `labs.google` and `flow.google`. A local handoff fixture was prepared from `outputs/pilot-space-10shot-previs/contact-sheet/contact-sheet.png`; the worker reported `status=prepared`, `networkCallsMade=false`, `uploadPerformed=false`, `generatePerformed=false`, and recorded the SHA-256 and byte size.

Validation evidence:

```text
node --check scripts/browsermcp_runtime_worker.mjs: PASS
cargo test --manifest-path desktop/src-tauri/Cargo.toml: 48 passed, 0 failed, 4 ignored
pnpm build: PASS
pnpm tauri build: PASS
project validator: PASS
BrowserMCP probe: ready, 12 tools
BrowserMCP navigate to labs.google: blocked; no browser action performed
```

The BrowserMCP package exposes twelve navigation/snapshot tools but no `upload_file` or `download_file`; the connected browser session was not attached for the desktop runtime test. Therefore upload, Generate, download and login remain explicit user-controlled steps. No credentials were read or logged, no Google generation was submitted, and no paid call was made.
