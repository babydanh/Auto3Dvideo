# PLAN-025 — Google Flow per-shot automation, prompt revision and grounded Blender

## Status

`IN_PROGRESS / NEEDS_HUMAN_REVIEW`

## 2026-09-15 BrowserOS GitHub backend checkpoint

### 2026-09-16 BrowserOS model-selection gate fix

- The BrowserOS path already owns Flow composer inspection and Nano Banana model
  selection, but `inspect_google_flow_dom_output` performed the legacy Chrome CDP
  9222 preflight before branching to BrowserOS. This falsely blocked a healthy
  BrowserOS session with the message that MCP 9009 cannot replace CDP.
- The CDP preflight is now restricted to the legacy Chrome/Playwright fallback;
  BrowserOS goes directly through `flow_select_model` and remains fail-closed on
  missing composer/model/Save evidence. No generation or credit-spending action
  is implied by the fix.

### 2026-09-16 BrowserOS snapshot/DOM picker recovery

- The live Flow failure showed `Agent settings` and `Start generation` in the
  BrowserOS snapshot but omitted the image model picker. The worker now keeps
  the snapshot-first gate, then performs a bounded DOM/shadow-DOM lookup for
  the specifically labeled Agent settings/model/x1/Save controls when the
  accessibility ref is missing. It does not infer a picker from page text or
  use coordinates, and it remains blocked if the exact control or selected
  model cannot be verified.
- The recovery is limited to model configuration; it never types a prompt or
  clicks Generate. Model selection is confirmed from the exact picker label
  before the existing x1 and Save gates continue.

### 2026-09-16 BrowserOS Flow picker recovery

- Flow can expose the live image composer with a `Settings` ref and render the
  `Image generation default model` control only after that panel is opened. The
  worker now refreshes the DOM/snapshot after opening the composer, clicks or
  presses Enter on a fresh Settings ref when needed, accepts Flow's nonstandard
  accessibility role for the picker, and waits through the bounded render
  window before blocking.
- A live BrowserOS run verified `Nano Banana Pro`, `x1`, and `Save` with one
  persistent Flow tab. This is model-readiness evidence only; it does not run a
  paid generation job.

- The official `browseros-ai/BrowserOS` GitHub release `v0.50.3` was verified
  by its published SHA-256 and installed system-level at
  `C:\Program Files\BrowserOS`. The per-user installer path was not used for
  runtime because Windows marked its `Application` payload EFS-encrypted and
  Chromium failed before startup with a Side-by-Side assembly error.
- The GitHub BrowserOS server is live and its MCP proxy is verified at
  `127.0.0.1:9000/mcp`; its CDP endpoint is `127.0.0.1:9101`. The adapter now
  defaults to port 9000 while retaining an explicit
  `AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT` override for BrowserOS neo on 9010.
- The adapter accepts both JSON and SSE JSON-RPC responses, supports the
  stateless GitHub server (no transport session header), omits null tool
  session arguments, and uses the GitHub snapshot schema without neo-only
  `mode`/`depth` fields.
- BrowserOS state now persists its MCP endpoint and automatically discards a
  legacy neo session/page when the standard GitHub bridge on port 9000 is
  selected; page ids are bridge/profile scoped and must be reacquired from
  the current tab list.
- BrowserOS is currently stopped at its first-run onboarding/profile gate:
  the MCP server reports `No profile available`, so a human must finish the
  visible BrowserOS onboarding once before Flow can be opened and tested.
- The active Google Flow DOM/action commands now route through the bounded
  `browseros_flow_worker.mjs` adapter: inspect composer/output, select Nano
  Banana Pro, type the shot prompt, click Generate and download the exact
  current-shot image. The legacy Nano Banana batch/Chrome CDP command is
  explicitly blocked while BrowserOS is enabled; there is no silent fallback.
- BrowserOS downloads are copied into the project run first, validated as
  PNG/JPEG/WebP, then copied into the existing Downloads/import boundary so
  the shot runner can hash/import only a newly-created file.
- The BrowserOS profile is currently unauthenticated and redirects the test
  project to `/about`; this is a real external-state gate. The user must sign
  into Google Flow once in the visible BrowserOS neo profile before a paid
  generation/download smoke test can be run.
- Screenshot/vision is not used as proof of action: this BrowserOS build can
  report a zero-sized screenshot viewport, so the adapter uses fresh
  accessibility DOM refs and fixed DOM-state reads. If DOM does not prove the
  composer, batch identity or fresh file, it remains blocked.
- The old Tauri startup bootstrap was still calling `ensure_chrome_cdp_session`,
  which explained the stray Chrome for Testing window even after the backend
  switch. The bootstrap and Connection Center now call BrowserOS MCP session
  discovery instead; the legacy Chrome window was closed and a live process
  check confirmed BrowserOS remains running with no legacy CDP process.

### Click recovery for Angular Material controls

- BrowserOS can reject a valid semantic click when the center point of a Flow
  link/button is hit-tested against its own `<span.mat-focus-indicator>` child.
  The runtime now permits one bounded recovery: press `Enter` on the same
  accessibility ref and require the resulting BrowserOS action response before
  continuing.
- This recovery is narrowly matched to the reported Material child overlay. A
  modal backdrop, consent surface, sticky banner or any other covering element
  remains blocked and is never dismissed automatically. The report records
  `interactionRecovery=enter_after_benign_material_overlay` when the fallback
  succeeds.

## 2026-09-14 Flow image download reliability fix

- Flow có thể trả download filename là UUID không có đuôi ảnh dù payload là PNG/JPEG/WebP.
  Playwright phải kiểm tra magic bytes sau khi lưu file tạm và tự gắn đuôi allowlist trước
  khi quét file mới/hash/import; không được chặn hợp lệ chỉ vì suggested filename thiếu suffix.
- The failure mode reported from the live Flow tab was narrowed to the image
  download bridge: the DOM worker used `HTMLElement.click()` on the Nano Banana
  batch control. That can change the page state without starting a real browser
  download, so the next deterministic Downloads scan found no new file and the
  per-shot runner correctly stopped at `FLOW_IMAGE_DOWNLOAD_TIMEOUT`.
- The worker now traverses Flow component shadow roots, requires an exact
  `SHOT_ID` + `REVISION_ID` batch match, scrolls the matched control into view and
  sends a trusted CDP pointer sequence. The outer runner still requires a fresh
  image file in the user Downloads folder, local copy, hash and Asset Library
  import before advancing to the next shot.
- This does not automate login, CAPTCHA, credit approval or publishing. If Flow
  changes its DOM or does not expose the identity text in a batch card, the run
  remains blocked rather than importing an unrelated image.

## 2026-09-14 Playwright + CDP Flow browser-agent route

