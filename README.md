# Auto3Dvideo — AI 3D Video Automation Studio

Auto3Dvideo is a local-first Windows desktop automation studio for producing AI-assisted 3D and cinematic videos. It is designed around a controlled pipeline rather than a single model or editor:

```text
brief → script → visual bible → shot plan → AI generation → 3D/render jobs
      → media processing → review gates → subtitles/audio → delivery package
```

The project is intentionally **automation-first**. A user should be able to submit a structured brief, monitor a durable job graph, review intermediate outputs, retry only failed steps, and receive a versioned delivery package. Blender, ComfyUI, FFmpeg and optional editors remain specialized engines; Auto3Dvideo coordinates them.

> Auto3Dvideo is not intended to replace Blender, DaVinci Resolve or CapCut in the first release. It is the production control plane that connects them safely and records the decisions and evidence around each video.

## Current status

This repository contains the planning pack plus the first P0 Tauri 2 desktop implementation. The current slice is a Vietnamese-first dashboard with SQLite initialization, provider/recipe catalogs, bounded job controls, durable execution-attempt inspection, a deterministic in-process mock supervisor, a direct no-shell external supervisor and explicit local software fixtures. FFmpeg/FFprobe can run a fixed synthetic media fixture directly or through a durable job attempt with output evidence and restart reconciliation. Settings can probe configured local binary versions, check a loopback-only ComfyUI health endpoint and run a deterministic Blender `.blend` fixture when `blender.exe` is configured. The Review surface can compile the three-beat `NarrativeVisualPlan` fixture without spawning a provider, exposing narration spans, visual proof, entity anchors, expected assets and grounded prompts before generation. General user-media worker execution, ComfyUI workflow submission, cloud provider calls and publishing remain disabled. It does not yet claim to be a production-ready desktop application, a universal AI model gateway, a monetization guarantee or a copyright/compliance certification.

## Navigation

Begin with [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md), then read the [`agent skill map`](docs/operations/AGENT_SKILL_MAP.md), [`master implementation plan`](plans/MASTER_IMPLEMENTATION_PLAN.md), [`architecture index`](docs/architecture/README.md), [`contracts`](contracts/README.md), [`workflow examples`](workflows/README.md), [`policy gates`](docs/policy/AUTOMATION_POLICY_GATES.md) and [`planning release evidence`](docs/operations/PLANNING_PACK_RELEASE_2026-08-22.md).

## Design goals

| Goal | Meaning |
|---|---|
| Local-first | Keep project metadata, references, cache and outputs on the user's Windows machine by default |
| Provider-neutral | Support replaceable AI provider adapters instead of hard-coding one model |
| Automation-safe | Use explicit job states, idempotency, budgets, retries, timeouts and approval gates |
| 3D-capable | Integrate Blender for deterministic assets, scenes, cameras and renders |
| Editor-friendly | Export standard media and timeline artifacts for DaVinci Resolve or CapCut |
| Agent-ready | Allow repository-aware coding agents to inspect plans, preview changes and operate within approved scope |
| Evidence-driven | Preserve prompts, model versions, source assets, rights status, outputs and review decisions |
| Free-first | Prefer free/open-source local tools where they meet the quality and hardware constraints |

## Recommended free-first stack

| Layer | Baseline technology | Responsibility |
|---|---|---|
| Desktop shell | Tauri 2 + Rust | Windows application, secure commands, process lifecycle and filesystem boundary |
| UI | React + TypeScript + Vite | Project dashboard, shot board, asset browser, job monitor and settings |
| UI system | Tailwind CSS + accessible component primitives | Design tokens, dark mode, keyboard and responsive surfaces |
| Local state | SQLite with migrations | Projects, episodes, shots, assets, jobs, costs, evidence and audit events |
| Job runner | Rust Tokio with a persisted state machine | Queue, concurrency limits, cancellation, retry, timeout and recovery |
| Local generation | ComfyUI API | Graph-based local image/video generation and post-processing workflows |
| 3D engine | Blender CLI + Python scripts | True 3D scenes, deterministic assets, cameras, animation and rendering |
| Media engine | FFmpeg | Transcode, concatenate, mux, audio mix, subtitle, thumbnails and platform variants |
| Timeline interchange | OpenTimelineIO (optional) | Editorial cut information and interchange; media remains external |
| Manual finishing | DaVinci Resolve Free or Kdenlive | Human-controlled master edit, color, audio and review |
| Cloud generation | Provider adapters | Optional user-selected video/image/audio providers with budget controls |
| Model catalog | Provider profiles + `.env.example` | Select different LLM, image, video, TTS, STT, 3D and media engines per workflow/stage |

