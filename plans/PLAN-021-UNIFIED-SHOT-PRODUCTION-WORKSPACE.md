# PLAN-021 — Unified Shot Production Workspace

## Trạng thái

`NEEDS_HUMAN_REVIEW` — plan đã đủ để triển khai theo lát nhỏ, nhưng cần người dùng duyệt phạm vi provider web và quy tắc chi phí trước khi bật các bước tạo ảnh/video có phí.

Plan này là bản hợp nhất cho các yêu cầu về Prompt Studio, preset, asset/reference, Shot Composer, Blender preview, provider AI web, BrowserMCP, workflow nhiều shot, terminal log và review/delivery. Nó kế thừa `PLAN-018-BROWSER_HANDOFF_UX_REBUILD.md` và `SHOT_COMPOSER_REVIEW_WORKSPACE_PLAN.md`; không thay thế các contract an toàn hiện có.

### Tiến độ Slice 0 — 2026-09-06

Đã triển khai nền UI đầu tiên trong `desktop/src/App.tsx` và `desktop/src/App.css`: workspace context bar, activity event stream cho các thao tác prompt/storyboard/render/Blender/BrowserMCP, console có trạng thái tiếng Việt, tự mở khi chạy và thu gọn khi idle, shot rail vẫn ẩn mặc định, cùng blocker thay cho `alert`. Đây mới là activity của phiên UI; chưa phải durable backend event store. Các slice contract/SQLite/prompt CRUD tiếp theo vẫn phải triển khai và kiểm thử riêng.

### Tiến độ Slice 1 — 2026-09-07

Đã nối vertical slice prompt → semantic storyboard 3D → handoff: prompt 30 giây tự mở rộng thành tối đa 12 shot (mục tiêu khoảng 4 giây/shot), mỗi shot có bốn beat ảnh `establish/action/reveal/resolve`. Blender tạo primitive blockout có ngữ nghĩa (circle/ellipse=subject, capsule=person/scale, block=environment, marker=prop, arrow=action, camera marker=framing), ảnh beat riêng, contact sheet theo shot và `edit-plan.json` có frame/time/action/prompt để làm mốc dựng. BrowserMCP nhận các board theo shot cùng beat anchors; không tự upload/generate và không coi proxy Blender là video cuối. MP4 Blender vẫn là tùy chọn, còn đường chính là semantic storyboard → Gemini still references tùy chọn → provider Omni → review/edit cuối.

### Tiến độ Slice 1.1 — 2026-09-07

Đã thêm `VideoWorkflowSession` cho Quy trình video. Mỗi project có cache local `.auto3dvideo/video-workflow-sessions.json` để lưu tên phiên, prompt/chủ đề, tiêu đề/thời lượng, script/shot plan, đường dẫn reference/Gemini và summary preview Blender. UI hiển thị các phiên gần đây ở đầu workspace, cho `Phiên mới`, mở lại, đổi tên, lưu thủ công và tự lưu sau khi prompt/shot/preview thay đổi. Cache chỉ lưu metadata/đường dẫn tương đối và JSON storyboard; không lưu credential, cookie, token hoặc binary media. State phiên hiện tại đi theo `draft → storyboard_ready → preview_ready → gemini_ready`; BrowserMCP/Omni vẫn là bước handoff thủ công có review.

### Tiến độ Slice 1.2 — 2026-09-07

Đã thêm `BrowserFlowWorkflow` cho lần đầu dùng Google Flow: workflow tạo ID local, giữ nguyên tab đang Connect và chạy discovery `snapshot → wait 2s → snapshot`, lưu capability/UI-ref count giới hạn, roadmap thích ứng, process ID có tên và asset ID theo tên file/role. Nếu học được ref `New project`/`Create project`, app tự click đúng ref, snapshot lại và tự nạp prompt; nếu BrowserMCP từ chối hoặc accessibility snapshot không trả ref điều khiển dù trang có thể đang hiển thị control, roadmap chuyển `waiting_user`/`failed` chứ không giả thành công và không bịa tọa độ/ref. Upload/Generate/review vẫn dừng tại capability/approval thật. State lưu trong `.auto3dvideo/browser-flow/workflow-<workflowId>.json` và có contract `browser-flow-workflow.schema.json`.

### Tiến độ Slice 1.3 — 2026-09-07

Đã liên kết Browser Flow với `VideoWorkflowSession`: mỗi workflow lưu `sessionId` và bảng file binding `fileId → relativePath → kind → processId` cho scene, manifest, preview, edit plan và video preview. Khi mở lại một session, app lọc đúng Browser Flow workflow theo `projectId + sessionId`, khôi phục roadmap/process/assets/file binding tương ứng thay vì lấy nhầm workflow mới nhất. Discovery tự chạy toàn bộ các bước an toàn, tự giữ project/không gian của tab đang Connect và tự nạp prompt nếu snapshot có textbox ref hợp lệ; thiếu ref thì dừng rõ tại blocker. Upload/Generate/download chỉ dừng tại capability hoặc approval gate thật của BrowserMCP.

### Tiến độ Slice 1.4 — 2026-09-09