- Added `playwright-core` as a desktop runtime dependency and a separate
  `playwright_flow_worker.mjs` adapter. The worker connects only to the local
  Chrome CDP endpoint and only selects the pinned `flow.google.com/project/<id>`
  tab; it does not read cookies, credentials or `.env` files.
- The adapter exposes four bounded operations: `observe` (controls,
  Accessibility tree, DOMSnapshot and screenshot), `type_prompt`,
  `click_generate` and `download_image`. Locators pierce open Flow shadow roots;
  download success requires a real Playwright download event plus a non-empty
  new image in the user Downloads folder.
- The active per-shot image path uses this adapter for the exact image composer
  when deterministic BrowserMCP refs are unreliable. BrowserMCP remains the
  discovery/session owner and the native import path still hashes, validates and
  registers the downloaded image before advancing to the next shot.
- `run_google_flow_playwright_action` runs through the Rust allowlisted Node
  executor, writes an auditable spec/report/screenshot under the run directory,
  and blocks unsupported modes, ambiguous batch identity, missing CDP, missing
  `playwright-core`, credential-shaped prompt text, stale output and timeout.
  Its native report shape is documented in
  `contracts/browser-flow-playwright-report.schema.json`.
- No live Generate or Download side-effect was used as a validation shortcut in
  this implementation pass. Human review remains required for Flow login,
  CAPTCHA, credits/paid generation, rights, creative quality and publishing.

## 2026-09-13 Browser Flow model-planner checkpoint

- Added a bounded `vision_browser` planner path. A fresh BrowserMCP accessibility
  snapshot, roadmap state and current project identity are sent to the configured
  model; the model may return one action only (`click`, `type`, `wait`, `snapshot` or
  `stop`) using the contract in `contracts/browser-flow-agent-action.schema.json`.
- Rust validates the action against the current UI refs, the pinned Flow project and
  the prompt/control allowlist before calling BrowserMCP. Page labels and provider
  responses are treated as untrusted data; the model cannot invent refs, type
  credentials or execute arbitrary browser operations.
- The planner is used as an adaptive fallback when deterministic Flow recognition
  cannot identify the current composer, prompt field or Generate control. Polling and
  output/download validation remain deterministic so a model response or a click is
  never treated as a completed video.
- A fresh snapshot with `waiting_user` status is still eligible for planner inspection
  when BrowserMCP has an attached session and non-empty current UI refs. Only a missing
  session or empty snapshot blocks the planner; this prevents `BLOCKED_CHAT_ROUTE` from
  short-circuiting the model before it can open the real Flow composer.
- Missing model credentials, invalid JSON, stale refs, credit gates and absent output
  remain explicit blockers. Paid generation, rights review and final creative review
  remain human gates.

## Implemented checkpoint (2026-09-12)

- Runtime role instructions are loaded from `configs/role-skills.cinematic-3d.json` by the
  local script worker and their SHA-256 prefix is recorded in `promptVersion`.
- The active Studio Flow path now has a sequential per-shot runner. It uses fresh UI refs,
  fresh click evidence, explicit Download/Export controls, a newly-created Downloads file,
  FFprobe validation and shot-scoped import metadata (`runId`, `shotId`, `revisionId`,
  `inputHash`). Existing imported evidence is reconciled before a shot is regenerated.
- Imported shot outputs can be composed through the allowlisted FFmpeg/FFprobe boundary into
  a versioned workflow output; the compose command refuses missing shot evidence and refuses
  to overwrite an existing output.
- The selected-shot editor now supports a prompt revision that preserves the previous output,
  assigns a revision ID and reruns only missing/new-hash shot evidence. This is currently
  shot-scoped; time-range editing and pasted-image hashing remain follow-up work.
- Blender previs reports `heroBinding` and explicitly distinguishes a missing `model3d` from
  a reference image or semantic proxy. The proxy remains labelled as previs and is never
  presented as a final dinosaur/tiger model.

## Active fix checkpoint (2026-09-12)

- The Flow entry path is being changed to reacquire a fresh composer snapshot before resume,
  before the first shot and before every later shot. Historical `click_project`/`type` records
  are not authority for the current tab; homepage-to-composer acquisition is allowed only from
  an explicit current UI ref and only for the initial shot.
- The browser snapshot parser is being made more tolerant of long Flow pages so a prompt or
  Generate control below the first screenful cannot disappear solely because of a fixed line
  cutoff. It still keeps bounded ref count and label sizes.
- The visible workspace terminal is the single activity source; the lower duplicate terminal is
  being removed from the workspace panel so one run cannot show two conflicting progress views.
- Per-shot prompt submission now carries a stable `SHOT_ID|REVISION_ID` guard: a later shot may
  reuse the composer, while an exact retry or legacy ambiguous record is blocked.
- Download attribution rejects more than one fresh video after a single click instead of
  selecting an arbitrary newest file.
- Nano Banana preflight now auto-launches an allowlisted Google Chrome binary with a dedicated
  local Flow CDP profile when loopback CDP `9222` is unavailable. It never closes or reuses the
  user's existing Chrome profile; the first run may still require one manual Google Flow login.

## 2026-09-12 direct Flow Nano Banana image checkpoint

The default image-reference route now uses the Nano Banana composer already present inside the
connected Google Flow project. The previous standalone Nano Banana MCP/CDP worker is retained only
for compatibility with legacy reports; the active UI no longer calls it before Flow.

- BrowserMCP recognizes the Flow image composer shown by the UI (`Nano Banana 2` and
  `Bạn muốn thay đổi gì?`) as a safe generation composer, while still rejecting the Agent/chat box.
- The Studio Flow image runner submits one shot at a time with `SHOT_ID`, `REVISION_ID` and an
  input hash, waits up to a bounded five minutes for a fresh image download, imports that file into
  the local Asset Library, then advances to the next shot in the same Flow project.
- Every Flow image/video submission also carries a unique `RUN_ID`, but `RUN_ID` is execution
  evidence only and is excluded from the resumable content hash. Resume identity is
  `SHOT_ID + REVISION_ID + stable prompt hash`; this prevents a second full-auto click from
  treating the same imported shot as new. Fresh output matching still uses the current run's
  media/download evidence, so an old Flow card cannot be mistaken for a new generation.
  Before an image run, the DOM adapter selects image batch `x1` and fail-closes if Flow cannot
  confirm that selection.
- Image output polling now measures media inside the matching identity batch instead of using
  the page-wide media count. It never falls back to a generic/stale Download ref, imports only
  after one confirmed download attempt, and fails on an ambiguous set of fresh files.

## 2026-09-17 historical Flow image reuse checkpoint

