# Changelog

## 0.6.4-dev — 2026-08-25

### Coding 2.5D instructional videos — 2026-10-03

Added a `coding-25d` visual mode that turns a prompt into an original, technically meaningful lesson for LeetCode-style algorithms and system design. `scripts/coding_lesson.py` validates a data-only teaching-scene contract (`contracts/coding-lesson.schema.json`) and computes real traces for two-sum, binary search, longest unique substring, BFS, cache-aside, token-bucket rate limiting, message queues and URL shorteners; `scripts/local_coding_25d_worker.py` renders those scenes as 1280x720@30 procedural frames with a readable code panel, array/graph geometry, code-line highlighting and directed packets. No animation-engine dependency was added; Manim/Motion Canvas were evaluated and Remotion was rejected as a default for its non-MIT commercial terms (`research/RESEARCH_CODING_ANIMATION_REPOS_2026-10-02.md`).

The native supervisor embeds both scripts, deploys the helper beside the deployed workers, verifies the rendered MP4 with FFprobe per mode, and propagates the live cancellation token to the frame renderer. Coding scripts default to `caption-only`, which produces a real video-only MP4 without invoking OmniVoice; claims stay `needs_review` and rights/publishing remain human decisions. The desktop topic workflow gained coding presets, an engine card, audio-mode control and deterministic scene review. Verified: 17 coding planner tests, 16 renderer tests, 157 Rust tests, the project validator (557 files) and `tsc && vite build` pass. Technical correctness, creative quality, accessibility, rights and platform policy still require human review; local captions are not narration audio.

Added a Vietnamese-first `Voice Studio` tab for VieNeu-TTS v3 Turbo. The tab standardizes preset voice selection, bounded temperature 0.6–1.2, experimental inline emotion cues (`[cười]`, `[thở dài]`, `[hắng giọng]`), local WAV preview and per-segment cue assignment. Added `voiceSettings` and `voiceCue` to the video-script contract; approved native rendering now carries the selected voice settings into the VieNeu request and maps allowed cues into narration. Rust and Python boundaries validate temperature, workspace-relative reference audio, clone consent and overwrite protection. Voice cloning remains opt-in, consent-gated and local-only; no impersonation, cloud TTS or automatic publishing was enabled. Added VieNeu research/plan registration and validation coverage. Python tests (17), Rust tests (39 passing; 4 ignored), frontend build and project validator pass.

Voice Studio is a configuration and preview surface, not a legal clearance system or a free-form emotion mixer. VieNeu v3 Turbo style prompts are not treated as supported emotion controls; cue behavior remains experimental and requires listening review. Preset/reference voice rights, AI disclosure, platform policy and final delivery remain human-review responsibilities.

### Google Flow shot automation hardening — 2026-09-28

Added a native shot-layout canvas with stable segment identity, local-only shot-reference assignment, and saved canvas state separate from script order. Added bounded Google Flow image-card discovery, SQLite-backed reference preflight, exact media-ID attachment, and fail-closed verification of the selected ingredient immediately before prompt entry and Generate. Shot prompts now sanitize brief-derived local paths and provider image tags; split-shot inspector previews cover every paid part. Reference fingerprints and checkpoint provenance prevent a changed assignment from silently resubmitting a shot. Existing budget, rights, review and credit-cap gates remain in force. No provider request or paid generation was used.

Focused Node suites, desktop build, Rust formatting and full Rust tests passed (148 passed, 4 ignored). Native WebView2 drop, DPI mapping, durable assignment/save-reopen, and live Flow DOM identity remain unverified; native acceptance requires human review.

### Desktop modularization, first slice — 2026-09-27

Moved the workspace node canvas into `desktop/src/features/workspace/ProjectWorkspaceCanvas.tsx`, with its own node model and a narrow, structural prop contract. Moved the saved video-session list/save/delete Tauri commands into `desktop/src-tauri/src/video_workflow_sessions.rs`; `invoke_handler!` still registers the same command names, and command payloads and session persistence remain unchanged. No Axum server or dependency was added.

`pnpm run build` passed (Vite warned that the 643.93 kB JavaScript chunk exceeds its 500 kB threshold). `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check` passed; `cargo test --manifest-path desktop/src-tauri/Cargo.toml video_session_` passed 2 focused tests; the project validator passed with 458 registered files. Vite preview smoke verified the empty-workspace state and its local project-form callback; it had no Tauri backend. No provider requests or credit spend occurred.

