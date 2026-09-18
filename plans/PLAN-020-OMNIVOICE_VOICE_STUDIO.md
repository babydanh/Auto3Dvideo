# PLAN-020 — OmniVoice Voice Studio: Clone, Preset và Local Voice Library

## Trạng thái

**IMPLEMENTED — design smoke passed; file/microphone clone capture is wired; clone/render manual review remains.**

Đã triển khai contract, migration, local worker, Rust boundary, Voice Studio UI và
đường render narration dùng `voiceProfileId`. Bản hiện tại chưa tự cài package/model:
người dùng phải bấm **Kiểm tra local** rồi **Cài model OmniVoice**; nếu môi trường
thiếu package hoặc cache, app phải báo blocked thay vì giả thành công.

### Emotion markup update

Voice Studio accepts a provider-neutral `emotionCode` vocabulary and inline
markup such as `[EXCITED]` and `[SHOUTING]`. The worker splits narration into
emotion segments and records the codes in its result. OmniVoice remains a
compatibility fallback: it maps supported groups to the existing laugh/sigh/
clear-throat cues instead of claiming native angry/excited/shouting control.
Native expressive providers can consume the same codes in a later adapter.

Mục tiêu của plan là thay VieNeu khỏi luồng Voice Studio đang hoạt động bằng một lớp `Voice Profile` và worker OmniVoice local. Người dùng chỉ cần tạo hoặc chọn một voice profile, nhập văn bản, bấm nghe thử; mọi bước còn lại phải có trạng thái, log, output validation và review rõ ràng.

## 1. Quyết định sản phẩm

### 1.1 Hai chế độ đầu tiên

Voice Studio chỉ còn hai lựa chọn chính:

1. **Clone voice từ file mẫu**
   - Nạp file WAV/MP3/FLAC/M4A/OGG vào workspace.
   - Bắt buộc nhập câu transcript của file mẫu để kiểm soát chất lượng và tránh ASR mơ hồ ở bản đầu.
   - Bắt buộc xác nhận người dùng có quyền sử dụng giọng và file mẫu.
   - Cho phép chỉnh tên profile, ngôn ngữ, ghi chú, giọng đọc/director instruction và thông số tạo âm thanh.
   - Không nhận diện danh tính người nói và không bật clone nếu thiếu consent.

2. **Voice có sẵn / Voice Design**
   - Không coi đây là một danh sách giọng người thật cố định. OmniVoice hỗ trợ tạo giọng từ các thuộc tính như giới tính, độ tuổi, cao độ, accent/dialect và style.
   - Ứng dụng lưu các tổ hợp đó thành preset profile có tên riêng, ví dụ `English Documentary — British, male, low pitch`.
   - Cho phép sửa preset, nhân bản preset và đặt preset mặc định cho project.
   - Không cung cấp chế độ “random voice” trong UI vì khó kiểm soát continuity.

### 1.2 Không còn VieNeu trong đường chạy mới

- Xóa VieNeu khỏi provider mặc định, Voice Studio UI, video render path, readiness report và nhãn thông báo.
- Không xóa ngay các file output VieNeu cũ của người dùng.
- Khi mở project/script cũ có `presetVoice` hoặc `vieneu`, hiển thị migration notice và chuyển sang profile OmniVoice tương ứng nếu có; nếu không có thì yêu cầu chọn profile.
- Sau khi migration và acceptance hoàn tất, xóa worker/command VieNeu khỏi native boundary trong một change riêng có rollback note.

## 2. Giới hạn license và quyền

OmniVoice có code Apache-2.0 nhưng pretrained model được ghi là CC-BY-NC do giới hạn dữ liệu huấn luyện. Vì vậy:

- Profile OmniVoice mặc định có `commercialUse=restricted` và không được tự đánh dấu là đủ quyền cho delivery thương mại.
- UI phải hiện rõ: **“OmniVoice local — model pretrained hiện giới hạn phi thương mại; cần kiểm tra quyền trước khi kiếm tiền/delivery.”**
- Clone giọng luôn cần `voiceOrLikenessConsent=approved` cho file mẫu. File nằm trong máy không được coi là bằng chứng sở hữu.
- Voice clone chỉ cho phép người dùng khai báo quyền; ứng dụng không tuyên bố đã xác minh danh tính hay quyền pháp lý.
- Chỉ dùng voice preset do model cung cấp hoặc preset do người dùng tự thiết kế; không đóng gói giọng người nổi tiếng/người thứ ba.
- Mọi preview và final audio vẫn có `humanReviewRequired=true` về phát âm, chất lượng, quyền và disclosure.