- The per-shot runner now probes the visible Flow history before typing a new prompt. The DOM
  worker derives bounded context from the image card/detail ancestors and returns a reusable
  media id only when that context explicitly contains the requested SHOT_ID and REVISION_ID;
  legacy cards that expose only a unique human label such as `Shot 5` are accepted as a bounded
  fallback.
- Exactly one proven historical card is downloaded through the existing exact-media menu path,
  imported and sent through the same Gemini visual QA/revision gate. The runner skips Generate
  for that shot; it creates a new image only when no card matches, the match is ambiguous, or
  the historical Download cannot be confirmed. A generic thumbnail or page-wide media count is
  never treated as a shot assignment.
- Full-auto resume now also advances past an already-imported same-input asset without reopening
  the per-shot confirmation modal. A migration fallback recognizes one unambiguous legacy asset
  by shot label even when its old per-run hash is stale. Human creative, rights and final delivery
  review remain required.
- If every requested shot already has a resumable local asset, full-auto completes from the
  Asset Library without requiring a new BrowserOS/Flow attachment. If only some shots exist,
  those shots are skipped before any new Generate action and only the missing shots continue.
- New browser downloads and workspace imports use stable names such as
  `flow-SHOT-001-rev-001.png`, rather than embedding a run UUID, so operators can find and audit
  shot outputs without opening the workflow JSON.
- The Flow download adapter now tolerates a virtualized/rerendered card: if the previously observed
  media id is temporarily absent, it performs one bounded exact-shot-label recovery (for example
  “Shot 5”), requires exactly one candidate, scrolls it back into view and continues through the
  same filesystem download proof. It never falls back to the first page-wide image.
- Image download import registers a `pending` Asset Library record with Google Flow provenance;
  missing output, stale Downloads, quota/credit blockers and lost UI refs remain blocked and never
  become success.
- Flow reference images are persisted up to 32 items in the resumable session because the active
  contract is one approved reference per shot (the supported script currently allows 12 shots).
  The old eight-item cache limit could drop shots 9-12 during resume and trigger duplicate work.

## 2026-09-17 BrowserOS historical Animate handoff checkpoint

- The live failure was not a missing Flow image. The video runner incorrectly
  required the current workflow's `downloadedFiles` record to contain an image
  with the current image `RUN_ID`; a resumed session can legitimately have the
  card in Flow while that transient metadata is absent. The video action now
  uses its own run ID and lets BrowserOS resolve the historical card by
  `SHOT_ID` + `REVISION_ID`.
- BrowserOS now exposes a bounded `flow_animate_image` operation. It selects a
  unique exact media card (preferring an exact revision and falling back only
  to one unique human `Shot N` label), opens the card's More options, clicks
  `Animate`, and verifies the video composer ingredient points to the same
  media ID. It fails closed on an ambiguous card or a pre-existing different
  ingredient; it never falls back to text-only video.
- The Rust action router now permits `animate_image` only through that
  BrowserOS operation. The legacy Chrome fallback remains disabled, and no
  credit-spending Generate action is implied by this checkpoint.

## 2026-09-14 approved-image-to-video handoff checkpoint

- The production order is now explicitly two-phase and shot-scoped: create exactly one x1
  reference image for a shot, import it, wait for human approval, then advance to the next
  shot. The video phase starts only after the approved reference set is available.
- The video phase reuses the same persisted Browser Flow workflow/session. It must not create a
  fresh discovery workflow after the image phase because a new workflow starts with an empty
  `downloadedFiles` list and would falsely report `0/N` references.
- For each video shot, the Playwright/CDP adapter finds the exact image batch by
  `SHOT_ID + REVISION_ID + RUN_ID`, opens the tile's native `Animate` menu, verifies the
  resulting ingredient chip points to the same media ID, and only then allows the motion
  prompt/Generate path. Text-only video fallback is blocked when the reference binding is
  missing.
- The Browser Flow asset binding limit is 32, separate from the eight-file limit used by other
 generic input routes, so a 12-shot storyboard is not truncated during discovery or resume.
- Flow does not always echo the automation `RUN_ID` in visible batch text. Before Generate, the DOM worker records visible media IDs; after Generate, the runner accepts a card without echoed `RUN_ID` only when exactly one new media ID appears after that baseline. If Flow still shows `Thinking`/`Stop`, stale-card rejection waits until generation finishes or the bounded timeout; download/import still requires a fresh file and the matching new tile.

## Problem

The current Studio Flow Agent calls a single multi-shot Flow session and treats a historical
successful click, a stale UI snapshot, or a generic media/download label as evidence that a
new generation succeeded. It can therefore stop after typing the prompt, report false
progress, scan unrelated Downloads, and never import or compose the resulting media.

The current Blender preview is a semantic primitive storyboard. Its shapes are useful for
layout, but an image reference is not a 3D model and a subject name in a prompt cannot create
an anatomically correct hero mesh. The binding must carry explicit entity, scale, camera,
action and asset-kind facts and must report a missing model instead of silently substituting a
primitive or unrelated asset.

## Scope and authority

The user-authorized `Tự làm toàn bộ` action owns generation, download and project import for
the selected project, subject to the configured budget and capability gates. It does not own
login, CAPTCHA, rights approval or publishing. A real BrowserMCP/Flow capability must be
verified from a fresh response; `connected` alone is not proof that the Flow URL or control
refs are usable.

## Target state machine

```text
run created
  → shot planned
  → prompt submitted (fresh action evidence)
  → provider acknowledged (fresh snapshot, matching run/shot/revision)
  → generating
  → output identified (fresh output ref tied to shot and run)
  → downloaded
  → validated (type/hash/duration/shot identity)
  → imported (project asset record)
  → next shot
  → composed (versioned timeline/output)
```

Every transition records `runId`, `sessionId`, `shotId`, `revisionId`, `inputHash`, action
kind, provider job evidence, output path/hash and timestamp. A retry first reconciles an
ambiguous submission by these identities and never blindly clicks Generate again.

## Implementation slices

### Slice A — Flow capability and per-shot runner

- Add typed action kinds for snapshot, submit prompt, acknowledge, poll, identify output,
  download, validate, import and compose.
- Replace historical `processes.some(...)` checks with fresh action evidence scoped to the
  current run/session/shot/revision and a new snapshot after every mutating action.
- Use one BrowserMCP/Flow owner for the whole run. Nano Banana reference work must finish or
  yield before BrowserMCP video actions start.
- Submit one shot at a time. Wait for a provider acknowledgement and an output control that
  matches the current shot/run evidence. Generic `video`, arbitrary media and unrelated
  Downloads are insufficient.
- Keep bounded polling, resume/reconcile, idempotency by input hash and exact failure states.
- Do not claim `succeeded` until output validation and project import have evidence. Compose
  only imported outputs belonging to this run and current shot list.