Đã thêm `Studio Flow` ngay trong tab `Quy trình video`: sau khi tạo project, app tự chuyển vào workspace này; canvas hiển thị các node Prompt, Reference, Agent, Shot Graph, Blender Preview, Provider và Output cùng trạng thái `waiting/ready/running/done/blocked`. Agent có nút chạy bước kế tiếp theo thứ tự prompt → shot plan → semantic preview → provider state, nhưng không tự bỏ qua cost/rights/capability gate. Graph là lớp hiển thị dẫn xuất từ `VideoWorkflowSession`, `LocalScriptDocument`, Blender preview và `BrowserFlowWorkflow`; dữ liệu nguồn vẫn là các state/contract hiện có nên không tạo một cache thứ hai dễ lệch. Google Flow/Omni/Seedance được hiển thị như provider node, không phải workspace trung tâm.

### Tiến độ Slice 1.5 — 2026-09-09

Đã mở rộng canvas thành kiểu node-workspace: nền chấm có nhiều điểm bấm, `＋ Thêm node` và menu node nổi. Người dùng có thể chọn Text to Image, Image to Image, Image to Video, Text to Video, Start/End Frame, Voiceover, Compose/Edit hoặc Review/Output; `⚡ Auto setup theo prompt` thêm toàn bộ graph setup vào phiên hiện tại và ghi activity event. Đây là lớp setup trực quan dùng các state workflow hiện có; chưa giả lập kéo-thả, chưa gọi provider trả phí và chưa coi việc thêm node là đã tạo output.

### Tiến độ Slice 1.6 — 2026-09-10

Đã thêm `Project Workspace / Node Canvas` ở đầu workspace video. Project root hiển thị nhiều `Video Flow` trong một chuỗi nối tiếp; mỗi flow mở lại đúng session đã lưu. Asset rack hiển thị asset local của project, còn các dấu chấm mở menu chọn flow, asset video, asset ảnh/phác hoặc tạo flow mới. Lớp project canvas dùng session/asset state hiện có, không tạo cache thứ hai; các lựa chọn chỉ cập nhật UI/activity và vẫn để provider/cost/rights gate ở bước chạy thật.

### Tiến độ Slice 1.7 — 2026-09-10

Đã gộp UI thành một `Project Workspace` duy nhất trong tab Quy trình video: bỏ context bar và flow canvas trùng ở màn chính, đưa prompt vào ngay canvas, thêm empty state để tạo project/workspace khi chưa có project. Toàn bộ dấu chấm là node placeholder; bấm node để chọn Prompt, Video Flow, Asset, Setup hoặc Output, chọn flow/asset cụ thể, kéo thả node bằng pointer và hoàn tác/làm lại bằng Ctrl+Z/Ctrl+Y. Các thao tác node chỉ là cấu hình canvas local; session/asset thật vẫn lấy từ state project hiện có và provider generation vẫn qua cost/rights gate.

### Tiến độ Slice 1.8 — 2026-09-10

Đã loại bỏ các chấm trống gây nhầm lẫn: canvas khởi tạo bằng node có nhãn và quy trình rõ `Prompt / Brief → Video Flow → Shot / 3D Setup → Asset / Reference → Google Flow / Omni → Output / Review`. Không còn nút `Thêm node` hoặc placeholder vô nghĩa; bấm node có nhãn để đổi loại/gắn flow/asset, kéo node để bố trí lại.

### Tiến độ Slice 1.9 — 2026-09-10

Điều chỉnh theo mô hình canvas slot: các dấu chấm khởi tạo lại là `Flow Slot` trống có hướng dẫn; bấm slot tạo `Video Flow Card` tại đúng vị trí. Flow Card hiện handle mũi tên khi hover, kéo handle sang card/node khác để tạo connection thật trên SVG canvas. Connection được đưa vào Undo/Redo snapshot cùng với vị trí và loại node; không còn tự gán sẵn node khi mở project.

## 1. Mục tiêu sản phẩm

Người dùng chỉ cần nhập chủ đề và ý tưởng của mình. Workspace phải giúp họ:

1. Biến ý tưởng thành một brief, style bible, shot list và prompt có cấu trúc.
2. Sửa prompt theo ý mình, lưu thành preset, áp dụng lại cho shot/project khác và khôi phục phiên bản cũ.
3. Chọn hoặc tái sử dụng asset/reference đã có; gắn rõ reference dùng cho identity, composition, pose, style, texture hay continuity.
4. Phác thảo shot 3D đẹp, kiểm tra camera/lens/light/layout và xem preview thật trước khi render/generate.
5. Chạy toàn bộ shot hoặc từng shot trong một workspace duy nhất, có graph phụ thuộc giữa các shot.
6. Nhìn thấy ứng dụng đang làm gì ở từng bước: tool nào chạy, input/output nào, tiến độ, thời lượng, lỗi và thao tác tiếp theo.
7. Gửi đúng dữ liệu đã duyệt sang Blender local hoặc provider AI được cấu hình. BrowserMCP chỉ là cầu nối tab Chrome; không giả vờ upload/generate khi capability không hỗ trợ.
8. Review, sửa, chạy lại có kiểm soát và ghép các output đã được kiểm tra thành video.

### Không thuộc mục tiêu của plan

