# PLAN-005 — Implementation Backlog

## Priority model

`P0` protects data, secrets, process safety and project recoverability. `P1` makes the local MVP useful. `P2` improves creative workflow and integrations. `P3` is expansion after evidence from real use.

## P0 — Foundations

| ID | Work item | Acceptance evidence |
|---|---|---|
| P0-001 | Create Tauri shell and workspace policy | App starts; project path is explicit; no arbitrary file write |
| P0-002 | Add SQLite migrations and schema version | Fresh and upgrade migrations pass |
| P0-003 | Implement job states and event log | State transitions reject invalid moves |
| P0-004 | Build allowlisted process executor | Shell metacharacters rejected; timeout/cancel/log tests pass |
| P0-005 | Add redaction and secret boundary | Test logs contain no credentials or tokens |
| P0-006 | Add output validator and checksum | Missing/wrong output blocks success |
| P0-007 | Add mock workflow fixture | CI runs end-to-end without provider/GPU |
| P0-008 | Add backup/restore and project lock | Copy/restore retains metadata and assets |

## P1 — Useful local studio

| ID | Work item | Acceptance evidence |
|---|---|---|
| P1-001 | Project/episode/shot CRUD | UI and repository tests pass |
| P1-002 | Asset browser and provenance fields | Asset hash, type, dimensions and rights state visible |
| P1-003 | Shot board and status filters | User can find failed/review/pending shots |
| P1-004 | ComfyUI health and local adapter | Mock and local endpoint tests pass |
| P1-005 | Blender health and render adapter | Controlled preview render is ingested |
| P1-006 | FFmpeg compose adapter | Fixture clips produce valid MP4/SRT package |
| P1-007 | Budget estimator and approval gate | Paid-mode fixture blocks without approval |
| P1-008 | Dark mode and accessibility baseline | Keyboard, focus and theme QA evidence exists |

## P2 — Production workflow

| ID | Work item | Acceptance evidence |
|---|---|---|
| P2-001 | Style bible/reference bundle | Same references propagate to selected shots |
| P2-002 | Prompt/version registry | Output can be traced to prompt/workflow version |
| P2-003 | Timeline surface | Shot order and durations export to internal timeline contract |
| P2-004 | OTIO export | Timeline export round-trips through parser fixture |
| P2-005 | Kdenlive/DaVinci handoff | Standard outputs and metadata open in editor |
| P2-006 | Voice/subtitle workflow | SRT/VTT and audio alignment validated |
| P2-007 | Provider adapters | Each adapter has mock, timeout, rate-limit and rights metadata |
| P2-008 | Agent preview/approval interface | Agent can inspect and preview; mutation requires approval |

## P3 — Scale and productization

| ID | Work item | Acceptance evidence |
|---|---|---|
| P3-001 | Remote render worker | Authenticated job lease and artifact upload |
| P3-002 | Cloud project backup | Encryption, restore test and deletion behavior |
| P3-003 | Team collaboration | Conflict model, audit trail and access tests |
| P3-004 | Platform publishing adapters | Official API support, review gate and rollback path |
| P3-005 | Marketplace/creator templates | Rights and monetization policy records |
| P3-006 | Advanced 3D tools | User research demonstrates need beyond Blender bridge |

## Delivery slices

Each slice should be releasable and testable. Do not start a cloud provider adapter before the mock runner, cost ledger, rights record and failure taxonomy are in place. Do not start a modeling editor before the Blender bridge demonstrates that the required workflow cannot be handled by existing tools.
