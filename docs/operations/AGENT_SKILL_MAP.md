# Auto3Dvideo — Agent Skill Map

Tài liệu này là nơi kiểm tra chung các skill mà agent dùng để làm video 3D. Đây là bản đồ tài liệu, contract và worker trong repo; không phải bộ model được fine-tune. Một skill chỉ được coi là chạy thật khi có input/output rõ, worker hoặc adapter tương ứng, validation và evidence.

Ngày cập nhật: 2026-09-11

## Luồng chuẩn

```text
topic_director
  → visual_world_bible
  → storyboard_shot_planner
    ├→ shot_prompt_designer
    └→ voice_emotion_planner
  → asset_select_or_generate
  → blender_scene_builder
  → preview_and_assert
  → image_or_video_provider
  → review_and_compose
```

Quy tắc quan trọng:

- Một `shot` là một đơn vị cảnh/video.
- Một `beat` là mốc bố cục/hành động bên trong shot, không phải asset cuối.
- Blender semantic blockout chỉ là phác hình học để khóa bố cục và continuity.
- Asset ảnh thật phải có `assetId`, hash, provenance, rights state và shot assignment riêng.
- Video provider chỉ được gọi sau capability, cost, rights và approval gate tương ứng.

## 1. Skill lên chủ đề và cấu trúc video

| Skill | Nguồn chính | Output | Trạng thái |
|---|---|---|---|
| `topic_director` | [`TOPIC_PROFILE_AND_PROMPT_REGISTRY.md`](../architecture/TOPIC_PROFILE_AND_PROMPT_REGISTRY.md) | brief, audience, goal, format, scope | Có khung + UI |
| `claim_and_research_planner` | [`prompt-templates.example.json`](../../configs/prompt-templates.example.json) · `content-brief-v1` · `research-claims-v1` | claims, sources, unknowns, caveats | Có template, cần review |
| `storyboard_shot_planner` | `storyboard-shots-v1` · [`video-script.schema.json`](../../contracts/video-script.schema.json) | shot, beat, timing, visual intent, asset path | Có worker local |
| `character_bible` | `character-bible-v1` | identity, silhouette, wardrobe, props, prohibited changes | Có template |
| `world_bible` | `world-bible-v1` · [`style-bible.schema.json`](../../contracts/style-bible.schema.json) | environment, scale, asset list, material, camera, lighting, motion | Có template |

Profile chủ đề mẫu nằm ở [`topic-profiles.example.json`](../../configs/topic-profiles.example.json). Profile `cinematic-3d` là profile đúng cho workflow Blender/Omni; profile này yêu cầu asset, camera, lighting, continuity và provenance.

## 2. Skill viết prompt ảnh đẹp theo từng shot

