# PLAN-024 — Asset Pack chủ thể → Nano Banana → Blender → Flow video

## Trạng thái

`DRAFT / NEEDS_HUMAN_REVIEW`

Đây là plan triển khai đầy đủ cho asset reference theo chủ đề. Nano Banana trong Google Flow là image provider mặc định; Nano Banana MCP chỉ còn là compatibility fallback. Cả hai đều không thay thế Muse Director, Blender hoặc Google Flow video.

Tiến độ: Slice A đã triển khai contract pack/item/report, validator semantic và state-transition gate. Slice B đã thêm contract cho Muse asset plan và planner biên dịch prompt riêng từng item. Slice C đã thêm job contract và Nano Banana batch worker có dependency order, retry/hash/report. Slice D đã nối Asset Pack vào Asset Library/review gate của desktop, có preview, checklist, rights và trạng thái review bền vững trong SQLite. Slice E đã thêm Blender binding contract/native preflight và worker preview reference-first; Blender execution thực tế vẫn chưa được tự động bật.

## 1. Mục tiêu

Khi người dùng nhập một chủ đề như “con hổ cao 8 m xuyên không về kỷ Phấn Trắng”, app phải tự tạo được một asset pack có cấu trúc trước khi tạo shot:

```text
Prompt chủ đề
  → Muse Director phân tích đề tài
  → character/world/style bible
  → Asset Pack Planner
  → prompt ảnh riêng cho từng asset
  → Nano Banana MCP tạo ảnh reference
  → ingest/hash/rights/review vào Asset Library
  → Blender dùng asset IDs và scale/continuity anchors
  → shot plan + shot prompt riêng
  → Google Flow/Omni tạo video từng shot
  → voice/alignment/subtitle/frame lock
  → FFmpeg compose + QA
```

Mục tiêu chính là không còn tình trạng mỗi shot nhận một prompt chung rồi sinh các ảnh gần giống nhau, hoặc dùng semantic Blender contact sheet như asset final.

## 2. Không làm trong plan này

- Nano Banana không tạo model `.blend`, mesh, rig hoặc animation 3D.
- Ảnh Nano Banana không được đánh dấu là final render hay final video.
- Không tự tải checkpoint, custom node, model hoặc MCP server từ prompt.
- Không tự upload/import vào Google Flow khi BrowserMCP/MCP không có capability tương ứng.
- Không tự vượt cost gate, rights gate, đăng nhập, CAPTCHA hoặc publish.
- Không coi một contact sheet nhiều beat là nhiều asset ảnh độc lập.

## 3. Taxonomy asset bắt buộc

### 3.1 Subject/character pack

Mỗi chủ thể quan trọng phải có một `identity_anchor_id` bất biến và tối thiểu:

| Asset role | Nội dung |
|---|---|
| `identity_hero` | Toàn thân, pose trung tính, nền sạch, silhouette rõ |
| `identity_front` | Mặt trước, nhận diện khuôn mặt/hình dáng |
| `identity_three_quarter` | Góc 3/4 dùng làm reference chính |
| `identity_side` | Profile và tỷ lệ cơ thể |
| `identity_detail` | Mắt, da/lông/vảy, vật liệu, dấu nhận diện |
| `scale_reference` | So với người, cây, xe hoặc chủ thể khác |
| `pose_action` | Các pose hành động cần cho shot |
| `negative_identity` | Những thay đổi bị cấm: đổi màu, thêm sừng, đổi sọc, méo tỷ lệ |

### 3.2 World/environment pack

- `environment_establishing`: toàn cảnh thế giới.
- `environment_ground`: nền đất, đá, nước, bụi, vegetation.
- `environment_lighting`: key light, fog, time of day, palette.
- `environment_landmark`: hang, tổ, núi, cây hoặc vật mốc cần continuity.
- `environment_scale`: reference chiều cao/khoảng cách.

### 3.3 Prop/evidence pack

- `prop_primary`: tổ, trứng, vũ khí, phương tiện hoặc vật thể chính.
- `prop_secondary`: dấu chân, đá, cây gãy, mảnh vỡ.
- `story_evidence`: vật chứng phục vụ narration/claim.
- `start_frame` và `end_frame`: nếu asset được dùng để neo chuyển động.

### 3.4 Style/camera pack

- `style_frame`: màu, chất liệu, độ tương phản, rendering language.
- `camera_reference`: lens, height, angle, composition.
- `lighting_reference`: volumetric/rim/fill/shadow logic.
- `motion_reference`: hướng screen direction, tốc độ và nhịp camera.

## 4. Agent/skill responsibilities

