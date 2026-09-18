# PLAN-018 — Browser Flow Handoff UX Rebuild

## Status

Prepared from a full audit of the current Browser Handoff UI, Tauri bridge, runtime worker, contract and BrowserMCP `@browsermcp/mcp@0.1.3` package. The first implementation slice now provides a connection-only Browser Handoff surface and an unbound session check; the full workflow orchestration remains the next slice.

## User outcome

The user wants Browser Handoff to be a one-time Chrome/BrowserMCP connection center only. It must not ask for an asset, prompt, handoff ID or candidate file. Later, the main Video Workflow owns the topic, shot prompts and Blender outputs; when the user runs the video workflow, it automatically uses the saved browser connection and performs the handoff from there. The UI must show the real A–Z activity, never expose dead buttons, and never claim an action happened when the current BrowserMCP capability cannot perform it.

## Audit findings

1. The current page exposes the internal reducer (`prepared`, approval flags, `awaiting_*`) instead of a production action. The user sees five flow boxes, three checkboxes, approval buttons, manual-confirmation buttons and a separate import panel.
2. `Snapshot tab đã Connect` is incorrectly gated by a durable handoff state. Chrome connection health is independent from a particular handoff pack and must be checkable before a pack exists.
3. Disabled buttons do not explain their blocker. Several actions therefore look like no-ops.
4. `desktop/src-tauri/src/browser_handoff.rs` allowlists click/type/press-key, but `scripts/browsermcp_runtime_worker.mjs` only implements probe/navigate/snapshot/screenshot/wait. The bridge and worker disagree.
5. The current runtime worker does not expose the package's real `browser_click`, `browser_type` and `browser_press_key` tools even though the installed package exposes them.
6. The current package has no dedicated file-upload or download tool. A web file chooser cannot be honestly treated as an automatic upload step, and a downloaded candidate cannot be silently imported without a local file path.
7. The current flow has no single orchestrator command. Prepare, probe, snapshot, state transitions and import are separate UI actions, so the user cannot see one coherent run.
8. The Browser Handoff screen stores a new `handoffId` and output path in UI state, while last-run recovery is not presented as a first-class “continue previous run” action.
9. Runtime reports are mostly final summaries. There is no durable user-facing progress stream for each stage and no guaranteed visible error when a control is blocked.

## New user-facing model

Keep **Browser Handoff** as a small connection/setup surface. It has one visible purpose:

### Connection card

- `Chrome / BrowserMCP: Connected`, `Not connected`, or `Checking…`.
- One action: `Kiểm tra kết nối`.
- On page open, run a read-only session check automatically; do not require a handoff ID.
- If disconnected, show the exact reason and the one user action needed in Chrome. Do not show approval or state-reducer controls.
- Persist only connection/runtime setup such as BrowserMCP package/runtime readiness and Google Flow target URL. Do not expose asset, prompt, output or candidate controls here.
- Provide one collapsed `Hướng dẫn kết nối` area for the extension instructions. It must not contain upload, Generate, import or approval buttons.

The main **Quy trình video** surface owns the run:

- AI creates the storyboard and shot prompts.
- User edits prompts in Shot Composer/review.
- `Tự chạy Blender → MP4` creates the local output.
- The same run then automatically creates its handoff pack from the produced Blender output and sends the current shot prompt to Google Flow using the saved browser connection.
- If the connection is missing, the main workflow shows one action: `Kết nối Chrome để tiếp tục`; it navigates to the connection center and returns to the same run.
- The user must never re-select the asset or re-enter the prompt in Browser Handoff.

### Workspace / live activity

One terminal-like panel with timestamped A–Z stages:

`Load saved setup → Validate asset → Write handoff pack → Check Chrome → Read connected tab → Navigate → Fill prompt → Upload required → Generate → Wait → Download required → FFprobe/hash → Complete`

Each entry must show `running`, `done`, `waiting for user`, or `failed`, elapsed time, and the next action. Technical JSON/audit paths remain in a collapsed `Advanced evidence` section.

### Result card

- Preview/video player when a local candidate exists.
- Output path, duration, hash and review status.
- One `Mở thư mục`/`Xem video` action.
- No separate import approval panel. Import remains a typed backend step after the user chooses a local candidate.

## Intended one-run flow

1. On entering Browser Handoff, the app checks the saved BrowserMCP/Chrome connection automatically. This screen does not know about a video asset.
2. In Quy trình video, the user enters a topic, lets AI create shots, edits prompts and starts the local render.
3. The video orchestrator creates or reuses a unique handoff pack from the current Blender output and current shot prompt, hashes the local output, and records one run log.
4. The orchestrator checks the connected tab and navigates only if the target is not already active.
5. The orchestrator uses supported BrowserMCP actions to inspect the page, fill the current shot prompt and perform the explicitly approved generation action.
6. If the installed runtime cannot upload the local file, the run changes to one state: `Cần thao tác trong Google Flow`. The UI shows exactly what the user must do and one `Tiếp tục` action. It must not show upload approval, manual-upload confirmation and generate approval as three separate controls.
7. If the web runtime cannot download the result, the main video workflow asks the user to download the MP4 once and select it with one file picker. Browser Handoff remains only a connection surface. The backend then copies, hashes and FFprobes it.
8. The result card and workspace log show the actual output. A failure includes the failed stage, error, elapsed time and recovery action.

