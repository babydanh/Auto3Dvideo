# Safe Process Executor Design

## Purpose

Run Blender, FFmpeg, ComfyUI helpers and other approved binaries without turning prompts or imported workflow files into arbitrary shell execution.

## Command specification

```rust
struct CommandSpec {
    executable_id: String,
    args: Vec<String>,
    working_directory: RelativeProjectPath,
    environment: BTreeMap<String, String>,
    timeout_seconds: u64,
    expected_outputs: Vec<OutputExpectation>,
}
```

The runner maps `executable_id` to a configured allowlisted binary path. The caller supplies structured arguments, not a command string. The runner validates executable existence, working directory containment, argument sizes, output paths, timeout range and environment allowlist.

The validation/planning half lives in `desktop/src-tauri/src/process_executor.rs` and is exposed as the typed `preview_process` command. Its allowlist IDs are `blender`, `ffmpeg`, `ffprobe`, `node`, `obs` and `python`. It accepts only project-relative working/output paths, a timeout from 1 to 604800 seconds, at most 64 arguments, and non-sensitive `AUTO3DVIDEO_*` environment keys. It rejects common credential-shaped argument/value markers and returns only environment key names. Executable settings normalize outer Windows quotes before resolution; Python readiness also inspects `pyvenv.cfg` so a stale venv launcher whose base interpreter was removed is not treated as runnable. The dry-run result explicitly reports `processStarted=false` and `sideEffectsBlocked=true`. The separate `external_worker.rs` contains a direct-spawn supervisor for explicit app-owned local paths: it revalidates the allowlisted binary filename, clears the child environment, avoids shell wrappers, bounds/redacts stdout/stderr, enforces timeout/cancellation and uses a Windows Job Object for process-tree termination. The currently live paths are fixed FFmpeg/FFprobe synthetic fixture execution, local version probes and a deterministic Blender fixture; general user-media job execution remains gate-locked.

## Lifecycle

```text
validate spec
  → acquire resource lease
  → create job directory
  → write redacted command summary
  → spawn child process
  → stream stdout/stderr with limits
  → heartbeat and enforce timeout
  → request cancellation if needed
  → terminate child/process tree if required
  → collect exit status
  → validate outputs
  → release lease
```

## Durable attempt record

The append-only `job_attempts` record is created before a worker starts and is unique by `(job_id, attempt_number)`. It records lease owner/expiry, heartbeat, timeout, bounded log counters, cancellation and termination evidence, redacted error text and whether an external side effect is unknown. `job_outputs` records relative output paths, hashes, sizes and validation state. The `execution-attempt.schema.json` validator rejects a running attempt without lease evidence, a cancelled process without termination evidence, success with unknown side effects, raw shell fields or secret-like messages. The general worker-plan remains pending-only, while the explicit synthetic FFmpeg fixture creates a durable external attempt and records its terminal evidence.

## Failure handling

| Failure | Result |
|---|---|
| Executable missing | `BLOCKED_TOOL_MISSING` |
| Invalid path/argument | `FAILED_INVALID_COMMAND` |
| Timeout | `FAILED_TIMEOUT`; retry only if policy allows |
| Non-zero exit | `FAILED_PROCESS_EXIT`; preserve logs |
| Zero exit, missing output | `FAILED_OUTPUT_VALIDATION` |
| Cancellation | `CANCELLED` after process termination/reconciliation |
| Crash during unknown side effect | `RECONCILIATION_REQUIRED` |

## Windows requirements

Use Windows process APIs or a trusted Rust process library to terminate a process tree, not only the immediate child. Normalize Windows paths before containment checks. Avoid `cmd.exe /c` or PowerShell string concatenation for generated commands. If a shell is unavoidable for a known tool, the command is hard-coded in application code and receives no raw user command text.

## Log policy

Logs have a byte limit and rotation. The runner redacts credential-shaped values and signed URLs, stores full logs only in the project workspace, and provides a sanitized summary to the UI. Log retention is configurable.

## Test cases

The test suite covers command injection, path traversal, symlink/junction escape, process tree termination, timeout, cancellation, non-zero exit, output validation, large logs, Unicode paths, spaces in paths, duplicate job IDs and recovery after application restart. Current coverage includes allowlist rejection, relative-path and traversal rejection, timeout bounds, secret-shaped input rejection, environment-key allowlisting, no-spawn dry-run, attempt lease/cancellation/reconciliation semantics, in-process mock lifecycle, direct allowlisted process success, bounded/redacted logs, timeout tree termination, output evidence validation, durable external success/failure persistence, startup reconciliation and loopback-only ComfyUI health restrictions. The explicit local FFmpeg fixture runs only fixed application-owned arguments in a selected project workspace and performs a second FFprobe validation. General typed media-plan execution and user-media worker execution remain gated.
