# PLAN-025 — Google Flow per-shot automation, prompt revision and grounded Blender

## Status

`IN_PROGRESS / NEEDS_HUMAN_REVIEW`

### 2026-09-28 native canvas and Flow shot references

Design authority for this slice is the binding contract `contracts/video-workflow-session.schema.json`,
the Flow media-binding rules in `scripts/flow_exact_media.mjs` and the gates named in this entry
itself; the session-local implementation plan the work was executed from is not a durable repo
artifact. The delivered slices are:

- **Session contract and domain identity.** `contracts/video-workflow-session.schema.json` gained
  optional `canvasGraph` (version 1: bounded nodes/edges/viewport over stable session/segment/asset
  IDs) and optional `shotReferenceBindings` (bounded; `segmentId`, `referenceSetId`,
  `assignmentId`, `assetId`, `assetSha256`, `role`, plus the four dependent Flow fields
  `flowProjectId`/`flowMediaId`/`confirmedAt`/`confirmationKind`). Both Rust session DTOs and the
  TypeScript `VideoWorkflowSession{,Input}` mirror them with `serde(default)` semantics, so older
  sessions still load and `schemaVersion: 1.0.0`, the storage path, the index and the 32-session
  limit are unchanged. `desktop/src/features/workspace/canvasGraph.ts` is a pure layout validator
  and model; parsing is not enough to execute anything.
- **Canvas presentation and shot ownership.** `ProjectWorkspaceCanvas.tsx` renders an ordered shot
  board from the session script, a selected-shot inspector, a local asset rail with rights badges,
  run/review/output status and session-save labels; `App.css` carries the responsive styling and an
  accessible canvas region. The dead hidden `.studio-flow-shell` presentation was removed while
  `runStudioFlowAgent()` stayed the live entry point. Arrangement is layout only and never changes
  script order or executor behaviour.
- **Native drop and local reference assignment.** Exactly one supported image dropped on one armed
  shot target (or the accessible file-picker fallback) imports through the existing asset path and
  creates/updates a shot-scoped `start_frame` assignment, then persists the session fields. A drop
  never implies a Flow attachment, an upload or a generation. **Native acceptance is outstanding:**
  the real WebView2 `tauri://drag-drop` event, non-100% DPI hit-testing, the durable SQLite
  assignment and a save/reopen round-trip were never exercised, so this slice stays
  `NEEDS_HUMAN_REVIEW`.
- **Manual Flow card bind and exact ingredient.** Read-only, bounded Flow image-card discovery
  (`discover_google_flow_image_cards`) returns sanitized media IDs, labels and thumbnails only, and
  never accepts a free-form media ID. A truncated read marks every retained card unselectable and
  reports the truncation, in the worker normalizer, the Rust parser and the UI confirmation gate
  alike; duplicates stay listed but unselectable. A local preflight
  (`preflight_shot_reference_flow_binding`) requires the project/segment/assignment/role identity,
  an image-kind asset, cleared rights evidence, an approved assignment, a safe in-workspace path
  and a recomputed current byte hash before anything may be prepared for Flow. The explicit
  binding then attaches that exact media ID via `animate_image` with a matching `sourceMediaId`, and
  the Playwright route refuses a grid larger than its bounded media scan instead of calling a
  sampled match unique. No label fallback exists while an explicit binding is present.
- **Prompt and provenance.** Both shot-prompt compilers carry stable `SHOT_ID`/`REVISION_ID`/
  `RUN_ID`, project/session identity, duration, per-shot subject/action/camera/light/continuity and
  inline exclusions; a bound reference is described by its role sentence, and a reference-free shot
  omits it. The paid prompt no longer contains local relative paths, absolute paths, `@Image` tags
  or unverified attachment claims. A canonical reference fingerprint over
  `(projectId, flowProjectId, sessionId, segmentId, assignmentId, assetSha256, flowMediaId, role,
  confirmationKind)` feeds a shot `inputHash`, while reference-free shots keep the previous
  prompt-only hash, the v1 checkpoint key and `schemaVersion: 1`. A prior submission whose
  provenance no longer matches the current binding blocks for human reconciliation instead of
  starting a second Generate.

