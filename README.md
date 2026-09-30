# Auto3Dvideo — AI 3D Video Automation Studio

Auto3Dvideo is a local-first Windows desktop automation studio for producing AI-assisted 3D and cinematic videos. It is designed around a controlled pipeline rather than a single model or editor:

```text
brief → script → visual bible → shot plan → AI generation → 3D/render jobs
      → media processing → review gates → subtitles/audio → delivery package
```

The project is intentionally **automation-first**. A user should be able to submit a structured brief, monitor a durable job graph, review intermediate outputs, retry only failed steps, and receive a versioned delivery package. Blender, ComfyUI, FFmpeg and optional editors remain specialized engines; Auto3Dvideo coordinates them.

> Auto3Dvideo is not intended to replace Blender, DaVinci Resolve or CapCut in the first release. It is the production control plane that connects them safely and records the decisions and evidence around each video.

## Current status

This repository contains a Windows-first Tauri 2 desktop studio and its planning pack. Current runnable outputs include a local, bounded 2.5D + OmniVoice + FFmpeg MP4 path and a separate per-shot Google Flow path that uses a connected BrowserMCP session, mapped subject images and explicit credit approval before downloading/composing clips. The generic recipe queue and mock-delivery tools remain non-generative fixtures; they do not render a finished AI/3D video. All generated media still requires human creative, rights, safety, accessibility and platform review before delivery or publishing.

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

## Development quick start: fixtures are not generated videos

These project checks validate contracts, plans and deterministic fixtures. `build_mock_delivery.py` writes metadata and a checksummed manifest, not a video; **Tạo queued job an toàn** persists queue state without starting a worker or contacting a provider. To create an actual MP4, use the Windows video setup below.

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
pnpm install --frozen-lockfile
pnpm dev

