# Auto3Dvideo Studio — Desktop Shell

This folder contains the Tauri 2 + React/TypeScript desktop app and Rust/Tokio control plane. Besides project, recipe and queue UI, the current desktop exposes two actual video paths: a local 2.5D/OmniVoice/FFmpeg export and a separate price-gated BrowserOS/Google Flow shot workflow. Mock jobs and mock-delivery commands remain non-generative.

## Run the UI

```powershell
# Run from this desktop folder.
pnpm install --frozen-lockfile
pnpm dev
```

The browser preview intentionally falls back to sample data when the Tauri backend is not present. Native startup uses `pnpm tauri dev` from **Developer PowerShell for VS 2022** or a shell with the MSVC environment loaded:

```powershell
pnpm tauri dev
```

## Current native commands

The Rust side exposes typed project, recipe, provider, BrowserMCP, local-video and subtitle commands. `enqueue_mock_job` only writes mock state; `preview_process` remains a dry-run. The separate `render_approved_local_video` command runs a bounded local 2.5D renderer, OmniVoice TTS, FFmpeg and FFprobe to produce a real MP4. The BrowserOS Flow path runs one approved shot at a time, imports matching clips and `compose_browser_flow_outputs` normalizes/joins them into a final MP4. Neither mock jobs nor project recipes imply provider execution.

The database is created in the Tauri application data directory and initialized from `src-tauri/migrations/0001_initial.sql`. Media files are not stored in SQLite.

## Voice Studio / OmniVoice

The local render path uses `k2-fsa/OmniVoice` plus the `eustlb/higgs-audio-v2-tokenizer`. Configure the Python executable in **Cài đặt → Cấu hình môi trường chạy**; install PyTorch and the OmniVoice package into that same Python. The **Kiểm tra local** action checks package, PyTorch, device and model cache. **Cài model OmniVoice** explicitly downloads model/tokenizer into the workspace cache; it does not install missing Python packages. Normal synthesis sets `networkCallsAllowed=false`.

Voice cloning requires a workspace-local reference audio file and `cloneConsent=true`; use only audio with documented rights and consent. The script's `voiceSettings` contract—preset, temperature, cue/emotion maps, clone flags and reference audio path—is defined in [`video-script.schema.json`](../contracts/video-script.schema.json). Every generated narration WAV requires human listening review for pronunciation, timing, quality and rights before delivery.

## Process safety boundary

`preview_process` remains validation-only and returns `processStarted=false`. Separate typed commands for local video, Flow composition and subtitle export use allowlisted executable IDs, fixed argument arrays, workspace-relative paths, bounded timeouts, expected outputs and media probes. They do not expose a generic shell or accept arbitrary user commands. See [`process-spec.schema.json`](../contracts/process-spec.schema.json) and the end-to-end instructions in [`../README.md`](../README.md).

## Configuration boundary

Provider credentials are not part of this subproject. Use the root `.env.example` only as a development variable reference and use the OS credential-store plan for packaged Windows builds. Do not commit a real `.env`, API key, private key or provider response.

## Build prerequisites

Windows native development requires Node.js/Corepack, pnpm 9.x for lockfile v9.0, Rust stable, WebView2, Visual Studio 2022 C++ build tools and the Windows SDK. Local 2.5D export additionally needs Python 3.12+ configured with Pillow, FFmpeg/FFprobe, and the OmniVoice package/model; Google Flow additionally needs a connected BrowserOS/BrowserMCP tab and an explicitly approved credit cap. `pnpm run build` checks the frontend only; `pnpm tauri dev` is the native app path. Follow the root [`README.md`](../README.md) for installation and both video workflows. A successful frontend build does not prove native startup or a live paid Flow run.

## Recommended IDE setup

Use [VS Code](https://code.visualstudio.com/) with the [Tauri extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) and [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## Subtitle Studio / Phụ đề

Mở tab `Subtitle Studio` sau khi đã tạo hoặc chọn project. Chọn một video local và file `.srt` hoặc `.vtt`, sau đó bấm `Probe video` để kiểm tra duration, codec, kích thước và audio trước khi bấm `Nạp vào editor`. Đường dẫn được chọn ngoài workspace sẽ bị từ chối; video gốc chỉ được đọc.

Trong editor, mỗi cue có thể sửa trực tiếp nội dung, thời điểm bắt đầu/kết thúc đến mili-giây, thêm dòng, xóa dòng, `Chia đôi`, `Gộp dòng sau` và `Tìm/Thay tất cả`. Bảng validation báo overlap, end ≤ start, cue vượt duration, tốc độ trên 20 ký tự/giây và dòng quá dài. Hãy sửa lỗi timing trước khi xuất.

`Xuất sidecar` tạo một file SRT hoặc WebVTT mới theo đường dẫn workspace-relative và không ghi đè file đã tồn tại. `Burn-in vào bản sao MP4` chạy FFmpeg qua native direct supervisor, tạo file MP4 mới và giữ video gốc nguyên vẹn. Sau khi xuất, người dùng vẫn phải mở video, kiểm tra chữ, timing, font, safe area, tiếng Việt và quyền xử lý trước delivery.

Subtitle Studio hiện là editor deterministic cho SRT/VTT. Tự động nghe video để tạo transcript hoặc dịch sang ngôn ngữ khác cần provider STT/LLM đã cấu hình; app không tự tải video TikTok/Douyin/YouTube, không xóa watermark và không tự publish. Contract của document nằm tại `../contracts/subtitle-document.schema.json`, worker local là `../scripts/subtitle_worker.py` và native command nằm tại `src-tauri/src/subtitle.rs`.

## Google Flow video shots

Select the saved Google Flow project and connect its signed-in BrowserOS/BrowserMCP session before running the One-Prompt workflow. The runner keeps current Flow model/settings, requires visible price evidence and one explicit batch cap, verifies each shot's exact reference media ID, stops before prompt/Generate if evidence is missing, imports matching shot clips, then FFmpeg/FFprobe-composes `<workspace>/outputs/sessions/<sessionId>/browser-flow/downloads/compose/<runId>-final.mp4`. Unlabelled images (for example Nano Banana cards) need an explicit card-to-shot binding in the canvas. This live provider path can spend credits; generated outputs still require human review and never publish automatically. See the root `README.md` for the setup checklist.
