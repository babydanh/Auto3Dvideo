# Contracts Index

All contracts are versioned and validated before execution. JSON Schema is used for structural validation; semantic checks such as acyclic dependencies, path containment, media probing and rights scope are implemented separately.

| Contract | Purpose |
|---|---|
| `project.schema.json` | Project identity, workspace and settings |
| `episode.schema.json` | Video/episode language, duration and output profile |
| `shot.schema.json` | Shot state, timing, prompt and references |
| `asset.schema.json` | Media/3D asset identity, metadata and rights state |
| `asset-ingest.schema.json` | Typed local asset intake, classification, provenance and shot intent |
| `asset-pipeline-report.schema.json` | Hash/classification/quarantine/quality/normalization/binding evidence |
| `asset-pack.schema.json` | Project-level subject/world/style asset pack, bible versions, roles and approval policy |
| `asset-pack-item.schema.json` | One generated/reference asset request with prompt, identity anchor, views, checks and attempts |
| `asset-generation-report.schema.json` | Per-item provider result, output hashes/dimensions, cost observation and review state |
| `asset-pack-review-state.schema.json` | Durable per-project review, rights and acceptance-check state for Asset Pack items |
| `asset-pack-plan.schema.json` | Structured Muse output for bibles, identity anchors, asset roles and prompt-planner inputs |
| `asset-pack-mcp-job.schema.json` | Dependency-ordered Nano Banana MCP job for Asset Pack items with bounded attempts and zero-cost policy boundary |
| `asset-pack-blender-binding.schema.json` | Approved Asset Pack → Blender binding with immutable hashes, scale, camera continuity and no-spawn job metadata |
| `job.schema.json` | Generic execution state, resources, dependencies and cost |
| `workflow.schema.json` | Versioned stage graph and policy |
| `comfyui-job.schema.json` | Graph bindings, references and expected outputs |
| `comfyui-image-job.schema.json` | Per-shot local ComfyUI image tasks, bindings, dimensions and rights state |
| `comfyui-image-report.schema.json` | ComfyUI image outputs, hashes, task errors and review status |
| `nanobanana-image-job.schema.json` | Nano Banana MCP/Google Flow per-shot image tasks and safe CDP routing |
| `nanobanana-image-report.schema.json` | Nano Banana MCP image outputs, hashes, task errors and review status |
| `blender-job.schema.json` | Controlled scene/script/render request |
| `timeline.schema.json` | Internal tracks/clips/frames/markers |
| `delivery.schema.json` | Platform output package and validation state |
| `rights-record.schema.json` | Ownership, license, derivative and platform scope |
| `provider-profile.schema.json` | Non-secret selectable provider/model profile and fallback policy |
| `provider-request.schema.json` | Normalized request sent from the job runner to any adapter |
| `provider-result.schema.json` | Normalized status, outputs, cost and evidence returned by an adapter |
| `video-recipe.schema.json` | Normalized visual/audio/caption recipe for slideshow, HTML, screen, AI, hybrid and 3D video |
| `process-spec.schema.json` | Structured allowlisted process request for dry-run planning and future worker execution |
| `media-plan.schema.json` | Typed FFmpeg/FFprobe operation plan with workspace-relative inputs/outputs and P0 policy locks |
| `execution-attempt.schema.json` | Durable supervised-attempt evidence for leases, timeouts, cancellation, termination, redacted errors and output validation |
| `worker-plan.schema.json` | Pending-only workflow stage plan that maps executors/resources to attempts without shell commands or side effects |
| `narrative-visual-plan.schema.json` | Ordered narration-to-beat visual plan with timing, entity identity anchors, visual proof, prompt grounding, candidate/review state and rights/cost/publish locks |
| `video-evidence.schema.json` | Local video observation artifact with source hash, probe metadata, sampled frames, shot boundaries, visual cues and explicit VLM/OCR/STT capability state |
| `mechanism-explainer.schema.json` | Causal event graph for mechanism explainers with contiguous frame timing, visual modes, continuity anchors, source notes and local-only policy |
| `browser-handoff.schema.json` | BrowserMCP web handoff pack with allowlisted Google target, hashed local inputs, prompt, independent upload/generate/import approvals and network/rights policy |
| `browser-flow-workflow.schema.json` | Durable first-run BrowserMCP discovery, adaptive roadmap, named process log and asset IDs for a Google Flow workflow |
| `browser-flow-playwright-report.schema.json` | Bounded Google Flow Playwright/CDP observation, prompt, generation-click and real-download evidence |
| `google-flow-video-action.schema.json` | Paid Flow video prompt/Generate request, batch approval cap and typed action result |
| `prompt-preset.schema.json` | Project-owned, versioned prompt text with variables, negative constraints, provider targets and rights notes |
| `reference-set.schema.json` | Reusable asset assignments for identity, composition, camera, style, frame and negative continuity |
| `video-workflow-session.schema.json` | Local resumable video session with prompt, shot script, reference paths, preview state, an optional `canvasGraph` layout and optional per-shot `shotReferenceBindings` (local identity plus the manually confirmed Flow project/media ID) |

The canonical JSON contract uses camelCase field names. Execution-attempt records are append-only evidence for a job attempt; they must never store secrets, raw shell commands or unredacted logs. Human-authored YAML workflow fixtures may use the repository's existing snake_case convention; the future Rust loader must normalize and validate that mapping before execution. A provider profile contains model and endpoint references, not secret values. Credential references such as `env:AUTO3DVIDEO_TTS_API_KEY` are handles only.

A schema pass is necessary but not sufficient for execution. Do not mark a job ready solely because JSON parses. The media-plan contract deliberately excludes shell commands and raw filter graphs; semantic validation maps `probe` to `ffprobe` and transforms to `ffmpeg`, while the current readiness report only checks configured paths and never launches a binary. The process-spec contract is intentionally not a shell-command contract: P0 validates it and returns a no-spawn plan, while future execution must still resolve a configured binary, enforce timeout/cancellation, capture bounded logs, validate outputs and write audit evidence. The execution-attempt contract is the durable boundary for that future worker; `reconciliation_required` must never be coerced into success or automatic retry. The worker-plan contract is only a deterministic expansion of a workflow into pending stages; it cannot claim execution, output validity or delivery approval. The narrative visual plan is upstream of generation: its semantic validator and native preview reject missing/non-contiguous beat coverage, unsafe output paths, persistent-entity anchor drift, ungrounded required visual elements, raw command fields and paid/publish/network bypass. Native preview reports `generationStarted=false` and must remain no-spawn.
