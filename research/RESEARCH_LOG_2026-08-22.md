# Research Log — 2026-08-22

## Question

What free or low-cost technology stack can support automated AI-assisted 3D/video production on Windows while remaining reproducible, safe and extensible?

## Sources reviewed

| Source | Observation | Decision impact |
|---|---|---|
| Tauri 2 official docs | Web frontend can be packaged with Rust application logic and native platform integration | Choose Tauri + React for desktop control plane |
| ComfyUI GitHub | Modular graph/API/backend, local queueing, memory management and custom nodes | Use as local AI graph executor, not project database |
| Velorn GitHub | Desktop AI video workstation around local ComfyUI; project/timeline/assets, preview-first agent operations and explicit approvals | Reuse project-centric UX, endpoint bindings and preview/approval pattern |
| Blender 5.2 LTS CLI manual | Background mode, render/frame/output options, Python script execution, exit codes, logging and GPU options | Run Blender as supervised worker |
| OpenTimelineIO GitHub | Editorial cut interchange references external media; supports timing/tracks/markers and Python | Keep internal timeline contract, add OTIO export later |
| n8n GitHub | Visual self-hosted automation with many integrations and fair-code terms | Use only outside core for webhooks/notifications until licensing/deployment are justified |
| DaVinci Resolve official page | Free edition includes editing/color/effects/motion/audio with documented format/resolution limits | Optional manual master finishing |
| Kdenlive official page | Free/open-source Windows installable and standalone builds | Default open-source manual editor option |
| Google video docs | Documents current Gemini/Video capabilities and provider-specific video modes | Keep provider adapters and benchmark, do not hard-code model |
| ByteDance Seedance announcement | Describes multimodal references, extension and long-form generation | Candidate cloud adapter; terms/access must be verified |
| Runway Gen-4.5 research | Provider-authored claims around motion, adherence, physical accuracy and consistency | Candidate benchmark tool, not universal ranking |

## Synthesis

The most defensible architecture is a small desktop control plane plus specialized workers. A single GUI editor or AI model cannot provide reliable project state, process supervision, cost control, rights evidence, recovery and multi-tool delivery at the same time.

## Open questions

1. What GPU, VRAM, RAM and disk profile will the first user machine have?
2. Will the MVP use local ComfyUI generation or only mock/provider adapters?
3. Which output platform and language should be optimized first?
4. Is true 3D scene continuity required for the first pilot, or is 3D-looking AI video sufficient?
5. Which public license is appropriate before source implementation is published?

## Research limitations

Provider capability and pricing pages are self-authored and change frequently. GitHub stars and repository activity are not proof of quality or security. The plan requires re-checking API availability, license, commercial-use terms, quotas and hardware compatibility before implementation or release.

## Multi-format video expansion

The second research pass added official sources for Remotion, Motion Canvas, FFmpeg filters/devices, OBS WebSocket/scripting, Playwright browser recording, Whisper, WhisperX, Piper, ElevenLabs TTS and Manim. The synthesis is recorded in `research/MULTI_FORMAT_VIDEO_TOOLCHAIN_2026.md` and maps each format to a specialized worker plus a common FFmpeg/timeline/audio/caption/delivery boundary.

Key decisions: use Remotion for deterministic HTML/CSS/React compositions; keep Motion Canvas/Manim optional for vector/technical animation; use OBS or runtime-checked FFmpeg capture for screen/demo workflows; use Whisper/Piper for local-first speech paths; keep cloud TTS/video as optional adapters with cost, terms, privacy and rights gates; use Playwright only for browser/demo capture or evidence, not as the primary frame-accurate renderer.