The stack is based on a separation of concerns observed in the official Tauri, ComfyUI, Blender, OpenTimelineIO, DaVinci Resolve and Kdenlive materials [1] [2] [3] [4] [5] [6].

## Quick start for the planned MVP

The first implementation should be able to run a fixture workflow without requiring a paid cloud model. The current mock-delivery command creates only `metadata.json`, `review-checklist.md` and a checksummed manifest under the ignored `outputs/` directory; it does not create a video or run a worker. In the desktop Recipe Catalog, **Tạo queued job an toàn** exercises the queue-first path: it validates the project/recipe and persists `queued` state, but it does not claim a worker, spawn a process or call a provider:

```powershell
# Root planning and migration checks
python scripts/validate_project.py --project .
python scripts/test_migration.py --project .
python scripts/test_process_spec.py
python scripts/test_media_plan.py
python scripts/test_tool_readiness.py
python scripts/validate_execution_attempt.py --attempt examples/minimal-3d-video/execution-attempt.json
python scripts/test_execution_attempt.py
python scripts/compile_worker_plan.py --workflow workflows/example-local-free-pipeline.yaml --output outputs/worker-plan.json
python scripts/validate_worker_plan.py --plan outputs/worker-plan.json
python scripts/test_compile_worker_plan.py
python scripts/test_mock_delivery.py
python scripts/validate_media_plan.py --plan examples/minimal-3d-video/media-plan.json
python scripts/report_tool_readiness.py --config configs/tool-paths.example.yaml
python scripts/build_mock_delivery.py --recipe examples/minimal-3d-video/recipe.json --output-dir outputs/mock-delivery
python scripts/validate_delivery.py --manifest outputs/mock-delivery/manifest.json
python scripts/run_workflow.py --workflow workflows/example-local-free-pipeline.yaml --dry-run
python scripts/estimate_cost.py --seconds 5 --usd-per-second 0.00 --attempts 1 --shots 3

# Frontend preview
cd desktop
pnpm install
pnpm dev

# Full Tauri desktop development, after MSVC/Windows SDK is installed
pnpm tauri dev
```

The free/local path is:

```text
structured brief
  → local LLM or approved text provider
  → ComfyUI image/reference graph
  → Blender scene/render job
  → FFmpeg compose/export
  → Kdenlive or DaVinci manual review
```

For a full topic-to-3D path, use [`example-cinematic-3d-topic-to-frame-captioned.yaml`](workflows/example-cinematic-3d-topic-to-frame-captioned.yaml). It connects topic research, director planning, reference assets, Blender scene/render, voice, STT/forced alignment, frame-locked captions, FFmpeg composition, quality gate and delivery evidence. The canonical caption timing is [`frame-caption-plan.schema.json`](contracts/frame-caption-plan.schema.json): integer `startFrame`/`endFrame` at the project FPS. SRT/VTT are derived sidecars, not the source of truth.