Task 5 hardening review fixes: dynamic prompt prose is sanitized before compilation; each split
paid part is previewed with its own revision ID; explicit reference media is re-verified directly
before prompt entry and again before Generate. The fresh SQLite preflight now runs before composer
acquisition, so a stale/rejected binding cannot navigate or mutate the live Flow tab. Locally
imported exact outputs are reconciled first; a paid output that exists in Flow but is not yet
imported cannot be auto-recovered when its current local reference fails preflight and requires
human reconciliation. Verification: focused Node suites passed, desktop build passed,
`cargo fmt --check` passed, and full unfiltered Rust tests passed (148 passed, 4 ignored).
`CHANGELOG.md` and `contracts/README.md` record the slice. Native drop/save-reopen and live Flow
card/chip identity remain human-review requirements.
Evidence for this slice is the focused Node suites (`test_flow_exact_media.mjs`,
`test_flow_shot_prompt.mjs`, `test_flow_run_checkpoint.mjs`, `test_flow_shot_provenance.mjs`,
`test_browseros_mcp_runtime_worker.mjs`, `test_canvas_graph.mjs`, `test_shot_reference_drop.mjs`,
`desktop/test_project_workspace_canvas.mjs`), the focused Rust tests, `pnpm run build` in
`desktop/`, `cargo fmt --check` and `python scripts/validate_project.py --project .`. All ran with
no provider request, no upload, no live Flow action and no paid generation. **Not verified:** real
Flow DOM exposure of card/chip media identity, the native WebView2 drop path, and native
save/reopen. This slice must not be called release-ready on the strength of mocked tests alone.

### 2026-09-23 active video route moved to pinned gflow-cli

- The visible one-prompt video action now runs the local Prompt Skill planner,
  then invokes the vendored `ffroliva/gflow-cli` checkout at commit
  `56d9501526767f9eaa71d9155608719414ac0e24` for one Flow video per shot. It
  no longer routes that action through the old Google Flow MCP image fallback.
- The app installs gflow-cli and its pinned Playwright 1.61 dependency closure
  into `.auto3dvideo/tools/gflow-cli/site-packages`, separate from Blender's
  Python. “Kết nối Google Flow” launches gflow-cli's real Google Chrome login
  for the local `auto3dvideo` profile; every video run checks that profile
  before submitting a paid job.
- Worker state is persisted atomically before submit and after validation.
  A same-input validated MP4 is skipped; a prior uncertain submit or orphaned
  output blocks automatic resubmit/overwrite. Each downloaded clip must pass
  ffprobe before Asset Library import. FFmpeg scales/pads to the selected
  aspect, trims each clip to its Prompt Skill target duration, then validates
  the final MP4 before import.
- Contract: `contracts/gflow-cli-video-generation.schema.json`. UI/Rust builds
  passed on 2026-09-23. No live Flow account login, paid generation or final
  MP4 has been verified in this change; human login and a user-approved
  credit-spending run are still required.
- Known provider limits: gflow-cli is an unofficial alpha browser automation
  project and Google can change Flow without notice. The app needs an existing
  Flow project ID and a Google Chrome login (Brave's active cookies are not
  reused). Flow charges the signed-in account for generated clips. Review the
  generated clips and project rights before delivery.

### 2026-09-24 Windows worker JSON encoding

- Both the video-generation and interactive-login workers emit stdout JSON with ASCII escapes so Vietnamese diagnostics survive Windows legacy code pages. The cp1252 regression test covers success and failure payloads without contacting Flow.
- No generation is triggered by this fix. A live Google Flow run remains credit-bearing and requires explicit user approval.

### 2026-09-24 auth probe failure handling

- A session status probe can fail after an earlier successful sign-in. Report it as `GFLOW_AUTH_UNVERIFIED` with safe CLI detail, not as definite missing login.
- Rust surfaces the worker's structured failure JSON on non-zero exit with secret filtering; generation still stops until the session probe passes.
- The observed `OSError` root cause remains unresolved. No generation request was sent during this investigation.
- The no-generation `Kết nối Google Flow` retry also failed with `GFLOW_AUTH_FAILED`; its output contained no allowlisted structured diagnostic. The auth worker now exposes only allowlisted event fields/error classes on failure and hides raw browser output. The login root cause remains unresolved.


### 2026-09-24 live BrowserMCP target resolution

- BrowserOS click resolution now takes the fresh snapshot and performs the semantic click in the same MCP worker/session; it never reuses the caller's transient `eN` reference as the target.
- Clicks are blocked when the label is missing, duplicated, non-interactive, destructive, or outside the existing allowlist. Saved page IDs must still resolve to an allowed Google Flow URL; recycled IDs pointing to another page are blocked without a click or replacement tab. Attachment status requires a verified Flow URL, not merely UI refs.
- The live BrowserOS status check returned a verified Flow page. One safe `Trang chủ` button click resolved against the same-session fresh snapshot and completed; the Generate control was not clicked.
- The open Flow project did not match the saved destination selected in the desktop app. Both were left unchanged; generation must remain blocked until the user selects the intended project.
- The project validator still reports `MANIFEST_INVENTORY_INVALID` for unregistered repository entries; none of the changed files were listed, and no unrelated artifacts or manifests were changed.

### 2026-09-24 saved Google Flow project selector

