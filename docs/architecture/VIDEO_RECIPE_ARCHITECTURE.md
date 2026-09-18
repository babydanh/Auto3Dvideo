# Video Recipe Architecture

## Purpose

A “video” is an output contract, not a single generation method. The control plane accepts a recipe that declares the visual source, timing, audio, captions, worker, model profiles and delivery requirements. The recipe is compiled into a job graph and then into one or more validated media assets.

## Recipe lifecycle

```text
brief
  → recipe selection
  → normalized recipe
  → asset/rights preflight
  → timeline compilation
  → specialized worker execution
  → audio/caption synchronization
  → FFmpeg normalization and mux
  → output probe and quality gates
  → human review
  → delivery variants
```

## Recipe kinds

| Kind | Main inputs | Primary worker | Human review focus |
|---|---|---|---|
| `image_slideshow` | Images, order, per-image duration, transitions | FFmpeg or Remotion | Cropping, pacing, image rights, text readability |
| `2d_motion_graphics` | Vector/HTML scene, animation cues, data | Remotion/Motion Canvas/Manim | Timing, typography, visual hierarchy, claims |
| `html_to_video` | React composition ID, JSON data, assets | Remotion | Data correctness, responsive layout, font loading |
| `browser_demo_capture` | URL/local app, scripted actions, viewport | Playwright | Privacy, account data, cursor/actions and claims |
| `screen_demo` | Approved window/display, OBS scene | OBS/FFmpeg | Accidental private information, audio, continuity |
| `ai_video_shot` | Prompt, references, model profile, shot limits | ComfyUI/cloud adapter | Motion, temporal consistency, rights, disclosure |
| `hybrid_2d_3d` | Blender render plus HTML/vector overlays | Blender + Remotion/FFmpeg | Registration, depth/lighting, overlay legibility |
| `true_3d` | Scene file, assets, camera and frame range | Blender CLI/Python | Geometry, materials, animation, continuity |
| `voiceover_package` | Script segments, voice profile, pronunciation | Piper/cloud TTS + FFmpeg | Voice permission, pronunciation, prosody, pacing |
| `captioned_delivery` | Approved video, transcript, target languages | STT/alignment + FFmpeg | Timing, line breaks, translations, safe area |

## Compile rules

The compiler assigns every track an integer frame range at the selected frame rate. It rejects negative durations, missing assets, overlapping items on a non-layered track, unbounded browser capture, output dimensions outside the selected profile and audio/caption tracks without a source or transcript.

For an image slideshow, filename order is never authoritative. The recipe stores explicit asset IDs and durations. For HTML, the composition ID and data payload are hashed. For screen capture, the target and privacy-mask policy are recorded before capture. For AI video, the prompt/reference/model/provider version and cost/rights state are recorded. For true 3D, the Blender scene/script version and frame range are recorded.

## Audio contract

Voice, music, sound effects and system audio are separate tracks. The mixer applies explicit gain, ducking and normalization rules. A voiceover can be rendered in multiple languages without mutating the original script or video asset. Each TTS segment has a stable segment ID so that a failed segment can be retried without regenerating the full narration.

## Caption contract

The system keeps a canonical timed caption representation and exports SRT, WebVTT and optionally ASS/burned-in video. Translation creates a new caption version, never overwrites the source language. Captions are checked for duration overlap, reading speed, line length, safe-area placement and missing text.

## Browser and screen privacy

Browser or screen recipes are blocked unless the user has explicitly approved the capture target, viewport, audio sources and privacy policy. The preflight may check a window title or local app identity, but it must not upload screenshots or capture credentials. A capture can be stopped manually and must record the reason. The worker produces a privacy evidence file alongside the media.

## Worker output contract

Every worker returns:

```text
worker_id
worker_version
recipe_id
input_asset_hashes
output_asset_ids
media_probe
logs_redacted
warnings
cost_evidence
rights_evidence
review_required
```

An output with a zero process exit code but invalid media, missing evidence or blocked policy state is not considered successful.

## Why one common compositor remains necessary

Specialized renderers are better at their own domains, but they should not each implement separate audio, caption, codec, delivery, rights and audit systems. FFmpeg provides the common deterministic finishing boundary; the desktop app owns orchestration and evidence; optional editors remain human finishing tools.