`App.tsx` and `lib.rs` remain large; this is the first feature-boundary extraction, not completion of the full modularization plan.

### Desktop modularization, second slice — 2026-09-27

Moved reference-set input validation and the list/create/update/archive/restore/assign/detach Tauri commands from `lib.rs` into `desktop/src-tauri/src/reference_sets.rs`. `invoke_handler!` registers the same command identifiers through the module; frontend invoke strings, DTOs, database behavior, audit events and project/asset ownership checks remain unchanged. No schema, dependency or provider-call changes.

`pnpm run build` passed with the existing 643.93 kB chunk warning. `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check` passed; `cargo test --manifest-path desktop/src-tauri/Cargo.toml reference_` passed 8 tests (123 filtered); the project validator passed with 459 registered files. Browser smoke rendered the workflow page but had no Tauri backend, so command invocation was not exercised through UI. No provider requests or credit spend occurred.

`lib.rs` remains 20,120 lines; this is the second bounded extraction, not completion of modularization.

### Desktop modularization, third slice — 2026-09-27

Moved `AssetReferencePanel` into `desktop/src/features/assets/AssetReferencePanel.tsx` and its `AssetView`, draft and reference-set view types into `assetTypes.ts`. `App.tsx` now imports the feature while retaining project state, Tauri callbacks and page composition; existing styles remain in `App.css`. UI props, rights states, approval actions and command behavior are unchanged.

`pnpm run build` passed with the existing 643.93 kB chunk warning. The project validator passed with 461 registered files (100 JSON, 17 YAML; semantic YAML validation unavailable). Vite browser smoke rendered the extracted panel with empty fixture data and verified its empty states; the preview had no Tauri backend and no callback or project write was exercised. No provider requests or credit spend occurred.

`App.tsx` remains 11,373 lines; this is the third bounded extraction, not completion of modularization.

### Desktop modularization, fourth slice — 2026-09-27

Moved `AssetPackReviewPanel` and its Asset Pack TypeScript view types into `desktop/src/features/assets/`; `App.tsx` retains state, data loading and mutation callbacks. Moved Asset Pack Rust DTOs, parsing/review/Blender-binding helpers and all five Tauri commands into `desktop/src-tauri/src/asset_packs.rs`; command identifiers and handler payloads are unchanged. Shared process/path/database helpers stay in `lib.rs`; existing UI styles stay in `App.css`.

`pnpm run build` passed with the 643.93 kB chunk warning. `cargo fmt --check` passed; the migration test passed, and the focused Asset Pack checklist test proves the 64/65 acceptance-check boundary. Browser smoke rendered empty and populated review states and confirmed the Blender gate stays disabled for an unapproved item. The preview had no Tauri backend; no callbacks, project writes, Blender or provider actions were performed.

`python scripts/validate_project.py --project .` passed (`AUTO3DVIDEO_PROJECT_VALID`, 463 manifest and physical files, 100 JSON, 17 YAML). Semantic YAML validation was unavailable; external tools were not run.

`App.tsx` is 11,170 lines and `lib.rs` is 18,661 lines; modularization is not complete.

### Desktop modularization, fifth slice — 2026-09-27

Moved `SubtitleStudioPanel` and subtitle document/report types into `desktop/src/features/subtitles/`; moved the shared `ProcessRunSummary` DTO into `desktop/src/processTypes.ts` to avoid a feature-to-App type dependency. `App.tsx` retains project state, file dialogs and Tauri callbacks. `App.css` and the existing `subtitle.rs` command module are unchanged.

`pnpm run build` passed with the existing 643.93 kB chunk warning. Vite browser smoke rendered empty and populated states; the empty state gated probing/loading until inputs were present, and a local-fixture split produced two timed cues and a draft document. The preview captured the edit in a harness callback only; no Tauri command, project file write, provider or worker ran.

`python scripts/validate_project.py --project .` passed (`AUTO3DVIDEO_PROJECT_VALID`, 466 manifest and physical files, 100 JSON, 17 YAML; environment template validation passed). Semantic YAML validation was unavailable; external tools were not run.

`App.tsx` is 10,983 lines. This is the fifth bounded extraction; additional screens and Rust command families remain.


### Desktop modularization, sixth slice — 2026-09-27

Moved `PreviewLibraryPanel`, preview view models, URL/card parsing and display helpers into `desktop/src/features/preview/`. `App.tsx` retains project state, worker calls, callbacks and page composition; preview CSS and behavior are unchanged.