### Slice B — Prompt revision by shot/time range

- Add one `Sửa bằng prompt` control bound to the selected `shotId` and optional start/end
  seconds or frames.
- Accept optional pasted image reference, hash it, and create an immutable revision record.
- Mark only the selected shot and dependent compose/output nodes dirty; preserve previous output.
- Rerun the selected shot, validate it, and recompose from the prior accepted outputs plus the
  new revision. Never claim semantic intent beyond the explicit selected shot/time range.

### Slice C — Grounded Blender scene data

- Compile a structured entity/world/camera/action spec from the shot plan and identity/world
  bible. Include subject identity anchor, species, scale meters, mesh/model asset ID, reference
  hashes, camera/lens, action constraints and acceptance checks.
- Distinguish `reference_image` from `model3d`; a reference image cannot satisfy a required
  hero mesh binding.
- Make missing hero mesh, scale or identity binding a visible blocker. Keep semantic
  primitives labelled as previs only and remove stale fallback substitution.
- Preserve world/character/style bible versions and reference hashes across all shots.

## Acceptance evidence

- A run with two shots produces two distinct shot-scoped submit/ack/poll/download/import
  records and one compose record; a stale click or unrelated file cannot satisfy any step.
- A timeout, lost BrowserMCP session, login/CAPTCHA, budget block or ambiguous submission is
  `blocked`/`reconciliation_required`, never success and never an unbounded retry.
- A revision on SHOT-003 changes only SHOT-003 and its downstream compose, with the prior
  output retained.
- A Blender preview report states the actual asset kind and blocker when a model3d is absent;
  it never presents the primitive contact sheet as a final hero asset.

## Cost, rights and review

The user click authorizes the configured generation path, but budget limits remain active.
Output rights remain pending until review. No publish action is part of this plan. Creative,
continuity, rights, safety, accessibility and final delivery review remain human gates.

## 2026-09-12 bounded runtime guard update

This slice is limited to the live BrowserMCP evidence boundary. A fresh `snapshot` is now
authoritative: a JSON-RPC/tool response with no current URL and no UI refs cannot keep an old
`ATTACHED` state alive. The native stdio owner resets the shared MCP process and retries a
read-only snapshot at most once; type/click/generation actions are never retried by this guard.
Failed snapshots clear live URL/ref/project evidence, mark the workflow blocked/waiting for
the user, and record the next action as connecting BrowserMCP on the correct Flow tab.

The UI terminal/header consumes only fresh preflight/snapshot state. Restored workflow cache is
shown as unverified until a new snapshot succeeds, so a historic report cannot authorize a
provider action. No Flow generation, Nano Banana call, download, or paid operation is part of
this update.

## 2026-09-12 Flow target lock checkpoint

After the first fresh snapshot proves a `/project/<id>` URL, the workflow persists a
`pinnedBrowserTarget` containing the Flow project key and evidence URL. Subsequent snapshots
and every type/click/upload action must match that project key. A tab on another Flow project or
on the homepage is blocked as `BLOCKED_WRONG_FLOW_TARGET`; the app never creates/selects a
generic new project to recover. The workspace displays the pinned target so the user can see
which connected Flow project owns the run. Existing cached workflow state remains untrusted until
the next fresh snapshot pins or verifies the target.

## 2026-09-12 Auto Flow browser workspace controller

The desktop app now materializes a small local Chrome MV3 controller in the Auto3Dvideo CDP
profile (using `D:\Auto3DvideoTools\chrome-flow-cdp-profile` when that tools directory exists,
with the AppData path as a fallback). Keeping the controller/profile on a normal local
directory avoids Chrome Web Store unpack failures caused by encrypted AppData descendants.
When that profile is opened, the controller groups Flow tabs under
`Auto3Dvideo · GOOGLE FLOW · AUTO`, keeps the selected project tab focused, and never groups
tabs from the user's normal Chrome profile. The Connection Center exposes this as
`Mở Chrome Auto + tạo group`; BrowserMCP must be connected once on the Flow tab in that window.
The controller does not read cookies, credentials or page contents, and the existing
project-identity lock remains the final guard before type/click operations.

## 2026-09-14 Image review gate

The per-shot Flow image route now pauses after a fresh image is downloaded and imported
into Asset Library. The UI shows the exact `shotId`/`revisionId`, local image preview and
file evidence, then waits in `waiting_user`. Approval resumes the loop for the next shot;
rejection returns `blocked` with `FLOW_IMAGE_REVIEW_REJECTED`, preserving the imported file
for inspection and preventing a silent advance. Cached same-hash images use the same gate,
so a rerun cannot bypass human visual review. Final rights, continuity, safety and delivery
review remain human responsibilities.

## 2026-09-14 visual BrowserMCP closed-loop checkpoint

The bounded BrowserMCP planner now receives a fresh accessibility snapshot and
the matching BrowserMCP screenshot as a multimodal request through
`ag/gemini-3.8-flash-low`. The screenshot is read only from the current project
workspace, capped, and never includes credentials or page cookies. Rust still
validates every returned action against the fresh UI refs, project target and
operation allowlist. The desktop agent may perform at most four
observe -> one action -> observe cycles per recovery attempt and stops on a
repeated action or uncertain state. This improves UI interpretation without
turning the model into an unrestricted browser executor.

## 2026-09-15 planner roadmap protocol checkpoint

The multimodal planner is now given an explicit operating protocol in addition to
the persisted roadmap, route, current browser state, assets, files and fresh UI
refs. Each cycle is deterministic: observe fresh DOM/accessibility evidence and
the screenshot, classify the state, choose one bounded action, execute it, and
observe again. The protocol treats the DOM refs as the exact action targets and
the screenshot as visual context; stale page IDs, historical cards and prior
successful actions cannot authorize a new action.

The image phase is explicitly shot-scoped. The planner must carry the current
`SHOT_ID|REVISION_ID`, submit one prompt only, wait for that shot's generation,
identify its output, download and validate the new PNG/JPEG/WebP, pause at the
review gate, and advance only after approval. It must never paste a 12-shot brief
into one composer, click a generic/batch download, or silently switch to the next
shot after a timeout. The existing Rust action/ref, project-target, budget and
human-review guards remain authoritative; this protocol teaches the model the
roadmap without granting it broader permissions.

## 2026-09-14 per-shot Flow download checkpoint

