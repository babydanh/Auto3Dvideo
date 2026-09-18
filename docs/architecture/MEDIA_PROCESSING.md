# Media Processing Architecture

## Role

FFmpeg is the deterministic media boundary. It handles normalization and packaging after AI/3D jobs, while human editors remain optional for creative finishing.

## Recipe workers

The control plane resolves a recipe to a specialized worker before it reaches the common FFmpeg boundary:

| Recipe family | Worker | Responsibility |
|---|---|---|
| `image_slideshow` | FFmpeg or Remotion | Deterministic image durations, crop/pan/zoom, transitions and text overlays |
| `2d_motion_graphics` | Remotion, Motion Canvas or Manim | Frame-based vector/HTML/diagram animation |
| `space_25d_infographic` | `local_space_25d_worker.py` + FFmpeg | Procedural stars, orbit layers, planets, camera-like parallax and frame-accurate vertical output |
| `licensed_space_footage` | `collect_licensed_footage.py` + `local_licensed_footage_worker.py` + FFmpeg | Manifest-driven local video sources with HTTPS allowlist, hashes, rights/proof fields, vertical crop and human review gate |
| `html_to_video` | Remotion | Render a pinned React composition from validated JSON data |
| `browser_demo_capture` | Playwright or OBS | Capture real browser/app behavior with explicit privacy approval |
| `screen_demo` | OBS WebSocket or FFmpeg capture | Scene/source setup, capture start/stop and recording evidence |
| `voiceover_package` | TTS/STT adapter + FFmpeg | Voice generation, alignment, normalization and caption sidecars |
| `hybrid_2d_3d` | Blender + Remotion/FFmpeg | Combine true 3D render with deterministic overlays and captions |
| `true_3d` | Blender CLI/Python | Geometry, scene, camera, animation and render frames |

Every worker produces versioned media plus a manifest with recipe ID, worker version, input hashes, frame rate, dimensions, duration, audio/caption references and quality-check results. The local 2.5D worker additionally records `animationMode`, `framePattern`, `frameCount`, `externalAssetsUsed` and `rightsStatus`; its procedural-only mode does not accept arbitrary URLs or third-party footage. The licensed-footage worker accepts only a bounded local `footage-manifest.json` produced by the allowlisted collector, verifies file containment and SHA-256, carries source/license/credit/proof metadata into each scene, and always emits `reviewState=needs_review` until a user approves a scope-bound rights decision.

## Operations

| Operation | Input | Output |
|---|---|---|
| `probe` | Media file | Duration, stream, codec, frame rate, dimensions and audio metadata |
| `normalize` | Heterogeneous clip | Project-standard intermediate |
| `concat` | Ordered clips | Draft or master video |
| `mux` | Video + audio | Synchronized media |
| `subtitle` | Video + SRT/VTT | Burned or sidecar captions |
| `thumbnail` | Video/frame | PNG/JPEG thumbnail |
| `variant` | Master | 16:9, 9:16, 1:1 and preview variants |
| `archive` | Delivery package | Checksummed archive and manifest |
| `image_sequence` | Ordered images + timing | Frame-accurate intermediate video or image sequence |
| `audio_normalize` | Voice/music tracks | Normalized, mixed or ducked audio |
| `caption_generate` | Transcript + timing | SRT/VTT/ASS sidecar and optional burned-in track |
| `browser_capture` | Approved browser/session source | Captured video + privacy/capture evidence |

## Media defaults

The project should define profile-specific defaults rather than hiding them in commands:

```yaml
master:
  container: mp4
  video_codec: h264
  audio_codec: aac
  frame_rate: 30
  color_space: bt709
social_vertical:
  width: 1080
  height: 1920
  frame_rate: 30
preview:
  width: 720
  height: 1280
  video_codec: h264
```

These are starting defaults, not universal platform requirements. The delivery profile records the actual values.

## Command safety

Build FFmpeg arguments as structured arrays. Do not concatenate raw user text into a shell command. Validate input paths, output path, filter graph, codec names and duration. Use a timeout and capture logs. The process executor rejects output outside the project workspace.

