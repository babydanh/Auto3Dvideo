# PLAN-027 — Desktop modularization

## Status

`ARCHITECTURE_COMPLETED; milestones 1–8 complete; App.tsx retains app-wide bootstrap and composition; lib.rs retains shared bootstrap, state, migrations, helpers and tests`

## Problem

The desktop behavior is concentrated in very large source files: `desktop/src/App.tsx` owns app state, commands and page components; `desktop/src-tauri/src/lib.rs` owns app setup, shared types and many Tauri commands. Existing extracted modules prove the Tauri/React split works, but feature ownership and test seams are inconsistent. This raises change risk and makes future updates harder.

## Decision

Keep the current local-first Tauri 2 + React/TypeScript + Rust architecture. Do not add Axum: an HTTP server does not solve code ownership or modularity and is not needed by the desktop client. Refactor by feature boundaries and narrow typed interfaces, retaining Rust as the authority for filesystem, process, provider and cost controls.

## Non-goals

- No behavior, Tauri command name/payload, SQLite schema, workflow contract or output-path changes.
- No replacement of the production workflow with a generic graph executor.
- No extraction of a separate backend service, Axum server, or new runtime/dependency.
- No paid provider call, network operation, data migration or destructive cleanup.
- No mass formatting or arbitrary line-count target; modules must own cohesive responsibilities.


## Completion boundary

- `App.tsx` contains only app-wide project/session selection, navigation and top-level composition. Feature screens, feature DTOs, state hooks and command adapters live under `desktop/src/features/<feature>`; shared UI/types remain shared only when multiple features own them.
- `lib.rs` contains Tauri bootstrap, `AppState` wiring, database migrations, `invoke_handler!` registration and genuinely shared low-level helpers. Feature command bodies and domain operations live in feature-owned Rust modules.
- Every existing UI surface and Tauri command is assigned to an owner; no feature-specific panel or command implementation remains in the two monoliths.
- Preserve all command identifiers, JSON casing, migrations, workflow contracts, path/process boundaries, rights/approval/cost gates and output validation. Completion requires build, focused behavior checks, representative UI smoke and project validation; no line-count target.

## Target boundaries

1. **Frontend shell:** project selection, app navigation and page composition only. Feature modules own their screen components, feature-specific types, state hooks and command adapters where a real boundary exists. Shared UI remains shared only when used by multiple features.
2. **Rust bootstrap:** `lib.rs` owns Tauri setup, shared application state wiring and `invoke_handler!` registration. Feature command modules own typed `#[tauri::command]` entry points; domain/service helpers own validation and operations; existing process executor remains the only external-process boundary.
3. **Contracts:** Tauri command names and JSON casing, schema versions, SQLite migrations, approval behavior, secret redaction, project-root path checks, retry/idempotency and output validation remain unchanged.

## Delivery phases

### A. Baseline and seams

- Map app state, command registration, existing modules, feature types and callsites.
- Select a cohesive frontend extraction and a cohesive backend command slice that can move without changing contracts.
- Record focused behavior checks before each slice; do not copy shared definitions or create circular runtime imports.

### B. Milestone 1 — workspace and session ownership

- Extract `ProjectWorkspaceCanvas` and its node model/catalog into `desktop/src/features/workspace/ProjectWorkspaceCanvas.tsx`; keep page composition and feature actions in `App.tsx`.
- Move the three saved-video-session Tauri commands into `video_workflow_sessions.rs`; keep the existing manifest format and validation behavior.
- Leave domain DTOs in place in this first pass where they are shared broadly; expose only the command functions required by `invoke_handler!`.
- Do not alter canvas behavior, session persistence, command names, payload casing, storage locations or workflow state.

### C. Milestone 2 — reference-set command ownership