Cloud AI video generation is an optional adapter. Free web credits are limited and do not represent unlimited commercial production capacity. The current FFmpeg path has a typed dry-run/readiness report, a direct synthetic local fixture and a durable fixed-argument fixture job with post-probe output evidence. The general job-linked media plan remains behind the external safe executor gate. The desktop Settings panel stores allowlisted local executable references in SQLite and checks file/PATH metadata without executing tools or probing network; explicit Probe actions execute only an app-selected `--version` command through the supervisor. The readiness report shows an explicit general external-worker gate that remains disabled even though the native build now passes. Settings can run a read-only worker preflight, probe FFmpeg/FFprobe/Python/Blender and check only a local ComfyUI health endpoint without submitting a workflow. Jobs can preview a per-attempt launch plan, run the fixed FFmpeg fixture attempt and inspect durable lease, process, cancellation, reconciliation and output evidence. The P0 native boundary includes `enqueue_pending_job`, `prepare_pending_attempt`, `start_mock_attempt`, `run_ffmpeg_fixture_attempt`, `list_job_attempts` and `list_attempt_outputs`: queued jobs can be created, pending attempt rows and expected outputs are validated transactionally, the in-process mock worker claims a lease with `processStarted=false`, and the explicit FFmpeg fixture claims an `external_process` attempt and persists its terminal result. The **Audit local** panel reads bounded event metadata from SQLite without exposing payload JSON or credential values. The worker-plan compiler still expands the local-free workflow into pending stage/attempt evidence and keeps general process, network, paid-generation and publishing side effects disabled.

## Multi-provider configuration

The application is designed to support multiple selectable providers rather than one fixed model. A workflow can use one profile for chat/script planning, another for image references, another for video generation, another for TTS/voice and local Blender/FFmpeg for true 3D and delivery. Start with [`.env.example`](.env.example) and [`configs/provider-profiles.example.yaml`](configs/provider-profiles.example.yaml); these contain placeholders and no secrets. The native Model & API surface now reads a bounded local `.env` for development readiness, shows one profile per capability with model, adapter, timeout, retry, fallback and masked credential state, and gives process environment values precedence. Packaged Windows use should prefer the OS credential store. The provider catalog records adapter, model, endpoint profile, pricing mode, terms source and fallback policy, while actual credentials are resolved only at execution time. Cloud calls remain disabled until a provider-specific adapter and approval gates are implemented.

## Repository map

```text
.
├── README.md
├── AGENTS.md
├── MANIFEST.json
├── plans/                  # Project and milestone plans
├── docs/                   # Architecture, contracts, operations and policy
├── research/               # Source-backed research and repository notes
├── contracts/              # Versioned JSON/YAML schemas
├── workflows/              # Example executable job graphs
├── configs/                # Safe defaults without secrets
├── scripts/                # Deterministic validation and runner utilities
├── desktop/                # Tauri 2 + React/TypeScript desktop implementation
└── examples/               # Small sanitized fixtures
```

## Roadmap

| Phase | Outcome |
|---:|---|
| 0 | Contracts, workspace, safety rules and fixture workflow |
| 1 | Tauri shell, SQLite project model and job monitor |
| 2 | ComfyUI integration, graph registry and local image/video jobs |
| 3 | Blender bridge, GLB asset preview, scene and render jobs |
| 4 | FFmpeg delivery pipeline, subtitles, audio and platform variants |
| 5 | Provider adapters, cost ledger, retry and human approval gates |
| 6 | Timeline interchange, DaVinci/Kdenlive handoff and agent control |
| 7 | Packaging, recovery, performance, accessibility and release evidence |
| 8 | Multi-format recipes: slideshow, HTML, screen/demo, voiceover/captions and hybrid 2D–3D |

## Safety and rights

Never commit API keys, `.env` files, private keys, credentials, personal data or unlicensed media. Every nontrivial asset should have a rights record covering source, owner, commercial use, derivative use, platform, territory and proof location. Voice, face, likeness, music and third-party footage require explicit review. AI disclosure requirements are platform-specific and must be recorded rather than assumed.

The project must not automate unauthorized scraping, watermark removal, impersonation, copyright evasion or mass reposting. A publish step should remain approval-gated until platform APIs, account permissions, content rights and policy requirements have been verified.

## Contribution direction

Prefer small, deterministic components with versioned contracts. A change should include a problem statement, architecture decision, data/API impact, job-state impact, security impact, test plan, cost impact and release evidence. Do not add a provider integration without a mock adapter, timeout policy, budget policy, error taxonomy and rights/disclosure fields.

## References

[1]: https://v2.tauri.app/ "Tauri 2 documentation"
[2]: https://github.com/Comfy-Org/ComfyUI "ComfyUI GitHub repository"
[3]: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html "Blender command-line arguments"
[4]: https://github.com/AcademySoftwareFoundation/OpenTimelineIO "OpenTimelineIO GitHub repository"
[5]: https://www.blackmagicdesign.com/products/davinciresolve "DaVinci Resolve official product page"
[6]: https://kdenlive.org/download/ "Kdenlive official downloads"