The image route now polls the current Flow generation in short bounded intervals and refuses
to download while Flow still reports an active generation. Once the current shot has a fresh
media id, the Playwright adapter scrolls to and hovers that tile before locating Download;
if the control is hidden, it tries the tile's More options menu, the image viewer, and Flow's
custom context-menu fallback. A download is accepted only after the browser reports a completed
file with non-zero size, and the imported asset still passes the existing shot review gate
before the next prompt is submitted. Native Chrome context menus remain outside CDP control;
the adapter therefore prefers Flow's own controls and records the route used as evidence.
The media-id-bound path never scans or clicks a batch ancestor, because Flow labels that
control `Download batch` and returns an archive rather than the requested image. It only
accepts a tile-scoped download or a download exposed after opening that tile/viewer.
For the current Flow menu shape, the adapter explicitly opens `Download` and selects
`1K Original size`; it never treats the parent menu item or an archive download as an image.

## 2026-09-14 BrowserOS neo backend migration plan

### Goal and boundary

Evaluate BrowserOS neo as a separate local browser backend for the existing Google Flow
per-shot workflow. BrowserOS neo is not treated as a blind Chrome replacement: the existing
Chrome-for-Testing/CDP backend remains available until BrowserOS passes the live acceptance
checks below. No credentials, cookies, API keys or personal browser data are copied into the
repository or logs.

### Phase 1 — install and establish a separate browser session

- Use only the official signed Windows installer and record installer hash/signature in local
  evidence; keep the installer outside source-controlled files.
- Install BrowserOS neo side-by-side with Chrome. Do not overwrite the existing CDP profile.
- Open BrowserOS neo and import only the user's intended Chrome profile/session through its
  visible UI. The user completes any Google login, consent, CAPTCHA or account selection.
- Open the exact existing Google Flow project URL, not a new generic project, and verify that
  the project key matches the workflow's `pinnedBrowserTarget`.
- Open BrowserOS MCP settings and record only the loopback endpoint shape and tool health;
  never print an endpoint token or credential.

### Phase 2 — read-only capability probe before code migration

- Confirm the BrowserOS MCP endpoint can return the active tab URL, accessibility snapshot,
  DOM/search result and screenshot for the Flow project.
- Confirm it can observe the real Nano Banana composer, selected model, prompt field, submit
  state and generation state. A stale/empty snapshot is not accepted as proof of readiness.
- On an already-created Flow image only, confirm hover, opening the tile's More options menu,
  selecting `Download` → `1K Original size`, and waiting for a completed local image.
- Validate downloaded bytes as PNG/JPEG/WebP and bind the file to the current `shotId`,
  `revisionId`, Flow project key and current run ID. A batch archive, stale image or unknown
  download is a blocker.
- Do not submit a new paid generation during this phase.

### Phase 3 — bounded BrowserOS adapter

- Add a backend capability/configuration boundary with `browseros` and `chrome_cdp` modes;
  this workspace now selects `browseros` by default, while `AUTO3DVIDEO_BROWSER_BACKEND=chrome_mcp`
  remains an explicit rollback switch until live acceptance is complete.
- Implement a loopback MCP client/adapter for the minimum required operations: fresh tab
  snapshot, DOM/search, screenshot, hover, click, fill/press, bounded wait and exact file
  download. Every action must be tied to fresh refs and the pinned Flow project.
- Prefer BrowserOS `download_file` only when the observed control is tile-scoped and the file
  evidence matches the current shot. Never use a batch ancestor or accept a ZIP as an image.
- Keep the visual planner as a recovery aid only. It may propose one allowlisted action after
  a fresh observation; Rust/state validation remains authoritative and repeated/uncertain
  actions stop the run.
- Preserve the existing per-shot review gate: prompt one shot, wait for its image, download,
  import, review/approve or reject, then advance. No parallel generation loop is allowed.

### Phase 4 — live acceptance and cutover

- Run a no-generation smoke test against the existing Flow project and one existing image.
- Run a single paid/credit-consuming SHOT-001 only after the user-visible provider/budget gate
  is satisfied; verify submit, active-generation polling, fresh media ID, exact download and
  review pause.
- Run a two-shot rehearsal with bounded timeout/retry and inspect evidence. A failed BrowserOS
  action must become `blocked`/`reconciliation_required`, never success.
- Switch the default backend only after all evidence is present. Keep one-click fallback to
  Chrome CDP and expose backend/endpoint health in the UI.

### Exit criteria

BrowserOS is considered usable for Google Flow only when the read-only probe and one-shot
rehearsal both pass with fresh DOM/screenshot evidence and a validated image file. “BrowserOS
installed”, “MCP connected” or “model selected” alone is insufficient. Creative quality,
continuity, rights, safety and final video review remain human gates.

### 2026-09-15 BrowserOS implementation checkpoint

The official signed BrowserOS neo installer was verified and installed side-by-side. Its
embedded AppData copy was EFS-encrypted and failed Windows side-by-side startup, so the
application payload was copied with the Windows archive tool to an unencrypted tools folder;
the copy launches as BrowserOS neo without touching the user's Chrome profile. The local MCP
endpoint is live at `127.0.0.1:9010/mcp` and currently exposes `tabs`, `snapshot`, `act`,
`wait`, `screenshot`, `download`, `evaluate` and related tools.

Auto3Dvideo now embeds a bounded BrowserOS MCP worker, persists only a non-secret session/page
handle under the project workspace, routes browser actions through fresh DOM refs, supports
exact download calls, and keeps the old Chrome MCP route behind the explicit rollback switch.
The BrowserOS `run` tool is intentionally not used because the current build has a known
structured-output failure; granular tools are used instead. Read-only DOM and click smoke tests
pass. The current unauthenticated BrowserOS profile redirects Flow to `/about`, and this
Windows build reports a zero-width/timeout screenshot for agent pages; therefore visual
acceptance and a real Flow image download remain blocked until the user signs in through the
visible BrowserOS window and the screenshot path is rechecked. The planner can now fall back
to fresh DOM-only reasoning in BrowserOS and labels the missing visual evidence instead of
silently treating an old screenshot as current.

### 2026-09-15 Gemini visual evaluation loop — implementation plan

#### Truth about the current gap

The current planner already receives a fresh accessibility/DOM snapshot and, when available,
a screenshot. It uses that context to propose one browser action. The screenshot shown in the
latest run proves that Gemini returned an action (`Close`), but the Rust safety boundary rejected
it because `Close` was not represented by an allowlisted Flow action. The run therefore stopped
before the composer was reacquired. This is an adapter/feedback-loop gap, not evidence that the
model or API is unavailable.

The current system does not yet perform a complete post-generation visual QA loop. In particular,
it does not reliably send the newly downloaded shot image to a Gemini evaluator, score it against
the shot prompt/reference/continuity bible, revise the prompt and retry within a bounded budget.
“Self-learning” in this plan means a persisted observe → evaluate → revise loop for the current
run; it does not mean retraining or changing model weights.

