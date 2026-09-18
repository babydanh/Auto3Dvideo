# PLAN-023 — Autonomous True-3D Topic-to-MP4 Pipeline

## Trạng thái

`DRAFT / NEEDS_HUMAN_REVIEW`

### Tiến độ triển khai — 2026-09-10

- Slice 0: đã thêm sáu contract true-3D/state và đăng ký strict manifest.
- Slice 1: đã thêm `true3d_scene_worker.py`, Rust supervisor command `run_true3d_fixture` và hai nút chạy preview/video trong Settings.
- Slice 2: đã thêm `multi-shot-continuity.schema.json`, fixture 8 shot, worker continuity, Rust command `run_true3d_multishot_fixture`, nút continuity/rerun và report asset hash/drift.
- Validation code đã pass; smoke Blender 5.2.1 đã tạo preview, đủ 120 frame và MP4 H.264 bằng FFmpeg tại `D:\Auto3DvideoTools\plan023-true3d-smoke\run-video\`; Slice 2 đã render 8 shot, drift=0 và rerun SHOT-004 không đổi asset hash tại `D:\Auto3DvideoTools\plan023-multishot-smoke\`. Slice 3 đã thêm contract ingest/report, worker hash/provenance/classification/quarantine, Blender quality/lookdev worker, Rust supervisor command `run_asset_pipeline_check` và nút `Kiểm tra Asset Pipeline` trong Settings. Evidence chi tiết nằm ở `docs/operations/PLAN023_TRUE3D_SLICE_IMPLEMENTATION_2026-09-10.md`, `docs/operations/PLAN023_TRUE3D_MULTISHOT_IMPLEMENTATION_2026-09-11.md` và `docs/operations/PLAN023_TRUE3D_ASSET_PIPELINE_IMPLEMENTATION_2026-09-11.md`; nút chạy trực tiếp trong app vẫn cần người dùng review.
- Slice 4 (ComfyUI image bridge): đã thêm contract job/report, worker loopback-only, native supervisor command `run_comfyui_image_generation`; ComfyUI được giữ làm fallback legacy.
- Slice 5 (Nano Banana MCP image bridge): đã thêm contract job/report, worker stdio `scripts/nanobanana_mcp_worker.py`, native supervisor command `run_nanobanana_image_generation` và nút `Tạo asset ảnh Nano Banana` sau Blender preview. App gọi `generate_image` qua server MCP đã cài, nhận output từ Google Flow CDP loopback, hash/import vào Asset Library và giữ rights `pending`; người dùng vẫn phải cài MCP, mở Chrome Flow và review.

Đây là plan triển khai tiếp theo sau `PLAN-021` và `PLAN-022`. Plan này không coi semantic storyboard, contact sheet, ảnh phác hoặc mock job là video 3D cuối. Mục tiêu là một đường chạy thật, có thể tiếp tục sau khi app đóng:

```text
brief/chủ đề
  → director + research/claim gate
  → world/character/style bible
  → script + shot/beat plan
  → asset manifest + reference bindings
  → Blender scene build + deterministic assertions
  → preview render + continuity review
  → approved final render từng shot
  → voice + forced alignment
  → frame-locked captions + compose
  → FFprobe/QA/rights evidence
  → delivery package