| Skill | Nguồn chính | Bắt buộc phải tạo |
|---|---|---|
| `shot_prompt_designer` | `storyboard-shots-v1` · [`local_script_worker.py`](../../scripts/local_script_worker.py) | subject, world, action, camera/lens, lighting, material, composition |
| `cinematic_prompt_enricher` | [`cinematic-video-prompt-skill`](https://github.com/Rylaispirit/cinematic-video-prompt-skill) · `role-skills.cinematic-3d.json` | one shot size + angle, one main action, one camera movement, compatible lighting/style/color/mood/technical blocks |
| `continuity_prompt_guard` | `character-bible-v1` · `world-bible-v1` · `style-bible.schema.json` | silhouette, palette, scale, screen direction, time of day, reusable props |
| `image_negative_prompt_guard` | `negativePrompt` trong `video-script.schema.json` và local worker | no extra subject, no random props, no text/logo/watermark, no morphing, no flicker, no broken geometry |
| `reference_role_mapper` | [`reference-set.schema.json`](../../contracts/reference-set.schema.json) · `asset-candidates-v1` | identity, composition, pose, camera, style, start/end frame, negative |

Prompt ảnh chuẩn của mỗi shot phải có dạng logic này:

```text
SHOT_ID
  subject / identity anchor
  environment / scale / foreground-midground-background
  action / cause-and-effect change
  composition / focal point / screen direction
  camera / lens / movement / focus
  lighting / palette / material / atmosphere
  continuity anchors
  reference assets + role của từng ảnh
  positive prompt
  negative prompt
  aspect ratio / resolution / expected asset path
```

Repo hiện đã tạo các trường này trong script local, nhưng chưa có một adapter riêng cho Nano Banana/Gemini để tự generate ảnh và nhận output.

`cinematic_prompt_enricher` dùng phần hướng dẫn prompt điện ảnh MIT của repo ngoài như vocabulary có giới hạn, không chạy code từ repo và không thay thế prompt contract của Auto3Dvideo. Worker giữ công thức shot-size/angle → subject/action → setting → lighting → camera movement → style/color → mood → technical; mỗi shot chỉ dùng một chuyển động camera và một hành động chính. Source được ghi trong `configs/role-skills.cinematic-3d.json` để prompt version/hash có thể truy nguyên.

## 3. Skill Blender

### Chuỗi skill chuẩn

Định nghĩa đầy đủ ở [`BLENDER_QUALITY_SKILL_STACK.md`](BLENDER_QUALITY_SKILL_STACK.md):

```text
brief_to_visual_spec
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
```

| Skill | Worker/contract hiện có | Trạng thái |
|---|---|---|
| `asset_quality_check` | [`blender_quality_toolkit.py`](../../scripts/blender_quality_toolkit.py) · `inspect` | Có kiểm tra mesh/material/scale |
| `pbr_material_lookdev` | `blender_quality_toolkit.py` · `setup_lookdev` | Có preset, chưa tự tạo hero asset chi tiết |
| `camera_language_setup` | `blender_quality_toolkit.py` · `setup_camera` | Có camera/lens/focus/safe area |
| `shot_blockout` | [`multishot_scene_builder.py`](../../scripts/multishot_scene_builder.py) | Có, nhưng là semantic primitive blockout |
| `animation_continuity` | `edit-plan.json`, shot manifest, continuity fields | Có dữ liệu, assertion còn hạn chế |
| `preview_render` | Blender job boundary + expected outputs | Có preview/contact sheet |
| `deterministic_scene_assertions` | quality report/tests | Có nền tảng |
| `final_render` | Blender/FFmpeg path | Có đường local, cần human review |

### PLAN-023 Slice 0/1 — 2026-09-10

Đã thêm contract/state foundation cho true 3D (`true-3d-run`, `world-bible`, `character-bible`, `asset-binding`, `scene-manifest`, `shot-production`, `multi-shot-continuity`) và worker `scripts/true3d_scene_worker.py`. Worker nhận spec typed, tạo mesh/material/camera/light/animation thật, render ba preview frame hoặc đủ frame video, ghi scene manifest + deterministic quality report và không dùng network/external asset/raw Python từ prompt. Rust supervisor có command `run_true3d_fixture`, kiểm tra output/assertions và UI Settings có nút `Dựng shot true 3D preview`/`Render video true 3D local`. Fixture đã smoke pass Blender 5.2.1 + FFmpeg ngoài app; evidence ở [`PLAN023_TRUE3D_SLICE_IMPLEMENTATION_2026-09-10.md`](PLAN023_TRUE3D_SLICE_IMPLEMENTATION_2026-09-10.md).

### PLAN-024 Slice A — Asset Pack contract/state gate — 2026-09-11

Đã thêm `asset-pack.schema.json`, `asset-pack-item.schema.json` và `asset-generation-report.schema.json`. `scripts/validate_asset_pack.py` kiểm tra schema, đối chiếu pack với item manifest, identity anchor, scale reference, prompt không chứa credential marker, quyền/review trước khi approved và count của report; validator luôn báo `provider_execution=not_started` và `blender_execution=not_started`. `scripts/asset_pack_state.py` khóa state machine planned → validated → queued → generating → ingested → needs_review → approved, cùng các nhánh blocked/failed. Test hợp lệ và test lỗi nằm ở `test_validate_asset_pack.py`/`test_asset_pack_state.py`. Đây mới là gate dữ liệu; chưa tự gọi Nano Banana hay Blender.

### PLAN-024 Slice B — Muse Asset Pack Planner — 2026-09-11

`contracts/asset-pack-plan.schema.json` định nghĩa output có cấu trúc mà Muse phải trả về: bible versions, identity anchors, asset role, shot assignment, world, action, camera, lighting, continuity và negative prompt. `scripts/asset_pack_planner.py` biên dịch mỗi item thành prompt riêng, tạo acceptance checks và giữ provider ở trạng thái `nano_banana_mcp` nhưng chưa gọi MCP. Planner chặn duplicate `assetItemId`, identity anchor không tồn tại, identity item thiếu anchor, scale reference thiếu `scaleMeters`, thiếu role bắt buộc và thiếu scale policy. Kết quả được đưa qua Asset Pack validator trước khi lưu.

### PLAN-024 Slice C — Asset Pack Nano Banana batch bridge — 2026-09-11

Đã thêm `asset-pack-mcp-job.schema.json` và `scripts/asset_pack_mcp_worker.py`. Worker nhận item prompt đã compiler, sắp thứ tự theo `dependsOn` và role priority (identity → environment → prop → scale), truyền output item trước làm reference cho item sau, retry tối đa 2 lần, chặn credential/cost violation, kiểm tra ảnh có dimensions thật, hash SHA-256 và ghi `asset-generation-report.json` theo từng item. Output sinh xong vẫn là `needs_review` với `rightsStatus` giữ nguyên; thiếu MCP/tool, dependency cycle, output hỏng hoặc lỗi provider không được đánh dấu thành công. Test fake-MCP đã kiểm tra dependency order, retry evidence, hash/dimensions và cycle rejection.

### PLAN-024 Slice D — Asset Pack Library/review — 2026-09-11

Đã nối Asset Pack vào workspace desktop bằng `list_asset_pack_reviews` và `register_asset_pack_source`. App đọc `asset-pack.json`, `asset-items.json` và `asset-generation-report.json` trong project workspace, hiển thị pack/item theo role, output path/thumbnail preview, prompt/negative prompt, shot IDs, scale, attempts và acceptance checks. Trạng thái review/quyền/checklist được lưu trong SQLite migration `0008_asset_pack_reviews`; approve yêu cầu quyền hợp lệ và pass đủ check bắt buộc, đồng thời khóa thay đổi ngược trên item đã approved. Review không ghi đè manifest/output; quyền được đồng bộ sang output asset nếu asset đã được ingest. Đây là review gate local, chưa tự submit provider retry hay bind Blender.

### PLAN-024 Slice E — Blender binding gate — 2026-09-11

Đã thêm `asset-pack-blender-binding.schema.json`, native command `prepare_asset_pack_blender_binding` và `run_asset_pack_blender_binding`. Nút **Chuẩn bị Blender binding** chỉ mở sau khi toàn bộ item được approve; native gate kiểm tra quyền, identity anchor, shot ID, output path trong workspace, file hash thực tế so với Asset Library, scale reference đồng nhất và continuity anchors. Nếu gate đạt, app ghi binding, job và worker đã version hóa vào run directory mới, `allowNetwork=false`, output render có version riêng và `blenderExecutionStarted=false`. Nút **Chạy Blender preview** mới là bước spawn Blender allowlist với timeout bounded, kiểm tra scene/report/frame output; kết quả luôn `succeeded_needs_review` và reference-only, không được coi là final. Nếu gate chưa đạt chỉ ghi report blocker, không tạo job giả.

Worker [`blender_asset_binding_worker.py`](../../scripts/blender_asset_binding_worker.py) là worker Blender reference-first đã version hoá: validate lại hash/path/approval rồi dựng preview board để review các ảnh reference; nó được spawn có giám sát từ nút review, nhưng không biến ảnh phác thành model 3D và không coi preview là final asset.

Slice 2 đã thêm `scripts/true3d_multishot_worker.py`: một world/character scene chung cho 8 shot, camera/action spec riêng, asset library + binding hash, shot manifests, continuity drift report và rerun một shot với baseline asset library. Rust command `run_true3d_multishot_fixture` và Settings có nút `Dựng continuity 8 shot`/`Chạy lại shot + kiểm asset hash`. Fixture Blender đã render đủ 8 shot, continuity drift bằng 0 và rerun SHOT-004 giữ nguyên asset/shot input hash; evidence ở [`PLAN023_TRUE3D_MULTISHOT_IMPLEMENTATION_2026-09-11.md`](PLAN023_TRUE3D_MULTISHOT_IMPLEMENTATION_2026-09-11.md). Đây vẫn là fixture có kiểm soát, chưa phải hero asset/provider pipeline và vẫn cần người dùng review.

### PLAN-023 Slice 3 — Asset pipeline — 2026-09-11

Đã nối Asset Library hiện có vào pipeline typed bằng `scripts/asset_pipeline_worker.py` và contract `asset-ingest.schema.json`/`asset-pipeline-report.schema.json`. Worker chỉ nhận path tương đối trong workspace, hash SHA-256, probe magic bytes/dimensions, giữ provenance, phân biệt `reference_image`, `model3d`, `texture`, `render`, copy sang thư mục run mới và đưa rights `unknown/pending/restricted/rejected` hoặc file sai loại vào `quarantine/`. Ảnh phác/reference không thể đi qua nhánh `model3d`; binding bị ghi `blocked` khi asset bị quarantine.

Model `.blend` ready được chuyển qua `scripts/blender_asset_quality_worker.py`, gọi toolkit versioned để inspect mesh/material/scale và áp lookdev/camera preset vào bản copy `normalized.blend`. Rust command `run_asset_pipeline_check` chạy ingest bằng Python allowlist, quality/lookdev bằng Blender allowlist nếu có, merge report và ghi audit evidence. Settings có nút `Kiểm tra Asset Pipeline`; nếu Blender chưa cấu hình, report giữ `needs_review` và nêu blocker, không báo thành công giả.

Host smoke `examples/plan023-true3d/asset-ingest-spec.json` đã pass: 1 reference image, 1 model3d, 1 texture, 1 render; asset render `rights=pending` nằm quarantine, tổng `ready=3/quarantined=1`. Đây là asset/reference pipeline có kiểm soát, chưa tự gọi provider tạo ảnh/model và vẫn cần human review quyền, chất lượng và shot binding.

### PLAN-023 Slice 4 — ComfyUI image reference bridge — 2026-09-11

Đã nối skill `asset_select_or_generate` vào hai adapter ảnh có contract riêng. Đường mặc định mới là Nano Banana MCP qua Google Flow: `nanobanana-image-job.schema.json`/`nanobanana-image-report.schema.json`, worker `scripts/nanobanana_mcp_worker.py` và native command `run_nanobanana_image_generation`. Mỗi shot tạo một task với prompt, negative prompt, kích thước, role, reference images và rights state; worker gọi MCP stdio `generate_image`, lấy file trong `FLOW_OUTPUT_DIR`, hash/report rồi app nhập vào Asset Library `rights=pending`. ComfyUI vẫn được giữ làm fallback legacy có kiểm soát.

Nút `Tạo asset ảnh Nano Banana` chỉ xuất hiện sau Blender semantic preview. Cần người dùng cài/build MCP server, mở Chrome Flow đã đăng nhập với CDP loopback `127.0.0.1:9222`, và tự duyệt chi phí/quyền trong Flow; app không lưu API key, không tự giả thành công và không gọi ComfyUI ở đường mặc định. Evidence Nano Banana ở [`PLAN024_NANOBANANA_MCP_IMAGE_BRIDGE_IMPLEMENTATION_2026-09-11.md`](PLAN024_NANOBANANA_MCP_IMAGE_BRIDGE_IMPLEMENTATION_2026-09-11.md); ComfyUI legacy ở [`PLAN023_COMFYUI_IMAGE_BRIDGE_IMPLEMENTATION_2026-09-11.md`](PLAN023_COMFYUI_IMAGE_BRIDGE_IMPLEMENTATION_2026-09-11.md).

### Giới hạn phải nhớ

`multishot_scene_builder.py` không phải skill tạo model 3D đẹp. Nó tạo primitive màu để biểu diễn subject, environment, prop, camera và action. Hiện mỗi shot có thể có bốn beat preview `establish/action/reveal/resolve`; các beat được ghép thành contact sheet của shot. Contact sheet đó không phải bốn asset ảnh cuối.

Asset 3D thật phải đi qua `asset_select_or_generate` → quality check → normalize → material/lighting review trước khi đưa vào scene. Không được đánh dấu `.blend` thành công là asset đã đẹp hoặc đã sẵn sàng phát hành.

## 4. Skill asset ảnh và provider

| Bước | Nguồn | Kết quả hiện tại |
|---|---|---|
| `asset_select_or_generate` | [`asset.schema.json`](../../contracts/asset.schema.json) · `asset-candidates-v1` | Có registry/provenance/review |
| `gemini_storyboard_image_pass` | `prepareGeminiStoryboardFromBlender` trong `desktop/src/App.tsx` | Chỉ tạo handoff pack + prompt theo shot |
| `gemini_image_import` | `importGeminiSketches` trong `desktop/src/App.tsx` | Chọn ảnh đã tải, copy/hash/import thủ công |
| `omni_video_handoff` | Browser handoff + [`browser-handoff.schema.json`](../../contracts/browser-handoff.schema.json) | Chuẩn bị prompt và reference; Generate vẫn gated |

Luồng asset đúng:

```text
SHOT-01 prompt
  → Gemini/Nano Banana tạo ảnh
  → GEMINI-SHOT-01.png tải về
  → hash + assetId + rights review
  → gán vào SHOT-01
  → Omni/Flow dùng ảnh đó làm reference
```

Hiện BrowserMCP chưa được coi là có capability upload/download/Generate tự động. Vì vậy app không được báo đã tạo ảnh nếu mới chỉ tạo handoff pack.

## 5. Skill voice, alignment, phụ đề và delivery

| Skill | Input → output | Trạng thái |
|---|---|---|
| `voice_emotion_planner` | storyboard/script → emotionCode theo segment + inline delivery cues | Có enum trong script/voice contract và rule dùng chung; provider-native emotion vẫn cần adapter riêng |
| `voiceover_synthesizer` | script segments → voice WAV + voice manifest | Có Voice Studio/worker; provider/consent/cost vẫn gated |
| `speech_alignment` | voice WAV + script → segment/word frame ranges | Có contract path; cần STT/forced-alignment provider trả timing thật |
| `frame_locked_captioner` | aligned ranges + FPS → `frame-caption-plan.json` + SRT | Có worker local và test; JSON frame là nguồn chuẩn, SRT là bản xuất |
| `timeline_composer` | Blender frames + voice + captions → master/timeline | Có FFmpeg/timeline contract; general production executor vẫn gated |
| `video_quality_gate` | media probe + frame/continuity/caption evidence → report | Có nền tảng evidence; human review bắt buộc |
| `delivery_rights_gate` | manifest + rights + AI disclosure → delivery decision | Có contract/policy; không tự tuyên bố publishable |

Quy tắc phụ đề:

```text
word/segment alignment
  → integer startFrame/endFrame ở FPS của project
  → frame-caption-plan.json (canonical)
  → SRT/VTT/ASS/FFmpeg (derived)
```

Không dùng timestamp do model tự đoán nếu chưa có `alignmentSource` và `alignmentState`. Cue overlap, range rỗng, vượt frame cuối hoặc text quá nhanh phải bị chặn/review. “Đúng từng frame” nghĩa là ranh giới cue được khóa ở frame; không có STT/forced alignment thật thì chỉ được gọi là draft.

### Quy định `voice_emotion_planner`

Đây là skill bắt buộc khi agent viết narration, shot plan hoặc prompt tạo voice. Nó phải:

1. Chọn một `emotionCode` trong enum chung cho mỗi segment; dùng `neutral` làm mặc định an toàn.
2. Nêu lý do ngắn gọn trong plan nội bộ dựa trên beat (`mở bài`, `khám phá`, `nguy hiểm`, `cao trào`, `kết`), nhưng không nhét lý do đó vào lời đọc hoặc subtitle.
3. Chỉ dùng inline tag viết hoa khi cần đổi cảm xúc giữa câu, ví dụ `[EXCITED]` hoặc `[SHOUTING]`; tag phải được parser loại khỏi audio text.
4. Giữ `narration` sạch cho caption/alignment và giữ mã cảm xúc riêng trong field `emotionCode`.
5. Đồng bộ nhịp giọng với visual: `excited/urgent/shouting` cần hành động hoặc camera có cao trào; `calm/mysterious/tender` cần nhịp máy, ánh sáng và khoảng nghỉ phù hợp. Không dùng emotion tag như một lệnh cho model ảnh.
6. Báo capability thật của provider. Với OmniVoice hiện tại, emotion code được tách chunk và dùng cue fallback gần đúng; muốn điều khiển cảm xúc native phải có provider/adapter đã xác minh.

Enum chuẩn: `neutral`, `calm`, `warm`, `friendly`, `happy`, `excited`, `joyful`, `triumphant`, `sad`, `melancholic`, `tender`, `concerned`, `fearful`, `angry`, `shouting`, `urgent`, `serious`, `surprised`, `mysterious`, `curious`, `sarcastic`, `whisper`.

## 6. Bảng trạng thái triển khai

| Nhóm | Đã có | Còn thiếu |
|---|---|---|
| Lên chủ đề | Profile, template, local script worker | Planner agent có output review rõ hơn |
| Prompt ảnh | Các trường prompt và continuity | Prompt pack riêng từng shot + adapter image provider |
| Blender | Preview, quality toolkit, manifest, contact sheet | Hero asset thật, multi-view asset, beauty render theo shot |
| Asset | Hash, registry, reference set, rights state, typed ingest/quarantine/binding, Blender quality/lookdev | Tự nối asset generated vào đúng shot sau khi provider trả file; multi-view/hero asset quality còn cần review |
| Gemini/Nano Banana | Handoff pack, import thủ công | Adapter/capability thật cho generate và output download |
| Omni/Flow | Browser handoff và roadmap | Upload/generate/download tự động khi capability được xác minh |
| Voice/caption | Voice Studio, subtitle schema và frame-caption worker | Cần adapter STT/forced alignment trả word timing thật; cần mux/burn-in production executor |
| End-to-end recipe | `example-cinematic-3d-topic-to-frame-captioned.yaml` | Cần nối workflow runner thật với từng worker; hiện compile/dry-run là chuẩn an toàn |

## 6. Checklist kiểm tra lần sau

1. Có một `projectId` và `sessionId` rõ ràng.
2. Có `topic profile` và `world/character bible`.
3. Có đúng số shot; mỗi shot có `shotId` ổn định.
4. Phân biệt `beat preview`, `generated image asset` và `final video`.
5. Mỗi asset có tên, hash, provenance, rights state và assignment.
6. Blender preview có scene, manifest, edit plan và expected output thật.
7. Prompt ảnh có subject/action/camera/lighting/continuity/negative riêng cho shot.
8. Provider capability, chi phí, quyền và approval được ghi trước khi generate.
9. Output tải về phải được validate rồi mới nhập vào workspace.
10. Human review vẫn bắt buộc cho chất lượng hình ảnh, continuity, rights và video cuối.
11. Frame-caption plan là nguồn thời gian duy nhất; SRT/VTT không được chỉnh tay rồi coi là đã cập nhật timeline nếu chưa re-import/review.

## File bắt đầu nhanh

- Chủ đề/prompt registry: [`TOPIC_PROFILE_AND_PROMPT_REGISTRY.md`](../architecture/TOPIC_PROFILE_AND_PROMPT_REGISTRY.md)
- Blender skill stack: [`BLENDER_QUALITY_SKILL_STACK.md`](BLENDER_QUALITY_SKILL_STACK.md)
- Prompt mẫu: [`prompt-templates.example.json`](../../configs/prompt-templates.example.json)
- Profile mẫu: [`topic-profiles.example.json`](../../configs/topic-profiles.example.json)
- Blender worker: [`multishot_scene_builder.py`](../../scripts/multishot_scene_builder.py)
- Quality toolkit: [`blender_quality_toolkit.py`](../../scripts/blender_quality_toolkit.py)
- Asset contract: [`asset.schema.json`](../../contracts/asset.schema.json)
- Asset ingest/report contract: [`asset-ingest.schema.json`](../../contracts/asset-ingest.schema.json) · [`asset-pipeline-report.schema.json`](../../contracts/asset-pipeline-report.schema.json)
- Asset pipeline worker: [`asset_pipeline_worker.py`](../../scripts/asset_pipeline_worker.py) · [`blender_asset_quality_worker.py`](../../scripts/blender_asset_quality_worker.py)
- ComfyUI image worker: [`comfyui_image_worker.py`](../../scripts/comfyui_image_worker.py) · static test [`test_comfyui_image_worker.py`](../../scripts/test_comfyui_image_worker.py)
- ComfyUI image contracts: [`comfyui-image-job.schema.json`](../../contracts/comfyui-image-job.schema.json) · [`comfyui-image-report.schema.json`](../../contracts/comfyui-image-report.schema.json)
- Nano Banana MCP image worker: [`nanobanana_mcp_worker.py`](../../scripts/nanobanana_mcp_worker.py) · protocol test [`test_nanobanana_mcp_worker.py`](../../scripts/test_nanobanana_mcp_worker.py)
- Nano Banana MCP image contracts: [`nanobanana-image-job.schema.json`](../../contracts/nanobanana-image-job.schema.json) · [`nanobanana-image-report.schema.json`](../../contracts/nanobanana-image-report.schema.json)
- Asset Pack contracts: [`asset-pack.schema.json`](../../contracts/asset-pack.schema.json) · [`asset-pack-item.schema.json`](../../contracts/asset-pack-item.schema.json) · [`asset-generation-report.schema.json`](../../contracts/asset-generation-report.schema.json)
- Asset Pack validator/state: [`validate_asset_pack.py`](../../scripts/validate_asset_pack.py) · [`asset_pack_state.py`](../../scripts/asset_pack_state.py) · [`test_validate_asset_pack.py`](../../scripts/test_validate_asset_pack.py)
- Muse Asset Pack planner: [`asset-pack-plan.schema.json`](../../contracts/asset-pack-plan.schema.json) · [`asset_pack_planner.py`](../../scripts/asset_pack_planner.py) · [`test_asset_pack_planner.py`](../../scripts/test_asset_pack_planner.py)
- Asset Pack Nano Banana bridge: [`asset-pack-mcp-job.schema.json`](../../contracts/asset-pack-mcp-job.schema.json) · [`asset_pack_mcp_worker.py`](../../scripts/asset_pack_mcp_worker.py) · [`test_asset_pack_mcp_worker.py`](../../scripts/test_asset_pack_mcp_worker.py)
- Asset Pack review gate: [`asset-pack-review-state.schema.json`](../../contracts/asset-pack-review-state.schema.json) · native `list_asset_pack_reviews`/`register_asset_pack_source`/`update_asset_pack_item_review` · migration [`0008_asset_pack_reviews.sql`](../../desktop/src-tauri/migrations/0008_asset_pack_reviews.sql)
- Blender binding gate: [`asset-pack-blender-binding.schema.json`](../../contracts/asset-pack-blender-binding.schema.json) · native `prepare_asset_pack_blender_binding` · [`blender_asset_binding_worker.py`](../../scripts/blender_asset_binding_worker.py)
- Shot contract: [`shot.schema.json`](../../contracts/shot.schema.json)
- Frame caption contract: [`frame-caption-plan.schema.json`](../../contracts/frame-caption-plan.schema.json)
- Canonical workflow: [`example-cinematic-3d-topic-to-frame-captioned.yaml`](../../workflows/example-cinematic-3d-topic-to-frame-captioned.yaml)