#### Goal

For every shot, make the agent follow this closed loop:

```text
fresh DOM + screenshot
  → Gemini Low chooses one safe UI action
  → observe again
  → submit only the current shot
  → wait for the current output
  → identify and download the exact output
  → validate file and shot identity
  → Gemini High evaluates visual quality
  → approve, revise once more, or block
  → human/auto review gate
  → advance to the next shot
```

The loop must never paste the complete multi-shot brief into one composer, run parallel Flow
tabs, download a generic/history item, accept a stale image, or retry a paid generation without
the configured approval and budget decision.

#### Model and responsibility routing

- `ag/gemini-3.8-flash-medium`: Director and prompt-revision route. It creates the style/continuity
  context and rewrites only the failed shot prompt using the evaluator's structured reasons.
- `ag/gemini-3.8-flash-low`: BrowserOS navigation/action route. It reads fresh DOM plus screenshot
  context and proposes exactly one allowlisted action at a time. It does not decide that a file is
  downloaded or that visual quality has passed.
- `ag/gemini-3.8-flash-high`: Visual evaluator and severe-recovery route. It receives the current
  downloaded image, shot prompt, reference asset IDs/hashes and continuity constraints, then emits
  strict JSON scores and revision instructions. It cannot click Flow or approve spending.
- Nano Banana Pro remains the Google Flow image generator. It is not a 9router planner and is not
  used to judge its own output.

#### Slice 1 — typed observation and action boundary

1. Extend the BrowserOS action contract with explicit safe actions: `snapshot`, `screenshot`,
   `dismiss_control`, `press_escape`, `close_panel`, `select_image_model`, `set_output_count`,
   `fill_prompt`, `press_enter`, `wait_generation`, `hover_output`, `open_output_menu`,
   `download_original` and `reacquire_page`.
2. Treat `Close` as a semantic observation, not an arbitrary click. Resolve it only when the
   fresh ref belongs to a dismissible Flow panel/modal; otherwise use a fresh `Escape` action or
   stop with an explicit ambiguity. Never let `Close` close a tab/window by accident.
3. Keep DOM/accessibility refs authoritative for targets. Screenshots provide visual context and
   are mandatory for visual evaluation, but never prove that a click, generation, download or
   approval succeeded.
4. After every mutating action, force a fresh snapshot and record the action result, page ID,
   project key, current URL, shot/revision identity and evidence timestamp. Stale refs must be
   rejected and reacquired.
5. Add an action capability report so a blocked action names the missing adapter capability and
   the safe fallback attempted, instead of collapsing into `0/N asset blocked`.

#### Slice 2 — per-shot generation state machine

Add explicit durable states and legal transitions:

```text
planned
  → ui_observed
  → composer_ready
  → prompt_filled
  → generation_submitted
  → generation_waiting
  → output_identified
  → downloaded
  → file_validated
  → visual_evaluating
  → review_pending
  → approved
  → next_shot
```

Failure states are `reconciliation_required`, `revision_required`, `blocked` and `rejected`.
Every state record carries `runId`, `projectKey`, `shotId`, `revisionId`, `promptHash`,
`referenceAssetHashes`, `mediaId`, `downloadPath`, `downloadSha256`, `model`, `attempt`,
`snapshotEvidencePath` and `evaluationEvidencePath` where applicable. A later shot cannot consume
an asset unless its state is `approved` or an explicitly configured auto-review policy accepts it.

#### Slice 3 — deterministic output/download validation

Before visual evaluation, validate without a model:

- the file exists inside the run/project download boundary;
- the file is a non-empty PNG/JPEG/WebP with decodable dimensions;
- the download is newer than the shot attempt and not a prior Flow card;
- the media tile/menu matched the current `shotId`/`revisionId` or the only fresh media ID;
- the downloaded hash is registered once and cannot be silently rebound to another shot.

If any check fails, do not ask Gemini to guess. Re-observe/reconcile once, then mark the shot
blocked or requiring human review.

#### Slice 4 — Gemini visual evaluator contract

Create a versioned evaluator request/response contract, with no credentials or raw browser
session data. Input includes the local image path/hash, current shot prompt, reference image
hashes, style bible, continuity anchors and negative constraints. Output must be JSON only:

```json
{
  "schemaVersion": "1.0.0",
  "shotId": "SHOT-001",
  "revisionId": "rev-001",
  "decision": "pass|revise|block",
  "scores": {
    "subjectIdentity": 0,
    "promptMatch": 0,
    "composition": 0,
    "lightingMaterial": 0,
    "continuity": 0
  },
  "criticalFlags": [],
  "revisionInstructions": [],
  "reason": ""
}
```

The evaluator must not invent a missing reference or claim that an image is the right shot when
the deterministic identity checks failed. Default pass requires all required scores ≥ 4/5 and no
critical flag such as wrong subject, duplicate/morphed hero, broken geometry, unreadable output,
wrong aspect ratio or visible text/watermark. A score is evidence for review, not a legal,
rights, safety or publishability decision.

Implementation normalization: the persisted contract in
`contracts/flow-visual-evaluation.schema.json` represents the five criteria and overall score on
0–100 scales, and uses `needs_review` instead of `block` for an uncertain or malformed evaluator
result. The Rust boundary maps worker/provider failure to `needs_review`, keeps
`humanReviewRequired=true`, and never treats the evaluator response as creative, rights or payment
approval.

#### Slice 5 — revision and approval policy

- Default `human_review`: pause after each valid image and show prompt, image, evaluator JSON,
  model, cost and retry count. The user chooses approve, revise or reject.
- Optional `auto_review`: only auto-approve a deterministic-valid image that meets the threshold;
  any critical flag or score below threshold pauses for the user.
- Allow at most two generation attempts per shot, with a new `revisionId` and new prompt hash for
  each retry. Never loop on a unchanged prompt or unchanged output hash.
- A revision may change only the failed shot prompt and its explicit negative/continuity clauses;
  it must preserve the project style bible and subject identity anchors.
- Revisions that spend Flow credits require the existing provider/budget approval. The evaluator
  cannot click Generate, alter the budget, or bypass the user gate.

#### Slice 6 — evidence, UI and recovery

Record an evidence bundle per shot containing the before/after snapshots, screenshot paths,
planner action JSON, Flow media ID, download validation, evaluator JSON, prompt revision diff,
cost/approval decision and final review decision. The UI must show the current shot and state,
not only a generic `0/12 blocked` summary.

Recovery rules:

- `Close`/dismiss ambiguity: snapshot → resolve panel-scoped close or Escape → snapshot again.
- Missing composer: reacquire the pinned project and inspect the current page; do not open another
  tab or paste all shots into a generic chat.