```

“Tự động hoàn toàn” trong phạm vi local nghĩa là sau khi người dùng nhập prompt và duyệt các gate bắt buộc, app tự lập kế hoạch, tự tạo job graph, tự chạy các job Blender/voice/FFmpeg, tự resume/retry có giới hạn và tự dừng ở blocker. App không được tự vượt quyền clone giọng, chi phí cloud, quyền asset, CAPTCHA, đăng nhập hoặc publish.

## 1. Mục tiêu sản phẩm

Người dùng mở một project, nhập một chủ đề như “hổ khổng lồ 5–10 m xuyên không về thời khủng long”, chọn preset `cinematic-3d`, rồi bấm một nút `Chạy pipeline 3D`. App phải tạo được một project run có bằng chứng đầy đủ:

1. Brief, research notes và claim state.
2. World bible, character bible và style bible có version.
3. Script narration sạch và shot plan có `shotId` ổn định.
4. Prompt riêng cho từng shot, không lặp một prompt cho nhiều ảnh.
5. Asset/reference manifest có hash, provenance, role và rights state.
6. Scene Blender thật có camera, ánh sáng, vật liệu, animation và frame range.
7. Preview render từng shot, thumbnail/contact sheet và quality report.
8. Final render image sequence/MP4 từng shot, không chỉ `.blend` rỗng.
9. Voice WAV, emotion plan, alignment evidence và subtitle frame plan.
10. Master MP4 có video/audio/subtitle đúng FPS, duration và stream metadata.
11. Audit, job attempts, retry history, output hashes và lý do blocker.

## 2. Quy tắc bắt buộc từ `skills.md`

### 2.1 Một workspace, một nguồn sự thật

Canvas chỉ là giao diện của `Project`, `VideoWorkflowSession`, `Shot`, `Asset`, `JobAttempt` và `Output`. Không tạo thêm một JSON canvas cache có thể lệch với SQLite/session.

Các card bắt buộc phải đại diện cho bước thật:

```text
Brief → World/Character Bible → Shot Plan → Assets → Blender Scene
     → Preview Review → Final Render → Voice/Caption → Compose → Delivery
```

Không hiển thị placeholder vô nghĩa. Node/card chưa đủ điều kiện phải nói rõ thiếu gì: `Thiếu Blender`, `Chưa có asset được duyệt`, `Cần xác nhận quyền voice`, `Chưa duyệt chi phí`.

### 2.2 Không có nút im lặng

Mọi action dài phải:

- hiện `running` ngay sau khi bấm và khóa chống bấm lặp;
- hiển thị `[bước hiện tại/tổng bước]`, tool, shot và output;
- ghi `WORKSPACE / LIVE ACTIVITY` với thời gian, duration và lỗi đã chuẩn hóa;
- chỉ báo `success` sau khi output tồn tại và đã validate;
- báo `blocked` nếu thiếu capability, approval, asset, quyền hoặc tool;
- cho `Pause`, `Resume`, `Retry failed`, `Cancel` và `Open evidence` khi phù hợp.

### 2.3 Agent chỉ phát lệnh typed

Model được phép tạo brief/JSON/intent, không được sinh raw shell command. Rust boundary chọn executable, arguments, timeout, environment, output path và policy. Blender script phải là file versioned/validated trong project, không chạy Python text lấy trực tiếp từ prompt.

### 2.4 Skills không được nhập nhằng vai trò

Mỗi shot phải đi qua các role sau, dù thực hiện bởi một model hay nhiều model:

```text
topic_director
  → claim_and_research_planner
  → visual_world_bible
  → storyboard_shot_planner
  → shot_prompt_designer
  → continuity_prompt_guard
  → reference_role_mapper
  → asset_select_or_generate
  → asset_quality_check
  → topology_uv_scale_normalize
  → pbr_material_lookdev
  → lighting_rig_setup
  → camera_language_setup
  → shot_blockout
  → animation_continuity
  → preview_render
  → deterministic_scene_assertions
  → final_render
  → voice_emotion_planner
  → voiceover_synthesizer
  → speech_alignment
  → frame_locked_captioner
  → timeline_composer
  → video_quality_gate
  → delivery_rights_gate
