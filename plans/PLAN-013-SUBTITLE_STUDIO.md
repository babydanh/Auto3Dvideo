# PLAN-013 — Subtitle Studio

## Mục tiêu

Thêm tab Subtitle Studio để người dùng nhập video local có quyền xử lý, tạo transcript/phụ đề draft, dịch sang ngôn ngữ khác, chỉnh text/timestamp và xuất sidecar hoặc bản video burn-in mà không ghi đè file gốc.

## Phạm vi MVP

MVP hỗ trợ nhập `.srt`/`.vtt` để chỉnh ngay; tạo transcript local là worker tùy chọn khi máy đã có Whisper executable/model. Editor hỗ trợ sửa text, start/end time, thêm/xóa dòng, chia/gộp dòng, tìm-thay thế, chọn ngôn ngữ và format. Validator kiểm tra timestamp tăng dần, không overlap, duration dương, độ dài text, CPS và safe path. Xuất `.srt`/`.vtt` versioned; burn-in dùng FFmpeg direct supervisor với filter arguments do Rust tạo, không nhận raw shell/filter từ user.

Dịch tự động là stage optional, phải giữ `source.srt`, tạo file đích riêng và ghi model/locale/review metadata. Không tải video xã hội tùy tiện, không xóa watermark và không tự publish.

## Contract/state

Tạo `contracts/subtitle-document.schema.json` với `schemaVersion`, `documentId`, `sourceVideoPath`, `sourceLanguage`, `targetLanguage`, `durationSeconds`, `format`, `entries[]`, `rightsStatus`, `reviewState` và `networkCallsMade`. Mỗi entry có id, start/end seconds, text và optional confidence/source segment. State `draft → validated → needs_review → approved`; output export luôn versioned/fail-on-overwrite.

## Native commands

- `load_subtitle_document`: đọc SRT/VTT từ workspace và trả document draft.
- `validate_subtitle_document`: chạy deterministic validation không spawn.
- `save_subtitle_document`: ghi SRT/VTT sidecar vào workspace, không ghi đè mặc định.
- `probe_subtitle_video`: FFprobe input local qua direct supervisor.
- `burn_in_subtitles`: FFmpeg tạo video mới với subtitle sidecar, output containment, timeout, post-probe và human review.
- `transcribe_local_video`: chỉ bật khi executable/model Whisper đã configured; output draft, không tự download model.

## Acceptance

1. User có thể mở tab, chọn file `.srt`/`.vtt`, chỉnh text/timing và thấy validation theo dòng.
2. File gốc không bị thay đổi; save output yêu cầu relative path an toàn và chống overwrite.
3. SRT/VTT export giữ millisecond rounding ổn định và không tạo overlap.
4. Burn-in không nhận raw command; FFmpeg/FFprobe chỉ chạy qua direct supervisor.
5. Input/output manifest ghi hash, source path, rights/review/network/cost metadata.
6. Failure paths gồm path traversal, format lỗi, overlap, end ≤ start, text quá dài, video không tồn tại và output đã tồn tại.
7. Python/Rust/frontend/project validator pass.
