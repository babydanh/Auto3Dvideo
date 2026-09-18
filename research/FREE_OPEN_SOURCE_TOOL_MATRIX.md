# Free and Open-Source Tool Matrix

## Decision principle

“Free” can mean free-to-download, free/open-source, free tier, or no marginal fee when run locally. These are not equivalent. A free cloud tier can have quota, watermark, queue, region or commercial-use restrictions. A local open-source tool still requires hardware, storage, electricity, setup and model licenses.

| Tool | Type | Free status | Automation fit | Main risk/limitation | Decision |
|---|---|---|---|---|---|
| Blender | 3D suite | Free/open-source | High through CLI/Python | Large scope and learning curve | Core 3D worker |
| ComfyUI | Local AI graph | Free/open-source | High through API/graphs | GPU/VRAM, custom node safety and model licenses | Core local AI engine |
| FFmpeg | Media CLI | Free/open-source | Very high | Complex codecs and command correctness | Core media worker |
| Kdenlive | Video editor | Free/open-source | Medium; manual finishing | GUI editor, not the job orchestrator | Free manual editor |
| DaVinci Resolve Free | Professional editor | Free tier | Low for GUI automation; high for manual finishing | Studio-only features, hardware load | Optional master editor |
| OpenTimelineIO | Timeline API/format | Free/open-source | High for interchange | Does not contain media; adapters may be separate | Optional interchange |
| ComfyUI Desktop | Local graph app | Open-source project/ecosystem | High | Model/download/custom-node management | Optional packaged local engine |
| Runway/Kling/Luma-style web tools | Cloud platform | Usually limited free credits | Medium through API if available | Quota, pricing, terms, region and output rights | Optional adapters |
| n8n | Self-hosted automation | Fair-code, terms must be reviewed | High for web integrations | Heavier deployment and license considerations | External integration only |
| Python runner | Custom | Free to build/run | Very high | Must build reliability, UI and state | Core orchestration |
| Rust/Tokio runner | Custom | Free to build/run | Very high | Higher development complexity | Preferred native runner |

## Recommended free-first combination

```text
Blender
+ ComfyUI
+ FFmpeg
+ SQLite
+ Rust/Tokio
+ Tauri/React
+ Kdenlive or DaVinci Resolve Free
```

This combination can complete planning, local generation, 3D work, deterministic media processing and manual review without requiring a recurring cloud subscription. It does not make high-quality local video generation free in practice if the computer lacks a suitable GPU.

## Free cloud policy

Cloud providers can be used for a controlled experiment, but the workflow must record provider, model, region, plan, quota, watermark state, commercial-use terms, cost estimate, actual cost and generation ID. Do not design the product around a free tier that has no stable API or no permission for commercial use.

## Hardware policy

The app must support a CPU-only mock/metadata mode. Local AI generation should detect GPU vendor, driver, VRAM and available disk before enqueueing a heavy graph. A job should fail with an actionable hardware message rather than exhausting memory or freezing the UI.

## Editor decision

Kdenlive is the default free/open-source manual editor in the documentation because it is available for Windows and does not require a paid license. DaVinci Resolve Free is the optional high-end finishing path when the machine and media formats are supported. Neither should be driven through brittle screen automation in the MVP.

## Rights policy

Free software does not imply free content. Model checkpoints, custom nodes, textures, fonts, stock footage, music, voices and generated outputs have separate terms. Every downloaded or generated asset needs a provenance record.
