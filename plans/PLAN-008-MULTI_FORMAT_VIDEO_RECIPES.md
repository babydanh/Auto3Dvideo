# PLAN-008 — Multi-Format Video Recipes

## Objective

Prove that one desktop control plane can automate different video types without turning into a fragile collection of one-off scripts. Each recipe must reuse project state, timeline, assets, audio/caption contracts, review gates, output validation and delivery evidence.

## Delivery slices

| Slice | Recipe | First worker | Acceptance |
|---|---|---|---|
| P0 | `image_slideshow` | Mock + FFmpeg plan | Explicit image order/duration, transitions, voice/captions and deterministic manifest |
| P0 | `voiceover_package` | Mock TTS + FFmpeg audio | Segment IDs, language/voice profile, rights gate, normalized WAV/MP3 and timing evidence |
| P0 | `captioned_delivery` | Fixture transcript + FFmpeg | SRT/VTT sidecars, burned-in variant, timing/line/safe-area checks |
| P1 | `html_to_video` | Remotion local worker | Pinned composition, validated JSON data, preview/final output, font/assets manifest |
| P1 | `2d_motion_graphics` | Remotion or Motion Canvas | Frame-accurate animation, voice marker synchronization and reusable design tokens |
| P1 | `true_3d` | Blender worker | Scene/script version, deterministic frame range, render probe and continuity review |
| P1 | `hybrid_2d_3d` | Blender + Remotion/FFmpeg | Overlay registration, shared timing, caption/audio sync and output probe |
| P2 | `screen_demo` | OBS WebSocket adapter | Approved scene/source, privacy preflight, start/stop evidence and captured output |
| P2 | `browser_demo_capture` | Playwright adapter | Explicit target/viewport, no credential capture, browser-session evidence and output validation |
| P2 | `ai_video_shot` | ComfyUI/cloud adapters | Provider/model evidence, budget/rights gate, reconciled retry and human acceptance |
| P3 | `manim_explainer` | Manim adapter | Explicit scene entrypoint, pinned environment, output probe and asset-license review |

## Shared acceptance criteria

Every slice must use the same project and job identifiers, write only inside the project workspace, support dry run/mock mode, preserve input/output hashes, produce redacted logs, obey timeout/cancellation rules, handle an interrupted job, reject unsupported capability and stop before paid or rights-sensitive side effects.

## Audio/caption variants

The system should permit a video to have no audio, user-provided audio, mock/local TTS, approved cloud TTS, generated music or mixed tracks. Captions may be supplied, generated from STT, aligned at word or segment level, translated into a new version or burned in. The source transcript is never overwritten by a translation.

## HTML-specific acceptance

The HTML worker must accept a composition ID and validated data payload, resolve fonts/assets from an allowlisted project path, render at an explicit FPS/size, produce a preview before final, report browser/runtime versions and fail closed when external network assets are required but not approved.

## Screen-specific acceptance

The screen worker must require capture approval, record target identity and privacy mask rules, support a stop action, avoid capturing unrelated windows where possible, and retain a privacy review record. It must not automatically upload a recording.

## Provider-specific acceptance

A cloud or TTS provider is not considered integrated until its adapter supports capability discovery, validation, cost estimate, idempotent submission, status reconciliation, output download, error normalization, terms metadata and mock fallback. Provider free tiers are not used as a production-cost assumption.

## Performance measurements

Record render duration, wall-clock time, CPU/RAM/GPU use when available, output size, audio drift, caption timing error, preview-to-final delta, retry count and manual interventions. Compare recipes on the same Windows hardware profile rather than using unspecified benchmark claims.

## Non-goals

Do not build a full nonlinear editor, automate unauthorized website scraping, bypass accounts or regions, remove watermarks, auto-publish content or imply monetization. The first release should optimize for reproducible original content and evidence, not maximum number of integrations.