## Video Vision Evidence — local-first slice

Tab **Video Vision** đọc một file video local nằm trong project workspace. Nó chạy FFprobe để lấy metadata, FFmpeg để trích frame và tùy chọn audio WAV 16 kHz, sau đó tạo `outputs/video-evidence/evidence.json`. Evidence gồm hash source, timestamp shot, frame references, brightness, palette, edge density và cut heuristic để planner có dữ liệu thay vì ghép hình ngẫu nhiên.

Slice này **chưa chạy Qwen3-VL, OCR, Whisper/STT hoặc semantic object/action recognition**. Các field tương ứng được đánh dấu `false`/`not_run`; không được gọi output là transcript hay semantic understanding. Mọi evidence có trạng thái `needs_review`, không tự xác nhận quyền, chất lượng, publishability hay monetization.

Trong Tauri, chọn project → mở **Video Vision** → chọn video local → giữ sample FPS và max frame mặc định nếu chưa benchmark → bấm **Phân tích video local** → mở JSON evidence để review → handoff sang shot planner. Input social URL, scraping, watermark removal và tái sử dụng footage không nằm trong workflow này.

## BrowserMCP Web Handoff — dùng Google web có kiểm soát

Tab **Browser Handoff** dùng repo/distribution [`browsermcp/mcp`](https://github.com/browsermcp/mcp) theo hướng handoff pack local. Nó nhận một shot Blender MP4 hoặc keyframe PNG nằm trong workspace, tính SHA-256, ghi `handoff.json` và `prompt.txt`, sau đó hiển thị các bước kết nối Chrome/BrowserMCP. P0 không tự clone/build standalone GitHub source, không tự login, không đọc cookie/token, không upload, không bấm Generate và không import file download.

```powershell
python scripts/test_browser_handoff_worker.py
```

Trong Tauri, chọn project → mở **Browser Handoff** → chọn shot/reference → chỉnh prompt → bấm **Tạo handoff pack local**. Sau đó cài BrowserMCP server/extension theo [tài liệu chính thức](https://docs.browsermcp.io/setup-server), mở Google web bằng tab riêng, tự login và tự kiểm tra file/prompt. Upload, Generate và Import là các approval độc lập; Google AI Pro trên web không tự biến thành developer API quota hoặc cam kết miễn phí.

Standalone repository hiện dùng stdio MCP và có workspace dependencies; vì vậy app không nhúng source đó như một binary nội bộ. Native Tauri chỉ chạy helper Python local qua supervisor để chuẩn bị pack. Một runtime BrowserMCP thật sẽ được nối ở slice sau, sau khi user duyệt cài Node/package/extension và kiểm tra upload capability.

## Mechanism Explainer — event-based 2D/2.5D/pseudo-3D

Worker `scripts/mechanism_explainer_worker.py` nhận `mechanism-explainer.schema.json` và biến một cơ chế thành chuỗi event có quan hệ nguyên nhân–kết quả. Mỗi event có narration, caption, claim/source note, frame range liên tục, dependency, visual mode, camera intent, continuity anchors và negative constraints. Renderer local tạo frame sequence original gồm 2D motion, 2.5D parallax và pseudo-3D primitives; đây là minh họa có kiểm soát, không phải true 3D Blender hay mô phỏng vật lý đầy đủ.

Ví dụ local-only:

```powershell
python scripts/mechanism_explainer_worker.py --plan outputs/cement-mechanism-demo/mechanism-plan.json --output-dir outputs/cement-mechanism-demo/render
python scripts/test_mechanism_explainer_worker.py
```

Worker không tải video social, không gọi cloud, không nhận shell command trong plan và không đánh dấu claim/rights là đã duyệt. True 3D sẽ đi qua Blender adapter riêng khi người dùng đã cài và cấu hình Blender; narration VieNeu/cloud TTS là stage riêng, có model/provider, consent, cost và human-review gate.
