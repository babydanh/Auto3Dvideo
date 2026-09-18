# PLAN-015 — Video Vision Evidence Local-First

## Mục tiêu

Thêm một slice bounded cho Auto3Dvideo để đọc cấu trúc video local bằng bằng chứng đo được, làm đầu vào cho storyboard/shot-plan/prompt compiler. Slice này không tải video từ TikTok/Douyin/YouTube, không scrape social, không gọi cloud, không tự cài model nặng và không tuyên bố semantic understanding khi chưa có VLM.

## Phạm vi slice A đã triển khai

| Bước | Đầu vào | Đầu ra | Boundary |
|---|---|---|---|
| Probe | Video tương đối trong project workspace | duration, width, height, fps, codec, audio presence | FFprobe qua Rust supervisor, timeout 90 giây |
| Frame sampling | Video đã probe, sample FPS 0.1–2, tối đa 240 frame | JPEG 320×180 mặc định dưới `.auto3dvideo/vision/<id>/frames` | FFmpeg typed args, không shell wrapper |
| Audio handoff | Audio stream nếu có và người dùng bật | WAV mono 16 kHz | FFmpeg typed args, không STT |
| Evidence analysis | Frame directory + probe metadata | `video-evidence.schema.json` JSON | Python worker local, hash input, không OCR/STT/VLM |
| Review | Evidence JSON + output hashes | trạng thái `needs_review` | Người dùng duyệt shot, rights và chất lượng |

## Evidence contract

`video-evidence.schema.json` giữ các field: source hash, metadata media, sampling config, shot ranges, frame refs, boundary method, brightness, motion, palette, edge density, semantic/OCR/transcript status, rights status, review state, network state và cost state. Shot plan về sau có thể tham chiếu `shotId`, timestamp và frame refs thay vì đoán từ brief hoặc một thumbnail.

## Kiến trúc an toàn

Rust resolve project workspace từ SQLite, canonicalize và kiểm tra path containment. Chỉ có `python`, `ffmpeg` và `ffprobe` được gọi thông qua direct process supervisor với allowlist, typed arguments, timeout, bounded stdout/stderr và expected output validation. Worker Python nhận request JSON tương đối trong workspace và tự kiểm tra path traversal, giới hạn request, giới hạn video/frame, output không ghi đè và hash SHA-256.

LLM/VLM không được nhận quyền thực thi. Ở các slice tiếp theo, Qwen3-VL nếu được người dùng duyệt chỉ sinh `semanticSummary`, OCR/action/object cues và confidence trong một artifact riêng hoặc phần mở rộng có schema; native app vẫn kiểm soát path, model profile, network, budget, rights và human review.

## Chưa làm trong PLAN-015

Slice hiện tại chưa có OCR, transcript, Whisper, Qwen3-VL, object detection, claim verification, storyboard editor hoặc prompt compiler. Không cài thêm package/model trong slice này. Audio WAV chỉ là handoff cho STT tương lai; không được gọi là transcript.

## Acceptance criteria

1. Video ngoài workspace, URL, absolute path, traversal và output trùng tên bị từ chối.
2. Video hợp lệ tạo được metadata, frame directory và evidence JSON có source SHA-256.
3. Shot ranges tăng dần, nằm trong duration và có frame refs workspace-relative.
4. `networkCallsMade=false`, `semanticVlm=false`, `ocr=false`, `transcript=false` khi chưa có adapter.
5. FFprobe/FFmpeg/Python chỉ chạy qua native direct supervisor.
6. Mọi evidence ở trạng thái cần review, không tuyên bố publishable, monetizable hoặc legal-cleared.
7. Test Python và Rust pass; frontend build pass; project validator pass.

## Lộ trình sau slice A

Slice B thêm shot-plan contract và UI editor: người dùng sửa beat, duration, visual mode, prompt, asset source, claim/source và review state. Slice C thêm tùy chọn Qwen3-VL local adapter sau khi duyệt model weights, hardware, dependency và license. Slice D nối Subtitle Studio SRT/transcript đã được duyệt và planner. Slice E tạo QA reader đọc lại video output để kiểm tra continuity, caption, crop, missing shots và claim evidence.
