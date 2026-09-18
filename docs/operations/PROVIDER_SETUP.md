# Provider and Model Setup Runbook

## Development setup

1. Copy `.env.example` to a local ignored `.env`.
2. Keep the default `AUTO3DVIDEO_PROFILE=mock` until the provider profile, terms, cost and rights review is complete.
3. Choose one or more capability families: LLM/chat, image, video, TTS, STT, audio, 3D asset, Blender render or FFmpeg media.
4. Fill only the variables for the selected provider. Leave all other provider switches disabled.
5. Add a matching non-secret profile to a local copy of `configs/provider-profiles.example.yaml`, saved as `configs/provider-profiles.yaml`.
6. Configure the allowlisted hostname and run the future adapter health check before running a real job.

## Example selections

| Need | Profile | Adapter shape | Required values |
|---|---|---|---|
| Local script planning | `llm_local` | Ollama/OpenAI-compatible local endpoint | Base URL and local model; no API key |
| Hosted script planning | `llm_primary` | Official OpenAI-compatible adapter | Base URL, model and credential reference |
| Reference images | `image_local` | ComfyUI | Loopback endpoint, workflow/checkpoint and local model files |
| AI video shots | `video_primary` | Official provider-specific HTTP/SDK adapter | Endpoint, model, API credential, cost and terms evidence |
| Voiceover cloud | `voice_primary` | Provider-specific official TTS adapter | Endpoint, model, approved voice ID, API credential and rights record |
| Voiceover local | `voice_primary` | VieNeu-TTS v3 Turbo through bounded Python/ONNX worker | Python reference, installed package/model cache, preset voice and review evidence; no API key |
| Transcription | `stt_local` | Whisper-compatible local engine | Local model path or ID |
| True 3D rendering | `blender_local` | Blender CLI worker | Installed Blender path/version |
| Compose/export | `media_local` | FFmpeg worker | Installed FFmpeg/ffprobe paths |

“ElevenLabs-style” means a provider-specific TTS adapter with text, voice, model and output settings. It does not mean that every provider accepts the same fields or that the project includes an ElevenLabs credential.

## Profile selection in a workflow

A stage selects a profile explicitly:

```yaml
- id: voice
  type: media.compose
  operation: synthesize_speech
  executor: provider_adapter
  provider: configured-by-user
  model_profile: voice_primary
  approval: required
  outputs: [voice.wav]
```

The Rust runner maps the YAML naming convention to the canonical request contract, checks capability and policy, resolves the credential, submits the request with an idempotency key and stores redacted evidence. The implemented local VieNeu slice uses `scripts/vieneu_tts_worker.py` through the allowlisted `python.exe`; it accepts a bounded request JSON, rejects unsafe paths, runs Hugging Face offline and validates a non-empty WAV output. It does not automatically download model weights.

## Credential handling

For development, `credential_ref: env:AUTO3DVIDEO_TTS_API_KEY` may resolve from a local ignored `.env`. For packaged Windows use, replace it with an OS credential-store reference. The UI must offer “configured / missing / rejected” status, never reveal the value. Do not paste keys into prompts, workflow files, screenshots, support logs or commit history.

## Cloud activation gate

A cloud profile remains disabled until endpoint allowlisting, API/version check, terms and privacy review, pricing/quote evidence, budget policy, output rights, retention behavior, retry semantics and a mock adapter fixture are complete. Free credits are not treated as a permanent free production mode.

## Development loader behavior

The desktop development loader reads only `AUTO3DVIDEO_*` assignments from a local `.env` file. It checks the current working directory and, when the app is launched from `desktop`, the repository parent; `AUTO3DVIDEO_DOTENV_PATH` can point to an explicit local file. The file is bounded to 128 KiB, malformed lines are ignored with a safe warning, process environment values take precedence, and neither secret values nor full request payloads are returned to the UI or logs.

Each capability family has its own independent profile block. The supported prefixes are `LLM`, `IMAGE`, `VIDEO`, `TTS`, `STT`, `AUDIO`, `ASSET3D`, `RENDER3D` and `MEDIA`. A block can choose `PROFILE_ID`, `PROVIDER`, `ADAPTER`, `BASE_URL`, `MODEL`, `CREDENTIAL_REF`, `PRICING_MODE`, `TIMEOUT_SECONDS`, `MAX_ATTEMPTS` and comma-separated `FALLBACK_PROFILES`. The Model & API screen displays these values as non-secret metadata and reports credential state only as `configured`, `missing`, `rejected` or `unresolved`.

The env loader is a configuration/readiness slice, not a general cloud execution adapter. The local VieNeu adapter is separate: it does not require `AUTO3DVIDEO_TTS_API_KEY`, does not access the network during synthesis, and only uses a model already present in the project-local cache. `AUTO3DVIDEO_VIDEO_ENABLED=true` or another cloud switch does not submit a request. Cloud generation calls remain blocked until the provider-specific adapter has a documented request/response contract, allowlisted endpoint, health check, cost estimate, terms and rights metadata, bounded idempotent retries, output validation, cancellation/reconciliation and a human approval gate. The default `AUTO3DVIDEO_PROFILE=mock` should remain unchanged during setup.

### Command Code connectivity probe