`pnpm run build` passed (`tsc && vite build`); Vite reported a 643.93 kB JavaScript chunk above the 500 kB warning threshold. Vite browser smoke rendered the Preview Library empty state, platform filters and disabled scan action without a selected project. The preview had no Tauri backend; no worker, project mutation, provider request or generation ran.

`python scripts/validate_project.py --project .` passed (`AUTO3DVIDEO_PROJECT_VALID`, 469/469 files, 100 JSON, 17 YAML; environment-template validation passed). The run first identified the existing `desktop/src-tauri/src/project_jobs.rs` missing from `MANIFEST.json`; that source is now registered. Semantic YAML validation was unavailable; external tools were not run.

`App.tsx` is 10,580 lines. The Preview Library is the first bounded frontend extraction from the remaining architecture slices.

### Desktop modularization, seventh slice — 2026-09-27

Moved `PromptStudioPanel` and its `PromptPreset` / `PromptPresetDraft` view types into `desktop/src/features/prompts/`. Added a feature-owned activity callback contract; `App.tsx` retains preset loading/mutations, workspace activity recording, brief application and page composition. Existing Prompt Studio styles and behavior are unchanged.

`pnpm run build` passed (`tsc && vite build`) with the existing 643.93 kB JavaScript chunk warning. Vite browser smoke rendered the empty preset state and editable draft under Quản lý nâng cao. No Tauri backend was available; no save/apply action, project write, provider request or generation ran. Browser runtime errors were empty.

`python scripts/validate_project.py --project .` passed (`AUTO3DVIDEO_PROJECT_VALID`, 471/471 files, 100 JSON, 17 YAML; environment-template validation passed). Semantic YAML validation was unavailable; external tools were not run.

`App.tsx` is 10,380 lines; the broader modularization plan remains in progress.

### Desktop modularization, remaining slices — 2026-09-28

Moved the remaining workflow screens, feature view types, state hooks and feature-owned Tauri adapters under `desktop/src/features/`. `App.tsx` now keeps app-wide bootstrap/status queries, shared refresh coordination, project/navigation state and page composition; feature reads and Google Flow account connection live with their owners. Moved all remaining Tauri command bodies and private feature helpers from `lib.rs` into Rust feature modules. `lib.rs` has no `#[tauri::command]` implementations; shared bootstrap, state, migrations, execution/database helpers and existing tests remain. Existing command names/payloads, contracts, schemas, rights gates and process safety are unchanged.

`pnpm run build` passed (`tsc && vite build`); Vite reported a 674.00 kB JavaScript chunk above the 500 kB warning threshold. `cargo fmt -- --check` passed; `cargo test` passed 128 tests with 4 ignored external-tool cases. Vite smoke rendered all 13 navigation routes with no browser runtime errors; its preview had no Tauri backend and performed no provider, generation, project mutation or worker action. The repository validator passed with 534 manifest and physical files (100 JSON, 17 YAML); semantic YAML validation was unavailable and external tools were not executed.

`App.tsx` is 664 lines and `lib.rs` is 2,641 lines. This completes PLAN-027's named feature ownership slices; the remaining shell and bootstrap responsibilities are intentionally shared.

### Desktop Google Flow video route — 2026-09-26

The primary one-prompt video action uses the attached BrowserMCP session, navigates to the saved Flow project ID and verifies the live target and video composer before typing any shot prompt. The live DOM must expose the selected model, aspect ratio, resolution, duration and one unambiguous price; the app then estimates `price × planned shot count` and requests one approval for a hard batch cap before prompt entry. It rechecks project, composer, settings and price before each prompt and Generate; changed settings, missing price or cap overflow blocks before that shot. Each accepted output must be new, downloaded, FFprobed and imported before the next shot. No automatic retry or publishing.

Flow project destinations are saved by display name and ID in a list scoped to
the selected Auto3Dvideo project. This remains a local saved list, not Flow
account discovery; it neither creates a remote project nor starts generation.

The selected saved project already exposes a Video composer. Live DOM inspection
confirmed the unchanged `Omni 1.1 Flash`, 16:9, 720p, 8-second selection and
12-credit unit price. Media-heavy project snapshots previously saturated
BrowserOS refs with gallery controls; snapshots now prioritize composer, price
and download refs, while same-project DOM evidence verifies the selected
settings. The settings inspector waits for evidence without toggling an
already-open menu.

