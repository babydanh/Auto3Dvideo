# PLAN-023 Slice 3 — Asset Pipeline Evidence

Date: 2026-09-11  
Status: `NEEDS_HUMAN_REVIEW`

## Scope

Slice 3 nối Asset Library local với ingest/provenance/hash, phân loại asset, rights quarantine, Blender quality/lookdev và shot binding. Thay đổi không gọi provider/cloud, không download/upload, không ghi secret và không coi ảnh phác là model 3D.

## Implementation

- `contracts/asset-ingest.schema.json` định nghĩa intake typed: source path tương đối, declared kind, role, shot IDs, provenance, rights và review.
- `contracts/asset-pipeline-report.schema.json` định nghĩa report gồm asset counts, resolved kind, SHA-256, MIME/dimensions, staged/quarantine paths, quality/normalization state, binding và quality evidence.
- `scripts/asset_pipeline_worker.py` kiểm tra path containment, file header/extension, dimensions cơ bản, hash, copy sang run directory mới, quarantine rights chưa rõ hoặc file sai loại và tạo `asset-bindings.json`/`quarantine.json`.
- `scripts/blender_asset_quality_worker.py` chạy trong Blender allowlist, mở model `.blend`, dùng `blender_quality_toolkit.py` để inspect mesh/material/scale, áp preset lookdev/camera lên bản copy và ghi `normalized.blend` cùng report.
- Rust command `run_asset_pipeline_check` lấy asset và reference-set assignment hiện có từ SQLite, chạy Python ingest, chạy Blender quality nếu có model3d ready và Blender đã cấu hình, merge report rồi ghi audit event.
- Settings thêm nút `Kiểm tra Asset Pipeline` và hiển thị ready/quarantine/report/binding/quality path cùng blocker rõ ràng.

## Validation

| Check | Result |
|---|---|
| `python scripts/test_asset_pipeline_worker.py` | PASS — `ASSET_PIPELINE_WORKER_STATIC_VALID` |
| `python scripts/test_blender_quality_toolkit.py` | PASS — 3 tests |
| `python -m py_compile scripts/asset_pipeline_worker.py scripts/blender_asset_quality_worker.py` | PASS |
| Host smoke with `examples/plan023-true3d/asset-ingest-spec.json` | PASS — 4 typed assets, `ready=3`, `quarantined=1` |
| `cargo check --manifest-path desktop/src-tauri/Cargo.toml --no-default-features` | PASS — warnings chỉ ở code cũ |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib` | PASS — 66 passed, 4 ignored |
| `pnpm build` in `desktop` | PASS — bundle warning >500 KB only |
| `python scripts/validate_project.py --project .` | PASS — manifest inventory 368 files, JSON 76, YAML 17 |
| Native dev launch (`pnpm tauri dev`) | PASS — `auto3dvideo-desktop.exe` đang chạy |

## Safety and review boundary

Asset pipeline chỉ copy vào thư mục run versioned và không overwrite asset đã có. Worker không có network/shell surface; prompt/title/provenance không được biến thành command. Rights chưa rõ hoặc file không khớp declared kind bị quarantine; binding của chúng là `blocked`. Model 3D chưa qua Blender quality không được coi là normalized/approved. Nếu Blender chưa cấu hình, report vẫn tạo được cho ingest nhưng giữ `needs_review` và không claim quality.

Human review vẫn bắt buộc cho silhouette, topology/UV, scale thực tế, material/lookdev, continuity giữa shot, quyền thương mại, disclosure và final delivery. Slice này chưa có adapter tự tải generated provider outputs; output provider vẫn phải đi qua capability/cost/rights/approval và ingest typed sau.

## Cost and rights

Cost impact: `0 USD`; chỉ chạy local Python/Blender nếu người dùng đã cấu hình. Không có cloud/provider/publish action. Rights status được giữ nguyên từ Asset Library; `pending/unknown/restricted/rejected` không được promote vào binding active.

## Next action

Mở app đang chạy → chọn Settings → nhập ít nhất một asset local trong Asset Library → bấm `Kiểm tra Asset Pipeline` → mở report/quarantine và review model normalized. Slice tiếp theo là nối output provider đã được duyệt vào ingest này và sau đó mới nối voice/alignment/caption; không tự publish.