- Move the reference-set input validator and seven list/create/update/archive/restore/assign/detach Tauri commands into `desktop/src-tauri/src/reference_sets.rs`.
- Keep shared DTOs, role/scope validators and row-fetch helpers in `lib.rs`; import only the required state, validators, SQLite, audit and fetch APIs.
- Preserve exact command names, argument casing, SQL, audit events, project ownership checks and archived-set rules.

### D. Milestone 3 — Asset Reference frontend ownership

- Extract `AssetReferencePanel` and its asset/reference view types into `desktop/src/features/assets/`; keep project state, Tauri callbacks and app-wide orchestration in `App.tsx`.
- Move the app-wide `AssetView` type into the asset feature type module instead of duplicating a narrower incompatible shape.
- Preserve existing `App.css` rules and the panel's props, local state, rights labels, approval flow and command behavior.

### E. Milestone 4 — Asset Pack feature ownership

- Extract `AssetPackReviewPanel` and its asset-pack view types into `desktop/src/features/assets/`; keep project state, data loading and mutation callbacks in `App.tsx`.
- Move Asset Pack DTOs, manifest/review helpers and five list/register/review/Blender-binding Tauri commands into `desktop/src-tauri/src/asset_packs.rs`; keep migrations and shared process/path helpers in `lib.rs`.
- Preserve command identifiers, serde casing, SQL, project-root containment, rights/checklist gates, audit events, approval behavior and supervised Blender execution.
- Do not invoke providers, load user project data or run Blender during this refactor.


### F. Milestone 5 — Subtitle Studio frontend ownership

- Move `SubtitleStudioPanel` and subtitle-specific frontend DTOs into `desktop/src/features/subtitles/`; move the shared `ProcessRunSummary` DTO to `desktop/src/processTypes.ts`.
- Keep project state, file dialogs, Tauri calls and callbacks in `App.tsx`; keep styles and the existing native subtitle command module unchanged.
- Preserve cue editing, timing validation, SRT/VTT export, explicit burn-in controls, rights metadata and existing safety gates. Do not execute workers or providers during extraction.

### G. Milestone 6 — project and execution command ownership

- Move project, job, attempt, audit and process-preview Tauri handlers from `lib.rs` into a feature command module; preserve the existing invoke names and payloads.
- Keep shared `AppState`, migrations and narrowly shared database/state-transition helpers in the core until a separately validated owner exists.
- Preserve project deletion protection, expected-output validation, allowlisted executables, attempt limits, audit bounds, cancellation transitions and mock-vs-external execution semantics.

### H. Remaining architecture slices — completed

- Extracted the remaining feature screens, view types, state hooks and adapters into their owners: One Prompt, Topic, Video Vision, Browser Handoff, Jobs, providers/voice, Settings, Review, Audit, Help and Recipe Catalog, alongside the earlier Preview Library and Prompt Studio slices.
- Moved feature-owned refresh reads and Google Flow account connection out of `App.tsx`; hooks now own their Tauri calls. `App.tsx` keeps only app-wide snapshot/health/readiness queries, cross-feature refresh orchestration, navigation, shared project state and view composition.
- Moved all remaining Tauri command bodies and private feature helpers into cohesive Rust modules, including `app_shell.rs`, `asset_library.rs`, `catalogs.rs`, `google_flow_automation.rs`, `image_generation.rs`, `media_io.rs`, `preview_discovery.rs`, `provider_catalog.rs`, `tool_readiness.rs`, `true3d_scene.rs`, `voice_tts.rs` and `worker_execution.rs`. Existing `project_jobs.rs`, `asset_packs.rs`, `reference_sets.rs`, `video_workflow_sessions.rs` and other domain modules remain owners.
- `lib.rs` has no `#[tauri::command]` implementations; it retains Tauri bootstrap, shared application state, migrations, common execution/database helpers and existing test modules. Command identifiers, payloads, schemas, process-safety and rights gates are unchanged.

### I. Verification