# Full Tauri desktop development, after MSVC/Windows SDK is installed
pnpm tauri dev
```

## Thiết lập Windows để tạo video thật

Có hai đường ra video khác nhau:

- **Không Gian 2.5D Cục Bộ**: tạo MP4 thật bằng cảnh 2.5D, giọng OmniVoice cục bộ và FFmpeg. Không cần Blender hay credit tạo video; model TTS cần tải/cài một lần.
- **Google Flow — One-Prompt**: tạo clip cho từng shot bằng tài khoản Flow đã đăng nhập, sau đó app tải, kiểm tra và ghép thành MP4. Đây là đường có thể tốn credit; cần duyệt ngân sách trước khi chạy.

### 1. Cài toolchain Windows

Cần Windows 10/11 x64, Node.js LTS + Corepack, pnpm 9.x (lockfile `9.0`), Rust stable, Python 3.12+ cho render cục bộ, Visual Studio 2022 Build Tools với workload **Desktop development with C++**, Windows SDK và WebView2 Runtime. `desktop/package.json` chưa khai báo `packageManager`; pnpm 9 là nhánh khớp lockfile. Chạy lệnh Tauri trong **Developer PowerShell for VS 2022** hoặc môi trường đã nạp `VsDevCmd.bat`; chỉ cài pnpm là chưa đủ để build app native.

Từ repository root:

```powershell
corepack enable
corepack prepare pnpm@9 --activate
Set-Location .\desktop
pnpm install --frozen-lockfile
pnpm run build
pnpm tauri dev
```

`pnpm dev` chỉ mở browser preview, có thể dùng sample data và không có Tauri commands; hãy dùng `pnpm tauri dev` để chạy các worker native. `pnpm run build` kiểm tra frontend, không thay thế native build.

Kiểm tra toolchain:

```powershell
node --version
pnpm --version
rustc --version
cargo --version
python --version
ffmpeg -version
ffprobe -version
```

### 2. Cấu hình đường video 2.5D cục bộ

1. Trong app, chọn/tạo project có workspace trên máy. Mở **Cài đặt → Cấu hình môi trường chạy**; nhập `python.exe`, `ffmpeg.exe`, `ffprobe.exe`, bấm **Lưu** cho từng tool rồi **Kiểm tra**. Dùng đúng cùng một Python cho cài package và chạy worker.
2. Cài Pillow để render frame 2.5D:

   ```powershell
   python -m pip install Pillow
   ```

3. Với TTS, cài bộ `torch` + `torchaudio` phù hợp CPU/GPU bằng [bộ chọn chính thức của PyTorch](https://pytorch.org/get-started/locally/), rồi cài OmniVoice vào đúng Python đã cấu hình:

   ```powershell
   python -m pip install omnivoice
   ```

   `python` trong lệnh phải là interpreter đã lưu trong Settings; nếu `python` trên PATH trỏ sang bản khác, gọi trực tiếp executable path đã cấu hình. Cài theo [hướng dẫn upstream](https://github.com/k2-fsa/OmniVoice#installation); repo không pin wheel vì phụ thuộc phần cứng/driver.
4. Mở **Voice Studio**, bấm **Kiểm tra local**. Nếu thiếu package hoặc PyTorch, sửa Python/path trước. Khi package đã sẵn sàng, bấm **Cài model OmniVoice**: thao tác riêng này tải model `k2-fsa/OmniVoice` và tokenizer `eustlb/higgs-audio-v2-tokenizer` vào cache của workspace; cần mạng và dung lượng trống. Kiểm tra lại đến khi trạng thái local sẵn sàng.
5. Mở mục **Quy trình video** trên thanh điều hướng. Chọn **Không Gian 2.5D Cục Bộ**; lựa chọn **AI 3D Cloud** hiện chưa nối renderer và sẽ chặn, không tạo video.
6. Nhập/chọn chủ đề, bấm **Tự động tạo kịch bản phân cảnh**, rồi đọc và sửa kịch bản, lời thoại, claims và từng shot. Nếu bật/configure gateway LLM ngoài thì bước viết kịch bản có thể gọi provider; để chạy local không gọi provider, không cấu hình gateway key.
7. Chỉ sau khi duyệt nội dung mới bấm **Tự xuất video MP4 hoàn chỉnh**. Nút này duyệt các segment cho lần render local. Worker chạy local 2.5D + TTS + FFmpeg/FFprobe; nếu tool/model thiếu hoặc probe sai, job dừng với lỗi thay vì coi là thành công.

Output được ghi trong workspace của project:

```text
<project-workspace>/.auto3dvideo/pipeline/<runId>/master.mp4
<project-workspace>/.auto3dvideo/pipeline/<runId>/narration.wav
<project-workspace>/.auto3dvideo/pipeline/<runId>/captions.srt
<project-workspace>/.auto3dvideo/pipeline/<runId>/manifest.json
```

Đây là hoạt họa 2.5D, không phải render Blender/3D chân thực. Manifest giữ trạng thái review; xem/nghe MP4, WAV, caption và rights/provenance trước delivery. Không publish dựa trên việc job báo thành công.

### 3. Cấu hình đường Google Flow cho video theo shot

Đây là đường tạo video bằng Flow, khác với renderer local và có thể tiêu credit.

1. Làm theo [setup BrowserMCP/BrowserOS](setup.md) và [BrowserMCP handoff runbook](docs/operations/BROWSER_MCP_HANDOFF_RUNBOOK.md): mở Auto3Dvideo trước, mở Google Flow trong đúng profile, đăng nhập thủ công, Connect extension, rồi kiểm tra **Browser Handoff → Kiểm tra kết nối Chrome** đến khi hiện kết nối. Nút **Kết nối Google Flow** dùng profile gflow-cli riêng; nó không thay cho BrowserOS/BrowserMCP session mà video runner kiểm tra.
2. Trong One-Prompt, lưu và chọn project Flow có sẵn bằng Project ID từ URL `/project/<id>` (**Lưu và chọn**), rồi bấm **Chọn Omni 1.1 Flash trong Flow**. Chọn model không nhập prompt, không bấm Generate và không trừ credit. Khi chủ động chạy Flow, mở **Mô hình & API**, tìm mục **Gọi cloud**; nếu trạng thái **ĐANG KHÓA**, bấm **Bật Cloud/API** (khi đã bật, nút đổi thành **Tắt Cloud/API**). Việc bật chỉ cho phép các lần gọi provider tiếp theo; chúng có thể tiêu credit và vẫn bị chặn bởi gate duyệt giá.
3. Gán ảnh chủ thể cho từng shot; app không tải ảnh lên Flow thay bạn:
   - Nếu ảnh chỉ đang có trong Flow, tải ảnh xuống bằng giao diện Flow rồi import file vào **Asset Library** của project; giữ rights ở `pending` đến khi xác minh.
   - Chọn shot, bấm **Choose image for selected shot** hoặc chọn ảnh đã import rồi **Assign selected image**. Bấm **Check local reference**. Đây mới là binding local, chưa phải attachment trong Flow.
   - Trong Flow, import chính ảnh đó bằng ingredient import của Flow (nếu chưa có card). Bấm **Read Flow image cards** trong canvas, xem trước local image và Flow card cạnh nhau, chọn đúng card có media ID cần gán.
   - Tick **I compared both images above and they are the same image**, rồi bấm **Save this Flow card as the shot's start frame**. App lưu đúng media ID; việc xác nhận là so sánh bằng mắt, không phải pixel/hash proof.
   - Card có nhãn shot có thể được nhận diện tự động. Card Nano Banana không nhãn cần gán như trên; card không selectable, mơ hồ hoặc thiếu sẽ chặn shot, không đoán và không fallback text-only.
4. Chạy **Run one-prompt workflow** chỉ sau khi review prompt/model, mỗi shot, rights và giá hiển thị. Duyệt hard cap tổng batch `giá mỗi shot × số shot` trước khi chạy. Nếu Flow project, BrowserMCP session, giá hoặc ảnh reference không xác định được thì không nhập prompt/không bấm Generate cho shot đó.
5. App chạy từng shot, tải output đúng card, kiểm tra bằng FFprobe rồi ghép theo thứ tự. Output:

   ```text
   <project-workspace>/outputs/sessions/<sessionId>/browser-flow/downloads/compose/<runId>-final.mp4
   ```

   Clip nguồn nằm cùng thư mục `downloads/`; xem đường dẫn chính xác trong Activity nếu session hiện tại dùng nhánh workflow legacy. Flow output vẫn cần xem/nghe lại, kiểm tra quyền, continuity, caption và disclosure AI; không có publish tự động.

**Không nhầm với fixture:** các lệnh `build_mock_delivery.py`, `run_workflow.py --dry-run` và nút **Tạo queued job an toàn** không tạo video. Hướng dẫn kiến trúc rộng hơn về ComfyUI/Blender trong file workflow là kế hoạch/recipe riêng, không phải lối tắt thay cho hai đường chạy thực ở trên.

The repository's broader free/local production architecture remains a separate planning target:

The free/local path is:

```text
structured brief
  → local LLM or approved text provider
  → ComfyUI image/reference graph
  → Blender scene/render job
  → FFmpeg compose/export
  → Kdenlive or DaVinci manual review
