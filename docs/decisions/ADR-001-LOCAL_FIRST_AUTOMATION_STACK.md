# ADR-001 — Local-First Automation Stack

- **Status:** Accepted for planning
- **Date:** 2026-08-22
- **Scope:** Auto3Dvideo MVP

## Context

The product must coordinate large local media files, Blender, ComfyUI, FFmpeg, optional cloud providers, human review and evidence on Windows. It should remain useful with no paid API and should not become a fragile GUI automation script.

## Decision

Use Tauri 2 with React/TypeScript for the desktop control plane, Rust/Tokio for the native runner, SQLite for portable project metadata, ComfyUI for local graph execution, Blender CLI/Python for true 3D tasks, FFmpeg for deterministic media processing, and Kdenlive or DaVinci Resolve as optional manual finishers. Use an internal versioned timeline contract and optionally OpenTimelineIO for interchange.

## Alternatives considered

| Alternative | Decision |
|---|---|
| Browser-only SaaS | Deferred; large files, local tools and GPU workers increase infrastructure complexity |
| Electron desktop | Viable fallback if Node-native ecosystem requirements dominate; not selected initially |
| n8n as embedded core | Rejected for MVP; heavier and fair-code licensing/deployment assumptions |
| Full Blender replacement | Rejected; scope is too large and duplicates a mature tool |
| CapCut GUI automation | Rejected as reliability boundary; use standard outputs and manual import |
| Cloud-only generation | Rejected as default; cost, quota, region and availability risk |

## Consequences

The MVP requires local installation and a health check. It gains offline/project portability, direct process control and lower recurring cost. The architecture must invest in Windows process supervision, path safety, GPU detection, backup and clear dependency setup. Collaboration and remote rendering remain later capabilities.

## Revisit triggers

Revisit this decision if more than one user must edit a project concurrently, if remote rendering becomes the primary workload, if a required provider has no safe local/API path, or if the local tools cannot meet the accepted quality bar.
