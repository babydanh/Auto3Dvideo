# Multi-Format Video Toolchain Research — 2026-08-22

## Executive conclusion

Auto3Dvideo should support a **family of video recipes**, not one universal generator. The common control plane should own the brief, timeline, assets, model/provider selection, audio/caption plan, policy gates, retries, evidence and delivery package. Specialized workers should render different media classes.

The recommended baseline is **FFmpeg as the deterministic compositor/exporter**, **Remotion as an optional HTML/CSS/React composition worker**, **Motion Canvas or Manim for specialized 2D/vector explainers**, **Whisper or WhisperX for local transcription/timestamps**, **Piper or an approved cloud TTS provider for narration**, **OBS or FFmpeg capture for screen/demo videos**, **ComfyUI for local generative references/video graphs**, and **Blender for true 3D**. A workflow can combine several of these workers.

> The product is an automation control plane, not a full replacement for Blender, a nonlinear editor or every external AI website.

## Supported video recipe families

| Recipe | Typical input | Primary renderer/worker | Audio/caption path | Best use |
|---|---|---|---|---|
| `image_slideshow` | Images, durations, transitions, text | FFmpeg or Remotion | TTS/music + Whisper alignment + SRT/VTT | Photo stories, listicles, product slides |
| `2d_motion_graphics` | SVG/HTML/React/vector scene spec | Remotion, Motion Canvas or Manim | Voice-over markers + captions | Explainers, charts, diagrams, educational clips |
| `html_to_video` | HTML/CSS/React composition and data | Remotion first; browser capture only when required | TTS/STT and timed overlays | Web UI demos, dashboards, product pages |
| `screen_demo` | App/window/display source and action script | OBS WebSocket or FFmpeg capture | Microphone/system audio + captions | Tutorials, product demos, walkthroughs |
| `ai_video_shot` | Prompt, references, shot constraints | ComfyUI or approved cloud adapter | Separate narration/music/captions | Cinematic inserts and short shots |
| `hybrid_2d_3d` | 2D overlays + 3D scene/render | Blender + Remotion/FFmpeg | Shared narration/timeline | Product explainers and branded scenes |
| `true_3d` | Scene spec, assets, camera, animation | Blender CLI/Python | FFmpeg finishing + captions | Repeatable 3D product/scene videos |
| `voiceover_package` | Script, voice/model/profile, mix plan | TTS worker + FFmpeg | Loudness/ducking/segment alignment | Narration variants and localization |
| `captioned_delivery` | Approved media + transcript | FFmpeg subtitle/mux filters | SRT/VTT/ASS plus burned-in variant | Platform-ready delivery variants |

## Tool findings

### 1. FFmpeg: common media graph and delivery backbone

FFmpeg documents filtergraphs as connected audio/video processing graphs with multiple inputs and outputs. Its filters include overlay, text rendering through `drawtext`/`textfile`, subtitle rendering, concat, transitions, scaling, audio mixing and timing controls [3]. The device documentation also describes input devices and specifically documents the Windows `gdigrab` capture device for desktop or window capture [4].

This makes FFmpeg the common **normalization and delivery layer**, not necessarily the best authoring environment. The Rust runner should create a structured filter plan or a generated filter script, use explicit argument arrays and keep user text in files when possible. It must avoid interpolating arbitrary prompt or caption text directly into a shell command because filtergraph and Windows shell escaping are multi-layered [3].

### 2. Remotion: HTML/CSS/React-to-video worker

Remotion uses React compositions and supports local rendering through a CLI as well as a server-side rendering API. Its documentation also exposes audio-only export, image-sequence output, still images, GIF and transparent-video variants [1]. This is a strong fit for data-driven 2D videos and HTML/CSS/React compositions where exact frame timing and reusable components matter.

Remotion should be treated as an **optional worker with a license and terms gate**. The desktop control plane can launch a pinned local composition project, pass a validated JSON input payload, render a preview or final output, probe the result and register the asset. The first implementation should not assume that every Remotion feature or license is included in the core product distribution.

### 3. Motion Canvas: voice-synchronized vector explainers