- The Google Flow Project ID controls had been rendered inside `.video-session-strip`, which the active workspace CSS hides. They now appear above the prompt workspace as a named project selector with ID/name editing and save/remove actions.
- Saved Flow projects and the selected destination are stored in local browser storage, scoped to the selected Auto3Dvideo project. The previous single global ID is migrated to the first local project that opens it.
- The selector is intentionally a local saved list, not live account discovery: pinned `gflow project list` reads gflow-cli's local SQLite catalog and does not authoritatively list the current Flow account. Users add an existing project's ID from its Flow URL.
- Selecting a destination never creates a remote project or starts generation. The generation action still requires an explicitly saved selection; Flow credit spend remains visible before running.

### 2026-09-25 desktop Google Flow video route

- The primary one-prompt action now runs video shots through the attached BrowserMCP session rather than the separate gflow-cli generation route.
- Discovery navigates to the exact saved Flow project URL before snapshot binding; the app verifies the live project key and a video composer before typing any shot prompt.
- Cloud/API must remain explicitly enabled. Before any shot prompt is typed, a fresh DOM preflight establishes the visible unit price and selected model/settings; the user approves `unit price × planned shot count` once as a hard batch cap. Every shot requires fresh composer/settings/price evidence; unknown price, missing model/settings, target mismatch, cap overflow, timeout or invalid output blocks without automatic retry.
- The Flow model, aspect ratio, duration and resolution remain the user's currently selected settings. A successful result is downloaded, FFprobed and imported for human review; no publish or rights clearance is implied.
- Verification runs `node --experimental-strip-types scripts/test_flow_batch_budget.mjs`, the desktop build and a no-submit UI smoke. Paid Flow generation requires one explicit batch budget approval, a fresh price/settings check before every shot and a hard cumulative credit cap; any mismatch stops before the next Generate.

### 2026-09-25 localized Flow video navigation

- A fresh Flow project screenshot visibly exposes a `Video` sidebar item, while BrowserOS accessibility refs omit that item.
- The `Tác nhân` composer chip does not open Video mode. The app now ignores it as a mode selector and uses a narrowly scoped exact-label DOM fallback only when the unique visible `Video` target belongs to the already-bound Flow project root.
- The prior Tools detour and this preflight stopped before prompt entry or Generate; no credits were spent.

- Live 2026-09-25 verification after the unique Video navigation click: the same bound Flow project still exposes the Nano Banana 2 image composer, not a video composer. The existing project shows an older Omni 1.1 Flash output, but the current model selector remains Nano Banana 2; do not switch the user's paid model setting by inference. No shot prompt or Generate action was submitted. Resume with the separate explicit model selector, require fresh video-composer evidence, and keep the per-shot credit approval gate.

### 2026-09-25 explicit Flow video model selection

- Added a separate desktop action for the user-selected `Omni 1.1 Flash` model. It requires a fresh same-project `Video` radio, a unique model-group picker and a unique exact model option; it then verifies the video composer before reporting success.
- Selection never enters shot text or presses Generate. No generation or credit is incurred by changing model.
- Live selection did not complete: the current BrowserOS snapshot exposed no unique Video radio, and reconnect returned HTTP 503. Keep shot prompting and Generate blocked until BrowserOS is healthy and the selected project exposes a verified video composer; resume with a fresh snapshot and one bounded batch-budget approval.

### 2026-09-25 current Flow model-picker menu

- The live composer screenshot shows Video navigation but leaves the prompt on the Nano Banana 2 image model. Flow hides the Video radio until the visible model chip is opened.
- The non-generative model action now verifies the saved project and Nano Banana 2 composer, opens exactly one visible Nano Banana 2 button/combobox, then requires a unique Video radio before continuing to the selected video model. Missing/duplicate controls still block without typing or Generate.


### 2026-09-26 live Flow composer and batch approval

- The saved Flow project already exposes its Video composer. The live DOM confirms the unchanged selection `Omni 1.1 Flash`, 16:9, 720p, 8 seconds and 12 credits per shot.
- Media-heavy project snapshots can saturate BrowserOS refs with card controls. Runtime snapshots now retain prompt, Video, Generate, price and download controls; the Flow inspector waits boundedly for model/settings/price evidence and does not toggle an already-open settings menu.
- The desktop combines fresh UI refs with same-project DOM evidence before prompt entry, and rechecks composer, settings and price before each shot and Generate.
- Smoke reached the native approval for the 12-shot, 60-second plan: 12 credits/shot, 144-credit maximum. The smoke canceled at approval; zero prompt type actions, zero Generate clicks and zero credits spent. No output artifact exists until a user approves.
- Verification: `node --check` for both BrowserOS workers, `node scripts/test_browseros_mcp_runtime_worker.mjs`, `node --experimental-strip-types scripts/test_flow_batch_budget.mjs`, desktop frontend/native builds and canceled live preflight.

### 2026-09-26 direct video prompt, Generate and output binding

