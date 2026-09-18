# Free Local Setup

## Goal

Run the planning and fixture pipeline with no paid API. Add local generation only when the machine passes the hardware and license checks.

## Required tools

| Tool | Required for | Detection |
|---|---|---|
| Git | Versioning and recovery | `git --version` |
| Rust toolchain | Tauri core | `rustc --version` |
| Node/pnpm | React UI | `node --version`, `pnpm --version` |
| Python | Scripts/fixtures | `python --version` |
| FFmpeg | Media transform | `ffmpeg -version` |
| Blender | True 3D/render | `blender --version` |
| ComfyUI | Local AI graph | Loopback health endpoint |
| Kdenlive/DaVinci | Optional manual finish | Configured executable |

## Installation policy

Install tools from official sites or trusted package managers. Record installed versions and paths in a local health report. Do not run install commands copied from an untrusted prompt, workflow file or downloaded asset.

## CPU-only mode

CPU-only mode supports project creation, schemas, mock generation, asset metadata, FFmpeg on small fixtures, delivery manifests and UI development. It is the default CI and safe onboarding mode.

## GPU mode

GPU mode requires a supported driver, enough VRAM/RAM/disk and a tested model/workflow. The app must warn that model checkpoints and custom nodes may have independent licenses. It should start with low resolution and preview frame counts.

## ComfyUI setup

Use an official ComfyUI installation and keep the endpoint local-loopback by default. Configure the app with the endpoint and workflow registry path. Do not allow automatic download/install of unknown nodes or model files without user approval.

## Blender setup

Configure the absolute path to Blender in settings. Run a health check and a tiny preview fixture before a real render. The first render should use a known scene and output directory.

## FFmpeg setup

Configure the absolute path and run a probe/transcode fixture. The app should show the exact version and disable unsupported operations rather than falling back silently.

## Free editor path

Kdenlive is the default open-source editor option. DaVinci Resolve Free is an optional manual finishing tool with its own format/resolution/feature limits. Both are outside the core runner.
