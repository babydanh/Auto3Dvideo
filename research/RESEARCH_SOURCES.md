# Research Sources and Decision Evidence

## Scope

This file records the primary sources used to design Auto3Dvideo. Provider pages describe their own capabilities and are not independent rankings. Repository pages are case studies, not security or production certification. Prices, quotas, regions, APIs and licenses must be rechecked before implementation or release.

## Primary technical sources

| Source | Finding used in the plan |
|---|---|
| [Tauri 2](https://v2.tauri.app/) | Supports an existing frontend stack, uses Rust application logic, targets desktop/mobile platforms and emphasizes small, secure applications |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Modular graph/nodes UI/API/backend, local queueing, partial graph execution, memory management, custom nodes and media-oriented tools |
| [Velorn](https://github.com/VelornLabs/velorn) | Open-source desktop AI video workstation precedent: project/timeline/asset management around local ComfyUI, preview-first agent tools and explicit approval |
| [Blender command-line arguments](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html) | Background rendering, animation/frame/output options, Python script execution, GPU selection, logging and exit-code controls |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | Open editorial cut interchange with clips/tracks/timing/markers and external media references |
| [n8n](https://github.com/n8n-io/n8n) | Visual self-hosted AI/workflow automation is useful for external integrations but is heavier and has fair-code licensing considerations |
| [MoneyPrinterV2](https://github.com/FujiwaraChoki/MoneyPrinterV2) | Compact Python end-to-end voice/video happy path; useful for stage ordering and local model selection, but current source is narrower than a multi-provider platform and its slideshow visual path lacks beat/entity grounding |
| [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve) | Free editor supports editing, color, effects, motion graphics and audio; official page describes up to UHD 3840x2160 at 60fps for the free version |
| [Kdenlive](https://kdenlive.org/download/) | Free/open-source editor with Windows installable and standalone builds |
| [Remotion](https://www.remotion.dev/docs/render) | React compositions can render locally through CLI/server-side APIs and can produce video, audio-only, image sequence, still, GIF and transparent-video variants |
| [Motion Canvas](https://motioncanvas.io/docs/) | TypeScript generator-based vector animation with real-time preview and voice-over synchronization; described as free/open source |
| [Manim Community](https://docs.manim.community/en/stable/index.html) | Python CLI animation engine for precise explanatory/math visuals; MIT project with separate copyrighted asset considerations |
| [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html) | Filtergraphs support multi-input composition, overlays, text, subtitles, transitions and audio/video filtering; structured escaping is required |
| [FFmpeg devices](https://ffmpeg.org/ffmpeg-devices.html) | Documents device enumeration, Windows `gdigrab` screen capture and DirectShow input capabilities |
| [OBS developer guide](https://obsproject.com/kb/developer-guide) | OBS supports plugins, Python/Lua scripts and external WebSocket control of scenes and sources |
| [Playwright videos](https://playwright.dev/docs/videos) | Browser-context recording supports demo/test evidence but is tied to context closure and viewport configuration |
| [OpenAI Whisper](https://github.com/openai/whisper) | Local multilingual transcription/translation/language identification with model-size and hardware tradeoffs; MIT code/model license |
| [WhisperX](https://github.com/m-bain/whisperX) | Batched ASR, alignment, word-level timestamps, VAD and optional diarization with language/model limitations |
| [Piper](https://github.com/OHF-voice/piper1-gpl) | Fast local neural TTS with CLI, HTTP, Python and C/C++ interfaces; voice/model terms require review |
| [ElevenLabs TTS](https://elevenlabs.io/docs/overview/capabilities/text-to-speech) | Cloud TTS with voice/model/output options; provider docs state commercial use depends on paid plan and input rights |
| [EmotiVoice](https://github.com/netease-youdao/EmotiVoice) | Open-source multi-voice TTS with prompt-controlled emotional synthesis, including happy, excited, sad and angry styles; candidate adapter, not installed by default |
| [IndexTTS](https://github.com/index-tts/index-tts) | Open-source zero-shot TTS family with separate emotional-reference and emotion-control workflows; candidate for a native expressive adapter |
| [TED-TTS](https://github.com/Simon-leong/TED-TTS) | Training-free intra-utterance emotion and duration control with per-segment emotion descriptions; research candidate and heavier runtime than OmniVoice |
| [CoCoEmo](https://github.com/wsssy/CoCoEmo) | Training-free activation steering for mixed emotions on CosyVoice2/IndexTTS2; research integration candidate, not a drop-in OmniVoice feature |

## Primary AI video sources

| Source | Finding used in the plan |
|---|---|
| [Google Gemini video generation](https://ai.google.dev/gemini-api/docs/video) | Google documents Gemini Omni Flash and Veo; it describes Omni Flash for coherence, multi-input and multi-turn editing and Veo 3.1 for native audio, extension and frame-specific direction |
| [ByteDance Seedance 2.5](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5) | ByteDance describes up to 30-second generation, multi-round extensions, up to 30 images/10 video clips/10 audio references and timestamp-level editing; API access and availability are platform-specific |
| [Runway Gen-4.5](https://runway.com/research/introducing-runway-gen-4.5) | Runway describes motion quality, prompt adherence, physical accuracy, complex scenes and visual consistency; claims are provider-authored |
| [awesome-nano-banana](https://github.com/akirakai/awesome-nano-banana) | Prompt case studies support concise, structured scene/lighting/material/camera instructions and iterative identity-preserving edits; inspiration only, not a runtime model or training source; README states CC-BY-SA 4.0 |
| [awesome-nano-banana-pro-prompts](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts) | Prompt examples and previews are useful for composition patterns; inspiration only and its repository license must be checked before copying examples into the product |
| [polyhavenassets](https://github.com/Poly-Haven/polyhavenassets) | Blender asset-browser integration precedent for Poly Haven environments, materials and HDRIs; it does not guarantee a rigged dinosaur/tiger, free automatic addon installation, or rights for every asset; addon distribution is GPL-3.0 while asset terms remain separate |
| [blender-mcp](https://github.com/ahujasid/blender-mcp) | MCP transport can inspect scenes, search materials/assets and control Blender through Python, but arbitrary Python is a security boundary and default telemetry must not be enabled; transport does not guarantee model quality |

## Platform and rights sources

| Source | Finding used in the plan |
|---|---|
| [YouTube channel monetization policies](https://support.google.com/youtube/answer/1311392?hl=en) | Original/authentic content is expected; mass-produced, generic or repetitive content may be ineligible; reused content must add significant original value |
| [YouTube altered/synthetic content disclosure](https://support.google.com/youtube/answer/14328491?hl=en&co=GENIE.Platform%3DAndroid) | Applicable realistic or meaningfully altered synthetic content may require disclosure |
| [TikTok AI-generated content](https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content) | Applicable realistic AI-generated content should be labeled according to TikTok guidance |
| [TikTok Creator Rewards](https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program) | Program eligibility, original content and duration requirements are region/account dependent and must be checked in the official account surface |
| [Douyin Creator Center](https://creator.douyin.com/) | Creator platform provides creator/agency, content, interaction and data management surfaces; public eligibility is account/market specific |
| [TikTok Shop Vietnam creator application](https://seller-vn.tiktok.com/university/essay?knowledge_id=6837838528808705&lang=en) | Commerce creator eligibility is market/account specific and should be checked before enabling affiliate automation |

## Evidence limitations

No source above proves that a particular provider is “number one” for every workload. Benchmarks should use the same shot set, references, prompts, hardware profile and acceptance rubric. No source above grants the project rights to use third-party footage, music, voice, likeness or brand assets. No source above guarantees monetization, platform approval or legal compliance.