- Không tự đăng nhập, lấy cookie/token, vượt CAPTCHA, tự thanh toán hoặc tự publish.
- Không coi Google Flow/Gemini/Omni là một API chắc chắn có thể điều khiển. Mỗi provider phải có adapter/capability riêng và trạng thái thật.
- Không coi bản mock/layout preview là output video thật.
- Không tự động tải custom node/model hoặc chạy shell command chứa prompt người dùng.
- Không dùng “AI agent” để bỏ qua approval, quyền asset/voice hoặc cost gate.

## 2. Quyết định UX chính

### 2.1 Một workspace, ba vùng cố định

Thay cho nhiều trang có nhiều nút không rõ tác dụng, trang `Quy trình video` trở thành workspace duy nhất:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Project / Sequence / Run status              [Draft] [Preview] [Run] │
├───────────────┬───────────────────────────────────┬─────────────────┤
│ Shot navigator│ Canvas: prompt / 3D / timeline   │ Inspector/review│
│ (ẩn/collapse  │                                    │                 │
│ mặc định)     │                                   │                 │
├───────────────┴───────────────────────────────────┴─────────────────┤
│ Workspace Console / Activity (bottom drawer, tự mở khi chạy)         │
└─────────────────────────────────────────────────────────────────────┘
```

- **Shot navigator**: mặc định thu gọn thành một mũi tên và số shot hiện tại. Mở ra mới thấy shot list, duration, state và dependency.
- **Canvas trung tâm**: một trong các mode `Brief`, `Prompt`, `Shot Composer`, `Workflow`, `Preview`, `Review`. Chuyển mode không làm mất context.
- **Inspector bên phải**: chỉ hiện dữ liệu của object đang chọn: prompt layer, asset/reference, camera, render, provider hoặc review. Các nhóm nâng cao đóng mặc định.
- **Console phía dưới**: đóng khi idle; tự mở khi có run; có filter theo shot/tool/state. Không ghi log xàm hoặc log lặp. Mỗi log phải trả lời “đang làm gì / vì sao / đầu ra / tiếp theo”.

### 2.2 Chỉ ba hành động chính

- `Soạn nháp`: phân tích brief và tạo shot/prompt draft, không gọi provider có phí.
- `Preview`: chạy composer + Blender preview/thumbnail/contact sheet theo cấu hình local.
- `Run`: chạy graph đã kiểm tra, dừng tại approval/capability/cost gate thật.

Các hành động phụ chỉ nằm trong context menu của object đang chọn: `Sửa`, `Nhân bản`, `Lưu thành preset`, `Áp dụng`, `Hoàn tác phiên bản`, `Retry`, `Cancel`, `Xem bằng chứng`, `Xóa`. Không hiển thị 10 nút độc lập cùng lúc.

### 2.3 Quy tắc phản hồi mọi nút

Theo `skills.md`, mọi click phải lập tức:

1. Disable nút hoặc chuyển sang `Đang chạy…` nếu thao tác có side effect.
2. Hiển thị toast ngắn `Đã nhận lệnh` và một dòng trong Console.
3. Cập nhật state `running`, `waiting_user`, `success`, `error` hoặc `blocked`.
4. Hiển thị output/đường dẫn/preview hoặc lý do block.
5. Cho `Hủy`, `Thử lại` hoặc `Mở chi tiết` nếu phù hợp.

Không dùng `alert` cho status bình thường. Không có button chỉ đổi một cờ nội bộ rồi im lặng.

## 3. Mô hình nghiệp vụ hợp nhất

### 3.1 Hierarchy

```text
Project
  └─ Episode (optional)
      └─ Sequence
          ├─ Style Bible / Continuity Bible
          ├─ Prompt Presets
          ├─ Asset Library / Reference Sets
          ├─ Shot 01 ──┐
          ├─ Shot 02 ──┼─ Shot Flow Graph / Timeline
          └─ Shot N  ──┘
                └─ Scene/Composer revision
                     └─ Preview / Generation jobs
                          └─ Output assets / Review decisions
```

### 3.2 Một nguồn sự thật cho mỗi loại dữ liệu

- **Brief**: mục tiêu, audience, ngôn ngữ, platform/aspect, duration, safety/rights.
- **Prompt**: prompt do user viết + prompt do AI gợi ý + prompt đã compile cho tool. Không ghi đè lẫn nhau.
- **Preset**: template có version, input variables, default values, provider constraints và license note.
- **Asset**: file đã ingest, hash, metadata, source, rights status và revision.
- **Reference assignment**: asset nào dùng cho vai trò nào ở shot nào, strength/priority, start/end frame hay ingredient.
- **Scene sketch**: layout/camera/light/subject/animation blockout, serializable và versioned.
- **Job**: một lần thực thi bất biến, có input snapshot, attempt, tool, output validation và cost evidence.
- **Review**: quyết định của người dùng gắn với revision/output cụ thể; sửa dữ liệu tạo revision mới, không sửa lịch sử.

### 3.3 State machine cấp workspace

```text
empty
 → brief_draft
 → storyboard_draft
 → prompt_ready
 → composer_ready
 → preview_running
 → preview_ready
 → needs_review
 → approved
 → queued
 → running
 → waiting_user / blocked
 → succeeded
 → failed / cancelled