Motion Canvas is described as a TypeScript library plus an editor for real-time preview. Its documentation positions it for informative vector animations and synchronization with voice-overs, and describes the project as free and open source [2]. It is a good optional path for diagrammatic or educational motion graphics, but it should not become a second general-purpose editor inside Auto3Dvideo.

### 4. Manim: precise technical and mathematical animations

Manim Community is a Python animation engine intended for precise programmatic explanatory animations. Its documentation provides a CLI scene-rendering workflow, Windows installation guidance and an MIT license statement, while warning that the community edition differs from other Manim projects and that particular copyrighted assets must not be reused [11]. It should be an optional specialized worker for charts, formulas, technical diagrams and educational sequences, not a default renderer for commercial social videos.

### 5. Playwright: browser/demo capture, not primary rendering

Playwright documents video recording primarily for tests and browser contexts. Recordings are saved when the page or browser context closes, and the output size is coupled to the configured viewport [5]. This is useful for a browser demo recipe or evidence capture, but it is less appropriate than Remotion for frame-accurate HTML composition because test recording introduces browser/session lifecycle concerns and is not the main purpose of the feature.

The product should support two separate recipes: `html_to_video` using Remotion for deterministic composition, and `browser_demo_capture` using Playwright only when the goal is to show a real browser session or interactive behavior.

### 6. OBS Studio: controllable screen/demo capture

The OBS developer guide states that OBS can be extended through plugins, Python/Lua scripts and an external WebSocket endpoint. The WebSocket can interact with scenes and sources [6]. This makes OBS a useful optional capture adapter: Auto3Dvideo can prepare a scene collection, set sources, start/stop recording and ingest the resulting file, provided the user explicitly enables the adapter and the recording evidence is captured.

OBS should not be embedded as the core compositor. Its process and WebSocket connection require health checks, version compatibility, port/authentication controls and clear user consent because screen capture may include private windows, notifications or personal data.

### 7. Whisper and WhisperX: local STT and caption timing

OpenAI's Whisper repository describes a general-purpose multilingual speech-recognition model with transcription, speech translation and language identification. The repository documents model-size tradeoffs, local execution and an FFmpeg requirement, and releases the code/model under MIT [7]. Whisper is a strong local-first baseline for transcription and initial captions.

WhisperX adds batched inference, word-level timestamps, alignment, VAD and optional speaker diarization, while documenting language-specific alignment limitations, GPU requirements and the need for an access token/agreement for some diarization models [8]. It is useful when karaoke-style highlighting or tighter timing is required, but the app should make word-level alignment optional and should not require speaker diarization for a simple single-narrator video.

### 8. Piper and cloud TTS

The current OHF-Voice Piper repository describes a fast local neural TTS engine with CLI, HTTP, Python and C/C++ interfaces [9]. It is a candidate for a private, low-cost narration path, but the selected repository/voice licenses must be reviewed before bundling or commercial distribution.

ElevenLabs documents TTS APIs, multiple voice/model options and several audio output formats. Its documentation states that commercial use depends on paid plans and the user's rights to input content; it also documents voice cloning and nondeterministic output behavior [10]. Therefore an ElevenLabs-style adapter is appropriate as an optional cloud TTS provider, but the app must require a voice/likeness rights record, terms snapshot, pricing evidence and paid-generation approval when applicable.

## Recommended architecture by mode

```text
brief + recipe
  → script / visual plan
  → asset and rights checks
  → recipe-specific worker
      ├─ slideshow: image sequence + transitions
      ├─ motion: Remotion / Motion Canvas / Manim
      ├─ html: Remotion composition
      ├─ browser demo: Playwright or OBS capture
      ├─ ai shot: ComfyUI / approved cloud adapter
      ├─ 3D: Blender background worker
      └─ voice: Piper / approved TTS adapter
  → FFmpeg normalize / mix / subtitle / mux
  → media probe and quality checks
  → human preview and approval
  → delivery variants
```

## Normalized recipe fields

Every recipe should resolve to a common internal video specification:

```text
recipe_kind
project_id / episode_id / shot_id
width / height / fps / pixel_format / color_policy
duration_policy
visual_tracks[]
audio_tracks[]
caption_tracks[]
transition_policy
safe_area_policy
render_worker
model_profiles[]
input_asset_ids[]
output_formats[]
rights_requirements
budget_policy
review_requirements
```

The recipe-specific parameters remain in a typed extension object. For example, a slideshow adds image durations and transition IDs; an HTML recipe adds composition ID and data payload; a screen recipe adds capture source and privacy mask; a 3D recipe adds scene file, camera and frame range.

## Audio and narration graph

The audio pipeline should treat narration as a timed asset, not as an afterthought:

```text
script
  → voice profile and rights check
  → TTS segments
  → silence/level/prosody review
  → concatenate and normalize
  → transcript/STT or supplied transcript
  → SRT/VTT/ASS generation
  → optional music bed with ducking
  → final mux and loudness check
```

The app should preserve both a clean audio track and a mixed delivery track where possible. It should support language, voice ID, model, seed (if a provider offers it), pronunciation notes, segment IDs and timing evidence. Likeness/voice cloning is blocked until the permission record is approved.

## Format decisions

| Decision | Recommendation |
|---|---|
| Common export | MP4/H.264 with AAC after probing and policy checks |
| Intermediate | Image sequence, WAV/PCM and lossless or high-quality intermediate when needed |
| Captions | Preserve SRT/VTT sidecars; optionally render ASS/burned-in variant |
| HTML | Render with Remotion for deterministic compositions; capture with Playwright only for actual browser behavior |
| Screen | OBS adapter for scene/source control; FFmpeg capture fallback only after runtime capability check |
| Image slideshow | Use frame/time-based recipe and FFmpeg/Remotion worker, never depend on image filename order alone |
| 3D | Blender for geometry/lighting/camera continuity; FFmpeg for finishing |
| Final edit | Optional Kdenlive/Resolve handoff; no hidden mutation of a user's project |

## MVP order

1. Implement a mock `image_slideshow` recipe with local images, deterministic durations, transitions and FFmpeg-style output metadata.
2. Implement `voiceover_package` with a mock TTS adapter, SRT/VTT fixture and audio timing evidence.
3. Add a Remotion prototype worker for `html_to_video` using a pinned local composition and JSON data input.
4. Add local Whisper STT and caption generation, then optional WhisperX alignment if the hardware and license review are complete.
5. Add `hybrid_2d_3d` by combining Remotion/FFmpeg overlays with the existing Blender preview path.
6. Add OBS/Playwright browser-demo capture only after privacy masking and explicit capture approval are implemented.
7. Add cloud video/TTS/image providers as independent adapters, each with cost, rights, terms and receipt gates.

## Non-goals

This expansion does not promise automatic creation of every kind of video, unlimited free cloud generations, automatic access to paid websites, scraping of third-party video, watermark removal, account bypass or automatic publishing. Provider/model availability, pricing, license, output rights and platform rules must be rechecked when an adapter is implemented.

## References

[1]: https://www.remotion.dev/docs/render "Remotion — Render your video"
[2]: https://motioncanvas.io/docs/ "Motion Canvas documentation"
[3]: https://ffmpeg.org/ffmpeg-filters.html "FFmpeg Filters Documentation"
[4]: https://ffmpeg.org/ffmpeg-devices.html "FFmpeg Devices Documentation"
[5]: https://playwright.dev/docs/videos "Playwright — Videos"
[6]: https://obsproject.com/kb/developer-guide "OBS Studio Developer Guide"
[7]: https://github.com/openai/whisper "OpenAI Whisper repository"
[8]: https://github.com/m-bain/whisperX "WhisperX repository"
[9]: https://github.com/OHF-voice/piper1-gpl "OHF-Voice Piper repository"
[10]: https://elevenlabs.io/docs/overview/capabilities/text-to-speech "ElevenLabs Text to Speech documentation"
[11]: https://docs.manim.community/en/stable/index.html "Manim Community Edition documentation"
