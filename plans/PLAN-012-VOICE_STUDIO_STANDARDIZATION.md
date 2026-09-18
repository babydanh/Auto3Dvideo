# PLAN-012 — Voice Studio Standardization (migration note)

> Plan cũ cho VieNeu đã được thay thế bởi `PLAN-020-OMNIVOICE_VOICE_STUDIO.md`.
> Không dùng các lệnh VieNeu trong đường chạy mới. Các field cũ chỉ còn để đọc/migrate
> project cũ; Voice Studio, provider mặc định và render path hiện dùng OmniVoice local.

## Mục tiêu

Tạo một tab Voice Studio trong Auto3Dvideo để chuẩn hóa giọng VieNeu-TTS trước khi đưa vào video: preset voice, temperature, cue cảm xúc thử nghiệm, preview local và cấu hình theo từng segment.

## Phạm vi

Bao gồm giao diện tiếng Việt, preset voice dạng nhập có gợi ý, temperature bounded 0.6–1.2, cue `[cười]`, `[thở dài]`, `[hắng giọng]`, preview WAV qua native Tauri process boundary, lưu voiceSettings trong video script và hiển thị cấu hình cue theo từng scene. Bao gồm voice-cloning gate yêu cầu reference audio tương đối trong workspace và clone consent.

Không bao gồm voice cloning tự động không consent, nhận diện danh tính người nói, slider cảm xúc tự do mà model không hỗ trợ, cloud TTS, tự động tải model, auto-publish hoặc lưu secret.

## Contract/state

`video-script.schema.json` cho phép top-level `voiceSettings` gồm `presetVoice`, `temperature`, `voiceCueBySegment`, `cloneEnabled` và `cloneConsent`; segment cho phép `voiceCue`. Native validator từ chối unknown keys, temperature ngoài 0.6–1.2, cue ngoài allowlist và clone bật khi thiếu consent. Khi approved render, native pipeline map cue thành inline cue VieNeu trong text TTS; preset và temperature được truyền tới worker.

`run_vieneu_tts` nhận thêm `temperature` và `cloneConsent`. Python worker xác minh lại temperature/reference/consent, giữ `HF_HUB_OFFLINE=1` khi synthesis và trả metadata reference usage.

## Rights/safety

Preset voice chỉ được dùng theo license của package và phiên bản local đã cài. Reference audio không tự được cấp quyền bởi license của model; người dùng phải có quyền/consent. Clone mặc định tắt, không dùng để giả mạo người khác. Preview và render đều cần human review về chất lượng, quyền, disclosure và intended platform.

## Acceptance

1. Tab Voice Studio hiển thị rõ readiness, preset, temperature, preview cue, text, output path và scene cue mapping.
2. Không có project hoặc VieNeu cache thì nút chạy bị khóa; output path phải workspace-relative và không ghi đè.
3. Có thể tạo preview WAV local với `networkCallsMade=false` khi model cache sẵn sàng.
4. Script approved mang `voiceSettings` được native render và TTS request sử dụng đúng preset/temperature/cue.
5. Reference audio không có clone consent bị chặn ở UI, Rust và Python worker.
6. Python test, Rust test, frontend build và project validator pass.
