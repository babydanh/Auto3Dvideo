# PLAN-004 — Free, Local and Cloud Strategy

## Objective

Keep the first usable workflow free or low-cost where possible while making cloud AI generation an optional, replaceable capability. The app must never represent a free tier as unlimited, stable or automatically commercial-use eligible.

## Execution modes

| Mode | Description | When to use |
|---|---|---|
| Mock | Deterministic fixture outputs and fake tools | CI, UI development and demos |
| Local | ComfyUI, Blender and FFmpeg on the Windows machine | Privacy, repeatability and no per-call fee |
| Hybrid | Local planning/media/3D plus cloud video generation | Better generation quality with local control |
| Cloud | Remote provider and optional remote render | No suitable local GPU or team-scale production |

## Free-first baseline

```text
SQLite
Rust/Tokio
Tauri/React
Blender
ComfyUI
FFmpeg
Kdenlive
```

All are free to obtain or open-source projects under their own licenses, but model checkpoints, custom nodes, stock media, music and cloud outputs have separate terms. Hardware and setup time remain costs.

## Provider abstraction

The provider interface must expose normalized capabilities rather than provider-specific assumptions:

```text
capabilities()
estimate(request)
submit(request, idempotency_key)
status(provider_job_id)
cancel(provider_job_id)
fetch_outputs(provider_job_id)
terms_metadata()
```

A provider adapter must not hide the actual provider/model, resolution, duration, policy state or cost. The project record stores the raw provider job ID and a redacted normalized response.

## Budget policy

| Policy | Default |
|---|---:|
| Monthly budget | User-configured; default zero for paid mode |
| Per-video budget | User-configured; default requires approval |
| Max retries/shot | 3 |
| Max concurrent paid jobs | 1 |
| Estimate required | Yes |
| Unknown cost | Block |
| Request lost after submit | Reconcile before retry |
| Budget exceeded | Stop new paid work and preserve existing outputs |

## Hardware detection

Before a local job, detect OS, GPU vendor, driver version, VRAM, RAM, disk space, Blender version, ComfyUI endpoint and FFmpeg version. The health result should state whether the job is supported, degraded or blocked. Detection must not upload system data without consent.

## Cloud decision

Cloud is justified when the user explicitly accepts variable cost, a provider is available in the account's region, the commercial/derivative rights are understood, the API is stable enough for the job, and the workflow can record usage and recover without duplicate requests.

## No hidden automation

There must be no background paid generation, automatic account switching, VPN-based region bypass, unbounded retry, or silent subscription action. The UI shows when an operation can incur a charge and requests confirmation according to the active budget policy.