- The paid video action now uses a typed Tauri command for prompt entry and Generate; both worker operations revalidate the saved Flow project, exact shot/revision metadata, Omni 1.1 Flash, a fresh visible unit price and the batch's explicitly approved credit cap.
- After Generate, the app waits for the exact `runId`/`shotId`/`revisionId` Flow output, clicks only its scoped video Download control, requires exactly one new local video file, then imports, FFprobes and composes it. Ambiguous cards, downloads, changed settings or uncertain clicks stop without automatic retry.
- The Rust command rejects unapproved or underfunded requests, prompts without the matching shot/revision identity, unsupported models and batches outside 1–12 shots. No remote project creation, model switching, publishing or rights clearance is implied.
- Legacy shot plans that repeat the entire brief under a generic role contract
  are grounded to the matching numbered source shot before prompt entry; no
  project-specific identity or scene template is hard-coded. Missing source
  shot context blocks the request. Regression coverage verifies that unrelated
  shot descriptions are excluded from each prompt.
- Video composition now receives the requested duration for every shot, trims
  each downloaded clip before concatenation, caps FFmpeg output at the sum and
  rejects/deletes the result if FFprobe reports a mismatch beyond 250 ms.
- Verification: frontend build, BrowserOS/budget/prompt regressions, targeted
  Rust duration guard test, project validator, native build and a throwaway
  FFmpeg/FFprobe 12-shot × 5-second composition check passed.
- Safety incident during resumed UI preflight: the embedded WebView accepted
  `window.confirm` without an explicit user decision, then reported one
  successful Generate click (12-credit estimate) and ambiguous matching
  outputs. No clip was downloaded/imported or composed; actual provider charge
  and output status are unverified. No retry or further paid action was made.
- Replacing native confirmation with an explicit in-app approval dialog; the
  next batch remains blocked until the user reviews and approves its exact
  displayed cap. Human review remains required.
- Batch spending now waits on an app-owned alertdialog. Only its explicit Approve
  button can continue; Cancel/Escape exits before prompt entry.
- Output reconciliation recognizes Flow's image-backed video posters only when
  the card also exposes the verified video model, resolution, duration, aspect
  ratio and exact run/shot/revision identity. Unrelated image cards are excluded;
  multiple matching outputs remain blocked without retry.
- Interrupted Flow batches persist a run identity and pre-Generate shot/revision
  credit estimates scoped to local project, Flow project, session and prompt
  hash. Resume imports only one exact output match, skips imported clips and
  never repeats a recorded Generate without verified output; remaining shots
  still require explicit cumulative budget approval. Clear the checkpoint only
  after FFprobe confirms composition duration. Provider charges remain unverified.
- Verification after this recovery change: desktop TypeScript/Vite build,
  checkpoint/recovery decision tests, BrowserOS Flow matching tests, cumulative
  budget tests and the focused Rust video-download allowlist test pass. A native
  Tauri rebuild completed after the user approved closing the old app; the
  rebuilt app launched and preserved the saved Flow project name/ID. No paid
  action or output download was made during verification.
- Project validator completed with `AUTO3DVIDEO_PROJECT_VALID`,
  455 manifest/physical files, 100 JSON and 17 YAML files; semantic YAML
  parsing was unavailable and external tools were not executed.
- The old binary reported one batch-video match versus two prompt-video
  matches for legacy SHOT-001. The rebuilt app's read-only inspector reports
  one of each. The legacy run predates checkpoints, so it is not auto-resumed;
  download/import and its provider charge remain unverified.

### 2026-09-27 shadow-hosted video poster recovery

- The user explicitly authorized Flow credit use. The app showed a cumulative
  ceiling of 144 credits; the checkpoint recorded SHOT-001 at 12 estimated
  credits before resume. The resumed run generated SHOT-002 at another displayed
  12-credit estimate, then stopped before further shots when the download
  selector rejected its output.
- The read-only output report found exactly one prompt-matched video for
  SHOT-002, but the downloader could not classify its image-backed video poster
  through a shadow-root host. The worker now walks DOM/shadow-host ancestors
  while retaining exact run/shot/revision, model/settings and unique-media
  checks. A shadow-host poster regression passes; desktop rebuild is pending.
- SHOT-001 was downloaded and imported at
  `outputs/sessions/video-session-1789650831022801100/browser-flow/downloads/flow-SHOT-001-rev-001.mp4`;
  its prior workflow record contains the imported file identity. SHOT-002 and
  final composition remain unimported/unverified. Both checkpoints retain a
  12-credit estimate; actual provider charges remain unverified. Do not repeat
  Generate for either checkpointed shot.


### 2026-09-27 idempotent Flow video import

- Restarted imports now reuse an existing destination only for an exact
  run/shot/revision request with a valid input hash and matching source/
  destination size and SHA-256. A mismatch is preserved and fails closed.
  Newly created destinations use no-overwrite creation and are rolled back on
  copy or FFprobe validation failure; reused files are still FFprobed before
  the resumed workflow records them.