- Run the frontend build, project validator and focused behavior checks for each changed slice; run Rust formatting/tests when native Rust changes.
- Smoke-test each extracted UI in representative empty and populated states without invoking real project mutations, providers or external workers.
- Update this plan and changelog with actual outputs; identify any unextractable shared bootstrap responsibilities explicitly.


## Milestone 1 acceptance

- `ProjectWorkspaceCanvas` has a feature-owned module and `App.tsx` imports it as a child view.
- Saved video-session list/save/delete commands live in their own Rust module and remain registered under the exact existing Tauri command names.
- Canvas interaction, persistence format, approvals, rights gates, process safety and user-facing feedback are unchanged.
- Targeted checks and a desktop smoke pass; no dependency, schema or provider-call changes.

## Milestone 2 acceptance

- Reference-set validation and seven Tauri commands live in their feature-owned module; `invoke_handler!` registers the same command identifiers.
- Database schema, serialized DTOs, validation rules, audit records and project/asset ownership behavior are unchanged.
- Targeted compile/tests and project validation pass; no UI contract, provider call or dependency changes.

## Milestone 3 acceptance

- `AssetReferencePanel`, its asset/reference view types and `AssetView` live in a feature-owned frontend module; `App.tsx` imports and composes them.
- The parent retains app state and Tauri-backed handlers; panel props and user-visible behavior, asset rights states and reference approval actions remain unchanged.
- CSS, command names, database schema, provider behavior and dependencies remain unchanged.

## Milestone 4 acceptance

- Asset Pack component and TypeScript view types live in the asset feature; `App.tsx` retains orchestration and Tauri-backed handlers.
- Asset Pack Rust DTOs, parsing/review/binding helpers and five Tauri commands live in `asset_packs.rs`; `invoke_handler!` registers the same command names through module paths.
- UI behavior, command payloads, DB schema, workspace containment, rights/checklist gates, audit records and external-process safety remain unchanged.


## Milestone 5 acceptance

- `SubtitleStudioPanel` and subtitle report/document types live under `features/subtitles`; `App.tsx` retains state, file dialogs and Tauri-backed handlers.
- `ProcessRunSummary` has one shared definition used by App and subtitle DTOs; feature modules do not import types from the App shell.
- Cue editing and validation, status/rights display, export/burn-in controls, CSS, command identifiers and command payloads remain unchanged.

## Current evidence

- Baseline: `desktop/src/App.tsx` was approximately 839 KB and `desktop/src-tauri/src/lib.rs` approximately 782 KB; both mixed app ownership with feature implementations.
- Milestone 1 moved the workspace node canvas and its owned model/catalog into `desktop/src/features/workspace/ProjectWorkspaceCanvas.tsx`.
- Saved video-session list/save/delete Tauri commands now live in `desktop/src-tauri/src/video_workflow_sessions.rs`; the module imports only the parent state, validation and persistence functions it needs.
- Milestone 2 left `App.tsx` at 11,560 lines and `lib.rs` at 20,120; milestone 3 reduced `App.tsx` to 11,373 lines; milestone 4 to 11,170; milestone 5 to 10,983; Preview Library to 10,580; Prompt Studio to 10,380 lines.
- Milestone 2 moved reference-set input validation and all seven list/create/update/archive/restore/assign/detach commands into `desktop/src-tauri/src/reference_sets.rs`; shared DTOs, role/scope validators and row-fetch helpers remain in `lib.rs`.
- `invoke_handler!` now names `reference_sets::...`; the frontend invoke strings, DTO serialization, database operations, audit events and ownership checks were not changed.
- `AssetReferencePanel` and its view/draft types now live under `desktop/src/features/assets/`; `App.tsx` retains project state, Tauri handlers and page composition, while existing global asset styles remain in `App.css`.
- Milestone 4 moved `AssetPackReviewPanel` and its view types into `desktop/src/features/assets/`; all five Asset Pack Tauri commands and their pack-only parsing/review/Blender-binding helpers now live in `desktop/src-tauri/src/asset_packs.rs` (1,495 lines). `App.tsx` retains state and callbacks; `lib.rs` retains shared process/path helpers and command registration.
- The Preview Library panel and its preview-only models and URL/card helpers now live under `desktop/src/features/preview/`; `App.tsx` retains project state, Tauri calls, callbacks and page composition. Existing styles remain in `App.css`.
- Prompt Studio and its preset/activity types now live under `desktop/src/features/prompts/`; `App.tsx` retains preset loading and mutations, workspace activity recording, brief application and page composition. Existing styles remain in `App.css`.
- `docs/architecture/TECH_STACK.md`, `DESKTOP_CONTROL_PLANE.md`, `skills.md` and `docs/operations/AGENT_SKILL_MAP.md` remain the governing architecture and safety guidance.