### Gemini 3.8 Flash Medium — Director/Planner

Tạo:

- topic brief;
- character bible;
- world bible;
- style bible;
- identity anchors;
- asset manifest;
- shot plan;
- prompt ảnh và prompt video;
- Blender job JSON typed.

Gemini không gọi shell, không tự bấm Flow và không tự quyết định rights/cost.

### Asset Pack Planner

Biến bible thành danh sách asset không trùng, xác định:

- asset role;
- chủ thể/world/prop thuộc về ai;
- số view cần tạo;
- prompt grounding;
- negative constraints;
- shot nào sử dụng;
- acceptance checks;
- dependency và thứ tự tạo.

### Google Flow / Nano Banana 2

Tạo ảnh reference trực tiếp trong composer Nano Banana 2 của project Flow. App gửi từng shot,
chờ file ảnh mới tải về, copy/hash/import vào project và giữ `rights=pending`; app không coi ảnh
là model `.blend` hay video final.

### Nano Banana MCP compatibility path

Worker MCP cũ chỉ tạo ảnh reference/chỉnh ảnh qua `generate_image`. Nó được giữ để đọc report/cache
cũ hoặc dùng khi người dùng chủ động chọn fallback; đường chạy mặc định không gọi worker này.

### Blender worker

Đọc asset manifest, scale anchors và binding đã duyệt; dựng scene thật, camera, lighting, animation, render preview/final. Primitive storyboard chỉ là layout guide.

### Gemini Vision/Recovery

Kiểm tra ảnh asset và Blender preview: identity drift, sai scale, sai hướng camera, duplicate subject, lỗi vật liệu, lỗi composition. Chỉ gọi recovery sau failure policy.

### Voice/Caption pipeline

Dùng narration đã duyệt, `voice_emotion_planner`, STT/forced alignment và frame-caption plan. Không đưa emotion tag vào prompt ảnh hoặc subtitle.

## 5. Data contracts cần thêm hoặc mở rộng

### 5.1 `asset-pack.schema.json`

```json
{
  "schemaVersion": "1.0.0",
  "packId": "asset-pack-dinosaur-tiger-v1",
  "projectId": "project-id",
  "status": "planned|generating|needs_review|approved|blocked",
  "bibleVersions": {
    "character": "character-bible-v1",
    "world": "world-bible-v1",
    "style": "style-bible-v1"
  },
  "identityAnchors": ["tiger-giant-v1", "trex-v1"],
  "assetItems": [],
  "acceptancePolicy": {"requiresHumanReview": true}
}
```

### 5.2 `asset-pack-item.schema.json`

Mỗi item cần có:

```text
assetItemId, packId, identityAnchorId, role, title,
prompt, negativePrompt, referenceAssetIds,
shotIds, requiredViews, width, height, provider,
status, reviewState, rightsStatus, acceptanceChecks,
generationAttempts, outputAssetIds
```

Role allowlist phải gồm `identity`, `composition`, `pose`, `camera`, `style`, `environment`, `prop`, `scale_reference`, `start_frame`, `end_frame`.

### 5.3 `asset-generation-report.schema.json`

Report phải ghi từng item:

- request hash;
- provider/MCP server info;
- prompt version;
- output path/hash/dimensions;
- attempt number và retry reason;
- cost/credit observation;
- rights state;
- review decision;
- failure code.

### 5.4 Mở rộng `shot.schema.json`

Thêm hoặc đồng bộ:

```text
identityAnchorIds
environmentAssetIds
propAssetIds
styleAssetIds
scaleReferenceAssetIds
assetPackId
continuityChecks
```

`referenceAssetIds` vẫn được giữ để tương thích, nhưng shot mới phải chỉ rõ role của từng asset.

## 6. Prompt compiler

Prompt ảnh không lấy thẳng một câu topic. Compiler phải ghép theo thứ tự:

```text
identity anchor
→ world/environment
→ action/pose
→ camera/lens/composition
→ lighting/material/color
→ continuity constraints
→ output role
→ negative prompt
→ acceptance checks
```

Ví dụ asset `identity_hero`:

```text
Create a cinematic 3D reference image of the same giant Bengal tiger,
8 meters tall, realistic anatomy, orange coat with three fixed dark stripes
over the left eye and shoulder, amber eyes, scar on the right cheek,
full body, neutral standing pose, clean dark studio background, orthographic
identity reference, visible feet and tail, consistent proportions.

Do not change the stripe pattern, eye color, scar, limb count, body scale,
species, age or silhouette. No text, logo, watermark, extra animal,
contact sheet, split screen or random props.
```