## 3. Kiến trúc đích

```text
Voice Studio UI
  → voice profile library
  → local asset ingest + hash + rights record
  → VoiceSynthesisRequest
  → Rust allowlisted process boundary
  → omnivoice_tts_worker.py
  → WAV validation + audio metadata
  → preview player / approved video render
```

Không gọi API key, không gửi audio ra ngoài và không tự tải model trong `check` hoặc `synthesize`. Tải model là một thao tác setup riêng, có network notice, progress, timeout và kết quả thật.

### 3.1 Model modes trong worker

Worker mới `scripts/omnivoice_tts_worker.py` có bốn lệnh bounded:

- `--check`: kiểm package, model, tokenizer, device và cache; không tải, không tạo audio.
- `--prepare-model`: chỉ chạy khi người dùng bấm cài model; ghi rõ đang tải khoảng 3.27 GB, network đã dùng, cache path và checksum/version nếu lấy được.
- `--prepare-clone-profile`: kiểm reference audio/transcript/consent, tạo reusable `VoiceClonePrompt` local nếu cần; không gửi file ra ngoài.
- `--synthesize`: nhận request JSON relative-only, chạy offline, tạo WAV mới và trả JSON metadata.

Các mode không nhận shell command, executable path, URL tùy ý, credential hoặc raw prompt bí mật. Request và output đều bị giới hạn kích thước, path và timeout.

### 3.2 OmniVoice request mapping

`VoiceSynthesisRequest` sẽ map các field sau:

| Field trong app | OmniVoice | Ghi chú |
|---|---|---|
| `mode=clone` | `ref_audio`, `ref_text` hoặc reusable clone prompt | bắt buộc consent |
| `mode=design` | `instruct` | thuộc tính giọng, không phải identity |
| `language` | `language` | truyền code/tên ngôn ngữ rõ ràng |
| `speed` | `speed` | bounded, mặc định 1.0 |
| `durationSeconds` | `duration` | tùy chọn; duration ưu tiên hơn speed |
| `qualitySteps` | `num_step` | preset nhanh/chất lượng, không cho giá trị tùy ý ở basic UI |
| `classTemperature` | `class_temperature` | advanced, bounded |
| `positionTemperature` | `position_temperature` | advanced, bounded |
| `directorInstruction` | `instruct` bổ sung hoặc style profile | không chèn vào spoken text |
| `normalizeText` | `normalize_text` | bật khi cần đọc số/ngày/tiền |
| `postprocessOutput` | `postprocess_output` | mặc định bật để dọn silence |

Voice cue như `[laughter]` chỉ được hiển thị là **experimental** và phải preview nghe lại; không coi mọi cue là được hỗ trợ đồng nhất trong mọi ngôn ngữ.

## 4. Contract và dữ liệu

### 4.1 Contract mới

Tạo:

- `contracts/voice-profile.schema.json`
- `contracts/voice-synthesis-request.schema.json`
- `contracts/voice-synthesis-result.schema.json`
- `examples/voice-profiles/` với một profile design và một clone fixture giả lập, không chứa giọng người thật.

`VoiceProfile` tối thiểu:

```json
{
  "schemaVersion": "1.0.0",
  "voiceProfileId": "voice-profile-id",
  "projectId": "project-id",
  "name": "English Documentary",
  "mode": "design",
  "modelId": "k2-fsa/OmniVoice",
  "language": "en",
  "instruct": "male, middle-aged, low pitch, british accent",
  "referenceAudioPath": null,
  "referenceAudioSha256": null,
  "referenceTranscript": null,
  "rightsRecordPath": "rights/voice-profile-id.json",
  "status": "ready",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Clone profile phải có `referenceAudioPath`, hash, transcript và consent approved. Design profile không được chứa reference audio. Không nhúng audio base64 vào JSON; file audio được ingest vào workspace và JSON chỉ giữ relative path/hash/metadata.

`VoiceSynthesisRequest` phải lưu `voiceProfileId`, text hash, language, output path, speed/duration, parameters, model version, rights snapshot và idempotency key. Không lưu raw credential hoặc secret vào request/log.

### 4.2 Asset và file layout

```text
.auto3dvideo/
  voices/
    <voice-profile-id>/
      profile.json
      reference.<ext>          # chỉ clone mode
      clone-prompt.pt          # optional, generated locally
      previews/
        <synthesis-id>.wav
        <synthesis-id>.json
  requests/
    <synthesis-id>.json
