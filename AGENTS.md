# Auto3Dvideo Agent Instructions

## Mission

Auto3Dvideo is an automation-first Windows desktop studio for AI-assisted 3D and cinematic video production. The application coordinates structured briefs, AI generation, ComfyUI graphs, Blender jobs, FFmpeg processing, editorial review and delivery evidence.

## Required context loading

Before changing files, read the root `README.md`, the active plan under `plans/`, the relevant architecture document under `docs/architecture/`, the applicable contract under `contracts/`, and the selected workflow under `workflows/`. Load only the profile-specific research that applies to the change.

For local AI graph work, read `research/RESEARCH_SOURCES.md` and the ComfyUI section of `docs/architecture/TECH_STACK.md`. For Blender work, read the Blender job contract and the Blender safety section. For timeline work, read the OpenTimelineIO decision. For platform publishing, read the policy and rights gate.

## Operating rules

An agent must work in a bounded change directory or plan-backed branch. It must not modify files outside the approved scope. It must not read, print or commit secrets, `.env` files, API keys, private keys, credentials or production personal data. Provider credentials belong in the OS credential store or an explicitly configured secret manager, never in project JSON or logs.

All external process execution must use an allowlisted executable, normalized paths, explicit arguments, timeout, cancellation, captured stdout/stderr and a non-zero exit policy. Never pass arbitrary user text as a shell command. Blender scripts and ComfyUI workflows must be versioned and validated before execution. Antigravity task catalog commands are documentation/routing data only; they are not permission to bypass the Rust executor boundary.

All paid generation jobs require a budget estimate and approval when the configured policy says so. Retries must be bounded and idempotent. A failed step must not silently be treated as successful. Filesystem writes, asset imports, publish actions and destructive operations require preview or explicit approval.

## Antigravity IDE handoff

When working in Antigravity, open `D:\\Duancanhan\\Auto3Dvideo` as the repository root and run root-level validation commands from that directory. Read `docs/operations/ANTIGRAVITY_IDE_RUNBOOK.md` and `configs/antigravity-task-catalog.yaml` for bounded task routing. Use small, plan-backed changes with explicit allowed files, contract impact, validation commands and evidence. Antigravity is an IDE/agent workspace; it does not replace MSVC, the Windows SDK, Rust, Node/pnpm or local worker binaries. Do not claim native Tauri launch from a frontend-only build.

## Profile routing

| Signal | Load |
|---|---|
| AI image/video generation | `docs/architecture/AI_PROVIDER_ARCHITECTURE.md`, `docs/07_AI_GENERATION_WORKFLOW.md` |
| ComfyUI graph | `docs/architecture/COMFYUI_INTEGRATION.md`, `contracts/comfyui-job.schema.json` |
| Blender scene/render | `docs/architecture/BLENDER_INTEGRATION.md`, `contracts/blender-job.schema.json` |
| FFmpeg/export | `docs/architecture/MEDIA_PROCESSING.md`, `contracts/delivery.schema.json` |
| Project/shot/asset state | `contracts/project.schema.json`, `contracts/shot.schema.json`, `contracts/asset.schema.json` |
| Timeline/editing | `docs/architecture/TIMELINE_AND_EDITOR_INTERCHANGE.md` |
| AI automation/agents | `docs/18_AGENT_AUTOMATION_PROTOCOL.md`, `docs/architecture/SECURITY_BOUNDARIES.md` |
| Rights/monetization/platform | `docs/policy/RIGHTS_AND_PLATFORM_GATES.md` |

## Required delivery status

Every implementation report must state one of `DONE`, `BLOCKED`, `NEEDS_CLARIFICATION` or `NEEDS_HUMAN_REVIEW`. It must include changed files, commands/tests run, outputs, known limitations, cost impact, rights/policy status and the next action.

An agent must not claim that a video is publishable, monetizable, legally compliant, App Store compliant or production-ready only because a generation job or build succeeded. Human review remains required for creative quality, rights, safety, accessibility, platform policy and final release.

## Definition of done

A change is complete only when its contract and state transitions are documented, the happy path and failure path are tested, retries/timeouts are bounded, logs are useful without leaking secrets, outputs are validated, evidence is recorded and the relevant project validator passes.
