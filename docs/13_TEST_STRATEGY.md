# Test Strategy

## Test layers

| Layer | Coverage |
|---|---|
| Contract | JSON schema, YAML workflow shape, enum/state validity and migration compatibility |
| Domain | State transitions, dependency graph, idempotency, budget reservation and approval rules |
| Process | Allowlist, argument validation, timeout, cancellation, process tree and output validation |
| Adapter | ComfyUI/Blender/FFmpeg mocks, provider errors, rate limits, partial outputs and reconciliation |
| Filesystem | Path containment, Unicode/spaces, symlink/junction escape, backup/restore and cleanup |
| UI | Project/shot/job flows, loading/error/empty states, theme, keyboard and localization |
| End-to-end | Fixture brief through mock generation, render, compose, review and delivery |
| Performance | Large asset list, log backpressure, preview lazy loading and queue responsiveness |
| Security | Secret redaction, injection attempts, unsafe downloads, rights/publish blockers |

## Deterministic fixture

CI must run without paid provider access, GPU or installed Blender/ComfyUI. Mock executors create tiny valid fixture outputs and deterministic hashes. The same workflow should produce the same normalized graph and state sequence.

## Concurrency scenarios

Test duplicate enqueue, two app instances, restart during running job, cancellation during output ingestion, dependency completion race, repeated approval event, provider response loss and retry after unknown external side effect.

## Media scenarios

Test variable frame rate, missing audio, wrong dimensions, corrupt container, Unicode filenames, long duration, zero-byte output, subtitle encoding, out-of-range timestamps and mismatched frame counts.

## Acceptance evidence

Every implementation slice records commands, environment profile, fixture version, pass/fail counts, known skipped tests, output paths and reviewer decision. Do not claim local GPU or cloud-provider coverage from mock tests alone.