```

Một model có thể điều phối nhiều role, nhưng output của từng role phải có field, version, validator và evidence riêng. Không để một prompt chung làm thay thế toàn bộ dữ liệu shot.

## 3. Kiến trúc chạy tự động

### 3.1 Pipeline DAG

```text
P0 Brief
 ├─ P1 Research/claims ─┐
 ├─ P2 World bible       ├─ P3 Script + shot plan
 └─ P2b Character bible ┘
                         │
              ┌──────────┴──────────┐
              │                     │
        P4 Asset/reference     P5 Voice plan
              │                     │
        P6 Blender scene build  P5b TTS
              │                     │
        P7 Preview render       P5c alignment
              └──────────┬──────────┘
                         │
                  P8 Review/approve
                         │
                  P9 Final render
                         │
                  P10 captions/compose
                         │
                  P11 QA + delivery
```

P4 có thể chạy song song theo asset; P6/P7 chạy theo shot nhưng phải dùng cùng world/character bible. P9 chỉ chạy sau preview assertions và approval policy. P10 không được bắt đầu bằng timestamp model đoán nếu chưa có alignment evidence.

### 3.2 State machine

Mỗi stage và shot dùng một state machine có terminal state rõ:

```text
draft
 → validated
 → queued
 → running
 → succeeded
 → needs_review
 → approved
 → delivered
```

Các nhánh lỗi:

```text
running → failed_retryable → queued
running → blocked_dependency
running → cancelled
running → failed_output_validation
needs_review → needs_revision → queued
```

Không được chuyển `succeeded` nếu process exit 0 nhưng thiếu file, file rỗng, sai frame count, sai duration, sai stream hoặc sai hash. Không được chuyển `approved/delivered` chỉ vì Blender render thành công.

### 3.3 Resume/idempotency

- Mỗi stage có `idempotencyKey = projectId + sessionId + stage + inputHashes + version`.
- App kiểm tra output manifest trước khi chạy lại.
- Output accepted không bị ghi đè; retry tạo attempt/version mới.
- App khởi động lại phải reconcile các attempt đang chạy thành `reconciliation_required`, không đoán là thành công.
- Retry mặc định tối đa 2 lần cho lỗi hạ tầng; lỗi schema/rights/cost không retry tự động.
- Người dùng có thể chạy lại riêng shot lỗi mà không dựng lại toàn bộ project.

## 4. Hợp đồng dữ liệu cần bổ sung

Không sửa contract cũ theo cách phá backward compatibility. Bổ sung schema/version và migration nhỏ:

### 4.1 `contracts/true-3d-run.schema.json`

Ghi run-level state:

- `runId`, `projectId`, `sessionId`, `schemaVersion`;
- `profile`, `fps`, `resolution`, `engine`, `renderBudget`;
- `stageIds`, `dependencyGraph`, `currentStage`, `runState`;
- `approvalPolicy`, `costEstimate`, `rightsState`, `reviewState`;
- `createdAt`, `updatedAt`, `resumedFromRunId`.

### 4.2 `contracts/world-bible.schema.json`

Ghi scale, geography, era, palette, material language, atmosphere, time of day, weather, camera language, forbidden drift và reusable environment assets.

### 4.3 `contracts/character-bible.schema.json`

Ghi identity anchor, species, silhouette, height/scale, proportions, colors, markings, wardrobe/props, rig requirements, motion constraints, prohibited changes và reference asset IDs.

### 4.4 `contracts/shot-production.schema.json`

Mở rộng shot hiện có với:

- `storyBeat`, `subject`, `environment`, `camera`, `lens`, `action`, `lighting`, `color`;
- `continuityAnchors`, `referenceAssets`, `blenderConstraints`;
- `flowPrompt`, `negativePrompt`, `acceptanceChecks`;
- `frameStart`, `frameEnd`, `previewOutput`, `finalOutput`;
- `voiceSegmentIds`, `captionRangeIds`, `reviewState`.

### 4.5 `contracts/scene-manifest.schema.json`

Ghi `.blend` version, Blender version, scene name, collections, object inventory, camera, lights, materials, asset hashes, frame range, FPS, engine, output pattern và deterministic assertions.

### 4.6 `contracts/asset-binding.schema.json`

Ghi rõ asset dùng để làm gì:

```text
identity | composition | pose | camera | style | texture |
start_frame | end_frame | environment | model3d | voice_reference
```

Mỗi binding có `assetId`, hash lúc bind, shot ID, role, priority, provenance, rights state và review state.

### 4.7 Alignment contract

Tái sử dụng `frame-caption-plan.schema.json`, nhưng bắt buộc có:

- `alignmentSource`;
- `alignmentState: draft | verified | failed`;
- word/segment timing;
- source audio hash;
- FPS và rounding policy;
- frame range integer, không overlap, không vượt shot/master duration.

## 5. Chi tiết từng stage

### Stage 0 — Project bootstrap

Input: tên project, workspace path, ngôn ngữ, FPS, resolution, profile `cinematic-3d`.

App tự tạo cấu trúc:

```text
.auto3dvideo/
  runs/
  briefs/
  bibles/
  shots/
  assets/
  scenes/
  renders/preview/
  renders/final/
  audio/
  captions/
  delivery/
  evidence/