- The post-build app repro downloaded the checkpointed SHOT-001 Flow output
  but blocked reuse because uppercase `SHOT-001` was checked by the generic
  lowercase-only `safe_id`. The local source and existing workspace file had
  matching size and SHA-256. The video reuse gate now validates ASCII shot IDs
  separately while retaining exact run/revision/input-hash and file-hash checks.
- The focused Rust regression passes (1/1), covering uppercase `SHOT-001`,
  exact-output reuse and preservation of a same-size mismatched destination.
  The repro reached download/import only; it did not trigger another Generate.
  Native rebuild, checkpoint recovery, remaining shots and composition remain
  pending; actual Flow charges remain unverified.


### 2026-09-27 Flow download marker lifecycle

- The video worker restores labels left by an earlier output-card scan before
  resolving a fresh BrowserOS Download ref, then restores the temporary marker
  after the BrowserOS action. The cleanup covers both metadata-backed and
  legacy markers without saved label metadata.
- `node --check` passed for the worker and focused regression file; the
  BrowserOS worker regression passed, including stale-marker recovery and
  marker cleanup after action.
- The refreshed desktop executable launched and restored the saved Flow
  project/checkpoint. BrowserOS MCP returned HTTP 503 at startup, so no live
  download/import or Generate was attempted. Charges for checkpointed Flow
  shots remain unverified.

### 2026-09-27 localized Flow edit completion

- The authorized cumulative run reached SHOT-009 (108 estimated credits of the 144-credit cap). Eight clips were imported. Flow opened an 8-second tiger/T-Rex result in `/edit/<media-id>`, but output reconciliation stopped because the edit-route guard recognized English “Done editing” and not Flow’s Vietnamese “Đã chỉnh sửa xong” control. No later Generate was issued; actual provider charges remain unverified.
- The guard now permits that exact normalized Vietnamese completion label while retaining the destructive-action gate; a focused regression covers the edit-route ref and label. Resume only the persisted run under the same 144-credit cumulative cap. Never repeat Generate for SHOT-009 before reconciling the existing Flow result.
- Focused Rust resume/composition regressions passed (2/2); `pnpm run build` passed; `python scripts/validate_project.py --project .` passed (455 files, 100 JSON, 17 YAML; semantic YAML validation unavailable). Stopping the managed desktop process released the executable lock, and the updated native build succeeded.
- Resume lookup restored the workflow with eight imported clips; SHOT-009 was reconciled and SHOT-010–012 were generated/imported under the already-approved 144-credit estimate. After fixing uppercase `SHOT-###` compose validation, the desktop composed all 12 clips to `outputs/sessions/video-session-1789650831022801100/browser-flow/downloads/compose/auto-muigr1z5-browser-flow-final.mp4`. The app cleared the checkpoint after its FFprobe duration check; local video metadata confirms 60.0s, 1280x720, 30fps H.264/AAC, 19.3 MiB. SHA-256: `56f152ed9224972fea7f975085464ae777abdc56aae3f8e102e00725c193ffe9`. Actual provider charges remain unverified; human creative/rights review is still required.

### 2026-09-24 persisted Cloud/API gate

- The cloud-generation setting was held only in `AppState` memory, so a restart or second app process restored `LOCAL-FIRST` even after the user enabled it. It now lives in SQLite and every status/provider/generation check reads that same setting.
- The migration restores the latest prior `cloud_generation.enabled/disabled` audit event, preserving an explicit choice made by an existing user. A fresh database still defaults off.
- The enabled choice persists across app restarts; the provider screen states this and offers an explicit off action. No generation is started by saving the preference.

### 2026-09-21 Generate-control mapping and pre-prompt state

- Flow may render the real image Generate control disabled while the prompt is
  empty. The worker now distinguishes `generateButtonFound` (safe evidence
  that the image composer is present and may receive text) from
  `generateButtonEnabled` (required immediately before the paid Generate
  click), removing the pre-prompt deadlock.
- The Rust `GoogleFlowDomOutputReport` now forwards both fields to the desktop
  UI. Previously the worker returned the field but the Rust mapping discarded
  it; the mapping now accepts the worker's `generationButtonFound` spelling
  (and the legacy alias), eliminating the misleading `generate=false`
  diagnostic despite a valid composer fingerprint.

### 2026-09-21 fresh-ref destructive-click gate and edit-route recovery

- The Flow accessibility ref is now re-read immediately before every generic
  BrowserMCP click. The executor compares the requested `ref + label` with the
  fresh snapshot and refuses the action when the ref was recycled, the label
  changed, or the current target is destructive. This closes the gap where a
  safe cached label could point at Flow's Trash icon after a route transition.