```

[`example-cinematic-3d-topic-to-frame-captioned.yaml`](workflows/example-cinematic-3d-topic-to-frame-captioned.yaml) describes a larger topic-to-3D workflow; do not treat that YAML example as a turnkey run unless every provider, Blender, caption and delivery stage is installed and enabled.

The generic provider catalog is not a universal generator. Google Flow is a separate, price-gated browser workflow; the local Topic Workflow is a bounded 2.5D/OmniVoice/FFmpeg pipeline. The general job-linked media plan remains behind the external safe-executor gate, while fixed fixtures and mock delivery stay non-generative. All video outputs retain human review and rights obligations.

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

## BrowserMCP Web Handoff pack — gói bàn giao thủ công, tách khỏi luồng One-Prompt

Tab **Browser Handoff** hỗ trợ tạo local handoff pack từ shot Blender MP4 hoặc keyframe PNG trong workspace theo hướng tích hợp [`browsermcp/mcp`](https://github.com/browsermcp/mcp): tính SHA-256, ghi `handoff.json` và `prompt.txt`, rồi hiển thị các bước kết nối. Quy trình pack này không tự clone/build repo, login, đọc cookie/token, upload media, click Generate hoặc import download.

```powershell
python scripts/test_browser_handoff_worker.py
```

Trong Tauri, chọn project → mở **Browser Handoff** → chọn shot/reference → chỉnh prompt → bấm **Tạo handoff pack local**. Sau đó cài BrowserMCP server/extension theo [tài liệu chính thức](https://docs.browsermcp.io/setup-server), mở Google web bằng tab riêng, tự login và tự kiểm tra file/prompt. Upload, Generate và Import là các approval độc lập; Google AI Pro trên web không tự biến thành developer API quota hoặc cam kết miễn phí.

Repo `google-flow-mcp` độc lập dùng giao thức stdio MCP, chỉ là thử nghiệm riêng cho Antigravity. Native app dùng helper Python để tạo handoff pack thủ công; code path One-Prompt desktop mặc định nối BrowserOS neo/BrowserMCP như hướng dẫn Windows ở trên. Tương thích với session Flow thật còn phụ thuộc tài khoản đã đăng nhập và cần người dùng tự xác minh; không nhầm với nút đăng nhập gflow-cli riêng.

## Mechanism Explainer — event-based 2D/2.5D/pseudo-3D

Worker `scripts/mechanism_explainer_worker.py` nhận `mechanism-explainer.schema.json` và biến một cơ chế thành chuỗi event có quan hệ nguyên nhân–kết quả. Mỗi event có narration, caption, claim/source note, frame range liên tục, dependency, visual mode, camera intent, continuity anchors và negative constraints. Renderer local tạo frame sequence original gồm 2D motion, 2.5D parallax và pseudo-3D primitives; đây là minh họa có kiểm soát, không phải true 3D Blender hay mô phỏng vật lý đầy đủ.

Ví dụ local-only:

```powershell
python scripts/mechanism_explainer_worker.py --plan outputs/cement-mechanism-demo/mechanism-plan.json --output-dir outputs/cement-mechanism-demo/render
python scripts/test_mechanism_explainer_worker.py
```

Worker không tải video social, không gọi cloud, không nhận shell command trong plan và không đánh dấu claim/rights là đã duyệt. True 3D sẽ đi qua Blender adapter riêng khi người dùng đã cài và cấu hình Blender. Voice rendering là stage riêng: Voice Studio hiện dùng OmniVoice local; legacy VieNeu hoặc cloud TTS chỉ dùng khi workflow tương ứng được cấu hình rõ, với consent, cost và human-review gate.