```

Tất cả path phải project-relative và canonicalized. Không dùng path tuyệt đối trong contract.

### Stage 1 — Director/research

`topic_director` tạo brief có hook, audience, mục tiêu, format, duration và mood. `claim_and_research_planner` phân loại câu factual/creative. Claim chưa có nguồn trở thành `needs_review`, không tự đọc như sự thật.

Với fiction như hổ khổng lồ thời khủng long, stage này có thể chạy local không cần web; nó phải ghi `not_applicable` cho claim factual thay vì bịa nguồn.

### Stage 2 — World/character/style bible

Agent tạo một bible dùng chung cho toàn bộ shot, không tạo style riêng cho từng shot nếu không có lý do. Bắt buộc khóa:

- scale: ví dụ hổ cao 8 m và T-Rex cao 12 m;
- silhouette, màu, vết sọc, vật liệu, rig;
- environment: rừng kỷ Phấn Trắng, sương, đá, nước, cây;
- camera grammar, lens range, shutter/motion blur;
- palette, key/fill/rim light, atmosphere;
- continuity rules và negative constraints.

Các giá trị scale phải được dùng lại trong Blender scene, không chỉ nằm trong prompt.

### Stage 3 — Script + shot plan

Agent tạo 6–12 shot, mỗi shot có một mục tiêu hình ảnh và một thay đổi hành động. Mỗi shot có một prompt độc lập; không cho phép copy prompt giữa shot nếu thiếu `continuityDelta`.

Mỗi shot bắt buộc xuất đủ:

```text
shot_id
duration
story_beat
subject
environment
camera
lens
action
lighting
color
continuity
reference_assets
blender_constraints
flow_prompt
negative_prompt
acceptance_checks
voice_segment_ids
```

Validator phải bắt shot không có action/camera/continuity hoặc shot trùng prompt nhưng khác nội dung.

### Stage 4 — Asset/reference

Chọn asset theo thứ tự:

1. asset 3D đã có trong project và đã duyệt;
2. procedural asset có spec rõ;
3. asset local/import có provenance và rights;
4. provider tạo ảnh/reference nếu capability thật đã được cấu hình;
5. provider tạo model 3D chỉ khi adapter có output contract và quality check.

Ảnh phác không được coi là model 3D. Ảnh tạo từ Nano Banana/Gemini có thể làm identity/style/composition reference, nhưng Blender vẫn phải tạo scene/geometry/camera final.

Import phải hash, probe MIME/dimensions, copy vào workspace, tạo `assetId`, ghi provenance/rights và gắn đúng shot trước khi scene build.

### Stage 5 — Blender scene build

Worker Blender typed jobs:

```text
scene.inspect
asset.normalize
scene.build
metadata.extract
render.preview
render.final
thumbnail.render
```

`scene.build` nhận `scene spec` đã validate và tạo:

- collections theo shot/role;
- assets đã normalize scale/origin/axis;
- PBR materials và texture bindings;
- camera/lens/focus/DOF;
- key/fill/rim/world lighting;
- animation/action markers;
- audio/caption markers nếu cần;
- frame range và output pattern;
- deterministic scene assertions.

Không nhận Python script raw từ model. Script versioned phải có test fixture và `--python-exit-code`.

### Stage 6 — Preview/assertions

Mỗi shot phải render preview đủ để kiểm tra:

- subject tồn tại và nằm trong frame;
- scale tương đối đúng bible;
- camera không clipping;
- không có object ngoài negative constraints;
- frame range đúng;
- material/texture không missing;
- animation có thay đổi frame-to-frame;
- output count, dimensions và naming đúng.

Preview contact sheet chỉ là evidence QA, không phải final output. Nếu assertion fail, agent sửa scene spec hoặc đánh `needs_review`; không tự lặp vô hạn.

### Stage 7 — Final render

Chỉ render final khi:

- preview assertion qua;
- asset/voice/cost/rights gate phù hợp;
- shot được approved theo policy;
- Blender version/engine/output path đã ghi trong job.

Final render tạo image sequence hoặc MP4 versioned. FFprobe kiểm tra codec, dimensions, FPS, duration, audio stream nếu có. Output accepted có SHA-256 và manifest.

### Stage 8 — Voice

`voice_emotion_planner` bắt buộc chạy trước TTS. Mỗi segment có đúng một `emotionCode`; tag emotion không đi vào subtitle hoặc visual prompt. OmniVoice dataset đã có trong Voice Studio nhưng clone chỉ chạy khi consent/rights hợp lệ.

Worker phải tạo:

- narration sạch;
- emotion manifest;
- WAV từng segment hoặc master;
- duration/sample rate/channels;
- provider capability/fallback;
- voice rights evidence.

### Stage 9 — Alignment/caption

Ưu tiên forced alignment/STT local trả word/segment timestamps. Nếu chỉ có duration ước tính, state là `draft`, không cho nút `Xuất bản/Delivery approved`.

Quy trình:

```text
narration sạch + WAV
  → STT/forced alignment
  → segment/word ranges
  → integer startFrame/endFrame
  → frame-caption-plan.json
  → SRT/VTT/ASS derived
