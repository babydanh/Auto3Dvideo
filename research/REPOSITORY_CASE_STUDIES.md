# Repository Case Studies

## Purpose

These case studies identify reusable patterns rather than copy code. Each project has its own scope, license and operational assumptions. Auto3Dvideo should preserve the useful architectural lessons while keeping its own contracts and safety boundary.

## ComfyUI

ComfyUI is the closest reference for a visual AI graph executor. Its modular node interface and API/backend model make workflows explicit and reusable. The repository describes asynchronous queueing, partial graph re-execution, VRAM/RAM management, model offloading, quantized models, custom nodes and media operations.

**Adopt:** versioned graph definitions, node-level inputs, queue status, partial rerun, custom extension boundary and local server integration.

**Do not adopt blindly:** unrestricted custom-node installation, arbitrary file access or treating a graph JSON as the entire production record.

## Velorn

Velorn is a useful product precedent because it wraps a local ComfyUI server in a project-based desktop video workstation. Its documented patterns include asset management, timeline editing, project state, embedded graph editing, auto-start behavior, preview-first agent tools, safe local MCP endpoints and explicit approval for filesystem-affecting actions.

**Adopt:** project-centric UX, local ComfyUI health check, endpoint markers, preview before mutation, undo where possible, explicit approval and agent-safe tool boundaries.

**Do not copy blindly:** its internal compatibility markers, product-specific MCP surface or assumptions about its own editor model.

## OpenTimelineIO

OpenTimelineIO decouples editorial cut information from media files. It supports clips, timing, tracks, transitions, markers and metadata and can use adapters for other formats.

**Adopt:** a timeline contract that references external media by stable asset identity, frame/time metadata and markers. Support OTIO export after the internal contract is stable.

**Do not treat it as:** a media container, a project database or a substitute for output file validation.

## n8n

n8n demonstrates the value of visual workflows, custom code, self-hosting and integrations. It is a good reference for webhook/notification/business automation around a media system.

**Adopt:** clear nodes, credentials separated from workflow data, execution history and reusable integrations.

**Do not embed in MVP:** its full service, editor, deployment model or licensing assumptions. A local video runner needs a smaller resource-aware state machine.

## Tauri

Tauri demonstrates the desktop pattern of using a web frontend with native application logic. This fits a UI-rich app with local filesystem, process and OS integration requirements.

**Adopt:** a small desktop shell, command allowlists, explicit capability permissions and a native boundary for process supervision.

**Do not assume:** that using Tauri automatically secures arbitrary command execution or secrets. Security is a configuration and code responsibility.

## Blender command-line workflow

Blender's command-line options make it suitable as a supervised worker for background rendering and Python automation. The process should receive a known `.blend` file, a known script, an output directory and explicit render arguments.

**Adopt:** headless execution, output templating, log capture, Python exit codes and explicit GPU/engine options.

**Do not allow:** arbitrary scripts or unknown files to execute merely because a workflow JSON references them.

## MoneyPrinterV2

MoneyPrinterV2 is a compact Python CLI case study for an end-to-end content happy path: topic/script generation, local TTS, optional local/cloud STT, AI image generation, MoviePy assembly and optional browser-based upload. Its current source is narrower than its broad configuration surface suggests: text is Ollama-local, images are Nano Banana 2/Gemini, voice is KittenTTS and STT has local Whisper or AssemblyAI paths. The image compositor uses prompt-count heuristics, equal-duration images and looping, so it does not provide a beat/entity/semantic visual-grounding layer.

**Adopt:** a short stage sequence, local model discovery/selection, local-first TTS/STT options, fixed-argument helper processes, bounded HTTP retry patterns and a preview/review payload before delivery.

**Do not adopt blindly:** direct credential fields in `config.json`, one class that owns planning/generation/assembly/upload, equal-duration slideshow logic, JSON scratch state as the source of truth, Selenium Firefox-profile publishing, scraping/outreach/affiliate workflows or viral-video download/re-edit/re-upload. Use the full [MoneyPrinterV2 case study](MONEYPRINTERV2_CASE_STUDY.md) for the source-backed analysis and the proposed `NarrativeVisualPlan` vertical slice.

## Synthesis

The best architecture is a composition:

```text
Tauri project app
  + ComfyUI graph executor
  + Blender worker
  + FFmpeg transform worker
  + internal job/state/evidence model
  + optional OpenTimelineIO interchange
  + optional n8n integration outside the core
```

The product value is not another generic node editor. It is the controlled connection between creative intent, repeatable jobs, safe local tools, provider changes, human review and delivery evidence.

## References

[1]: https://github.com/Comfy-Org/ComfyUI "ComfyUI"
[2]: https://github.com/VelornLabs/velorn "Velorn"
[3]: https://github.com/AcademySoftwareFoundation/OpenTimelineIO "OpenTimelineIO"
[4]: https://github.com/n8n-io/n8n "n8n"
[5]: https://v2.tauri.app/ "Tauri 2"
[6]: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html "Blender command-line arguments"
