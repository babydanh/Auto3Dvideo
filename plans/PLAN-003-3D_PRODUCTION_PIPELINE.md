# PLAN-003 — 3D Production Pipeline

## Objective

Define the smallest repeatable 3D pipeline that can support AI-assisted product explainers, stylized characters and short cinematic sequences without attempting to rebuild a general-purpose DCC application.

## Asset lifecycle

```text
reference
  → concept
  → source/license review
  → model/import
  → normalize scale/origin/naming
  → materials/UV
  → rig/animation if required
  → preview
  → approval
  → render use
  → archive/version
```

## Asset classes

| Asset | Required metadata |
|---|---|
| Character | Stable ID, source, likeness/consent, scale, rig, actions, materials and version |
| Product/object | Stable ID, dimensions, origin, materials, logo rights, variants and source |
| Environment | Unit scale, coordinate system, lighting assumptions, dependencies and version |
| Camera | Lens, sensor, transform, target, movement, framing and shot association |
| Audio | Source, license, loudness target, language, transcript and timing |
| Reference image/video | Source URL/path, rights status, prompt role, crop and hash |

## Scene contract

A scene must declare units, coordinate system, frame rate, resolution, color management, render engine, output format, active camera, asset versions, lighting profile, frame range and seed/reference policy. It must not rely on an unrecorded user workstation state.

## Shot workflow

| Step | Artifact |
|---|---|
| Brief | Shot objective and viewer takeaway |
| Blocking | Camera and subject positions with rough motion |
| Look development | Materials, lighting and style reference |
| Animation | Keyframes/action clips and timing notes |
| Preview | Low-cost render with review markers |
| Fix | Issue list and bounded changes |
| Final | Render output with settings and hash |

## AI + 3D hybrid pattern

AI is used for concept frames, texture ideas, background elements, motion references and short generated inserts. Blender remains the authority for geometry, camera, layout, text/logo placement and deterministic renders. AI-generated outputs are treated as external assets with provenance and review status.

## Blender worker contract

The worker receives a job JSON, a known `.blend` file or a controlled scene builder script, an output directory and a timeout. It runs Blender background mode, captures stdout/stderr, returns an exit code and validates expected output files. A failed Python exception must produce a non-zero job result.

```text
blender
  --background <known-scene.blend>
  --python <allowlisted-script.py>
  --python-exit-code 2
  --scene <known-scene>
  --render-output <project-output-pattern>
  --engine <approved-engine>
```

The worker must never execute arbitrary scripts or allow an external prompt to become a command argument without structured validation.

## Performance tiers

| Tier | Preview | Final |
|---|---|---|
| Draft | Workbench/Eevee, low samples, reduced resolution | Not for delivery |
| Standard | Eevee or low-sample Cycles, target resolution | Social/product demo |
| Premium | Cycles/GPU, higher samples, denoise and compositing | Client/master output |

## Exit criteria

The pipeline can import a permitted asset, normalize it, preview a shot, run a controlled Blender render, validate output dimensions and associate the result with a shot and evidence record.