## Milestone 1 verification

- `pnpm run build` passed. Vite reported a 643.93 kB JavaScript chunk above its 500 kB warning threshold.
- `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check` passed.
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml video_session_` passed: 2 targeted tests, 129 filtered.
- `python scripts/validate_project.py --project .` passed: 458 inventory/physical files, 100 JSON files and 17 YAML files; semantic YAML validation is unavailable.
- Vite browser smoke displayed the workspace empty-project state and opened the local project form from its canvas callback. The preview had no Tauri backend; no node-graph editing, provider request, generation or credit spend was exercised.
- No Tauri command payload, session manifest, approval gate, DB schema, external process or rights state changed.

## Milestone 2 verification

- `pnpm run build` passed; Vite reported the unchanged 643.93 kB JavaScript chunk warning above 500 kB.
- `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check` passed.
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml reference_` passed: 8 tests, 123 filtered; the Rust test build compiled the command module and registration.
- `python scripts/validate_project.py --project .` passed: 459 manifest/physical files, 100 JSON files and 17 YAML files; semantic YAML validation is unavailable.
- Vite browser smoke rendered the desktop workflow page and confirmed the preview has no Tauri backend; no project mutation, provider request or credit spend was exercised. UI command invocation therefore remains unverified by browser; command wiring was compile-checked.
- No UI, database schema, dependency, provider behavior, rights or policy code changed. Compiler warnings remain in unrelated functions/files.

## Milestone 3 verification

- `pnpm run build` passed; Vite reported a 643.93 kB JavaScript chunk above its 500 kB warning threshold.
- `python scripts/validate_project.py --project .` passed: 461 manifest/physical files, 100 JSON files and 17 YAML files; semantic YAML validation is unavailable.
- Vite browser smoke mounted the extracted panel with an empty asset/reference fixture and confirmed the heading, project label, empty asset/set states and empty inspector. No callback was invoked; the preview had no Tauri backend and no project data was changed.
- No permanent test was added for this behavior-preserving extraction. No CSS, command, schema, provider, rights or policy behavior changed; no provider call or credit spend occurred.

## Milestone 4 verification

- `pnpm run build` passed; Vite reported a 643.93 kB JavaScript chunk above its 500 kB warning threshold.
- `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check` passed. After correcting five command-signature DTOs to `pub(super)` for the Tauri macro boundary, the migration test passed (1 test, 130 filtered) and the focused Asset Pack checklist boundary test passed (1 test, 131 filtered): 64 valid checks are accepted and 65 are rejected.
- Vite browser smoke rendered empty and populated Asset Pack review states. It confirmed the pack/item/checklist view and that Blender prepare/run buttons remain disabled for an unapproved item. No buttons/callbacks were invoked; the preview had no Tauri backend and no project data was written.
- No Blender/provider process was started. Compiler warnings remain in unrelated code; no schema, dependency, CSS, rights or policy behavior changed.
- `python scripts/validate_project.py --project .` passed: `AUTO3DVIDEO_PROJECT_VALID`, 463/463 inventory and physical files, 100 JSON files, 17 YAML files, environment template validation passed. Semantic YAML validation was unavailable and external tools were not executed. Remaining scope: additional React screens and Rust command families; map one cohesive feature boundary before the next extraction.