- On `/project/<id>/edit/<media-id>`, only Back/Undo/Download/Done editing
  controls are allowed. Image fallback automatically returns to the same
  pinned project before inspecting or typing; it never clicks Restore,
  Delete permanently, Trash or a generic More options control on that route.
- A stale-ref or edit-route rejection is recorded as a blocked safety event
  with the fresh snapshot evidence; it does not retry the click or claim a
  generated asset. Unit tests cover recycled refs, Trash labels and unknown
  controls on edit routes.

### 2026-09-20 per-shot DOM proof retention

- The image runner no longer lets a later accessibility snapshot erase a valid
  same-project DOM composer proof. After the model gate, a report with the
  exact image-editor/ingredients fingerprint remains valid for the current
  project, even when Flow hides the Nano Banana label outside Agent settings.
- Before every shot, the runner still re-reads the live DOM and requires the
  current project URL, exact prompt editor, enabled image Generate control and
  image-mode evidence. A blocked DOM probe now reports project, editor,
  Generate, image-mode and fingerprint fields instead of the misleading
  generic “Nano Banana + prompt” message.
- This change is transport/gating only. It does not click Generate, create
  paid media, delete/restore Flow media, or convert a blocked 5/12 run into a
  success; the existing resumable partial state remains authoritative.

### 2026-09-20 exact image-composer gate and bounded transport retry

- BrowserOS no longer treats a generic `contenteditable` or a page-wide
  `Start generation` label as proof of the image composer. Before typing or
  clicking, the live DOM must show Flow's exact ProseMirror image editor,
  `Add ingredients to the prompt box`, and an enabled image Generate control.
  The output inspector records these evidence fields and the selected model.
- When a shot has `mediaCount` unchanged, no matching RUN/shot batch, and
  `generationActive=false`, the runner records the full DOM diagnosis, takes
  a fresh snapshot, reacquires the exact composer and retries that same shot
  once. It never downloads a historical tile, deletes imported assets, or
  retries indefinitely; a second failure remains resumable and blocked.

### 2026-09-20 image fallback route guard and partial-resume evidence

- The Vision planner may inspect a fresh screenshot/DOM, but `Tools` is a
  video-only fallback. When the goal is Nano Banana/image composer, the Rust
  executor rejects `Tools`, media menus and new-project controls before any
  browser click; the planner must keep the current project and return a fresh
  image ref or stop.
- The image fallback reconciles local assets before probing the provider
  composer. If Flow is blocked at shot 1, the report preserves the verified
  `N/N` local assets and resume skips those shots; it no longer reports `0/N`
  or implies that existing images were deleted/regenerated.
- If a previous video attempt left the shared Flow tab at `/tools`, the image
  route first returns to the same project using a fresh Back ref, or a pinned
  provider project URL when Back is absent; it never opens Tools again.
- A Trash/Delete overlay is now a hard safety boundary. The image route may
  use only a fresh `Undo` recovery ref; stale `Agent`, `Tools`, media and
  destructive refs are rejected before BrowserOS receives the click.
- The shared Rust executor now applies a final destructive-click lock for every
  BrowserOS/BrowserMCP route, including direct actions outside the Vision
  planner. Labels containing Delete, Remove, Trash, Move to trash or their
  Vietnamese equivalents are rejected before a worker is spawned and recorded
  as `BLOCKED_DESTRUCTIVE_FLOW_CLICK`; only non-destructive recovery controls
  such as Undo/Back can proceed.

### 2026-09-20 project/composer fingerprint gate

- BrowserOS now reads the live DOM URL and emits a composer fingerprint instead
  of trusting only the accessibility snapshot: project key, exact ProseMirror
  image editor, Add ingredients control, enabled Generate control and selected
  Nano Banana Pro model.
- Model setup is idempotent. If the current composer already proves Nano Banana
  Pro x1, the worker does not click the selected model button looking for an
  option that Flow does not render. If x1 is not proven, it opens the settings
  panel, searches menu/listbox/option/button controls in the live DOM and logs
  candidate labels when the option is absent.
- The selected model/x1 fingerprint is persisted per project/page. Type and
  Generate require that fingerprint, while the native Rust report rejects a
  worker response whose live target URL belongs to another project.

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

- 2026-09-19 asset-optional video-first correction: Nano Banana reference images are optional.
  The default run only uses image-to-video Animate when a complete reference set already exists;
  missing or partial assets no longer block the run at `0/N`. The runner falls back to direct
  per-shot text-to-video, validates/downloads every shot, and composes the final project output
  only after all required video shots are present.

- 2026-09-19 Flow mode-selector correction: a fresh project snapshot can expose the bottom
  composer only as an exact `Agent` button, with no visible Video/Text-to-video control yet.
  The runner may click that exact mode selector once, take a fresh snapshot, and continue only
  when an explicit video mode, prompt control and Generate control are visible. `Add media`,
  `Add ingredients` and chat remain prohibited substitutes; no prompt or paid generation is
  sent while the mode evidence is missing.

