# Reference-to-3D Cinematic Workflow Research — 2026-08-27

## Executive conclusion

The supplied TikTok reference should be treated as a finished science-editorial production, not as a single Blender scene or a single AI video prompt. The visible grammar includes a strong hook, a hero visual with apparent depth and motion, high-contrast dark/cyan/white styling, red accent contrast, typography/branding layers and a sequence of visual events. The sandbox could not load the TikTok player consistently enough for frame-by-frame confirmation, so this report does not claim the original production tools or exact shot count.

A workflow capable of producing that class of result is feasible, but it needs a production system with editorial planning, reusable 3D assets, shot-level scene building, deterministic render workers, a real timeline composer and review gates. Auto3Dvideo currently has the beginnings of this system and should evolve toward a local-first hybrid rather than adding a random video model.

## What was missing from the previous trial

The previous Editorial Space Pulse test proved local Blender render, camera motion, VieNeu voice and FFmpeg composition. It intentionally used one abstract sphere/rings hero scene. It therefore tested palette and motion grammar, but not the capabilities that make the reference feel “professional”: multiple semantic scenes, distinct camera language per beat, model/asset continuity, compositing, sound design, editorial timing, visual proof per sentence, and a final NLE-style timeline.

| Reference-class capability | Required implementation |
|---|---|
| Many impressive 3D models | Asset Registry with stable `assetId`, model version, material/lookdev version, scale and approved provenance. |
| Several shots working together | Shot Graph with event, cause/effect, frame range, camera intent, visual proof and continuity constraints. |
| Consistent characters/objects | Shared asset packages and scene-building step; never regenerate the same hero object independently for every shot. |
| Cinematic look | Versioned Style Bible for lens, lighting, palette, material, depth of field, atmosphere, render profile and negative constraints. |
| Fast editorial rhythm | Timeline Composition with multiple tracks, clip trims, transitions, overlays, captions, audio and markers. |
| Science-explainer clarity | Claim Ledger linked to narration spans and shot-level visual proof. |
| Reliable production | Versioning, playblast review, render manifest, bounded retries, logs, hashes and human approval. |

## Recommended architecture

```text
Reference Video Intake
  ├─ rights gate, hash, FFprobe, transcript if permitted
  ├─ shot boundary detection
  ├─ keyframe/contact-sheet extraction
  ├─ audio beat and caption-span analysis
  └─ visual grammar report (style only; no media reuse)

Creative Development
  ├─ brief and audience promise
  ├─ claim ledger and source review
  ├─ original script and narration timing
  ├─ style bible
  └─ narrative visual plan / shot graph

Asset and Scene Production
  ├─ asset registry and version lock
  ├─ model/material/rig import or procedural build
  ├─ scene builder per shot
  ├─ camera and lighting presets
  ├─ playblast thumbnails
  └─ bounded Blender render worker

Editorial Composition
  ├─ OTIO-compatible timeline
  ├─ video and overlay tracks
  ├─ voice/music/SFX tracks
  ├─ typography and caption safe-area
  └─ FFmpeg/Blender VSE export

Review and Delivery
  ├─ visual continuity QA
  ├─ audio and subtitle QA
  ├─ factual/rights/policy QA
  ├─ human review gate
  └─ delivery manifest and hashes
```

## Which public projects are useful

BlenderProc is a useful pattern for deterministic procedural scene construction, reusable object/material/light/camera helpers and repeated render passes. It is not a drop-in editorial system and should not be installed without explicit approval. OpenTimelineIO is the strongest candidate for structured editorial interchange: it stores cut order, timing and references to external media, but it is not a media container. Blender's Video Sequencer already supports multiple video channels, overlays, transitions and synchronized audio. Prism demonstrates production-grade scene versioning, asset import/export, shot cameras, scene building, frame-range/FPS/resolution synchronization and OTIO support. Kitsu demonstrates shot metadata linked to editorial strips and production tracking. ComfyUI's public multi-shot workflow is useful as an example of per-shot orchestration, but cloud API access requires its own plan/key and it does not solve true-3D continuity.

| Project | Use in Auto3Dvideo | Decision |
|---|---|---|
| Blender + Python API | Hero 3D assets, cameras, lighting, animation and renders | Core local renderer |
| Blender VSE | Local fallback composer for clips, overlays and audio | Use for first implementation |
| OpenTimelineIO | Structured timeline interchange and future Resolve/NLE bridge | Add adapter after internal timeline works |
| BlenderProc | Procedural scene/render patterns | Study patterns; do not add dependency yet |
| Prism | Asset/version/scene-building reference | Research integration; optional later |
| Kitsu | Review/status/shot tracking reference | Optional future connector; not required for solo MVP |
| ComfyUI | Optional provider for image/video/asset nodes | Adapter only; no continuity authority |
| Power Sequencer | Editing convenience | Avoid for Blender 5; project states recent Blender 5 support is unavailable |