Prompt `SHOT-004` được tạo sau khi asset identity đã approved và phải đính kèm asset ID/hash, không tự mô tả lại chủ thể theo cách mâu thuẫn.

## 7. Generation order

```text
1. Character/subject identity anchors
2. World/environment anchors
3. Main props and story evidence
4. Scale/camera/style references
5. Human review asset pack
6. Blender scene binding
7. Per-shot reference images
8. Human review shot references
9. Google Flow/Omni video generation
```

Không chạy toàn bộ 32 shot ảnh trước khi identity anchor được duyệt. Nếu identity bị reject, chỉ tạo lại nhánh asset liên quan; không overwrite asset đã approved.

## 8. State machine

```text
planned
  → validated
  → queued
  → generating
  → ingested
  → needs_review
  → approved
  → bound_to_blender/shot
```

Failure states:

```text
blocked_missing_provider
blocked_missing_mcp
blocked_missing_flow_session
failed_provider
failed_output_validation
needs_revision_identity
needs_revision_continuity
rejected_rights
```

Retry tối đa 2 lần mỗi item, idempotency theo `packId + assetItemId + promptVersion + attempt`. Không retry nếu Flow không có composer, không đọc được cost hoặc thiếu login.

## 9. UI workspace

Trong canvas project cần có các card thật:

```text
Prompt
→ Director/Bibles
→ Asset Pack Planner
→ Subject Assets
→ World Assets
→ Prop/Scale Assets
→ Asset Review
→ Blender Binding
→ Shot Plan
→ Shot References
→ Flow Video
→ Voice/Caption
→ Compose/Delivery
```

Mỗi card phải hiển thị:

- số item `ready / review / failed`;
- provider thật;
- prompt version;
- output thumbnail/preview;
- asset IDs và shot IDs;
- nút `Tạo`, `Review`, `Retry failed`, `Open evidence`;
- lý do bị khóa.

Không hiển thị placeholder dot không có ý nghĩa. Click vào card mở detail panel; hover card hiện connector; nối node chỉ thay đổi graph typed, không chạy provider nếu chưa qua gate.

## 10. Cost, rights và safety gates

- Nano Banana Flow image generation phải đọc cost từ MCP/Flow trước khi submit.
- `FLOW_MAX_COST=0` mặc định; nếu provider báo cost khác 0 thì block.
- Mọi ảnh import có `rights=pending` cho đến khi người dùng duyệt.
- Asset có reference người thật, IP hoặc thương hiệu cần rights record riêng.
- Không lưu cookie, token hoặc API key trong SQLite, prompt pack, report hay log.
- MCP server là dependency bên ngoài; phải ghi repo, phiên bản, license và đường dẫn entry.
- Không gọi video Flow trước khi asset pack và shot references đạt review tối thiểu.

## 11. Blender binding rules

Blender job phải nhận:

```text
assetPackId
identityAnchorIds
assetBindings[]
worldScaleMeters
cameraContinuity
screenDirection
materialPalette
approvedReferenceHashes
```

Binding fail nếu:

- asset chưa `approved`;
- hash không khớp;
- asset role không phù hợp với slot;
- scale thiếu hoặc mâu thuẫn;
- identity anchor bị thay đổi giữa shot;
- output `.blend`/render nằm ngoài workspace;
- render exit 0 nhưng thiếu frame/output.

## 12. Implementation slices

### Slice A — Contracts/state

Thêm asset-pack contracts, state transitions, database records hoặc projection typed; cập nhật manifest và validator.

### Slice B — Muse asset planner

Thêm structured output cho character/world/style bible và asset manifest; validate duplicate role, missing identity anchor, missing scale/reference.

### Slice C — Nano Banana batch bridge

Mở rộng MCP worker từ shot tasks sang asset-pack tasks; hỗ trợ dependency order, reference images, per-item report, retry bounded và output hash.

### Slice D — Asset Library/review

Hiển thị pack theo nhóm subject/world/prop/style; review từng item; approve/reject/retry không overwrite bản approved.

### Slice E — Blender binding

Compile approved asset pack thành Blender job JSON; enforce scale/material/camera/continuity; render preview từng shot.

Triển khai hiện tại: native preflight compile binding/job/worker, kiểm tra output hash/path và tạo versioned run directory; review button có thể chạy Blender preview bounded và validate output, nhưng vẫn không tự coi preview là final.

### Slice F — Shot references + Flow video

Tạo ảnh theo shot sau asset pack; chuẩn bị Browser/MCP Flow handoff; chỉ Generate sau approval/cost gate.

### Slice G — Voice/caption/delivery