```

Asset ingest phải copy vào workspace, canonicalize path, giới hạn dung lượng, tính SHA-256, đọc duration/sample rate/channels và tạo asset record. Không lấy path tuyệt đối của người dùng làm nguồn lâu dài.

### 4.3 Database migration

Thêm các bảng/record tương đương:

- `voice_profiles`: profile metadata, mode, model, language, status, current rights state.
- `voice_profile_assets`: reference audio và clone prompt, hash, media metadata.
- `voice_synthesis_jobs`: request state, process metadata, output evidence, timing, error code.
- `voice_rights`: link tới `rights-record.schema.json`, consent, license, territory/platform, reviewedAt.

Nếu schema hiện tại đã có asset/audit/job primitives phù hợp thì tái sử dụng, không tạo bảng trùng. Migration phải idempotent và có fixture rollback/read test.

## 5. UX thiết kế mới

### 5.1 Màn hình Voice Studio

Bố cục gọn, không còn form VieNeu:

1. **Model status bar**
   - `OmniVoice local: Chưa cài / Đang kiểm tra / Sẵn sàng / Lỗi`.
   - Nút `Kiểm tra` và `Cài model` là hai nút khác nhau.
   - Nêu rõ download size, device, cache và license warning.

2. **Voice library**
   - Danh sách profile với tên, mode, ngôn ngữ, model, trạng thái quyền và preview gần nhất.
   - Nút `Tạo clone voice`, `Tạo voice có sẵn`, `Sửa`, `Nhân bản`, `Xóa`.
   - Xóa là soft delete nếu profile đang được script/job tham chiếu; không tự xóa output đã render.

3. **Editor panel**
   - Clone: chọn/nạp file, record tùy chọn, transcript, ngôn ngữ, nghe file gốc, consent, ghi chú quyền.
   - Design: language, gender, age, pitch, accent/dialect, style, director instruction.
   - Common: speed, output duration, quality preset, pronunciation/text normalization.
   - Advanced được thu gọn; không phơi toàn bộ sampler nếu người dùng chưa mở.

4. **Test voice workspace**
   - Text thử giọng, ngôn ngữ, nút `Nghe thử`, player WAV, duration/sample rate, output path.
   - Có bộ câu test theo ngôn ngữ: câu ngắn, số/ngày, tên riêng, câu dài và ký hiệu phát âm.
   - Kết quả hiển thị model, mode, language, profile, thời gian chạy, network calls, output validation và cảnh báo cần review.

### 5.2 Feedback bắt buộc theo `skills.md`

Mỗi nút phải đưa log thật vào workspace:

```text
[1/4] Đang kiểm tra profile và quyền sử dụng
[2/4] Đang đọc reference audio / transcript
[3/4] OmniVoice đang tạo audio trên GPU/CPU
[4/4] Đang kiểm tra WAV và lưu preview
Hoàn tất — nghe thử trước khi duyệt
```

Trong lúc chạy:

- button đổi thành `Đang ...`, có spinner và bị khóa;
- chỉ cho một synthesis chạy trên cùng profile để tránh spam GPU;
- lỗi phải nêu nguyên nhân: thiếu model, thiếu transcript, thiếu consent, không hỗ trợ ngôn ngữ, hết VRAM, output hỏng hoặc timeout;
- không hiển thị `success` khi chỉ mới ghi request;
- không ghi raw audio, transcript nhạy cảm, đường dẫn tuyệt đối hoặc command line vào activity log.

## 6. State machine

### 6.1 Profile

```text
draft
  → ingesting
  → needs_consent
  → ready
  → editing
  → ready
  → deleted
```

Nhánh lỗi: `ingesting → failed`, `prepare clone → invalid_reference`, `ready → rights_blocked`.

### 6.2 Model readiness

```text
not_checked → checking → missing_package/model_missing/device_unavailable/ready
model_missing → preparing → ready | prepare_failed
```

`check` không tải model. `prepare` là network side effect có approval/notice riêng.

### 6.3 Synthesis job

```text
queued → validating → running → validating_output → succeeded
                                      └────────────→ failed
