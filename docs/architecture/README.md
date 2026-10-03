# Architecture Index

Read in this order for implementation:

1. `TECH_STACK.md` — technology and boundary decisions.
2. `AUTOMATION_ARCHITECTURE.md` — graph, lifecycle, resources and recovery.
3. `JOB_STATE_MACHINE.md` — valid state transitions and restart behavior.
4. `DATA_MODEL.md` — entities, identity, versioning and privacy.
5. `LOCAL_WORKSPACE_LAYOUT.md` — project filesystem and backup policy.
6. `PROCESS_EXECUTOR.md` — safe Blender/FFmpeg/ComfyUI process boundary.
7. `AI_PROVIDER_ARCHITECTURE.md` — normalized provider adapter contract.
8. `COMFYUI_INTEGRATION.md` — local graph executor integration.
9. `BLENDER_INTEGRATION.md` — controlled true-3D worker.
10. `MEDIA_PROCESSING.md` — deterministic FFmpeg and editor handoff.
13. `CODING_25D_VIDEO.md` — prompt-driven algorithm and system-design teaching videos (data-only scenes, caption-only export).
11. `TIMELINE_AND_EDITOR_INTERCHANGE.md` — internal timeline and OTIO boundary.
12. `DESKTOP_CONTROL_PLANE.md` — UI and Tauri command surface.

The architecture is local-first and provider-neutral. Heavy external tools remain workers; the desktop application owns project state, evidence, safety and approvals.