Emotion plan → TTS → alignment → frame captions → FFmpeg → FFprobe/QA → delivery evidence.

### Slice H — Full autonomous runner

Resume/retry/cancel/reconcile, durable logs, failure recovery và project reopen không mất state.

## 13. File dự kiến thay đổi

```text
contracts/asset-pack.schema.json
contracts/asset-pack-item.schema.json
contracts/asset-generation-report.schema.json
contracts/asset-pack-review-state.schema.json
contracts/asset-pack-plan.schema.json
contracts/asset-pack-mcp-job.schema.json
contracts/shot.schema.json
desktop/src-tauri/src/lib.rs
desktop/src-tauri/migrations/0008_asset_pack_reviews.sql
desktop/src-tauri/src/provider_config.rs
desktop/src/App.tsx
desktop/src/App.css
scripts/asset_pack_planner.py
scripts/asset_pack_mcp_worker.py
scripts/nanobanana_mcp_worker.py
scripts/asset_pack_validator.py
scripts/blender_asset_binding_worker.py
workflows/example-cinematic-3d-topic-to-frame-captioned.yaml
docs/operations/AGENT_SKILL_MAP.md
MANIFEST.json
contracts/asset-pack-blender-binding.schema.json
```

## 14. Tests bắt buộc

### Contract/unit

- asset pack thiếu identity anchor → blocked;
- duplicate `assetItemId`/role → rejected;
- shot reference không có asset ID/hash → blocked;
- role sai hoặc reference path traversal → rejected;
- approved asset không được overwrite;
- prompt có secret → rejected;
- prompt version thay đổi tạo idempotency key mới.

### Worker/provider

- fake MCP trả đủ output;
- fake MCP trả thiếu ảnh;
- MCP không có `generate_image`;
- Flow session chưa đăng nhập/chưa mở project;
- cost đọc được lớn hơn 0 → không submit;
- MCP timeout, retry tối đa 2;
- output ngoài workspace hoặc file hỏng → quarantine.

### Blender

- bind đúng identity/world/prop;
- thiếu asset approved → không chạy;
- scale 8 m/12 m giữ nguyên qua 8 shot;
- rerun một shot không làm đổi hash asset approved;
- render exit 0 nhưng thiếu frames → failure.

### End-to-end

Với đề tài hổ khổng lồ:

```text
2 subject identity anchors (tiger, T-Rex)
3 environment anchors
4 prop/evidence anchors
4 style/scale/camera anchors
8 shot plans
8 per-shot references
8 Blender shot manifests
voice + alignment + captions + master QA
```

## 15. Definition of done

Plan chỉ được đánh dấu `DONE` khi:

1. Một prompt tạo được asset pack có nhóm subject/world/prop/style.
2. Nano Banana tạo output riêng cho từng asset item và report/hash đầy đủ.
3. Người dùng review/approve asset pack trước khi shot dùng asset.
4. Blender binding dùng đúng asset ID/hash/scale và render thật.
5. Shot reference không lặp prompt/ảnh vô nghĩa.
6. Flow video nhận đúng reference đã duyệt, không nhầm contact sheet.
7. Voice, alignment, subtitle frame lock và FFmpeg QA có evidence.
8. Failure path, retry, cancel, resume và rights/cost gate đều được test.
9. Human review vẫn bắt buộc trước final delivery/publish.

## 16. Next action

Thực hiện Slice A trước: thêm ba contract asset pack, validator và state model; sau đó mới sửa UI và mở rộng worker Nano Banana. Không bắt đầu bằng cách tạo thêm hàng chục ảnh shot khi identity/world pack chưa tồn tại.

## 17. Bounded runtime guard update (2026-09-12)

Trước khi gọi Nano Banana MCP, native command phải thực hiện CDP preflight chỉ-đọc tới endpoint Chrome Flow đã cấu hình (mặc định `127.0.0.1:9222`). BrowserMCP `9009` là bridge riêng, không được coi là thay thế cho Chrome CDP. Nếu preflight không sẵn sàng, command phải dừng trước khi spawn worker hoặc tạo job trả phí và trả thông báo phân biệt rõ hai cổng.

Nếu worker trả report `failed/blocked`, đặc biệt lỗi `initialize timeout`, native report và UI phải giữ mã lỗi/detail có cấu trúc; không chuyển thành success chỉ vì process đã thoát. Studio Flow heartbeat phải dừng ngay khi stage asset thất bại để không tiếp tục hiển thị “đang chạy”. Slice này không thực hiện click Generate, không tạo ảnh/video thật và không thay đổi transport BrowserMCP.