queued/running → cancelled
```

Retry chỉ tạo attempt mới với idempotency key mới; không ghi đè WAV cũ.

## 7. Thay đổi code dự kiến

### Native Rust

- Thay `VieneuReadinessReport`/`VieneuTtsReport` bằng type dùng chung cho OmniVoice.
- Tách validator chung cho text, language, profile ID, relative path, output và consent.
- Thêm commands:
  - `check_omnivoice_local`
  - `prepare_omnivoice_model`
  - `list_voice_profiles`
  - `create_voice_profile`
  - `update_voice_profile`
  - `ingest_voice_reference`
  - `delete_voice_profile`
  - `run_omnivoice_tts`
  - `read_audio_metadata`
  - `read_workspace_audio_base64` (tái sử dụng nhưng giữ giới hạn hiện tại)
- Mọi external process chạy qua process executor hiện tại với allowlist, timeout, cancellation, expected output và audit event.
- Cập nhật provider catalog `voice_primary` thành `omnivoice`, không lộ credential ref.
- Cập nhật video render path để đọc `voiceProfileId` và request contract mới.

### Python worker

- Tạo `scripts/omnivoice_tts_worker.py`.
- Không tự download ở check/synthesis; chỉ dùng offline flag khi synthesis.
- Verify model/cache/device trước khi load.
- Verify file reference, transcript length, language, consent, model mode và output non-overwrite.
- Emit một JSON result bounded; không trả traceback/raw prompt/audio content.

### Frontend

- Thay `VieneuPanel` bằng `VoiceStudioPanel` và các component nhỏ: `VoiceLibrary`, `VoiceProfileEditor`, `VoiceTestWorkspace`, `OmniVoiceReadiness`.
- Xóa nhãn VieNeu khỏi UI và các handler/invoke cũ.
- Thêm audio player và preview history.
- Thêm notice license/consent tại đúng nơi người dùng bấm, không giấu trong trang hướng dẫn.
- Khi profile bị xóa hoặc quyền bị block, các script đang tham chiếu phải hiển thị trạng thái và không cho render âm thầm bằng voice khác.

### Tài liệu

- Cập nhật `plans/PLAN-012-VOICE_STUDIO_STANDARDIZATION.md` thành lịch sử/migration note sau khi triển khai.
- Cập nhật `docs/architecture/AI_PROVIDER_ARCHITECTURE.md` với local TTS adapter semantics.
- Cập nhật `docs/architecture/DEPENDENCY_AND_LICENSE_POLICY.md` với OmniVoice code/model/tokenizer record.
- Cập nhật `contracts/video-script.schema.json` qua migration version rõ ràng; không sửa âm thầm contract cũ.
- Cập nhật workflow voiceover và README setup.

## 8. Kiểm thử và acceptance

### Contract/Rust

- Schema validation cho design profile, clone profile, thiếu consent, thiếu reference, path traversal, output collision và profile deleted.
- Migration từ `video-script` cũ có `presetVoice`/VieNeu sang `voiceProfileId`.
- Xóa profile đang được dùng phải soft-delete hoặc bị chặn có lý do.
- Audit events không chứa token, absolute path, raw audio hoặc full text dài.
- Retry không overwrite và output evidence phải tồn tại.

### Python worker

- `--check` không gọi mạng và không tải model.
- `--synthesize` thiếu model fail rõ ràng, không giả thành công.
- Clone thiếu transcript/consent fail trước khi load model.
- Design profile không được đọc reference audio.
- Output WAV được probe về header, sample rate, channels, duration và size.
- Mock worker test chạy được không cần tải model 3.27 GB.
- Smoke thật chạy sau khi người dùng cài OmniVoice và có model cache; test voice của chính người dùng, không commit audio thật.

### Frontend

- Build/typecheck pass.
- Mỗi nút có loading, disable chống spam, success/error notice và activity log.
- Import/sửa/xóa/nhân bản profile cập nhật library ngay sau kết quả thật.
- Test tiếng Anh, tiếng Việt và ít nhất một ngôn ngữ khác được model hỗ trợ; kết quả phải ghi rõ đây là test phát âm, không phải chứng nhận chất lượng mọi ngôn ngữ.

### Manual acceptance

1. Mở Voice Studio khi chưa cài model: thấy `Chưa cài`, không có nút nghe thử chạy im lặng.
2. Bấm `Cài model`: thấy từng bước tải/cached; lỗi mạng hiện nguyên nhân; không tự chạy lại vô hạn.
3. Tạo voice design tiếng Anh, nghe thử, sửa pitch/speed/instruct, thấy preview mới khác version cũ.
4. Nạp reference audio của chính người dùng, nhập transcript, consent, tạo clone, nghe thử.
5. Bỏ consent: nút clone bị chặn và log nói đúng lý do.
6. Xóa profile đang dùng trong script: app không xóa âm thanh/output cũ và chặn render cho tới khi chọn profile khác.
7. Chạy video pipeline: narration lấy đúng `voiceProfileId`, audio được probe, FFmpeg nhận output, review gate vẫn còn.

## 9. Chi phí, hiệu năng và fallback

- Không cần API key và không có phí API khi chạy local.
- Lần đầu cần tải model/tokenizer khoảng vài GB và cần dung lượng cache.
- GPU NVIDIA là đường chạy ưu tiên; CPU fallback phải hiện ước lượng chậm và cho phép hủy.
- Preview dùng quality preset nhanh; final dùng quality preset đã chọn. Không tự dùng batch/multi-GPU ở phase đầu.
- Nếu OmniVoice không sẵn sàng, app không tự quay về VieNeu. User phải chọn profile/engine khác hoặc dừng với lỗi rõ ràng.
- Không claim output được phép thương mại chỉ vì worker chạy thành công.

## 10. Thứ tự triển khai đề xuất

1. Contract + migration + rights model.
2. Worker check/synthesis mock, sau đó smoke thật với OmniVoice.
3. Rust process boundary và audit/state transitions.
4. Voice library ingest/edit/delete/clone consent.
5. Voice design/preset editor và test workspace.
6. Nối video render path, bỏ VieNeu khỏi active provider.
7. Xóa VieNeu code/fixtures không còn tham chiếu.
8. Build, tests, validator, manual acceptance và release evidence.

## 11. Trạng thái triển khai thực tế

- Đã có `voice_profiles` và `voice_synthesis_jobs` migration idempotent.
- Đã có schema profile/request/result và worker offline-first với check/synthesis.
- Đã có clone ingest vào workspace, hash SHA-256, transcript, consent, edit/delete mềm.
- Đã có thu microphone trực tiếp trong OmniVoice: MediaRecorder → PCM WAV 24 kHz mono → lưu vào `.auto3dvideo/voice-recordings/`, nghe lại và đưa thẳng vào form clone; không tự coi recording là consent.
- Đã đọc và hiển thị các audio local có sẵn trong `.auto3dvideo/voice-samples/` và `.auto3dvideo/voice-recordings/` để chọn trực tiếp làm reference clone; file chỉ được chọn, chưa được coi là profile ready nếu thiếu transcript/quyền sử dụng.
- Đã thêm 3 reference WAV tiếng Việt từ `christian-hoang-04/vivos-processed` vào `.auto3dvideo/voice-samples/`, kèm transcript và manifest `CC BY-NC-SA 4.0`; chỉ dùng cho local/non-commercial testing, không tự coi là cleared cho publish hoặc impersonation.
- Đã có voice design prompt, preset nhanh, language, speed, duration, quality và sampler controls.
- Khi mở project, `list_voice_profiles` idempotent seed 4 preset design local (English Documentary, English Cinematic Female, Vietnamese Documentary, Vietnamese Warm Female) nếu thư viện chưa có; không seed audio, không ghi đè profile người dùng và giữ `restricted` rights/commercial state.
- Đã nối video render path sang OmniVoice profile; không còn VieNeu trong UI/provider mặc định.
- Design smoke thật đã pass trên RTX 3060: WAV 24kHz mono, 3.49s, offline synthesis.
- Clone bằng audio của người dùng và render video end-to-end vẫn cần human review riêng; không claim chỉ từ design smoke.
- `prepare-clone-profile` có trong worker contract nhưng native flow hiện synthesize trực tiếp từ reference audio/transcript; reusable clone prompt là việc hậu kỳ.
- Legacy VieNeu handler/component vẫn giữ nội bộ tạm thời để đọc project cũ; không còn reachable từ navigation, Settings hay render path mới và sẽ xóa trong cleanup riêng.

## 12. Definition of done

- Người dùng vào Voice Studio, chọn **Clone voice** hoặc **Voice có sẵn**, không thấy VieNeu.
- File reference được copy, hash, metadata hóa, sửa/xóa profile được kiểm soát.
- Có thể thu mic, nghe lại, nhập transcript và tạo clone từ bản WAV local; lỗi quyền mic/giải mã/lưu file phải hiện rõ.
- Test giọng có language, speed, style/instruct, preview WAV và log từng bước.
- Clone thiếu consent bị chặn ở UI, Rust và Python.
- Model missing/network/device/output failure đều báo lỗi thật, không mock success.
- Video pipeline sử dụng đúng profile đã chọn và lưu provenance/rights state.
- Contract, state transition, cost/rights notes, tests và manual evidence được cập nhật.
