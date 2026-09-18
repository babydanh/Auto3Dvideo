# Master Implementation Plan — Auto3Dvideo

## Product statement

Build a Windows-first, local-first desktop automation studio that coordinates AI-assisted video production, true 3D workers and deterministic media delivery. The app should make complex production repeatable without hiding costs, rights, failures or human decisions.

## Delivery strategy

The project is delivered in vertical slices. Each slice must run end-to-end in mock mode before its real dependency is added. The team must prefer a narrow, observable pipeline over a broad collection of disconnected screens.

## Phase map

| Phase | Duration guidance | Main outcome | Exit gate |
|---:|---|---|---|
| 0 | 1 slice | Repository, contracts, fixtures and safety policy | All schemas/fixtures validate |
| 1 | 2–3 slices | Tauri shell and local workspace | App opens, creates project, health screen works |
| 2 | 2–4 slices | SQLite domain and job state | State transitions and restart tests pass |
| 3 | 2–4 slices | Mock runner and FFmpeg fixture | Brief-to-delivery mock path passes |
| 4 | 3–5 slices | ComfyUI local adapter | Local graph can be submitted, reconciled and ingested |
| 5 | 3–5 slices | Blender bridge and 3D preview | Controlled scene/render fixture passes |
| 6 | 2–4 slices | Timeline, captions and editors | Delivery package opens in selected editor |
| 7 | 2–4 slices | Cloud provider adapters | Cost/rights/timeout/terms gates pass for one provider |
| 8 | 2–4 slices | Agent control and recovery | Preview-first agent operation passes audit |
| 9 | 2–4 slices | Packaging and release | Installer, upgrade, backup/restore and release evidence |

## Phase 0 — Contract-first foundation

Create the entity schemas, workflow schema, job state machine, path rules, output validation rules and sanitized examples. Add a deterministic mock executor. No paid provider, custom node installation or automatic publishing is allowed.

## Phase 1 — Shell and workspace

Scaffold Tauri + React, implement project create/open, project folder selection, theme, health screen and settings. The UI must be responsive while jobs run. Native capabilities start minimal.

## Phase 2 — Domain and persistence

Implement SQLite migrations and repositories for projects, episodes, shots, assets, jobs, attempts, approvals, costs, rights records, deliveries and audit events. Add transaction tests and backup/restore.

## Phase 3 — Runner and deterministic media

Implement job graph expansion, dependency scheduling, leases, cancellation, retry, process executor and FFmpeg fixture. The mock path must exercise all states and produce a manifest.

## Phase 4 — Local AI

Implement ComfyUI loopback health, workflow registry, typed binding, submission, polling, reconciliation, output ingestion and custom-node blocking. Start with image/reference generation before video generation.

## Phase 5 — True 3D

Implement Blender health, scene inspection, asset normalization, preview render and final render adapters. Start with one known `.blend` fixture and a small product scene.

## Phase 6 — Delivery and editors

Implement timeline model, frame arithmetic, captions, audio, thumbnails, platform variants and OTIO export. Provide Kdenlive/DaVinci/CapCut handoff as files, not GUI automation.

## Phase 7 — Cloud providers

Add one provider adapter after the local path is stable. Implement capability discovery, estimate, approval, idempotency, polling, download validation, terms metadata and disable switch. Benchmark a fixed shot set.

## Phase 8 — Agent interface

Expose read, inspect, preview and approval operations to repository-aware agents. Keep mutation scoped and preview-first. Add audit reports and prompt-injection tests.

## Phase 9 — Release

Package Windows installer, document dependencies, add upgrade/rollback, backup/restore, crash recovery, license inventory, release notes, security review and pilot evidence.

## Definition of success

A new user can install the app, open the sanitized example, run a free/mock workflow, inspect shot/job state, preview a delivery, understand every blocked step, and export a package without a paid account. A power user can add ComfyUI and Blender and repeat the same workflow with real local tools. A cloud provider is optional and never hidden behind a “free” label.