- Generation still active: bounded wait and fresh observation; do not submit again.
- Output menu visible but no file: select the exact `1K Original size` item, wait for file evidence,
  then validate; never treat a menu click as a download.
- Wrong/stale output: quarantine the file and reconcile the current Flow card before retrying.
- Planner JSON/action invalid: retry reasoning once with the same fresh observation; then block with
  the exact invalid action and evidence path.

#### Tests and live acceptance

Unit tests must cover semantic `Close`, Escape fallback, stale refs, action allowlist rejection,
strict evaluator JSON, score thresholds, critical flags, prompt revision hashes, retry limits,
wrong-shot downloads, duplicate hashes, missing screenshots and budget denial. Worker integration
tests must use a fake BrowserOS/Flow transcript for:

1. one existing-image read-only review with no generation;
2. one approved SHOT-001 generation/download/evaluation;
3. a failed evaluation followed by exactly one revised attempt;
4. two shots proving no cross-shot prompt, output or download reuse;
5. a blocked `Close`/missing-composer path that never spends credit.

Live acceptance is three stages: read-only existing-image review, one user-approved paid shot, then
two sequential shots with review pause. BrowserOS is not declared usable until all stages produce
fresh DOM/screenshot evidence, validated files and state/evidence records. Creative quality,
continuity, rights, safety, accessibility and final video review remain human gates.

#### Files/contracts expected to change during implementation

- `desktop/src-tauri/src/browser_handoff.rs`: action capabilities, state transitions and evidence.
- `scripts/browser_flow_planner_worker.py`: strict one-action planner/evaluator payload handling.
- `scripts/browseros_flow_worker.mjs`: semantic dismiss, screenshot, wait and exact download paths.
- `contracts/shot.schema.json` and `contracts/asset.schema.json` or a new
  `contracts/flow-visual-evaluation.schema.json`: persisted evaluation and revision evidence.
- `desktop/src/App.tsx`: per-shot state, image/evaluator review and retry controls.
- `plans/PLAN-025-FLOW-SHOT-AUTOMATION-REVISION-BLENDER-GROUNDING.md`: acceptance evidence and
  implementation notes after each slice.

#### Definition of done for this loop

The feature is done only when a two-shot rehearsal can observe each Flow state, use a safe
dismissal action, create one shot at a time, download the exact current image, evaluate it with
Gemini using the strict rubric, revise at most twice when requested, pause for approval, and
advance only from a validated approved state. A screenshot, an HTTP 200, a selected model or a
heartbeat message alone is not completion evidence.

#### 2026-09-15 implementation checkpoint

- Implemented the strict evaluator worker and persisted report contract. The worker accepts only
  one downloaded image plus bounded references, calls `ag/gemini-3.8-flash-high` through the
  allowlisted 9router endpoint, validates the five rubric scores, and returns `needs_review` on
  malformed/ambiguous output.
- Connected the evaluator after Flow download/import and before the existing per-shot human review
  gate. The UI now shows decision, score, summary, flags, revision instruction and evidence path;
  it never auto-approves creative quality or rights.
- Allowed the planner to dismiss a visible in-page Close/Dismiss overlay while continuing to reject
  tab/window/account closure and destructive controls.
- Implemented the bounded automatic revision path: a `revise` result creates exactly one new
  `revisionId`, appends only the evaluator's shot-local instruction, submits that shot again, waits
  for a new media/download identity, evaluates the new file and then returns to the human review
  gate. A third paid attempt is rejected.
- Added provider-free fake BrowserOS/Flow transcript tests covering existing-image read-only review,
  one approved shot, one revision only, cross-shot prompt/media isolation and missing-composer
  no-credit behavior.
- Hardened BrowserOS download selection: after matching the current batch by all three identity
  markers, the adapter clicks only that batch's Download control and accepts only a new image file
  observed after the click; a page-wide/history Download control is no longer accepted.
- Live read-only acceptance passed on the signed-in Flow project through BrowserOS: fresh snapshot
  attached, 119 accessibility refs, image composer/prompt/start-generation/download controls found,
  16 existing media, no generation active and no paid action performed. The two paid live stages
  remain an explicit human-review acceptance step; this plan is not marked DONE until the user
  approves that spend and the resulting files/evidence are checked.
- 2026-09-16 controlled one-shot rehearsal reached the paid boundary without tab or prompt
  fan-out: Nano Banana Pro/x1 was confirmed and saved, one `SHOT-001` prompt was inserted into
  the shadow-DOM ProseMirror editor, and Generate was clicked exactly once. Flow produced one
  fresh media ID (`c574515d-8dad-4db1-8334-6df8924c1353`). The remaining live blocker is the
  BrowserOS download bridge: Flow exposes the exact card's `Download media` control, but the
  BrowserOS `download` call times out and the rendered image is not canvas-readable; no stale
  history image is imported. The adapter now bounds that bridge timeout and remains fail-closed.

- 2026-09-16 download confirmation correction: the user's BrowserOS/Flow screenshot proved the
  exact image download completes normally (`Your image has been downloaded!` and a new JPEG in
  the browser Downloads list). The false blocker was the adapter waiting on BrowserOS's
  high-level `download` tool, which can time out after Flow has already triggered Chrome's native
  download. The exact current-card menu now uses a trusted BrowserOS `act` click; the existing
  fresh-file poll, extension/type check and workspace copy remain the only success evidence.

- 2026-09-16 detail-editor menu correction: a live read-only/download rehearsal showed Flow's
  `Download media` button opens a second menu (`1K Original size`, `2K Upscaled`, `4K Upscaled`).
  The adapter now detects and clicks the smallest available size item, including a menu left open
  by a previous attempt, before polling the real Downloads folder. No new generation is involved.

- 2026-09-16 verification note: source/embedded worker checks pass and BrowserOS read-only
  observation sees the exact `Download media` and size-menu refs. A no-credit live download
  rehearsal through the active port-9000 bridge still did not produce a second local file after
  the bridge action, while the user's visible manual click did produce the JPEG. Therefore the
  app must remain fail-closed until that bridge dispatch is confirmed; the remaining issue is
  BrowserOS-to-native-download dispatch, not Flow generation or the model.

- 2026-09-16 per-shot argument-size correction: the image loop already advances serially, but
  BrowserOS Flow prompt transport still placed the complete shot prompt in a Windows process
  argument. The worker now reads the prompt from a project-scoped file, and the image prompt
  builder bounds each shot's fields to 8,000 characters while preserving exactly one
  `SHOT_ID`/`REVISION_ID`. This prevents a long 12-shot brief from being interpreted as an
  oversized Agent argument; it does not submit a batch or relax the one-shot review gate.