- 2026-09-19 Flow tool-picker correction: the live project snapshot also exposes a `Tools`
  navigation link beside the All media/image composer. Video discovery now opens that exact
  Flow navigation first, snapshots again, and only then tries the bounded Agent mode selector.
  This remains navigation-only and does not authorize prompt entry or paid Generate.

- 2026-09-19 Windows mapped-cache correction: video session saves now write a uniquely named
  recovery snapshot before updating the stable session index. If Windows returns
  `ERROR_USER_MAPPED_FILE` (os error 1224) because the fixed index is mapped by WebView or
  another process, the save remains recoverable and the reader prefers the newest valid recovery
  snapshot on the next launch. Other filesystem failures remain explicit errors.

- 2026-09-19 Browser planner wait correction: the bounded planner contract already permits
  `{"action":"wait","ref":null}` while Flow is visibly loading. The executor now sends that
  page-level wait without requiring a UI ref; only click/type still require a fresh allowlisted
  ref. This prevents a legitimate loading wait from being reported as a planner failure before
  the next snapshot.

- 2026-09-19 Flow route-priority correction: the live project snapshot exposed both `Agent` and
  `Tools`, but opening `Tools` first moved the session to `/project/<id>/tools` and removed the
  Agent/video refs. The runner now opens the exact project-level `Agent` selector first; `Tools`
  is fallback-only. A stale `/tools` route can return through its fresh Back ref before another
  composer probe, with no prompt or Generate action during navigation.

- 2026-09-19 Agent-menu fallback correction: after the project-level `Agent` selector was opened,
  the live snapshot exposed only `Agent instructions`, `Settings` and `Start generation`, not
  Video/Text-to-video. The runner no longer falls through to `Tools` after that attempt; it
  reports `BLOCKED_VIDEO_MODE_NOT_EXPOSED` with the exact missing capability and preserves the
  project route.

- 2026-09-20 Flow capability probe cache: once a project-level Agent menu has been freshly
  inspected and proves that Video/Text-to-video is not exposed, the desktop UI stores that
  negative capability result in local storage keyed by local project plus provider project
  identity/current URL. Subsequent auto-runs stop from the cached result without repeating
  planner or snapshot discovery. The user-facing `Đọc trạng thái Flow` snapshot action clears
  the project cache for an explicit re-probe; changing provider project identity or URL uses a
  different cache key automatically.

- 2026-09-20 Flow image fallback: when an auto-run proves that the current Flow project only
  exposes the Nano Banana image composer, it no longer treats the provider mismatch as the
  final run failure. It generates one image per planned shot through the verified image route,
  imports each new file, then invokes a bounded local FFmpeg/FFprobe compose command using the
  requested shot durations. The output is explicitly labeled an image slideshow with light
  camera motion, not a provider-generated motion video; the workflow never clicks an image
  `Start generation` control as if it were video.

- 2026-09-20 Flow fallback detection and authentication gate correction: the auto-run now
  recognizes the persisted semantic signature `Agent` + `Settings`/`Settings trigger` +
  `Start generation` with no Video mode, even when the workflow's generic `lastMessage` only
  says that a snapshot completed. This preserves the image fallback instead of ending at 86%.
  A fresh Google sign-in page (`accounts.google.com`, or the Email/Password + Google sign-in
  UI signature) is reported as `BLOCKED_GOOGLE_SIGN_IN`; the app never enters credentials and
  asks the user to authenticate once in the BrowserOS profile.

- 2026-09-20 native smoke test: rebuilt the Tauri executable, launched it, clicked `Tự làm
  toàn bộ` through the live WebView DOM, and observed the fallback reach Nano Banana Pro,
  enter `SHOT-001`, and wait for a real Flow download. Flow reached the bounded 300-second
  wait without producing a new file, so the run ended with `0/12` images and no false video
  success. Provider output/download remains an external-state blocker.

- 2026-09-20 composer route-settling correction: Flow can expose only a root ref for a short
  interval after leaving `/tools` or opening the Agent selector. The desktop composer probe
  now waits two seconds and takes a fresh snapshot after each bounded navigation action before
  deciding that the composer is missing. It also recognizes the live image-agent signature
  `Agent instructions` + `Settings` + `Start generation` even when the exact `Agent` selector
  ref is absent, returning `BLOCKED_VIDEO_MODE_NOT_EXPOSED` so auto-run enters the image fallback
  instead of retrying the planner and ending at the generic `composer.ready` blocker. A live
  BrowserOS wait/snapshot rehearsal returned the signed-in project URL with 71 fresh refs and
  the expected image-agent signature without spending another generation credit.