The resumed preflight unexpectedly auto-accepted the embedded WebView's native
`window.confirm` and made one Generate click. Auto3Dvideo recorded a 12-credit
estimate, then stopped because its inspector found ambiguous matching outputs.
No clip was downloaded, imported or composed. The actual Google Flow charge and
output status are unverified. No retry was made. The budget gate now uses an
explicit in-app approval dialog before any future batch can proceed.

The video input/Generate path uses a typed Tauri action backed by BrowserOS DOM evidence, validates the exact saved Flow project, `Omni 1.1 Flash`, live unit price and full approved batch cap, and binds output to run/shot/revision before download. Ambiguous output, changed settings, uncertain clicks or timeouts stop without retry. Batch approval now uses explicit in-app Approve/Cancel controls; no native `window.confirm` can authorize provider spend.

Output reconciliation recognizes Flow's image-backed video posters only when
the card exposes video model/resolution/duration/aspect metadata and exact
run/shot/revision identity. Unrelated image cards are excluded; ambiguous video
outputs still stop without retry.

The Flow video worker now restores temporary Download accessibility labels
before preparing a fresh BrowserOS ref, and cleans them after the action.
Regression coverage includes legacy markers without saved label metadata.
The code change itself triggers no Google Flow request or credit spend.

Interrupted batches now persist their run identity and pre-Generate shot/revision
credit estimates in local storage scoped to the Auto3Dvideo project, Flow
project, workflow session and source-prompt hash. Resume checks exact run/shot/
revision output before continuing; it imports only a unique match, skips
already-imported clips and blocks if a prior Generate has no verifiable output
instead of repeating a paid action. Remaining shots require explicit batch
approval; the cumulative estimate covers this checkpointed run only, not
uncheckpointed/provider usage. Checkpoints clear only after FFprobe confirms
composition; actual provider charges remain unverified.

Batch resume now selects the saved workflow with the most imported videos for
the exact Auto3Dvideo project, session and Flow run when discovery created a
new empty workflow. Imported video identity must include the exact run, shot,
revision and input hash; missing or cross-run evidence cannot authorize another
Generate. The same run's unimported output is reconciled before any new shot.

Video and image composition accept canonical uppercase `SHOT-###` identifiers
through the same ASCII identity validator used by Flow actions, while still
rejecting path syntax. FFmpeg can now receive the identifiers emitted by the UI.

For legacy shot plans that repeat the whole brief under a generic role
contract, each paid Flow prompt now uses only that shot's numbered source
description plus the source subject, opening context, style and continuity.
This generic fallback avoids sending stale dinosaur-template text instead of
the user's project-specific shot plan; no generation or provider cost is
incurred by the change.

Flow composition now trims every imported clip to its planned shot duration
before concatenation and rejects the output unless FFprobe confirms the
requested total duration. This keeps the 12-by-5-second storyboard at 60
seconds even when Flow's available generation duration is 8 seconds.

The batch approval popup is app-owned, accessible and explicitly canceled or
approved by the user. Cancel/Escape resolves the waiting run before prompt entry.

The Flow edit-route safety allowlist now accepts the exact Vietnamese “Đã chỉnh sửa xong” completion control as well as “Done editing”. Unknown and destructive controls remain blocked. This guard fix triggers no Flow request or credit spend.

### 2026-09-27 checkpointed Flow video import recovery

Restarted imports can reuse an existing Flow video only when the request has
valid run/shot/revision/input-hash identity and source/destination size and
SHA-256 match. Conflicting files remain untouched and fail closed. New files
are created without overwriting; copy/hash or FFprobe rejection rolls back only
the file created by that import. Reused outputs are still FFprobed before they
are recorded in the resumed workflow. A focused Rust regression covers exact
reuse and same-size mismatch preservation. This local fix starts no Flow
generation and performs no publishing.

### Windows Flow worker output encoding — 2026-09-24

Fixed gflow-cli generation and interactive-login worker stdout to emit ASCII-escaped JSON, preserving Vietnamese success and failure messages under legacy Windows code pages. Added cp1252 regression coverage for both report and error output. No generation was started by this fix.

### Google Flow auth preflight diagnostics — 2026-09-24

