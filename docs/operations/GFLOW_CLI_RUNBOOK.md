# gflow-cli runtime runbook

## Scope

Auto3Dvideo uses the vendored `gflow-cli` checkout at commit
`56d9501526767f9eaa71d9155608719414ac0e24`. The runtime is installed into the
project-local `.auto3dvideo/runtimes/gflow-cli` directory. The setup script only
installs and verifies the CLI; it does not log in, inspect existing browser
profiles, focus a browser, spend credits, or generate a video.

## Install and verify

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup_gflow_cli.ps1
```

The script checks the vendor commit, creates an isolated Python 3.11+ virtual
environment, installs the local checkout, and runs the real executable with
`gflow --help`. The expected install path is:

```text
.auto3dvideo\runtimes\gflow-cli\venv\Scripts\gflow.exe
```

The app's Rust command does not use a shell command string. It invokes the
existing typed `run_gflow_cli_video_generation` command, which launches the
versioned project worker with the configured Python executable and validates
each returned MP4 with `ffprobe`.

## Human login (required once)

After setup succeeds, run the printed command manually:

```powershell
.auto3dvideo\runtimes\gflow-cli\venv\Scripts\gflow.exe auth login --browser chrome
```

Complete Google Flow login in the dedicated gflow-cli window. This is the only
interactive browser step. Do not point gflow at an everyday Chrome profile.
The app does not claim authentication until a real generation run returns a
validated output or the CLI reports an authentication failure.

## App workflow and status

1. Configure the project's Python and FFprobe paths in Settings.
2. In the active **Tự làm** route, enter the real Google Flow project ID from
   the Flow URL and review the shot plan.
3. Approve the cloud/budget gate, then run **Tạo video AI**. The route calls
   only the gflow-cli runtime; it does not start BrowserMCP or focus a browser.
4. The UI reports `blocked`, `partial`, or `success` from the typed Rust command.
   A success requires an actual non-empty MP4 per validated shot plus ffprobe
   evidence. A plan, prompt, download, or CLI exit alone is not a video.

Retries are bounded by the worker and resume only when the stored project,
revision, prompt hash, and output evidence match. Failed or missing outputs stay
blocked and are never presented as success.

## Safety and release boundary

Do not put credentials in project JSON, prompts, logs, or this runbook. Login,
credits, rights, content quality, accessibility, platform policy, and final
publishability remain human-review gates. A passing `gflow --help` check proves
runtime availability only; it does not prove login or produce an MP4.
