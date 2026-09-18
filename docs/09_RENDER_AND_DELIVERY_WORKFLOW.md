# Render and Delivery Workflow

## Objective

Transform approved shot outputs into reproducible master and platform variants, then create a package that can be reviewed, archived and handed to an editor or publishing operator.

## Delivery stages

```text
probe inputs
  → normalize media
  → assemble timeline
  → mux audio
  → add captions
  → render master
  → create platform variants
  → generate thumbnail
  → validate outputs
  → create manifest/checksums
  → human approve
  → export/archive
```

## Output set

| Output | Purpose |
|---|---|
| `master.mp4` | Highest-quality approved project master |
| `social-9x16.mp4` | Vertical social variant |
| `social-16x9.mp4` | Horizontal platform variant |
| `preview.mp4` | Lightweight review file |
| `thumbnail.png` | Cover/preview |
| `captions/<locale>.srt` | Sidecar captions |
| `captions/<locale>.vtt` | Web captions |
| `metadata.json` | Project/episode/output metadata |
| `manifest.json` | Files, hashes, settings and evidence references |

## Validation

Output validation probes container, streams, dimensions, frame rate, duration tolerance, audio presence, subtitle encoding and minimum file size. It also checks that all referenced assets exist and that output paths stay inside the delivery directory.

The current P0 implementation provides an evidence-only path through `scripts/build_mock_delivery.py` and `scripts/validate_delivery.py`. It creates metadata, a Vietnamese review checklist and a checksummed manifest, then keeps the delivery `blocked` because no media worker has rendered an output and rights/disclosure review is still pending. It does not substitute for FFmpeg probing or human approval.

## Platform profiles

Platform profiles are configuration, not a promise of approval. Each profile declares aspect ratio, resolution, frame rate, codec, bitrate/quality policy, audio policy, caption format, thumbnail rules, file-size limit and disclosure fields. The profile version is recorded in the delivery manifest.

## Human handoff

A reviewer receives the preview, shot list, changed assets, rights summary, AI disclosure state, known limitations and a checklist. A delivery is `validated` only after deterministic checks; it becomes `approved` only after human review.

## Local mock verification

```powershell
python scripts/test_mock_delivery.py
python scripts/build_mock_delivery.py --recipe examples/minimal-3d-video/recipe.json --output-dir outputs/mock-delivery
python scripts/validate_delivery.py --manifest outputs/mock-delivery/manifest.json
```

The output directory is ignored by the repository, and the generator refuses to overwrite an existing package. These commands create no video, do not call a provider and do not publish.

## Archive

The archive includes the final media, subtitles, thumbnail, manifest, checksums, prompt/style/workflow versions, tool versions and review decision. Large intermediate files may be excluded only if the retention decision is recorded.