## Milestone 5 verification

- `pnpm run build` passed; Vite reported a 643.93 kB JavaScript chunk above its 500 kB warning threshold.
- Vite browser smoke rendered empty and populated Subtitle Studio states. The empty state kept Probe video and Nạp vào editor disabled; with an in-memory local fixture, splitting a cue emitted two entries, preserved timing, and returned the document to draft. Only the harness callback captured the edit; no Tauri command, file write or worker ran.
- No provider request or generation cost occurred. `python scripts/validate_project.py --project .` passed: `AUTO3DVIDEO_PROJECT_VALID`, 466/466 inventory and physical files, 100 JSON, 17 YAML; environment template validation passed. Semantic YAML validation was unavailable and external tools were not executed.

## Preview Library verification

- `pnpm run build` passed (`tsc && vite build`); Vite reported a 643.93 kB JavaScript chunk above its 500 kB warning threshold.
- Vite browser smoke opened Kho Preview and rendered the existing empty-library state, platform filters and disabled scan action with no selected project. The page had no Tauri backend; no worker, project mutation, provider request or generation ran. Browser runtime errors were empty.
- `python scripts/validate_project.py --project .` passed: `AUTO3DVIDEO_PROJECT_VALID`, 469 manifest and physical files, 100 JSON and 17 YAML; environment-template validation passed. Semantic YAML validation was unavailable and external tools were not executed. The validator's initial run found the existing `project_jobs.rs` source missing from `MANIFEST.json`; it is now registered.

## Prompt Studio verification

- `pnpm run build` passed (`tsc && vite build`); Vite reported a 643.93 kB JavaScript chunk above its 500 kB warning threshold.
- Vite browser smoke opened Quy trình video, opened Quản lý nâng cao and rendered Prompt Studio's empty preset state and editable draft. The preview had no Tauri backend; no save/apply action, project write, provider request or generation ran. Browser runtime errors were empty.
- `python scripts/validate_project.py --project .` passed: `AUTO3DVIDEO_PROJECT_VALID`, 471 manifest and physical files, 100 JSON, 17 YAML; environment-template validation passed. Semantic YAML validation was unavailable and external tools were not executed.

## Milestone 8 acceptance

- Feature views, view types, state and Tauri adapters have feature-owned modules; `App.tsx` only coordinates app-wide state/bootstrap and top-level composition.
- Every feature Tauri command implementation is outside `lib.rs`, remains registered under its existing command name, and keeps its existing payload and behavior.
- Shared bootstrap, state, migration, execution and test responsibilities remain in the root only where they are genuinely cross-feature.
- The source inventory includes every extracted module, and the repository validator passes.

## Milestone 8 verification

- `pnpm run build` passed (`tsc && vite build`). Vite reported a 674.00 kB JavaScript chunk above its 500 kB warning threshold.
- `cargo fmt -- --check` passed. Full `cargo test` passed: 128 passed, 0 failed, 4 ignored; the ignored external FFmpeg/FFprobe pipeline requires explicit tool paths.
- Vite browser smoke rendered all 13 navigation routes after the cutover with no browser runtime errors. The Vite preview had no Tauri backend; no worker, provider, generation, project mutation or external process ran.
- `python scripts/validate_project.py --project .` passed: `AUTO3DVIDEO_PROJECT_VALID`, 534 manifest and physical files, 100 JSON and 17 YAML; environment-template validation passed. Semantic YAML validation was unavailable; external tools were not executed.
- `App.tsx` is 664 lines; `lib.rs` is 2,641 lines and contains no command implementations. No contracts, schemas, dependencies or provider behavior changed. Cost impact: $0; rights and policy gates remain unchanged.
