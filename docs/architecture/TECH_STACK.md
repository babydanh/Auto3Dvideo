# Technology Stack Decision

## Decision summary

Auto3Dvideo will use a **local-first desktop control plane** with a web UI rendered inside Tauri, a Rust process/job boundary, SQLite metadata, ComfyUI for local graph execution, Blender for deterministic 3D work, and FFmpeg for deterministic media processing. Optional cloud video providers will be adapters, not architectural dependencies.

| Layer | Decision | Why |
|---|---|---|
| Desktop runtime | Tauri 2 | Small Windows-first desktop shell, existing frontend support, Rust system boundary and cross-platform path later |
| UI | React + TypeScript + Vite | Fast iteration for dashboard, shot board, asset browser and timeline surfaces |
| UI system | Tailwind CSS + accessible primitives | Semantic tokens, light/dark/system theme, keyboard and responsive behavior |
| Application core | Rust | Process control, filesystem boundary, credentials, queue and native integration |
| Async runtime | Tokio | Bounded concurrent jobs, cancellation, timers, subprocess supervision and channels |
| Metadata store | SQLite | Portable single-user project database with migrations and transactional state |
| Query layer | `sqlx` or `rusqlite` | Explicit migrations and typed access; choose one and do not mix in MVP |
| Local AI graph | ComfyUI API | Modular node graph, local async queue, partial graph re-execution, custom nodes and model offload |
| 3D engine | Blender CLI/Python | Mature modeling, scene, camera, animation and headless rendering |
| Media processing | FFmpeg | Deterministic command-line media transform, mux, concat, subtitle and variant output |
| Timeline interchange | OpenTimelineIO optional | External-media editorial cut interchange; not a media container |
| Manual editor | Kdenlive first; DaVinci Resolve Free optional | Free/open-source path plus professional finishing option |
| Cloud AI | Provider adapter interface | Swap Seedance/Veo/Runway/Kling/Luma-style providers without changing domain state |
| Validation | JSON Schema + Rust/Python checks | Contract validation without trusting provider output or free-form files |
| Packaging | Tauri Windows installer | Native distribution and update path after MVP |

## Why not Electron?

Electron remains a viable alternative when ecosystem maturity and Node-native desktop integrations outweigh binary size and system boundary concerns. Tauri is preferred for this project because the core requirements include process supervision, filesystem control, local tool invocation and a Windows-first distribution with a Rust boundary. The decision should be revisited if required plugins or frontend constraints materially favor Electron.

## Why not n8n as the core?

n8n is a capable fair-code workflow automation platform with visual workflows, custom code, self-hosting and extensive integrations. It is better suited to cross-service webhooks, SaaS integrations and business automation than a local media workstation. Embedding or redistributing it would add deployment, licensing and operational complexity. Auto3Dvideo may integrate with an external n8n instance later for notifications, webhooks or CRM actions, but the first desktop runner should remain small and project-scoped.

## Why ComfyUI is an engine, not the product

ComfyUI provides the graph execution surface and local model workflow. Auto3Dvideo must own the creator-facing project model, shot state, asset provenance, budget, approvals, job idempotency and delivery evidence. A ComfyUI workflow JSON is an executable dependency, not the complete source of truth for a production project.

## Why Blender is an integration, not the UI core

Blender is the true 3D authority for scenes and renders. The MVP should preview GLB/GLTF assets and submit controlled Blender jobs rather than reimplement Blender's mesh, rig, animation, physics and compositor stack. This preserves a realistic delivery scope while still allowing Auto3Dvideo to automate deterministic tasks.

## Why FFmpeg is mandatory

AI providers and editors produce heterogeneous outputs. FFmpeg is the deterministic boundary for normalization, frame-rate checks, audio muxing, concatenation, subtitle burn-in, thumbnails and platform variants. GUI automation of CapCut or DaVinci should not be the reliability boundary.

## Hardware profiles

| Profile | Expected usage | Policy |
|---|---|---|
| CPU-only | Planning, metadata, FFmpeg, mock jobs and light Blender preview | Must work for contract/runner development |
| 8 GB VRAM | Small local image/video graph and modest Blender scene | Use quantized/offloaded models and bounded resolution |
| 12–16 GB VRAM | Practical local generation and 3D preview | Recommended baseline for local AI experiments |
| 24 GB+ VRAM | Larger local video/3D graphs and batch jobs | Optional; do not make MVP installation depend on it |
| Cloud API only | No suitable local GPU | Use budgeted provider adapter and preserve generation metadata |

## Dependency policy

All external tools must be detected by version and executable path. The app must show a clear health state for missing, incompatible or untrusted binaries. It must not download and execute arbitrary model nodes, scripts or installers without explicit approval. Every dependency has an owner, license note, update policy and fallback behavior.

## References

[1]: https://v2.tauri.app/ "Tauri 2 official documentation"
[2]: https://github.com/Comfy-Org/ComfyUI "ComfyUI official repository"
[3]: https://github.com/VelornLabs/velorn "Velorn open-source AI video workstation case study"
[4]: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html "Blender 5.2 LTS command-line arguments"
[5]: https://github.com/AcademySoftwareFoundation/OpenTimelineIO "OpenTimelineIO official repository"
[6]: https://github.com/n8n-io/n8n "n8n official repository"
[7]: https://www.blackmagicdesign.com/products/davinciresolve "DaVinci Resolve official product page"
[8]: https://kdenlive.org/download/ "Kdenlive official downloads"