- 2026-09-20 native validation: installed Microsoft C++ Build Tools/Windows SDK, rebuilt the
  Tauri release executable successfully, and clicked `Tự làm toàn bộ` through the live desktop
  accessibility tree. The run reached the intended `Flow image fallback từng shot + FFmpeg
  compose` branch, then stopped honestly at `0/12` because Flow did not return image downloads.
  A follow-up report showed Flow changing fresh `Start generation` to `Stop` after prompt entry;
  image generation now treats that as an active generation and never reuses the stale pre-type
  ref that previously caused `Unknown ref e80`.

- 2026-09-20 fallback gate correction: `BLOCKED_CHAT_ROUTE`, `BLOCKED_VIDEO_COMPOSER`, and
  `BLOCKED_VIDEO_MODE_NOT_EXPOSED` now all route to the image-per-shot fallback, while sign-in,
  credit and connection blockers remain fail-closed. The full fallback still requires 12 verified
  downloads before local FFmpeg compose and never runs Blender.

- 2026-09-20 image transition correction: after prompt entry, Flow can temporarily remove both
  `Start generation` and `Stop` from the accessibility tree while the request is committed. The
  fallback now captures the media baseline before typing, checks the live DOM for
  `generationActive`/one fresh media, and waits up to five fresh two-second snapshots before
  declaring the shot blocked. It never retypes the prompt or clicks a stale Generate ref during
  this transition.

- 2026-09-20 BrowserOS image download correction: the Flow bridge can acknowledge an ordinary
  accessibility click on `1K original size` without emitting a file into the user Downloads
  folder. The worker now prefers the BrowserOS `download` helper for the final size menu item,
  preserves attached/action flags when a later file check fails, and includes media ID, click
  method, download directory and visible-file diagnostics in a blocked report. A live download
  test for fresh media `5699dc1a-6fe5-4830-aa54-27282cbf74e0` returned a real
  `flow-SHOT-001-rev-001.jpeg` (264,822 bytes) in the workspace.

- 2026-09-20 revision composer route correction: Google Flow returns to
  `/project/<id>/edit/<output-id>` after downloading an image. Before revision, the desktop app
  now navigates back to the project root, re-verifies the Nano Banana Pro image composer, and
  only then types the revision prompt; it no longer assumes the output-detail route exposes the
  ProseMirror prompt editor.

- 2026-09-20 revision timeout/resume correction: a 300-second revision wait now extends to a
  900-second bounded window when fresh DOM snapshots still show generation activity or recent
  activity. The app never resubmits while Flow is active; if Flow has stopped with no output it
  retries the same revision identity once as a transport recovery, then fails closed. On a later
  run it first inspects and downloads an already-created revision output before generating again,
  and the fallback log tells the user to resume from the existing `N/N` assets instead of
  restarting the 12-shot batch.

- 2026-09-20 unlabeled-output DOM correction: some Flow image cards omit `SHOT_ID/RUN_ID` from
  `flow-batch-info` even though the DOM media count changes from 15 to 16 after the current
  Generate. The fallback now accepts only an exact temporal `+1` media delta with generation
  stopped, then asks the BrowserOS/Playwright worker to select the newest tile and still requires
  a new local download before import. A delta of zero or more than one remains blocked to avoid
  importing history.

- 2026-09-20 detail-route download correction: Flow output detail `/edit/<id>` exposes a single
  toolbar `Download media` control without batch identity. BrowserOS/Playwright now prefer that
  unique detail-route control before tile/history fallback and still require a fresh local file
  as success evidence.

- 2026-09-20 live DOM re-probe correction: a cached video-composer blocker is now diagnostic only;
  every run takes fresh BrowserOS/UI snapshots and re-analyzes the current route. After the Agent
  menu is inspected, the route may still try a newly exposed Tools ref before concluding that
  Video/Text-to-video is unavailable. This prevents a stale probe or one menu layout from
  permanently blocking the automatic image fallback.

- 2026-09-20 action-recovery correction: when the planner returns a stale/missing ref or a click/type
  fails, the agent now starts a bounded recovery turn with the execution error plus a newly captured
  screenshot and DOM/UI snapshot. The model must return a ref from that new snapshot; infrastructure
  failures such as missing Python or provider credentials remain terminal and are not retried as UI
  actions.

- 2026-09-20 revision safety correction: Playwright no longer falls back to an arbitrary
  `contenteditable`/Agent chat editor. Before typing a revision it requires the exact image-composer
  editor and a visible enabled Generate control. If revision fails, the outer image run preserves all
  previously imported assets instead of returning an empty `generatedAssets` list.

- 2026-09-20 revision continuity correction: an open Flow image-detail panel is now closed by its
  current `Close` ref before image-composer discovery. The planner is forbidden from clicking
  `Create New`/`New project` when the current provider project is known. If Gemini revision fails,
  the original shot remains valid and the batch continues to the next shot instead of stopping at
  `N/N`.
