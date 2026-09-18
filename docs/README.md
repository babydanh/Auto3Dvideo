# Documentation Index

Auto3Dvideo documentation is organized by decision level. Read the current status before treating any design as implemented.

## Start here

| Path | Use |
|---|---|
| `PROJECT_STATUS.md` | Truthful implementation status and explicit non-goals |
| `QUALITY_GATES.md` | Definition of evidence for each delivery phase |
| `architecture/README.md` | System boundary and architecture index |
| `operations/README.md` | Runbooks and planning-release evidence |
| `policy/RIGHTS_AND_PLATFORM_GATES.md` | Rights/platform routing index |

## Build the system

Read `architecture/TECH_STACK.md`, `AUTOMATION_ARCHITECTURE.md`, `JOB_STATE_MACHINE.md`, `DATA_MODEL.md`, `DATABASE_SCHEMA_AND_MIGRATIONS.md`, `PROCESS_EXECUTOR.md` and `DESKTOP_CONTROL_PLANE.md` before implementation.

## Integrate media tools

Read the ComfyUI, Blender, FFmpeg, timeline, provider-adapter, plugin/node and dependency/license documents before adding an integration. For diverse outputs, start with [`VIDEO_RECIPE_ARCHITECTURE.md`](architecture/VIDEO_RECIPE_ARCHITECTURE.md) and the [`multi-format toolchain research`](../research/MULTI_FORMAT_VIDEO_TOOLCHAIN_2026.md).

## Operate and review

Read the AI-generation, 3D-scene, render/delivery, human-review, cost/retry, observability/recovery, installation, publishing, rights/provenance and agent-protocol documents for end-to-end behavior.

## Status language

The words “planned,” “designed,” “fixture,” “mock,” “dry-run” and “implemented” are intentionally distinct. A document describing a future Rust worker or desktop screen is not evidence that the worker or screen exists.