## Concrete implementation plan

### Phase A — data model

Reuse the existing `narrative-visual-plan` and shot contracts. Add stable IDs and relationships instead of creating duplicate graph systems. A shot should reference `claimIds`, `assetIds`, `styleBibleVersion`, `cameraPreset`, `renderProfile`, `sourceSceneVersion`, `frameIn`, `frameOut`, `handles`, `visualProof`, `continuityRules` and `reviewState`.

### Phase B — scene building

Implement a bounded `scene_build` worker that accepts a validated shot plan and asset registry. It may load only approved project-relative assets, apply a versioned lookdev preset, set frame range/FPS/resolution, import the approved camera and save a new scene version. It must reject absolute paths, network URLs, arbitrary Python code and unregistered assets.

### Phase C — playblast and render

Every shot first renders a low-cost playblast/contact sheet. Human review happens before final render. Final rendering is per shot or per scene collection, not one monolithic 30-second render. Each render outputs a manifest containing Blender version, source scene hash, frame range, settings, worker version, network state and output hash.

### Phase D — timeline

Create a deterministic timeline compiler from the timeline-composition contract. It should place shot media by frame range, attach voice spans and SFX cues, add transitions and captions, then export an OTIO-compatible representation plus an FFmpeg delivery. Subtitle burn-in should be a separate operation with a tested Windows path strategy; sidecar SRT remains the fallback.

### Phase E — editorial QA

The QA report should compare narration span to visual proof, detect missing shots, flag continuity violations, check safe area, inspect audio duration/loudness and validate codec/FPS/resolution. Human review remains mandatory for the final motion, creative quality, factual claims, rights and publication decision.

## Minimum viable “reference-like” test

Do not start with a 7–8 minute video. The correct next test is a 45–60 second original science short with 10–12 events and at least five distinct visual scales: macro hero object, wide environment, diagram/graphic insert, close-up mechanism and final reveal. Use one consistent asset family across shots, two or three lighting states and a deliberate edit rhythm. This will test whether the workflow—not a lucky one-off render—can create the desired result.

## Policy boundary

The reference can teach pacing, contrast, camera categories, density of visual proof and editorial grammar. It must not become a source asset. Do not download or reuse TikTok footage/audio, remove watermarks, imitate the creator's exact composition, or clone the creator's voice. If the user provides an owned or licensed file, the intake worker may analyze it and store derived evidence, while still marking the original media as non-reusable unless explicit rights allow reuse.

## References

[1]: https://studio.blender.org/blog/opentimelineio-in-blender/ Blender Studio, “OpenTimelineIO in Blender” — production interchange and multi-track edit lessons.

[2]: https://summerofcode.withgoogle.com/programs/2026/projects/IVkxBrR2 Blender Foundation, “OpenTimelineIO Support in VSE” — structured editorial object graph and Blender integration goal.

[3]: https://docs.blender.org/manual/en/latest/video_editing/index.html Blender Manual, “Video Editing” — VSE channels, overlays, transitions and synchronized audio.

[4]: https://github.com/DLR-RM/BlenderProc DLR-RM, “BlenderProc” — procedural scene, camera, material and rendering pipeline patterns.

[5]: https://github.com/PixarAnimationStudios/OpenTimelineIO Pixar/Academy Software Foundation, “OpenTimelineIO” — editorial cut data model and adapters.

[6]: https://prism-pipeline.com/ Prism Pipeline — asset/version management, scene building, OTIO and DCC integrations.

[7]: https://prism-pipeline.com/docs/latest/plugins/Blender/ Prism Blender plugin documentation — scene versioning, shot camera, render and scene-building features.

[8]: https://studio.blender.org/tools/addons/blender_kitsu Blender Kitsu documentation — shot metadata strips and edit/shot relationship.

[9]: https://comfy.org/workflows/gsc_advanced_3_1-8357db8ead93/ ComfyUI public multi-shot workflow — per-shot orchestration example and API caveat.

[10]: https://github.com/GDQuest/blender-power-sequencer GDQuest Power Sequencer — editing add-on reference; repository notes lack of recent Blender 5 support.