Failed `gflow auth status` probes now remain fail-closed but return `GFLOW_AUTH_UNVERIFIED` with the CLI's safe diagnostic instead of misreporting every probe error as missing login. Rust surfaces structured worker failure JSON on non-zero exits while retaining credential redaction. The no-generation login worker now reports only allowlisted auth event fields and error classes on failure; raw browser/CLI output is withheld. A retry emitted no safe structured diagnostic, so the underlying login issue remains unresolved. No generation was started and no credits were spent.

### BrowserOS live target resolution — 2026-09-24

BrowserOS clicks now resolve the requested exact accessible label from a fresh same-session snapshot and use that snapshot's unique interactive ref; stale refs are not reused. Recycled page IDs outside Google Flow are blocked without clicking or opening another tab, and attachment status requires a verified Flow URL rather than generic UI refs. Mocked click/origin regressions pass. A live non-generation `Trang chủ` click resolved from a fresh snapshot and completed; no paid generation was attempted.

Added `Subtitle Studio` to the Windows desktop UI. The new local editor probes a user-provided video with FFprobe, loads SRT/VTT through a bounded Python worker, edits cue text and millisecond timestamps, supports add/delete/split/merge and find/replace, warns on overlap/end-time/CPS/line length, exports a new SRT/VTT sidecar and burns subtitles into a new MP4 copy through the native direct supervisor. Added `subtitle-document.schema.json`, `subtitle_worker.py` coverage, native `subtitle.rs` commands, workspace containment, output overwrite protection, SHA-256/FFprobe evidence and the Subtitle Studio plan. Source video is never overwritten; automatic transcription/translation providers are not silently called, and TikTok/Douyin/YouTube scraping, watermark removal and auto-publish remain disabled.


Added a manifest-driven licensed-footage recipe for the Windows native local Topic-to-MP4 path. The collector accepts only explicitly registered HTTPS sources from the NASA SVS/Wikimedia allowlist, verifies video signatures and SHA-256, supports offline verification, and always emits `needs_review`. Added `local_licensed_footage_worker.py`, `licensed-footage-space` script/schema fields, path/size/rights/SHA validation, per-shot asset provenance, and native FFmpeg video-input handling with portrait crop, source-audio removal and bounded duration. Added unit tests for offline provenance, host/filename/rights rejection, missing assets and worker mapping, plus an opt-in native Windows E2E using three downloaded space clips, VieNeu `Phạm Tuyên`, SRT, H.264/AAC MP4, FFprobe and durable SQLite evidence.

The sample package is under `outputs/licensed-space-footage-2026-08-25/` and remains `succeeded_needs_review`; NASA conditions, CC BY attribution, platform scope, target jurisdiction, visual crop, captions and final human review are not cleared by technical success. Added `PLAN-011-LICENSED_SPACE_FOOTAGE.md`, a reusable workflow example, `rights-ledger.json` and `attribution.md`. No TikTok/Douyin/YouTube downloader, scraping, watermark removal, repost automation, auto-publish or cloud video generation was enabled. Cost status is `not_called` for this manually authored local render; source retrieval is recorded as provenance rather than claimed free or commercially cleared.

## 0.6.2-dev — 2026-08-25

Added a rights-safe procedural `space-25d` recipe. The Python worker creates a deterministic 30 fps 720x1280 PNG frame sequence with layered stars, orbit rings, a glowing sun, colored planets, a ringed planet, a moving rocket marker and a readable infographic panel; it uses no network or external assets and records frame-pattern/count, animation mode, rights and review metadata. The Rust native path now selects this worker only when an approved script explicitly contains `visualMode: "space-25d"`, encodes the sequence as per-scene H.264 clips, muxes VieNeu/SRT, validates the final MP4 with FFprobe and records SHA-256 plus durable SQLite job/attempt/output evidence. Topic Studio exposes an intentional 2.5D checkbox for the approved script and the VieNeu panel defaults to the reviewed male preset `Phạm Tuyên` instead of `Adam`. Added the `PLAN-010` design, workflow fixture, example brief, contract allowlist and research notes covering Blender, Motion Canvas, Remotion licensing and the GPL camera add-on reference; GPL code/assets were not copied into core.

The approved native E2E produced `outputs/space-25d-infographic-2026-08-25/master.mp4`, a 9.840-second 720x1280 H.264 video with mono AAC 48 kHz audio, WAV, SRT, scene manifest, SHA-256 and durable evidence. The result remains `succeeded_needs_review`: visual depth, voice naturalness, script wording, captions, rights and disclosure require human inspection. Cost remains `local_gateway_unreported`; no TikTok/Douyin downloader, watermark removal, repost automation, automatic publishing or cloud video generation was enabled.