```

Caption validator bắt overlap, gap ngoài policy, CPS quá cao, cue vượt frame và sai transcript. Burn-in chỉ chạy trên bản copy versioned.

### Stage 10 — Compose/QA/delivery

Timeline composer nối shot output theo thứ tự `shot.order`, mux voice/music/effects đã được duyệt, đưa caption theo frame plan và xuất master. QA kiểm tra:

- duration audio/video/caption;
- black frame/empty frame;
- frame rate/resolution/codec;
- missing shot hoặc duplicate shot;
- subtitle readability/CPS/overlap;
- continuity report;
- rights/provenance/AI disclosure;
- output hash và delivery manifest.

Delivery chỉ là `succeeded_needs_review` cho đến khi người dùng xem/nghe và xác nhận. Không tự publish.

## 6. Provider/capability strategy

### Local-first

- Blender: bắt buộc cho true 3D.
- FFmpeg/FFprobe: compose/probe.
- OmniVoice: voice local, có consent gate.
- STT/forced alignment: local adapter cần bổ sung để khóa caption.
- ComfyUI: tùy chọn cho texture/reference, graph submission phải có contract.

### Cloud/web optional

Image/video provider chỉ được bật nếu adapter có đủ `getCapabilities`, `validateRequest`, `estimateCost`, `submit`, `getStatus`, `fetchOutputs`, `normalizeError`, `getTermsMetadata` và `healthCheck`.

BrowserMCP không được coi là adapter API. Nếu chỉ có snapshot mà không có upload/click/download capability, stage dừng `blocked_capability` và giao một bước rõ cho người dùng. Không hiển thị thành công giả.

## 7. UX cần triển khai trong workspace

### Nút chính

```text
[Kiểm tra pipeline]
[Dựng preview 3D]
[Duyệt preview]
[Chạy final toàn bộ]
[Chạy lại shot lỗi]
[Tạm dừng] [Tiếp tục] [Hủy]
[Mở evidence]
```

`Chạy final toàn bộ` chỉ enable khi pipeline check pass. Khi thiếu Blender phải hiện `Cần cấu hình Blender.exe`; khi thiếu voice consent phải hiện shot/voice cụ thể; khi có cost phải hiện estimate và approval.

### Card mỗi stage

Mỗi card hiển thị: state, input, output, tool, shot count, progress, duration, retry count, blocker và nút mở artifact. Không tạo card “đã xong” nếu chỉ tạo request/hand-off.

### Workspace activity mẫu

```text
[1/11] Đã khóa world/character bible — 8 shot
[2/11] Đã kiểm tra 6 asset — 1 asset cần duyệt quyền
[3/11] Blender đang dựng scene SHOT-01/08
[4/11] Render preview SHOT-01 — frame 1–120
[5/11] Preview assertion: PASS
[6/11] Chờ duyệt preview 8 shot
```

## 8. Các slice triển khai

### Slice 0 — Contract/state foundation

Files dự kiến:

- `contracts/true-3d-run.schema.json`
- `contracts/world-bible.schema.json`
- `contracts/character-bible.schema.json`
- `contracts/shot-production.schema.json`
- `contracts/scene-manifest.schema.json`
- `contracts/asset-binding.schema.json`
- SQLite migration cho run/stage/asset-binding evidence
- validator và fixture schema tests

Exit: compile/validate được run 8 shot; state transition và idempotency test qua.

### Slice 1 — One-shot real Blender

Nối scene spec → normalize asset → scene.build → preview render → metadata/assertions → evidence. Dùng một fixture true 3D có mesh, material, camera, light và animation, không dùng primitive semantic làm final.

Exit: có `.blend`, image sequence preview, scene manifest, quality report và failed-output test.

### Slice 2 — Multi-shot continuity

Tạo 6–8 shot dùng cùng character/world assets, camera/lighting presets và continuity anchors. Chạy parallel job theo dependency nhưng dùng cùng asset hashes.

Exit: chạy lại một shot không làm đổi hash asset/shot đã approved; continuity report chỉ ra drift.

### Slice 3 — Asset pipeline

Nối asset library → quality check → normalize → material/lookdev → shot binding. Thêm generated reference ingest có hash/provenance và adapter capability rõ ràng.

Exit: ảnh phác, model 3D, texture và render được phân biệt đúng loại; asset rights pending bị quarantine.

### Slice 4 — Voice/alignment/caption

Nối Voice Studio → OmniVoice → STT/forced alignment → frame-caption plan → derived subtitles. Giữ emotion code và cue fallback trong evidence.

Exit: narration sạch, WAV probe, alignment source, frame caption JSON và SRT/VTT nhất quán; test overlap/rounding/CPS qua.

### Slice 5 — Full autonomous runner

Nút chạy pipeline tạo DAG, queue, lease, heartbeat, cancellation, resume, retry bounded và per-shot rerun. Workspace tự mở activity và tự focus blocker.

Exit: tắt app giữa render rồi mở lại có thể resume/reconcile; lỗi một shot chỉ retry shot đó.

### Slice 6 — QA/release gate

Nối quality report, rights ledger, disclosure, delivery manifest, export package và installer/release build. Thêm golden project.

Exit: một run golden từ prompt đến MP4 có evidence đầy đủ; installer build và smoke launch pass; vẫn giữ `needs_review` trước publish.

## 9. Golden fixture để kiểm thử

Fixture đề xuất: `prehistoric-giant-tiger-vs-trex`.

- 8 shot, 30 giây, 30 FPS, 9:16 và 16:9 test matrix.
- Hổ cao 8 m, T-Rex cao 12 m, scale lưu trong bible và Blender units.
- Shot 01: hổ nhỏ trong khu trưng bày, camera push-in.
- Shot 02: cơ thể tăng kích thước, ánh sáng biến đổi.
- Shot 03: xuyên không, environment chuyển sang kỷ Phấn Trắng.
- Shot 04: tracking hổ đi tìm dấu vết/tổ.
- Shot 05: reveal T-Rex ở xa, scale comparison rõ.
- Shot 06: đối đầu, không cần gore.
- Shot 07: hành động né/truy đuổi, continuity screen direction giữ nguyên.
- Shot 08: kết thúc mở, hổ bảo vệ khu vực/tổ.

Fixture phải có asset mock/local hợp lệ để test pipeline; không gọi cloud hoặc tải asset không có rights trong test mặc định.

## 10. Failure-path và security tests

Bắt buộc có test cho:

- thiếu hoặc sai phiên bản Blender;
- Blender exit 0 nhưng thiếu output;
- script path traversal/absolute path/symlink escape;
- prompt chứa shell/metacharacter không được biến thành command;
- asset sai MIME, quá lớn, hash mismatch hoặc rights rejected;
- model 3D thiếu material/scale/normal/animation;
- camera clipping, missing camera, missing light, frame range sai;
- shot duplicate/missing/out-of-order;
- retry duplicate không tạo output overwrite;
- cancel giết toàn bộ process tree;
- app restart giữa `scene.build`, render, TTS, compose;
- voice clone thiếu consent;
- alignment fractional/overlap/CPS quá cao;
- provider trả output rỗng/đường dẫn ngoài workspace/credential trong response;
- cost cap vượt hoặc provider capability đổi giữa lúc chạy;
- BrowserMCP không kết nối hoặc chỉ có snapshot;
- final output thiếu audio/caption/rights evidence.

## 11. Definition of done

Plan này chỉ được đánh dấu `DONE` khi:

1. Golden fixture chạy từ prompt tới master MP4 bằng runner thật.
2. Blender scene/animation/render là output thật, không phải semantic blockout.
3. Mỗi shot có prompt/action/camera/lighting/continuity riêng và asset binding có hash.
4. Run có durable state, retry/cancel/resume/reconcile và evidence.
5. Voice dùng profile hợp lệ, emotion plan, WAV probe và consent state.
6. Alignment thật hoặc bị ghi rõ `draft`; không tuyên bố caption đúng frame nếu thiếu nguồn timing.
7. FFprobe/QA kiểm tra media; delivery manifest có hashes/provenance/rights/disclosure.
8. UI có feedback tiếng Việt cho running/success/error/info và không có nút giả.
9. Unit, contract, worker, failure-path và Windows smoke tests pass.
10. Human review vẫn là bước bắt buộc trước phát hành/publish/monetization.

## 12. Những thứ không được làm trong plan này

- Không lấy một ảnh AI rồi gọi đó là video 3D.
- Không dùng Blender semantic primitive/contact sheet làm final asset.
- Không để model tự chạy PowerShell/cmd hoặc Python tùy ý.
- Không tự tải custom node/model từ URL do prompt đưa vào.
- Không clone giọng khi thiếu consent.
- Không bấm Google Flow bằng tọa độ đoán hoặc giả upload/download.
- Không tự retry vô hạn khi render/provider lỗi.
- Không tuyên bố publishable, monetizable, legal-cleared hoặc “đã xong” trước human review.

## 13. Next action

Bắt đầu bằng `Slice 0` và `Slice 1`, không làm thêm UI trước khi một shot true 3D chạy được qua worker boundary. Sau khi hai slice pass, mới mở rộng multi-shot/asset/provider. Mỗi slice phải có change record, validator, test và evidence trong `docs/PROJECT_STATUS.md`.
