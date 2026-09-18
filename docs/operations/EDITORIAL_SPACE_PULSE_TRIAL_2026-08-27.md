# Editorial Space Pulse Trial — NEEDS_HUMAN_REVIEW

## Mục tiêu

Tạo một video thử dọc original lấy cảm hứng từ grammar quan sát được ở reference: nền không gian tối, tương phản cyan/trắng, điểm nhấn đỏ, hero visual chuyển động hướng tâm, typography hook và cảm giác science-editorial. Video này không sao chép shot-by-shot, footage, logo, typography exact hoặc giọng creator.

## Output

| Artifact | Metadata |
|---|---|
| `outputs/editorial-space-pulse-v3/editorial-space-pulse-final.mp4` | H.264, 540×960, 30 fps, AAC mono 48 kHz, 30.000 s; SHA-256 `658d62d8503b6ba6a35f4031ef23f0cc9c78e1e20a44d0b95e9e837623b12d4a` |
| `outputs/editorial-space-pulse-v3/editorial-space-pulse.blend` | Blender source scene; SHA-256 `98858f800fecdbf50f1cf6fdada0f93be90beb5da28d8fa82ccd1485359ab708` |
| `.auto3dvideo/tts/editorial-space-pulse-narration.wav` | VieNeu `Adam`, ONNX int8, no reference audio, cloneConsent false; SHA-256 `09bf3c8cb18a6b3580f41fc520ee61a3c3f24724816da4f7d312770418dbe139` |
| `outputs/editorial-space-pulse-v3/editorial-space-pulse.srt` | Vietnamese sidecar subtitles; SHA-256 `d3a71306387d3d2426288c11130895339aa0a6b54cf962670827dcac38f2d255` |
| `outputs/editorial-space-pulse-v3/final-ffprobe.json` | Codec, stream, dimensions, FPS, sample rate, channels, duration and size evidence |
| `outputs/editorial-space-pulse-v3/visual-review.md` | QA frame review at 5s, 15s and 25s |

## Changed files

`editorial_space_pulse_worker.py` tạo procedural Blender scene bằng primitives; `run_editorial_space_pulse_encode.cmd` mux narration và giữ subtitle dưới dạng sidecar SRT; `editorial-space-pulse-voice.json` khai báo narration; `MANIFEST.json` đăng ký source; PLAN-019 và Reference Video Workflow report mô tả intake-to-shot architecture.

## So sánh với reference

Video thử đã tiến gần hơn pilot Moon ở palette, central focal point, cyan/white streaks, red contrast accent và camera energy. Tuy nhiên nó **chưa giống hoàn toàn reference**: hiện vẫn là một hero procedural scene liên tục với sphere/rings; chưa có nhiều semantic cutaways, distinct visual-proof shots, typography rhythm mạnh, sound-design hits hoặc composited editorial layers. Đây là style experiment, không phải recreation.

## Commands và validation

Blender 5.2.1 tạo scene và render 900 PNG frames. FFmpeg 9.0.1 encode image sequence, mux VieNeu narration và pad output đến 30 giây. FFprobe pass: 540×960, 30 fps, H.264, AAC mono 48 kHz, 30.000 s. `certutil -hashfile` đã ghi hash evidence. Project validator pass sau khi đăng ký source: `manifest_inventory_files=270`, `physical_files_checked=270`, `json_files_checked=52`, `yaml_files_checked=16`.

## Cost, rights và limits

Blender, FFmpeg và VieNeu synthesis chạy local. Model VieNeu đã có cache từ lần chuẩn bị trước; synthesis lần này báo `networkCallsMade=false`. Không gọi cloud video/image API. Reference TikTok chỉ dùng làm moodboard/analysis; không tải lại, không reuse footage/audio, không clone voice/likeness, không upload và không publish.

Text subtitle đang là sidecar SRT vì Windows FFmpeg filter quoting làm burn-in fail trong thử nghiệm; video vẫn có subtitle script đầy đủ nhưng chưa embedded. Visual QA mới xem frame checkpoints, chưa thay thế human xem toàn bộ motion và nghe toàn bộ narration.

## Next action

Người dùng xem file MP4, SRT và QA report để đánh giá có đạt đúng cảm giác editorial chưa. Nếu tiếp tục, Phase 2 nên implement `reference_probe`, `shot_detect`, `keyframe_extract`, `audio_transcribe` và `vision_evidence` bounded workers, sau đó mới làm một bản 45–60 giây có 10–12 event thật sự khác nhau thay vì một hero scene kéo dài.