- 2026-09-16 Windows worker-window correction: the BrowserOS/BrowserMCP fallback workers were
  spawned directly with `std::process::Command`, bypassing the existing shared external-worker
  no-console flag. Both direct Node launch paths now set `CREATE_NO_WINDOW`, so snapshot/action
  polling cannot open a new cmd window per observation. The bounded timeout and fail-closed
  report behavior remain unchanged.

- 2026-09-16 auto-run button lock correction: the prompt workspace's primary “Tự làm toàn bộ”
  button only observed the generic loading flag, while the Studio Flow agent uses its own
  `autoPipelineBusy` state. The workspace now receives that run-lock state, disables the prompt,
  reference attachment and duplicate-run button during an active agent/browser run, and shows the
  same running label as the Agent bar. The handler-level lock remains as a second guard.

- 2026-09-17 revision-budget guard correction: the first automatic revision is intentionally
  numbered `attempt=2` because the original generation is attempt 1, but the guard rejected every
  value greater than 1 before sending the revision to Flow. The guard now permits the one allowed
  revision and blocks only a third generation; TypeScript/Vite and release builds pass.

- 2026-09-17 full-auto image-review correction: the explicit “Tự làm toàn bộ” path no longer opens
  the per-shot human confirmation modal. It still runs Gemini visual QA and one bounded revision,
  records the decision/flags, then auto-advances to the next shot; the separate manual image button
  keeps the confirmation gate, and final creative/rights review remains required before delivery.

- 2026-09-16 output-scope correction: the image wait loop previously compared every visible Flow
  media ID on the page against the baseline, so thumbnails/cards outside the current
  `SHOT_ID/REVISION_ID/RUN_ID` batch could falsely trigger the multiple-media blocker. The DOM
  worker now returns media IDs scoped to the matching batch, and the app uses those IDs for fresh
  output detection while retaining the hard stop when the current batch itself contains more than
  one media.

- 2026-09-16 Flow identity fallback correction: Flow can omit the automation `RUN_ID` from a
  visible batch even after a real Generate. The DOM report now also exposes the
  `SHOT_ID/REVISION_ID` scope, and the wait loop falls back to exactly one media ID that is new
  relative to the pre-Generate baseline when neither identity is echoed. Multiple new IDs or no
  new ID remain blocked, so historical media cannot be reused.

- 2026-09-16 image-composer guard correction: the BrowserOS DOM probe previously treated any
  generic “What do you want to create?” chat editor as an image composer. It now requires the
  visible image-model picker as well as the editor before allowing prompt entry, preventing a
  storyboard/chat response from being mistaken for Nano Banana image generation.

- 2026-09-16 model Save-confirmation correction: Flow's live Agent settings can render an
  enabled Save button with an icon/hidden label or a stale accessibility ref. The BrowserOS
  adapter now prefers a fresh, label-scoped DOM click, falls back to the fresh snapshot ref,
  waits for the settings transition, and preserves the exact pre-Save Nano Banana Pro
  selection when Flow closes the picker. A run remains blocked when the model selection or
  Save click is not evidenced; it never clicks Generate in this gate.

- 2026-09-16 hidden-picker route correction: after Save, Flow closes Agent settings and hides
  the model picker while leaving the exact image ProseMirror editor and Settings trigger live.
  The composer probe now accepts that narrowly scoped DOM signature, so the model gate can
  reopen settings and verify Nano Banana Pro instead of treating the valid image composer as
  a chat route. Generic contenteditable/chat editors remain blocked.

- 2026-09-16 Agent-settings deadlock correction: when Flow opens Agent settings first, the image
  prompt editor is intentionally hidden while the real image-mode picker and selected-model
  control remain visible. The app now treats that bounded DOM signature as a model-gate state,
  performs only Nano Banana Pro/x1 + Save, then requires the worker's post-Save editor reread
  before allowing shot prompt entry. This prevents the previous false block while keeping
  generic chat editors and generation actions fail-closed.

- 2026-09-16 Flow download-menu correction: the live BrowserOS snapshot exposed the exact
  `1K Original size` menu ref, but coordinate clicking could report success while leaving the
  Angular size menu open. The worker now clicks that fresh menu ref first and only uses the
  coordinate path as a bounded compatibility fallback; the filesystem remains the required
  proof of a completed download.

- 2026-09-17 download-page binding correction: the size-menu probe was taking a snapshot without
  passing the task's Flow page id, so the worker could inspect a different active tab and leave
  the real `1K Original size` menu open. The probe now snapshots the exact owned page before
  clicking its fresh ref; this keeps multi-tab sessions bounded and makes the click/file proof
  refer to the same Flow card.

- 2026-09-17 nested-download-menu race correction: after Flow's parent Download item is opened,
  the `1K Original size` submenu is rendered only after a short hover/paint cycle. The worker
  now hovers the exact Download menu item, retries the same-page snapshot briefly, clicks the
  fresh size ref, and only then polls for the native file. Live no-credit validation copied a
  288286-byte JPEG into the project workspace.

- 2026-09-17 workflow-size correction: the persisted Browser Flow workflow had accumulated 507
  process-history entries and reached 524265 bytes, so the next append crossed the 512 KiB safety
  guard before any shot action. Workflow load/persist now keeps the first discovery record plus the
  latest 95 process records, preserving current state without allowing unbounded history growth.

- 2026-09-17 prompt-grounded Blender correction: the previous shot preview path stopped at
  `semantic_blockout`, so a long tiger/T-Rex brief became colored primitives even though the text
  plan contained identity and camera prose. The local script worker now preserves `sourcePrompt`
  and a bounded `promptGrounding` world/character bible, including parsed tiger dimensions,
  identity anchors and continuity constraints. The Blender path now uses
  `prompt_grounded_previs` for prehistoric prompts, builds a procedural tiger, separate T-Rex,
  causal time-rift, Cretaceous environment, Eevee lighting and per-shot camera/action keyframes,
  and writes the grounding into the edit/manifest evidence. It remains explicitly procedural and
  `needs_review` until a reviewed production model is bound; no preview is called final video.

- 2026-09-17 AI-first routing correction: the default Studio Flow `Tự làm toàn bộ` path no longer
  requires or runs Blender. It now goes `prompt → shot plan → Google Flow/Nano Banana reference
  images → Flow video`, while the legacy Blender preview/true-3D workers remain available only
  through explicit legacy/advanced actions. The Flow image stage no longer rejects a valid shot
  plan merely because no Blender preview exists. This matches the user's hardware constraint:
  the local machine does not render a final Blender video; the cloud provider creates the final
  shot outputs. Provider login, composer/snapshot, credit, upload and human review gates remain
  fail-closed and are not bypassed by this routing change.
