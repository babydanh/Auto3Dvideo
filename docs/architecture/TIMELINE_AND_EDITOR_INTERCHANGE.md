# Timeline and Editor Interchange

## Internal source of truth

Auto3Dvideo stores a versioned internal timeline contract. A timeline contains ordered shot references, time ranges, transitions, audio/caption references, markers and review state. It references assets by stable IDs and hashes rather than embedding large media blobs.

## Timeline model

```text
Timeline
  → Track(video|audio|caption|marker)
  → Clip(asset_id, source_range, timeline_range, speed, transform)
  → Transition
  → Marker
```

## Time policy

The MVP uses integer frame time for render and shot scheduling and stores the project frame rate explicitly. Human-facing duration may be displayed in seconds, but frame boundaries remain canonical. Audio sample offsets and subtitle timestamps must be converted with documented rounding rules.

## OTIO strategy

OpenTimelineIO is an optional interchange layer. It represents editorial cut information and references external media; it is not a media container. Auto3Dvideo exports OTIO only after validating that every referenced asset exists and that frame rate/time ranges are consistent. Import is preview-first and cannot overwrite the internal timeline without an approval event.

## Editor handoff

| Destination | Handoff |
|---|---|
| Kdenlive | MP4/WAV/SRT/VTT plus folder manifest; manual import |
| DaVinci Resolve | Master/intermediate media, audio, captions and optional OTIO/XML depending on supported workflow |
| CapCut | Social MP4, audio, subtitle and thumbnail files; manual import |
| Blender | Shot/scene spec, asset references, camera metadata and `.blend`/render outputs |

## Interchange acceptance

A handoff package records timeline version, source asset hashes, frame rate, dimensions, audio sample rate, subtitle language, color assumptions, output files and known limitations. A human editor may alter timing after handoff; the edited project is not automatically considered the Auto3Dvideo source of truth unless re-imported and reviewed.

## References

[1]: https://github.com/AcademySoftwareFoundation/OpenTimelineIO "OpenTimelineIO official repository"