Command Code's official OpenAI-compatible base URL is `https://api.commandcode.ai/provider/v1`; the chat operation is `POST /chat/completions`, authenticated with `Authorization: Bearer <key>`. The exact public Laguna model ID is `poolside/laguna-s-2.1-free`. A local Command Code gateway may expose the allowlisted alias `cmd/poolside/laguna-s-2.1-free` at `http://localhost:20128/v1` or `http://127.0.0.1:20128/v1`; these loopback endpoints are treated as local transport and the key is still read only from the local `.env`. The desktop app includes a deliberately narrow **Kiểm thử API** probe: it sends one fixed Vietnamese sentence, uses at most 32 output tokens, requests `x-cmd-zdr: 1`, reads `AUTO3DVIDEO_LLM_API_KEY` only inside the bounded worker from the local `.env`, and does not accept user prompt, arbitrary model, upload or publish parameters. This probe is a connectivity check, not general cloud generation. The provider page states that Laguna is $0.00 while capacity lasts, but the account plan/entitlement still controls API access; a 403 response must be reported as an account/plan issue, not treated as an adapter bug. Do not store response text in project records, and do not put keys in argv, logs, prompts or screenshots.

| Variable family | Example role | Default safety behavior |
|---|---|---|
| `AUTO3DVIDEO_LLM_*` | Script planning or structured chat | Command Code probe is narrow and explicit; general cloud generation remains blocked |
| `AUTO3DVIDEO_IMAGE_*` | Reference images or stills | Loopback ComfyUI profile; no workflow submit |
| `AUTO3DVIDEO_VIDEO_*` | Generated video shot | Disabled and blocked until official adapter review |
| `AUTO3DVIDEO_TTS_*` | Voiceover | VieNeu local is the default catalog candidate but remains disabled until package/model readiness; voice/likeness approval remains required |
| `AUTO3DVIDEO_STT_*` | Transcription/captions | Local-first profile; model must be installed separately |
| `AUTO3DVIDEO_AUDIO_*` | Music or audio asset | Disabled; rights and terms evidence required |
| `AUTO3DVIDEO_ASSET3D_*` | Local 3D asset preparation | Disabled until a bounded local adapter exists |
| `AUTO3DVIDEO_RENDER3D_*` | Blender rendering | Disabled until Blender is installed and inspected |
| `AUTO3DVIDEO_MEDIA_*` | FFmpeg compose/export | Local-only and still limited to approved fixture paths |


## Local Topic-to-MP4 MVP đã kiểm chứng

Luồng local thực tế nằm trong Topic Studio và không phải nút mock. Chọn hoặc tạo project có workspace hợp lệ, nhập chủ đề và mục tiêu, xem prompt preview, sau đó bấm **Sinh script local**. Script được lưu ở trạng thái `pending`; hãy đọc và sửa tiêu đề, hook, từng lời dẫn, chữ trên màn hình, trạng thái claim và nguồn đối chiếu. Không chọn `Đã đối chiếu nguồn` nếu chưa có nguồn thật. Khi mọi claim đã được xử lý, bật xác nhận chịu trách nhiệm và bấm **Duyệt script và tạo video cục bộ**. Chỉ ở bước này ứng dụng mới chạy VieNeu, FFmpeg và FFprobe.

Đầu ra nằm trong workspace project dưới `.auto3dvideo/pipeline/<run-id>/`: `scenes/assets/*.png`, `narration.wav`, `captions.srt`, `master.mp4` và `manifest.json`. Job, attempt và output evidence được lưu trong SQLite. Manifest phải cho thấy `reviewState: needs_review`, `humanReviewRequired: true`, H.264/AAC, 720x1280, audio 48 kHz mono, duration hợp lệ, kích thước dương và SHA-256. `succeeded_needs_review` chỉ nghĩa là pipeline kỹ thuật đã tạo được artifact; chưa có nghĩa là nội dung đúng, có quyền, an toàn, kiếm tiền được hoặc được phép đăng.

Gateway local dùng model alias `cmd/poolside/laguna-s-2.1-free` tại `http://localhost:20128/v1` hoặc `http://127.0.0.1:20128/v1`. Chi phí phải hiển thị `local_gateway_unreported`, không được đổi thành `$0` nếu gateway chưa báo receipt. VieNeu chạy offline từ cache hiện có; FFmpeg/FFprobe và Python phải trỏ tới binary/runtime đã được allowlist. Nếu script worker timeout, không tăng retry vô hạn và không xem lỗi là thành công.

### Checklist duyệt trước khi bàn giao

| Hạng mục | Câu hỏi bắt buộc |
|---|---|
| Nội dung | Chủ đề, lời dẫn và chữ màn hình có đúng mục tiêu, không bịa claim hoặc nguồn không? |
| Âm thanh | Đã nghe toàn bộ WAV/MP4, phát âm, giọng, nhịp và quyền sử dụng giọng có ổn không? |
| Hình ảnh | Scene PNG có đúng chủ đề, đủ liên tục và không chứa tài sản ngoài chưa được cấp quyền không? |
| Phụ đề | SRT có khớp lời, thời gian và ký tự tiếng Việt không? |
| Kỹ thuật | FFprobe có đúng một video/audio stream, đúng codec, kích thước, sample rate và duration không? |
| Pháp lý/nền tảng | Đã kiểm tra quyền, disclosure, an toàn, chính sách nền tảng và mục tiêu kiếm tiền chưa? |
| Quyết định | Người dùng có chấp thuận thủ công việc xem, sửa, lưu trữ và bàn giao không? |

Không bật cloud generation, automatic publishing, OAuth/cookie automation, scraping, reposting hoặc watermark removal chỉ vì local MVP đã chạy. Những khả năng đó cần adapter, policy, rights, budget, cancellation/reconciliation và human approval riêng.