## 0.6.1-dev — 2026-08-24

Created and verified a disposable Vietnamese vertical space-animation sample through the durable Windows native path. The sample now recognizes a space topic, renders deterministic stars, a blue planet, orbit rings and a central sun using Pillow-generated local artwork, and applies a bounded 30 fps zoom-pan motion to each H.264 scene clip instead of presenting only a still card. The sample uses the documented built-in male VieNeu preset `Phạm Tuyên` rather than the previously hardcoded `Adam`; the UI default was updated accordingly. The local TTS worker now explicitly configures UTF-8 stdout/stderr on Windows so Vietnamese evidence messages do not fail on legacy console encodings. The real E2E produced a 12.240-second 720x1280 MP4 with H.264 video, mono AAC 48 kHz audio, WAV, SRT, scene manifest, SHA-256 and durable SQLite job/attempt/output evidence. The result remains `succeeded_needs_review`: visual movement, voice naturalness, script wording, captions, rights and disclosure require human inspection. Cost remains `local_gateway_unreported`; no automatic publishing or cloud video generation was enabled.

## 0.6.0-dev — 2026-08-24

Implemented and verified the first real local Topic-to-MP4 vertical slice on Windows. Topic Studio now separates script generation from rendering: generated scripts remain `pending`, the user can edit title, hook, narration, on-screen text, claim state and source note, and native rendering is blocked until every claim is resolved and the user explicitly approves the script. The approved path runs the bounded local Command Code worker, deterministic Pillow scene cards, local VieNeu ONNX TTS, SRT generation, per-scene FFmpeg clips, final FFmpeg composition and strict FFprobe validation. The manifest records H.264/AAC stream metadata, 720x1280 dimensions, duration, output size and SHA-256; SQLite persists a durable job, attempt and output-evidence lifecycle with redacted audit events and cancellation-token registration. Added mocked Python tests for success, empty visible model output, bounded retry, path traversal and scene containment. A real ignored Windows E2E passed through the durable wrapper using the configured loopback gateway, existing VieNeu cache and D-drive FFmpeg/FFprobe binaries; the resulting artifact is `succeeded_needs_review`, not publishable. Cost remains `local_gateway_unreported`; cloud generation and automatic publishing remain disabled.

## 0.5.0-dev — 2026-08-23

Fixed native Command Code probe dotenv discovery to use the same bounded current-directory/executable-ancestor resolver as provider readiness, and changed the UI to show a redacted native error summary instead of a generic failure. Added a bounded Command Code OpenAI-compatible connectivity probe for `poolside/laguna-s-2.1-free`. The probe uses the official `https://api.commandcode.ai/provider/v1` endpoint, a fixed 32-token Vietnamese test prompt, `x-cmd-zdr: 1`, local dotenv credential resolution inside the Python worker, redacted process logs and a native audit event; it does not enable general cloud generation, accept arbitrary prompts/models, store response payloads or publish. A live connectivity test reached the provider but returned HTTP 403 requiring a qualifying provider plan, so no Command Code chat generation is claimed and reported cost remains unverified despite the provider's free-while-capacity-lasts deal. The configured local gateway probe later reached `http://localhost:20128/v1` but returned HTTP 404 `no active credentials for provider: poolside` when using the plain provider model ID. A follow-up probe using the imported alias `cmd/poolside/laguna-s-2.1-free` returned HTTP 200 and the Vietnamese response `Đúng.`; this verifies narrow local connectivity while cost reporting remains unverified.

Added a bounded Topic Profile and Prompt Template Registry for multi-topic video planning. Added six sanitized profiles for science, history, narrative, product demo, gameplay/tutorial and cinematic 3D; nine versioned prompt templates for brief, research claims, storyboard, asset candidates, narration and domain-specific planning; JSON contracts and a no-network validator for IDs, versions, placeholders, references and safety guardrails. Added native `list_topic_profiles`, `list_prompt_templates` and `preview_topic_prompt` commands plus a Topic Studio UI where the user enters the topic, content goal and additional prompt, previews the rendered prompt and sees the selected recipe/asset policy/QA checklist. Preview remains non-persistent, no-spawn, no-network, zero-cost and human-review gated; cloud generation, automatic publishing and arbitrary prompt-driven process execution remain blocked.