The `contracts/media-plan.schema.json` contract represents operations such as `probe`, `normalize`, `concat`, `mux`, `subtitle`, `variant` and `image_sequence` without exposing a shell command or raw filter graph. `scripts/validate_media_plan.py` checks executable mapping, workspace-relative paths, typed media settings and the P0 locks `dryRun=true`, `externalPublish=false` and `paidGeneration=false`. The native app has an explicit `run_ffmpeg_fixture` command and a durable `run_ffmpeg_fixture_attempt` command. Both compile fixed application-owned arguments, spawn only configured `ffmpeg.exe`/`ffprobe.exe` directly and return bounded process/output evidence. The durable path persists `external_process` lifecycle state, output validation, log byte counts, cancellation/failure taxonomy and startup reconciliation; it is still a synthetic fixture path, not a general media-plan executor.

## Quality checks

A successful transform requires a zero exit code, output existence, minimum size, readable container, expected streams, expected dimensions, duration tolerance, frame rate and audio presence when required. Run a second probe on the output. The local fixture currently checks non-empty output, two or more streams, positive duration and FFprobe readability; richer codec/dimension/frame-rate checks remain part of the general worker slice. The explicit Settings Probe action executes only a fixed version command through the same direct supervisor. Before that action, `scripts/report_tool_readiness.py` still reports metadata without executing binaries or probing network; a missing required binary remains `blocked`. An interrupted external attempt is conservatively moved to `reconciliation_required` on app restart instead of being treated as successful.

## Timing and synchronization

The internal timeline is frame-based. Image durations, animation cues, speech segments and captions are converted to integer frame ranges at the selected FPS. The system rejects overlapping or ambiguous timing unless the recipe explicitly allows layers. Audio remains sample-time data until the final mux, with a recorded duration tolerance and drift check.

## Editors

Kdenlive or DaVinci Resolve can be opened with generated media and metadata for manual finishing. The automation core should not depend on simulated clicks, unstable project-file internals or GUI availability. Use standard media files, subtitle files and optional OTIO interchange.

## References

[1]: https://ffmpeg.org/documentation.html "FFmpeg documentation"
[2]: https://ffmpeg.org/ffmpeg-filters.html "FFmpeg filters documentation"
[3]: https://ffmpeg.org/ffmpeg-devices.html "FFmpeg devices documentation"
[4]: https://www.remotion.dev/docs/render "Remotion render documentation"
[5]: https://motioncanvas.io/docs/ "Motion Canvas documentation"
[6]: https://playwright.dev/docs/videos "Playwright video documentation"
[7]: https://obsproject.com/kb/developer-guide "OBS developer guide"
[8]: https://kdenlive.org/download/ "Kdenlive official downloads"
[9]: https://www.blackmagicdesign.com/products/davinciresolve "DaVinci Resolve official product page"


## Voice Studio và VieNeu-TTS

Voice Studio là lớp chuẩn hóa trước TTS. UI lưu `voiceSettings` trong script gồm preset voice, temperature bounded 0.6–1.2, cue theo segment, mã cảm xúc theo segment, trạng thái clone và reference path tương đối khi có. Mã cảm xúc chuẩn gồm neutral, calm, warm, friendly, happy, excited, joyful, triumphant, sad, melancholic, tender, concerned, fearful, angry, shouting, urgent, serious, surprised, mysterious, curious, sarcastic và whisper. Văn bản cũng nhận markup `[EXCITED] ... [SHOUTING] ...`; worker tách các đoạn trước khi gọi TTS và không gửi tag cho người nghe. Native validator từ chối unknown key, cue/mã cảm xúc ngoài allowlist, temperature ngoài khoảng và reference audio không đi kèm `cloneEnabled=true`/`cloneConsent=true`.

Khi render approved, Rust truyền mã cảm xúc vào request JSON project-relative và chạy worker Python bằng direct supervisor. OmniVoice local hiện chưa có bộ điều khiển cảm xúc tự do như các model expressive TTS; adapter dùng fallback cue tương thích (`[cười]`, `[thở dài]`, `[hắng giọng]`) và ghi rõ `emotionFallback=legacy_omnivoice_cues` trong report. Provider có native emotion control có thể dùng cùng mã chuẩn mà không đổi script contract. Worker chạy offline model mode, kiểm tra lại path/size/suffix/consent, không tải model trong synthesis và chỉ trả metadata đã được kiểm chứng. Output WAV được validate header, probe duration rồi mới dùng cho SRT/FFmpeg. Voice clone mặc định tắt; quyền reference audio, chất lượng phát âm, disclosure và policy delivery vẫn là human-review gates.
