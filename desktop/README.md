# Auto3Dvideo Studio — Desktop Shell

This folder contains the first runnable desktop implementation for Auto3Dvideo. It is a Tauri 2 + React/TypeScript shell with a Rust/Tokio control-plane direction and SQLite-backed local metadata. The current slice implements a Vietnamese-first dashboard, project creation, recipe catalog, provider catalog, job history and a deterministic mock job command.

## Run the UI

```powershell
cd D:\\Duancanhan\\Auto3Dvideo\\desktop
pnpm install
pnpm dev
```

The browser preview intentionally falls back to sample data when the Tauri backend is not present. The desktop development command is:

```powershell
pnpm tauri dev
```

## Current native commands

The Rust side exposes narrow typed commands for app snapshot, health, projects, jobs, recipe catalog, provider catalog and `preview_process`. `enqueue_mock_job` writes a completed mock job to the local SQLite database; it does not call cloud APIs or execute Blender, ComfyUI, FFmpeg, OBS or browser capture. `preview_process` validates an allowlisted executable ID, structured arguments, workspace-relative paths, bounded timeout, environment-key policy and expected outputs, then returns a dry-run plan with `processStarted=false`; it never spawns a child process.

The database is created in the Tauri application data directory and initialized from `src-tauri/migrations/0001_initial.sql`. Media files are not stored in SQLite.

## Voice Studio / VieNeu-TTS

Open the Vietnamese-first `Voice Studio` tab after selecting a project. Choose a VieNeu preset, set the bounded temperature between `0.6` and `1.2`, select an experimental cue such as `[cười]`, `[thở dài]` or `[hắng giọng]`, and create a local WAV preview. When a script is available, the right-hand scene list lets you assign a cue to each segment. The chosen settings are carried into an approved local video render.

The current VieNeu v3 Turbo integration does not expose a free-form emotion mixer, pitch slider or speed slider. The `style` prompt is not treated as a supported control. A reference audio path is optional, but it must be workspace-relative and requires explicit consent; cloning is disabled by default and must not be used to impersonate another person. VieNeu readiness must be green and the model must already exist in the configured local cache; synthesis does not download a model or call a cloud API.

The source contract is `../contracts/video-script.schema.json`, where `voiceSettings` stores the preset, temperature, cue map, clone flags and optional reference path. The runtime still requires human listening review for pronunciation, emotion cues, rights, AI disclosure and final delivery.

## Process safety boundary

The process contract is [`../contracts/process-spec.schema.json`](../contracts/process-spec.schema.json), with implementation in `src-tauri/src/process_executor.rs`. P0 allowlists `blender`, `ffmpeg`, `ffprobe`, `node`, `obs` and `python` identifiers, rejects shell-style credential markers and absolute or parent-traversal paths, and only permits `AUTO3DVIDEO_*` environment keys. This is validation and planning only; binary-path resolution, process-tree termination, timeout enforcement, output probing and durable worker supervision remain future work after native compilation is available.

## Configuration boundary

Provider credentials are not part of this subproject. Use the root `.env.example` only as a development variable reference and use the OS credential-store plan for packaged Windows builds. Do not commit a real `.env`, API key, private key or provider response.

## Build prerequisites

Node.js, pnpm, Rust and WebView2 are installed or expected. Windows Tauri builds also require the Microsoft C++ build tools and Windows SDK. The current attached machine has Rust, WebView2 and Visual Studio Build Tools/MSVC configured under `D:\VSBuildTools`; `pnpm build`, `cargo test --lib` and the native development path have been verified. A packaged installer build should still be run separately when a release artifact is required.

## Recommended IDE setup

Use [VS Code](https://code.visualstudio.com/) with the [Tauri extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) and [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## Subtitle Studio / Phụ đề

Mở tab `Subtitle Studio` sau khi đã tạo hoặc chọn project. Chọn một video local và file `.srt` hoặc `.vtt`, sau đó bấm `Probe video` để kiểm tra duration, codec, kích thước và audio trước khi bấm `Nạp vào editor`. Đường dẫn được chọn ngoài workspace sẽ bị từ chối; video gốc chỉ được đọc.

Trong editor, mỗi cue có thể sửa trực tiếp nội dung, thời điểm bắt đầu/kết thúc đến mili-giây, thêm dòng, xóa dòng, `Chia đôi`, `Gộp dòng sau` và `Tìm/Thay tất cả`. Bảng validation báo overlap, end ≤ start, cue vượt duration, tốc độ trên 20 ký tự/giây và dòng quá dài. Hãy sửa lỗi timing trước khi xuất.

`Xuất sidecar` tạo một file SRT hoặc WebVTT mới theo đường dẫn workspace-relative và không ghi đè file đã tồn tại. `Burn-in vào bản sao MP4` chạy FFmpeg qua native direct supervisor, tạo file MP4 mới và giữ video gốc nguyên vẹn. Sau khi xuất, người dùng vẫn phải mở video, kiểm tra chữ, timing, font, safe area, tiếng Việt và quyền xử lý trước delivery.

Subtitle Studio hiện là editor deterministic cho SRT/VTT. Tự động nghe video để tạo transcript hoặc dịch sang ngôn ngữ khác cần provider STT/LLM đã cấu hình; app không tự tải video TikTok/Douyin/YouTube, không xóa watermark và không tự publish. Contract của document nằm tại `../contracts/subtitle-document.schema.json`, worker local là `../../scripts/subtitle_worker.py` và native command nằm tại `src-tauri/src/subtitle.rs`.

## Google Flow video shots

Select a saved Google Flow project and connect the signed-in BrowserOS tab before running a video shot plan. The app keeps the current Flow model/settings unchanged, requires a visible unit credit price, and asks for one explicit batch cap before entering any prompt. It submits one shot at a time, binds each result to its run/shot/revision IDs, downloads only from that matching video card, and imports a newly created video file after validation. Timeouts, ambiguous results or uncertain clicks stop without retrying Generate. Generated clips still require human review for creative quality, rights, safety and platform policy; generation does not publish or establish monetization rights.