Added a bounded local VieNeu-TTS v3 Turbo adapter for the Windows desktop path. The adapter uses the allowlisted Python supervisor, a project-relative request JSON, offline Hugging Face mode, bounded text/reference paths, WAV header/output validation and local audit events. Added readiness and synthesis controls to Settings; no API key is required, no model download is triggered automatically, and voice/likeness plus final listening review remain mandatory. The app-managed Windows Python now resolves the installed VieNeu package and model cache under `D:\Auto3DvideoTools\vieneu\`; a fixed local WAV smoke output passed FFprobe. Updated the local `.env` and provider YAML examples, project manifest and provider setup documentation. Cloud requests, automatic publishing and general arbitrary worker execution remain blocked.

Started the Tauri 2 Windows desktop implementation. Added a Vietnamese-first React dashboard, Rust/Tauri command boundary, SQLite migration, project workspace path safety, typed JSON recipe validation, mock recipe stage previews, queued/running/succeeded job transitions, bounded retry/cancel commands, audit events, provider endpoint/model/credential references, provider readiness status and job management controls. Added a versioned structured process-spec contract, Rust allowlist/path/timeout/secret validation and a no-spawn `preview_process` dry-run command with safe metadata-only output. Added an evidence-only mock delivery generator and manifest validator with hashes, package containment, overwrite protection, blocked rights/disclosure defaults and a Vietnamese review checklist. A review pass hardened malformed `files` handling, unknown-field rejection, normalized duplicate-path detection, finite-number validation, boolean-type rejection and premature approval blocking. Added a typed FFmpeg/FFprobe media-plan contract and validator, a sanitized slideshow plan fixture, and a no-spawn local tool-readiness report/test that keeps missing required FFmpeg and FFprobe blocked. Added the append-only `0002_execution_attempts.sql` migration, `job_attempts`/`job_outputs` persistence shape, a pending-attempt fixture and lifecycle validator/tests for leases, heartbeat, cancellation, reconciliation, redacted errors and output evidence. Added a pending-only `worker-plan.schema.json`, workflow-to-stage/attempt compiler, semantic validator and regression tests for dependency cycles, publish/raw-command rejection, malformed stage IDs and JSON round trips. Updated project inventory validation to ignore generated `outputs/` artifacts while keeping source inventory strict. Added an Antigravity IDE runbook, bounded `vi-VN` task catalog, workspace preflight command and catalog regression test; these improve agent handoff but do not replace MSVC, Rust/Tauri runtime or the native executor boundary. Added a read-only PowerShell native prerequisite diagnostic for Cargo/Rustup, active toolchain, MSVC/link.exe, Visual Studio C++ workload, disk space and optional local tools; it never installs or starts workers. Added native `enqueue_pending_job`, `prepare_pending_attempt` and `list_job_attempts` command preparation. The Recipe Catalog can now create a validated `queued` job without a worker; the Jobs surface can prepare and inspect a pending attempt plus its expected-output evidence through `list_attempt_outputs`. The UI sends user-selected typed executable/media/output metadata to the native boundary. Added a bounded read-only `list_audit_events` command and Vietnamese Audit local panel that shows event metadata without payloads or credential values. Added `0003_tool_configs.sql`, allowlisted `list_tool_readiness`/`save_tool_config` commands and a Settings tool-readiness form that stores only executable references, checks file/PATH metadata and never executes binaries or probes network. The readiness report now carries an explicit disabled worker gate until native build and supervision checks pass. Settings also exposes a read-only `worker_preflight` action that lists blockers and safety checks without spawning a process. Jobs can preview a per-attempt `preview_worker_launch` plan with expected-output count and blockers without claiming a lease or starting a process. Expected-output validation remains transactional, mock jobs persist truthful succeeded attempts and no process is spawned. The latest fresh suite passes project, link, migration, state, process, delivery, media, readiness, attempt, worker-plan, recipe, workflow, Python syntax, frontend build, Rust formatting, Cargo metadata, native cargo check and Rust unit tests. Migration smoke coverage now also rejects duplicate `(job_id, attempt_number)` rows and orphan `job_outputs` rows. Installed and verified Visual Studio Build Tools/MSVC 14.51.36231 on `D:\VSBuildTools`, including a real `pnpm tauri dev` native launch. Added `0004_attempt_execution_mode.sql` and explicit execution-mode evidence so the deterministic in-process mock supervisor can claim leases, heartbeat, update progress and cooperatively cancel while keeping `processStarted=false`; the Jobs UI exposes this mock action and polling. Added a verified local FFmpeg/FFprobe 9.0.1 essentials package under `D:\MediaTools`, matched its adjacent SHA256 checksum, and stored its absolute executable references in the local SQLite tool catalog. Added `desktop/src-tauri/src/external_worker.rs` with a direct no-shell supervisor that revalidates the allowlisted filename, clears the child environment, bounds/redacts logs, enforces timeout/cancellation and uses a Windows Job Object for process-tree termination. Added output containment/evidence helpers and native tests for direct process success, timeout tree termination, bounded logs and credential-shaped log redaction. Added the gated `run_ffmpeg_fixture` command and Settings UI action; it creates only a synthetic one-second MP4 in an app-owned workspace, then validates it with FFprobe. External results are not yet persisted into job attempts; Blender/ComfyUI, cloud providers and publishing remain disabled. A second native launch exposed a duplicate-column startup panic in the 0004 migration bootstrap; fixed it by checking schema_migrations and pragma_table_info before applying ALTER TABLE, and added a restart idempotency regression test. The post-fix Tauri launch opened successfully. A post-research security audit then restricted provider credential references to the explicit `none`, `env:VARIABLE_NAME` or `os:handle` forms, added rejection tests for raw/malformed secret-like values, and made tool readiness/resolution require the expected binary filename instead of treating any existing file as ready. Added durable `run_ffmpeg_fixture_attempt` execution with fixed FFmpeg/FFprobe arguments, output evidence persistence, cancellation race handling and startup reconciliation for interrupted external attempts. Added explicit local binary version probes through the same direct supervisor, loopback-only ComfyUI `GET /system_stats` health checking without workflow submission, and a conditional deterministic Blender synthetic-cube fixture using an app-owned script; no Blender installation was performed and general user-media, cloud, publishing and custom-node execution remain gated. Default Rust tests now pass with 25 tests plus one environment-dependent live FFmpeg/FFprobe integration test that passed when the verified D-drive paths were supplied explicitly; the frontend build remains green. Added `narrative-visual-plan.schema.json` plus a three-beat Vietnamese fixture with contiguous narration/frame coverage, immutable persistent entity anchors, visual-proof requirements, grounded positive/negative prompts, expected output paths and rights/cost/network/publish locks. Added Python semantic validation and regression tests for missing coverage, timing gaps, prompt drift, entity drift, unsafe paths, raw command fields and policy bypass. Added native no-spawn preview commands and a Review UI that displays beat timing, claims, entities, evidence, expected assets and prompts; no image/video provider or media generation is started by this slice. Added a bounded development `.env` loader and `get_provider_env_snapshot` command for independent LLM, image, video, TTS, STT, audio, asset3d, render3d and media profiles. The Model & API UI shows adapter/model/endpoint readiness, timeout, retry, fallback and masked credential state; process environment takes precedence, OS credential resolution is not implemented, and cloud calls remain blocked.

## 0.4.0-plan — 2026-08-22

Added multi-format video recipes for image slideshows, 2D motion graphics, HTML/React rendering, browser/screen demos, voiceover/captions, AI video shots, hybrid 2D–3D and true 3D. Added toolchain research, video recipe architecture, normalized recipe schema and four workflow fixtures.

## 0.3.0-plan — 2026-08-22

Added multi-provider and multi-model routing for LLM/chat, image, video, TTS/voice, STT, audio, true 3D and media operations. Added `.env.example`, provider profile/request/result contracts, non-secret provider registry, explicit workflow model profiles, credential resolution rules and provider setup runbook.

## 0.2.1-plan — 2026-08-22

Added the validated planning-pack release evidence, root navigation, manifest inventory enforcement, optional YAML parsing when PyYAML is already present, a deterministic zero-cost-capable estimator, rights/platform routing, database migration guidance, dependency/license policy, plugin/node policy, provider/output adapter boundaries, operations index, architecture diagram source, contribution guidance and security boundaries.

## 0.2.0-plan — 2026-08-22

Established the local-first Windows desktop architecture, research index, workflow fixtures, JSON contracts, automation job graph, 3D/Blender path, ComfyUI integration boundary, FFmpeg delivery path, human review gates, rights/provenance model, agent protocol and implementation backlog.


## Future releases

The first implementation release will be recorded only after a Tauri shell, SQLite migrations, deterministic mock runner and automated tests exist. Cloud providers and publishing capabilities must not be listed as implemented until their adapters, policy gates, receipts and review evidence pass.
