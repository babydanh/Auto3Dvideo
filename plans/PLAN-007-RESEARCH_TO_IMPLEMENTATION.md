# PLAN-007 — Research to Implementation Traceability

## Purpose

Prevent the project from collecting research that never changes implementation. Every external observation must map to a decision, contract, test, backlog item or explicit non-adoption reason.

## Traceability table

| Research observation | Design decision | Implementation artifact | Verification |
|---|---|---|---|
| Tauri supports a frontend plus native Rust logic | Desktop control plane with Rust boundary | Tauri commands and capability config | Shell boot and command tests |
| ComfyUI exposes modular graph/API behavior | Local graph adapter with workflow registry | `comfyui-job.schema.json`, adapter | Mock/local submit/reconcile test |
| Velorn uses project/timeline/assets around local ComfyUI | Project-centric UX and preview-first agent actions | Project/shot/job screens, approval protocol | UI and agent audit test |
| Blender supports background/render/script CLI | Supervised Blender worker | `blender-job.schema.json`, process executor | Fixture render/output test |
| OpenTimelineIO references external media | Internal timeline plus optional OTIO export | `timeline.schema.json`, OTIO adapter | Round-trip/interchange fixture |
| n8n supports broad integrations but has fair-code terms | External integration only, not embedded core | Integration boundary document | License and deployment review |
| Free editor options have different scope | Kdenlive/DaVinci optional manual finishing | Delivery handoff | Human editor smoke test |
| Cloud provider capabilities differ | Provider adapter interface | `AI_PROVIDER_ARCHITECTURE.md` | Capability/terms/cost test |

## Review cadence

Revisit research before each major release, after provider/API change, after tool upgrade, after a security incident or when pilot evidence contradicts an assumption. Record date, source, decision and affected artifacts.

## Anti-patterns

Do not cite GitHub stars as proof of security or quality. Do not treat a provider marketing page as an independent benchmark. Do not copy an untrusted repository's install script into the product. Do not use stale price or quota data as a runtime guarantee.