## Internal state model

Keep durable state for recovery, but stop exposing it as the UI:

`idle → checking_connection → ready → preparing → navigating → editing_prompt → waiting_upload → generating → waiting_download → importing → completed`

Failure states are `blocked`, `failed`, `cancelled`. Existing approval/audit fields may remain for policy evidence, but the orchestrator owns normal transitions. Human confirmation is surfaced only at a real external side-effect boundary or an actual BrowserMCP capability gap.

## Required implementation slices

### Native/runtime

- Add a connection-check command that runs `browser_snapshot` without requiring a handoff state.
- Make the runtime worker implement the already allowlisted `browser_click`, `browser_type`, `browser_press_key` and `browser_wait` operations with typed arguments and bounded reports.
- Add one typed orchestrator command for the run and a progress channel/persisted activity log so the UI receives every stage.
- Keep upload/download capability detection explicit. Do not fake file upload/download when the installed package lacks those tools.
- Reuse workspace containment, hash, FFprobe, timeout, cancellation, audit and rights policy from the current bridge.

### UI

- Replace the current A/B/C/D sections, five-step strip, asset fields and prompt fields with the single connection card.
- Move all run controls into Quy trình video, where the current shot plan and Blender output already exist.
- Remove checkboxes and buttons that only mutate `approval` flags without doing the underlying browser action.
- Make every blocked action show an inline reason and next step.
- Auto-load the latest saved run/setup; avoid an effect that silently retries state reads on every render.
- Keep technical evidence, raw state and audit paths collapsed under `Advanced evidence`.

### Contract/tests/docs

- Version or extend the browser handoff contract with the run activity/status model without invalidating old evidence.
- Add tests for disconnected session, connected session, supported click/type/press, unsupported upload/download, timeout, cancellation, restart recovery and candidate import rollback.
- Update the runbook to describe the short flow, not the current seven-button reducer workflow.

## Acceptance criteria

- Browser Handoff contains only connection status, connection check and collapsed setup/help; no asset/prompt/import workflow.
- A connected Chrome session can be checked from the app without creating a handoff pack first.
- One primary run button starts a coherent run and the activity panel reports every stage.
- No visible button is a no-op or only changes hidden state without explaining it.
- Prompt edits are used by the run and are visible in the run evidence.
- Unsupported upload/download is shown as one explicit user-required step, never as a false automatic success.
- A completed local candidate shows an actual playable file path and FFprobe/hash evidence.
- A failed action displays its real error in the workspace and remains recoverable.

## Policy and cost

No credentials, cookies or tokens are stored. Google web actions remain network-bound and human-reviewable. No paid generation, payment, publishing or rights clearance is inferred. Cost remains `not_called` until a real web generation is explicitly started by the user.

## Implemented reliability slice — 2026-09-08

- Prompt target selection now requires prompt/composer context and explicitly rejects Search, filter, URL, title and metadata inputs. `browser_type` remains `submit=false`; after a timeout the UI polls with bounded wait/snapshot cycles and never retypes the prompt.
- The Browser Flow state records a local download bridge. Because BrowserMCP 0.1.3 has no `upload_file`/`download_file`, the user still performs the web download/upload action, while Auto3Dvideo can scan Windows `Downloads`, show eligible files, copy the selected video into the workflow workspace, hash it and FFprobe-validate it before recording the binding.
- `downloadedFiles` is an optional backward-compatible field in the workflow contract. Import failures roll back the copy and leave the source untouched; rights, cost and final creative review remain human gates.

## Session workspace slice — 2026-09-08

- A saved video session now owns `outputs/sessions/{sessionId}/` with stable subfolders for inputs, storyboard, Gemini references, Blender, video and logs, plus a local `session.json` manifest.
- Session autosave starts from the first non-empty topic/prompt, so a new session is remembered before the user generates a storyboard. Reopening a session restores its topic, script, shot state, preview and Browser Flow session ID.
- Browser Flow downloads are copied into `outputs/sessions/{sessionId}/browser-flow/downloads/` when the workflow is attached to a session. Legacy workflows without a session keep the previous `outputs/browser-flow/{workflowId}/downloads/` fallback.
- Deleting a session removes it from the index only; its output folder is intentionally retained to prevent accidental media loss.

## Next action

Implemented first slice: native connection check, runtime capability alignment for click/type/press-key, connection-only Browser Handoff, safe prompt targeting, bounded loading reconciliation and local Downloads import. Next slice: exercise this route against the connected Google Flow UI with a real downloaded MP4 and add a full end-to-end fixture for the download bridge.