```

Quy tắc:

- `failed` không được tự chuyển thành `success`.
- `approved` luôn chỉ rõ approved revision và người/thời điểm duyệt.
- Sửa prompt/asset/reference/camera sau approval làm revision mới và trả shot về `needs_review`.
- `Run` chỉ nhận graph acyclic, input tồn tại, provider capability đủ, quyền asset hợp lệ và cost gate đã qua.
- Restart app phải khôi phục job đang `running` thành `reconciling`, sau đó `succeeded`, `failed` hoặc `waiting_user` bằng evidence thật; không tạo output giả.

## 4. Prompt Studio — prompt của chính người dùng là trung tâm

### 4.1 Các lớp prompt

Mỗi shot có 5 lớp, hiển thị tách biệt nhưng có nút `Xem prompt cuối`:

1. **User intent** — câu/ý tưởng gốc, không bị AI sửa.
2. **Scene facts** — subject, action, environment, time, continuity anchors.
3. **Cinematic direction** — shot size, camera move, lens, composition, lighting, material, motion.
4. **Provider adapter** — cú pháp riêng cho Blender/Comfy/Flow/Gemini/adapter khác.
5. **Negative/constraints** — no text, no logo, no extra objects, no flicker, safety/rights constraints.

AI chỉ được đề xuất lớp 2–3 hoặc diff. Người dùng có thể `Chấp nhận`, `Sửa`, `Giữ prompt gốc` hoặc `Khôi phục`. Không giấu prompt cuối trong textarea ngắn.

### 4.2 Prompt editor

- Editor nhiều dòng có height tối thiểu 280px, resize được.
- Tabs: `Viết`, `Cấu trúc`, `Diff`, `Compiled prompt`, `History`.
- Token/field chips cho subject/action/camera/light/look/continuity/negative.
- `Tạo gợi ý` chỉ tạo draft, không tự gửi provider.
- `Dịch/chuẩn hóa` tạo version mới, giữ nguyên bản gốc.
- Hiển thị cảnh báo khi prompt thiếu field quan trọng, nhưng không bắt người dùng tick checklist vô nghĩa.
- Có `Save draft`, `Save as preset`, `Apply preset`, `Duplicate`, `Archive`, `Restore version`.

### 4.3 Preset CRUD

`PromptPreset` phải có:

- `id`, `name`, `description`, `scope` (`user/project/sequence`), `status` (`draft/active/archived`).
- `template`, `variables[]`, `defaults`, `providerTargets[]`, `styleBibleId?`, `negativeTemplate`.
- `version`, `parentPresetId?`, `createdAt`, `updatedAt`, `createdBy`.
- `rights/licenseNote` nếu preset chứa style/asset/reference từ nguồn ngoài.

CRUD UX:

- Create: từ prompt đang dùng hoặc từ thư viện preset.
- Read: preview template và ví dụ compiled output trước khi apply.
- Update: tạo version mới; không sửa ngược shot đã render.
- Delete: archive trước; xóa vĩnh viễn chỉ khi không có job/review tham chiếu và có confirm.
- Apply: preview diff `before/after`, chọn apply cho shot hiện tại hoặc các shot được chọn.

## 5. Asset Library và reference workflow

### 5.1 Asset types

`image`, `video`, `audio`, `voice`, `model3d`, `scene`, `texture`, `sketch`, `render`, `subtitle`, `proxy`.

Mỗi asset có preview phù hợp, local path trong workspace, SHA-256, MIME, dimensions/duration, source URI, import time, derivative links, rights record và status `ready/quarantined/missing/archived`.

### 5.2 Reference Set

Một `ReferenceSet` là nhóm continuity cho một sequence/character/object/world:

- identity reference;
- composition/layout reference;
- pose/action reference;
- camera/lens reference;
- style/color/material reference;
- start frame/end frame;
- negative/avoid reference.

Mỗi assignment có `strength`, `priority`, `shotRange`, `crop`, `notes`, `approved` và hash asset. Khi đổi reference, shot phải tạo revision và hiển thị continuity impact.

### 5.3 Asset CRUD và quyền

- `Import`: chọn file, kiểm tra path containment, MIME/size/hash, tạo quarantine rồi ingest.
- `Attach`: gắn asset vào project/sequence/shot/reference role.
- `Replace`: giữ revision cũ; preview diff và chạy lại continuity check.
- `Detach`: không xóa file nếu còn reference/job.
- `Archive/Delete`: chỉ archive mặc định; xóa cần không còn tham chiếu và confirm.
- `Metadata`: sửa title/tags/role/note, không cho sửa hash/path evidence.
- `Rights`: source/license/permission/attribution/expiry/likeness/music flags; chưa clear thì block provider/publish theo policy.

## 6. Shot Composer và phác thảo 3D

### 6.1 Mục tiêu

Composer không cố làm full Blender. Nó là layout/blockout có thể đọc được bởi người và compiler Blender/provider:

- subject cards và placeholder mesh;
- primitive/low-poly proxy, scale, position, rotation;
- camera path, focal length, DOF, framing guides;
- key light/fill/rim, color temperature, fog/volumetric intent;
- action path, pose markers, timing curve;
- foreground/midground/background layers;
- continuity anchors được khóa từ sequence bible;
- annotations/arrow/sketch overlay;
- camera preview, top/front/side view và contact sheet.

### 6.2 Chế độ preview

1. **2D sketch**: canvas nhanh, vẽ/đánh dấu composition.
2. **3D blockout**: WebGL viewport với primitive/asset proxy; dữ liệu lưu scene graph có version.
3. **Blender preview**: scene/script versioned, Workbench/material preview, PNG/contact sheet/MP4 ngắn thật.
4. **Provider preview**: ảnh/video trả về từ adapter; không hiển thị placeholder là thành công.

Nút chính là `Preview shot`. Panel sẽ cho biết phase hiện tại và output. `Open Blender` chỉ mở file/preview đã tồn tại; không gọi Blender ngầm mà không log.

### 6.3 Gán ảnh để tái tạo

Flow:

`Import image → classify/reference role → attach to shot → compile provider payload → preview prompt/ingredients/frames → approval → run provider`.

Với Google Flow, adapter phải biểu diễn được ingredients, start/end frames và text prompt theo khả năng hiện có; nếu BrowserMCP không hỗ trợ upload/download thì chuyển sang một trạng thái `waiting_user` duy nhất với hướng dẫn cụ thể, không tạo ba nút approval rời.

## 7. Workflow graph nối các shot

### 7.1 Node types

- `brief.parse`
- `storyboard.expand`
- `prompt.compile`
- `asset.ingest`
- `reference.assign`
- `composer.build`
- `blender.scene.build`
- `blender.render.preview`
- `provider.image.generate`
- `provider.video.generate`
- `browser.connection.check`
- `browser.flow.handoff`
- `media.probe`
- `continuity.check`
- `review.gate`
- `timeline.assemble`
- `delivery.validate`

Mỗi node có input/output schema, executor, timeout, cancellation, retry policy, cost estimate, approval policy và output validators.

### 7.2 Shot graph

Mỗi shot là một subgraph. Sequence graph nối shot theo:

- `dependsOn`: shot sau chờ output/approval của shot trước;
- `carryContinuity`: subject/world/style/reference được truyền;
- `matchCut`: camera/action/frame anchors;
- `parallelGroup`: các shot độc lập có thể chạy song song;
- `fallback`: local Blender preview khi provider web bị block.

Graph editor hiển thị dependency và “vì sao đang chờ”. Cho phép kéo node, sửa config, duplicate branch, disable node với lý do. Không cho cycle; validator chỉ rõ cạnh gây cycle.

### 7.3 Run modes

- `Draft only`: tạo plan/prompt, không render/generate.
- `Preview selected`: chạy một shot local.
- `Preview sequence`: chạy contact sheet/low-res cho các shot.
- `Run approved`: chỉ chạy nodes đủ approval/capability.
- `Retry failed`: chỉ retry node idempotent, với bounded attempts.
- `Resume`: tiếp tục run đã dừng sau khi user xử lý blocker.

## 8. Workflow console và log thật

### 8.1 Event schema tối thiểu

```json
{
  "runId": "run-…",
  "eventId": "evt-…",
  "timestamp": "2026-09-06T00:00:00Z",
  "shotId": "shot-…",
  "nodeId": "blender.render.preview",
  "stage": "render_preview",
  "tool": "Blender",
  "state": "running|success|waiting_user|failed|cancelled|blocked",
  "message": "Đang dựng scene 3D preview",
  "progress": 0.45,
  "elapsedMs": 18400,
  "inputSummary": {"revision":"rev-…","assetCount":3},
  "outputSummary": {"path":"outputs/…","mime":"image/png"},
  "errorCode": null,
  "nextAction": "Xem preview"
}
```

Không ghi prompt/raw media/secret vào log mặc định. Raw prompt và evidence nằm ở artifact path có access control/retention phù hợp.

### 8.2 Hiển thị

- Dòng mới nhất ở trên, group theo run/shot/node.
- Một dòng summary dễ hiểu + expandable technical detail.
- Progress là của node thực tế; nếu tool không có progress thì hiển thị spinner + elapsed, không bịa phần trăm.
- `waiting_user` có câu hỏi và một hành động duy nhất.
- `failed` có error code, stderr đã sanitize, output bị loại vì sao, retryability và next action.
- Console giữ history sau restart; filter `Tất cả / Blender / FFmpeg / FFprobe / BrowserMCP / Provider / lỗi`.

## 9. Provider và BrowserMCP boundary

### 9.1 Blender local

Blender là đường dựng/preview xác định trên máy:

- compile scene từ `SceneSketch` + `Shot` + references;
- chạy job types đã được allowlist;
- ghi `.blend`, script version, manifest, preview/contact sheet và metadata;
- kiểm tra file thật, frame range, dimensions, MIME, hash và FFprobe nếu có video.

DeprecationWarning không được coi là failure; exit code 0 nhưng thiếu output vẫn là failure. Ngược lại, warning phải hiện trong technical log nhưng không làm UI báo “không tạo được” nếu output hợp lệ.

### 9.2 AI image/video adapters

Adapter interface chung:

```text
estimate(input) -> cost/capability/approval requirement
prepare(input snapshot) -> provider payload + evidence
submit(payload) -> provider job id
poll(job id) -> status/progress/usage
collect(job id) -> local artifact
validate(artifact) -> media evidence
cancel(job id)
```

Provider profile phải khai báo text/image/video, reference ingredients, start/end frames, max duration, aspect, rate/cost, region, license and whether API/BrowserMCP/manual is supported.

OmniVoice chỉ là voice/TTS adapter, không được dùng tên “Omni” cho image/video nếu chưa có provider capability xác thực. Nếu người dùng muốn “Omni tự chỉnh” thì phải chọn đúng provider profile và nhìn thấy capability; nếu không có profile thì block rõ ràng.

### 9.3 Browser Handoff

Giữ đúng plan 018:

- Browser Handoff page chỉ là `Connection Center`.
- Một lần kiểm tra connection, runtime capability và target tab.
- Không chọn asset, không nhập prompt, không tạo handoff pack, không duyệt upload/generate ở page này.
- Main workspace tạo pack từ shot revision đã chọn và gọi connection saved.
- BrowserMCP không tự claim upload/download nếu package/runtime không expose tool.
- Mọi bước unsupported chuyển thành `waiting_user` với “bấm ở tab Google Flow” và `Continue` sau đó.

## 10. CRUD matrix

| Entity | Create | Read | Update | Delete/Archive | Version/Impact |
|---|---|---|---|---|---|
| Project/Sequence | wizard hoặc duplicate | dashboard | metadata/settings | archive | không làm mất output |
| Shot | từ storyboard/manual/duplicate | navigator/canvas | prompt, timing, composer | archive nếu không trong timeline | revision + review reset |
| PromptPreset | từ editor/library | preview compiled | tạo version mới | archive | không sửa lịch sử |
| Asset | import/derive/render | library/preview | metadata/role | detach/archive/delete safe | hash bất biến |
| ReferenceSet | nhóm asset | continuity panel | assignments/strength | archive | shot impact report |
| SceneSketch | blank/from shot/from image | 2D/3D canvas | layout/camera/light | archive | compile revision |
| WorkflowRecipe | template/duplicate | graph view | node config | archive | schema/version validate |
| Job/Attempt | Draft/Preview/Run | console/evidence | cancel/reconcile | không xóa evidence | idempotency key |
| ReviewDecision | approve/reject/request change | review rail | supersede | immutable | gắn revision/output |
| ProviderProfile | local/configured adapter | capabilities | config non-secret | disable | capability audit |
| RightsRecord | import/source/voice | rights panel | evidence/status | archive | gate impact |

## 11. Contract và persistence cần bổ sung

Không sửa semantics cũ nếu chưa migrate. Tạo schema version mới và migration additive:

- `prompt-document.schema.json`: 5 prompt layers, source, compiled output, variables, version.
- `prompt-preset.schema.json`: CRUD/version/scope/provider target.
- `reference-set.schema.json`: asset role/strength/shot range/continuity.
- `scene-sketch.schema.json`: scene graph, camera, lights, paths, annotations, preview refs.
- `shot-workspace.schema.json`: selected mode, selected shot, panel state, saved filters, last run.
- `shot-flow-graph.schema.json`: nodes/edges, dependencies, retry/approval policy.
- `workflow-run.schema.json`: run snapshot, state transitions, idempotency, cost gate.
- `activity-event.schema.json`: event model above, sanitized logs.
- `review-decision.schema.json`: revision/output/actor/decision/comment.
- Extend existing `project`, `shot`, `asset`, `job`, `execution-attempt`, `browser-handoff`, `provider-profile`, `provider-request/result`, `rights-record` with optional references to the new records.

Persistence rules:

- Source JSON/SQLite remains local-first; no credential/API key/cookie in records.
- Every generated output points to a versioned workspace-relative path and hash.
- UI state (open panels/selected shot) is separate from production state (revision/job/review).
- Delete uses archive/tombstone so old evidence can still be read.

## 12. Implementation slices

### Slice 0 — Contract and UX foundation

Allowed scope: plan/contracts/docs and shared state types.

- Add schemas/migrations and state transition table.
- Define `ActivityEvent` and `WorkflowRun` reducer.
- Add a single workspace shell with collapsed navigator and bottom console.
- Keep existing page routes working behind the shell.

Exit: validator rejects invalid transition/cycle; existing build stays green.

### Slice 1 — Prompt Studio + preset CRUD

- Move long prompt editing to the center canvas.
- Add prompt layers, diff, compiled preview and history.
- Implement preset create/read/update/archive/apply/duplicate.
- Every action emits activity event and has failure state.

Exit: edit a user prompt → save version → apply preset to two shots → verify exact prompt snapshots.

### Slice 2 — Asset library + reference sets

- Add local import/quarantine/hash/probe.
- Add asset browser, metadata edit, role assignment, archive/restore.
- Add ReferenceSet and continuity impact.

Exit: imported image is previewable, hashable, rights-visible, assignable to a shot and preserved through a revision.

### Slice 3 — 3D Composer vertical slice

- Add scene sketch schema and canvas/blockout editor.
- Compile one shot to versioned Blender scene/script.
- Run real Blender preview, output validation and contact sheet.
- Show preview in review rail and console.

Exit: one shot goes from prompt/reference → blockout → Blender PNG/contact sheet/scene file with evidence.

### Slice 4 — Multi-shot flow graph + console

- Add sequence graph, dependencies, parallel groups, resume/cancel/retry.
- Add durable event stream and restart recovery.
- Replace repeated “Chưa chạy preview brief” messages with actual stage-specific events.

Exit: three shots show dependencies, one failure blocks only dependent nodes, retry is bounded and logs exact reason.

### Slice 5 — Provider adapters and web connection

- Add provider capability registry and estimate/approval gate.
- Integrate local/approved image provider first.
- Reuse BrowserMCP saved connection for the main run; no prompt/asset UI in Browser Handoff.
- Implement one `waiting_user` path for unsupported upload/download.

Exit: provider run cannot be marked successful without actual output validation; disconnected/unsupported web flow is actionable.

### Slice 6 — Timeline/review/delivery

- Assemble approved shot outputs with integer-frame timeline source of truth.
- FFmpeg/FFprobe validation, audio/subtitle tracks, final review and evidence.
- Delivery remains human-reviewed and rights-gated.

Exit: final MP4 has actual duration/codec/frame evidence and a review package; no publish claim.

## 13. Failure, retry và recovery rules

- BrowserMCP server fails to start: show executable/config/path error and a `Kiểm tra cấu hình` action; no fake connected state.
- WebSocket closes: preserve run as `waiting_user` or `failed` with reconnect action; do not reset all fields.
- Blender exits 0 with missing output: fail validation and show expected/actual paths.
- FFmpeg/FFprobe missing or incompatible: block only final media steps; show install/config path, not a generic “failed”.
- Provider timeout: poll within deadline, then mark `failed/retryable`; never infinite retry.
- User edits while run is active: create draft revision; active job continues with immutable snapshot; new run required to use edits.
- Missing asset/reference: mark exact shot/node blocked; show attach/import action.
- Rights incomplete: block external generation/delivery where policy requires; allow local draft/preview if safe.

## 14. Test and validation matrix

### Unit/contract

- Schema validation for create/update/archive/version transitions.
- Prompt compile is deterministic for same snapshot/provider profile.
- Asset path containment, MIME/size/hash and quarantine.
- Graph acyclicity, dependency propagation and idempotency.
- Activity event redaction does not leak secrets/raw credentials.

### Integration

- Brief → storyboard → prompt edit → preset apply → scene sketch → Blender preview.
- Blender warning with valid output is success-with-warning; missing output is failure.
- FFmpeg/FFprobe command allowlist, bounded timeout, output validation.
- BrowserMCP disconnected/connected/unsupported upload/unsupported download/WS close.
- Restart during running job and resume/reconcile.

### UI click-through

- Every visible button has loading/disabled/result/error behavior.
- Collapse left navigator and console; restore selection after reload.
- Long prompt remains readable; right review rail updates selected shot.
- `Draft`, `Preview`, `Run` show the right scope and do not mutate unrelated shots.

### Required commands per implementation slice

- `pnpm build` in `desktop`.
- `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml`.
- `cargo check --lib --manifest-path desktop/src-tauri/Cargo.toml`.
- `python scripts/validate_project.py --project .`.
- Targeted Rust/TypeScript/schema tests for the slice.
- Manual click-through evidence with output paths and sanitized console log.

## 15. Research decisions from comparable tools

- **Spline**: take the ideas of a browser scene editor, editable results, scene/interactivity modes and version history. We keep the local-first/offline-safe boundary and do not copy proprietary implementation.
- **Vectary**: take variants/materials, scene configuration and interactive object-level controls; use them for reference/asset variants and shot continuity rather than a general product configurator.
- **Meshy**: take text-to-3D/image-to-3D as optional asset provider adapters, with upload/type/size/cost/license checks and local artifact validation.
- **Google Flow**: model ingredients, character/object references and start/end frames as explicit reference roles. The app must show the exact payload and capability before any browser-side action.

Sources:

- Spline docs: https://docs.spline.design/ and version history https://docs.spline.design/designing-in-3-d/scenes/version-history
- Vectary docs: https://help.vectary.com/ and interactive elements https://help.vectary.com/documentation/design-process/design-mode/interactive-elements
- Meshy image-to-3D guide: https://help.meshy.ai/en/articles/9996860-how-to-use-meshy-image-to-3d
- Meshy API capabilities: https://www.meshy.ai/api
- Google Flow help: https://support.google.com/flow/answer/16353334?hl=en

## 16. Rights, cost and safety

- Local Blender/2D preview can remain free/local subject to installed dependencies.
- Provider generation must show estimate, provider, model, expected outputs and approval before paid work.
- Asset/voice/reference source and license are part of the record; “found online” is not a rights status.
- Voice likeness and cloned voice remain human-reviewed; only samples with permission may be used.
- Google web automation is not a credential store and is not a bypass for provider policy.
- No output is called publishable, monetizable or legally compliant without human review of quality, rights, safety, accessibility and platform rules.

## 17. Definition of done for the whole workspace

The workspace is considered complete only when:

1. User prompt, preset, asset, reference, scene, shot, job and review all have explicit CRUD/version semantics.
2. A three-shot sequence can run through the same workspace with visible dependencies and real previews.
3. Every button reports action, progress/result or exact blocker.
4. Console evidence survives restart and does not leak secrets.
5. Blender/FFmpeg/FFprobe/provider outputs are validated from actual files, not exit code alone.
6. Browser Handoff is connection-only and the main workflow reuses that connection truthfully.
7. Failure paths, bounded retries, cancellation and recovery are tested.
8. Rights/cost gates and human review remain visible.

## Next action

Slice 0, Slice 1 and Slice 2 are implemented and validated. Proceed to **Slice 3**: the 3D Composer vertical slice, reusing the persisted asset/reference hashes and the same workspace activity console. Do not add provider automation until the local Blender preview has real output validation.

## Implementation notes

### Slice 0 — completed 2026-09-06

- Added the collapsed workspace shell, context bar and live activity console.
- Wired brief preview, storyboard generation, Blender preview/render and BrowserMCP handoff preparation to explicit activity events with running/success/error/blocked states.
- Validation: frontend build, native check and project validator passed.

### Slice 1 — completed 2026-09-06

- Added `contracts/prompt-preset.schema.json` and migration `0006_prompt_presets.sql`.
- Added project-local Prompt Studio with long-form prompt editing, declared variables, negative constraints, provider targets and rights/license note.
- Added persistent create/read/update/archive/restore commands. Updating creates a new version linked by `parentPresetId`; an unchanged version is automatically bumped at patch level.
- Applying a preset compiles the current brief variables into the additional prompt without calling a provider. Save, update, archive, restore and apply all report to the workspace activity console.
- Validation: `pnpm build`, `cargo test --lib` (52 passed, 4 ignored), migration smoke test and project validator passed.

### Slice 2 — completed 2026-09-06

- Added `contracts/reference-set.schema.json` and migration `0007_asset_reference_workflow.sql` with project-local asset, reference-set and assignment tables.
- Added real native CRUD for asset import/hash/path containment, MIME and size checks, quarantine by rights state, metadata updates, archive/restore and SHA capture on reference assignment.
- Added Asset Library and Reference Set workspace panel with import, metadata/rights editor, set CRUD, role/strength/priority/shot assignment and detach actions. Every action reports running/success/error state in the existing workspace activity console.
- Validation: `pnpm build`, `cargo test --lib` (52 passed, 4 ignored), `cargo check --lib`, migration smoke test and project validator passed.

### Slice 2.5 — simplified one-prompt entry flow — completed 2026-09-06

- Changed the default `Quy trình video` surface to one primary prompt: the user no longer chooses profile, recipe, render engine or shot count before the first run.
- Moved Prompt Studio, Asset Library/Reference Sets, detailed legacy storyboard controls and Recipe Catalog behind `Mở quản lý nâng cao`; CRUD remains available without cluttering the happy path.
- Added optional local reference-image attachment. The app imports, hashes and records the image, then passes a bounded `referenceContext` into the local script worker so generated visual prompts preserve the reference subject, palette and composition cues.
- Added a compact workflow result: generated shot rail, editable narration/visual prompt/overlay for the selected shot, a Blender storyboard contact sheet with one still per shot, and a real activity console that opens while work is running. Blender is now reference-only on the happy path; Google Omni receives the storyboard images plus the shot prompts for final video generation. Local MP4 export remains an explicit advanced action, not a required preview step.
- Validation: `pnpm build`, `cargo check --lib`, `cargo test --lib` (53 passed, 4 ignored), local worker tests (21 passed) and project validator passed.

### Slice 2.6 — prompt-grounded 3D blockout and Omni handoff — completed 2026-09-06

- Extended the deterministic local planner with scene archetype selection and a structured 3D prompt bible: world, hero subject, timed action beat, camera/lens, material, lighting, continuity and negative constraints.
- Replaced the generic sphere/orbit Blender placeholder with bounded procedural blockouts for underwater/submersible, ancient architecture, cyberpunk city, space and generic cinematic prompts. The scene manifest records `sceneMode`, intentional visual asset objects and `blockoutOnly=true`.
- Added a compact, all-shot Google Flow/Omni handoff prompt generated from the approved script and Blender output. It explicitly tells Omni to rebuild final-quality visuals from the blockout and does not claim that BrowserMCP uploaded or generated media.
- Validation: `pnpm build`, `cargo check --lib`, local worker tests (23 passed), Python syntax checks, and direct Blender 5.2.1 storyboard render (6 shot images plus contact sheet; no MP4 required for Omni handoff). The earlier 900-frame MP4 path remains optional and is not used as the handoff reference.

### Slice 2.7 — semantic storyboard + optional Gemini still pass — completed 2026-09-07

- Replaced the default detailed scene proxy with a semantic Blender storyboard. Every primitive carries `semantic_role`, `semantic_label`, `omni_prompt`, shot/beat identity and an explicit “replace this primitive” instruction in the scene/edit-plan manifest.
- Added beat-state changes so establish/action/reveal/resolve are visibly different composition anchors instead of repeated camera views of one hero mesh. Blender output is explicitly `semantic_blockout`, not a final video or beauty render.
- Added an optional Gemini storyboard pack action. The app prepares a bounded `gemini.google.com` handoff containing the semantic boards and per-shot prompts; the user generates/downloads stills in Gemini, then imports multiple local images into the asset library with SHA-256 and pending rights review. Imported Gemini stills are attached to the later Omni handoff alongside Blender boards and user references.
- BrowserMCP remains approval-gated: no automatic login, upload, Generate click or download is claimed because the installed tool surface does not expose those file actions.
