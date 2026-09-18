# Blender Integration Architecture

## Role

Blender is the deterministic true-3D worker. Auto3Dvideo does not embed or replace Blender's modeling, animation, material, physics or rendering systems in the MVP. It submits controlled jobs, observes them and ingests validated outputs.

## Supported job types

| Job | Purpose |
|---|---|
| `scene.inspect` | Read scene metadata without changing it |
| `asset.normalize` | Import, scale, orient, name and save an asset copy |
| `scene.build` | Build a scene from a versioned spec and approved assets |
| `render.preview` | Produce low-cost review frames/video |
| `render.final` | Produce final image sequence/video output |
| `thumbnail.render` | Produce a representative frame |
| `metadata.extract` | Read frame rate, resolution, cameras and object inventory |

## Worker input

```json
{
  "job_id": "job-123",
  "scene_path": "project/scenes/episode-01.blend",
  "script_path": "project/scripts/render_preview.py",
  "scene_name": "SHOT-001",
  "frame_start": 1,
  "frame_end": 120,
  "output_pattern": "project/outputs/SHOT-001/frame-####.png",
  "engine": "BLENDER_EEVEE",
  "timeout_seconds": 1800,
  "expected": {"kind": "image_sequence", "min_files": 120}
}
```

## Process policy

The runner resolves Blender from a configured allowlist and executes background mode with explicit arguments. It uses a dedicated working directory, sanitized environment, stdout/stderr logs, timeout and non-zero exit handling. Python scripts are versioned project files or approved generated artifacts; they are not arbitrary prompt text. The native app currently exposes a deterministic synthetic-cube fixture that writes an app-owned `.blend` file only when a configured `blender.exe` passes the expected filename check; arbitrary user scripts and general scene jobs remain gated.

```text
blender --background <scene>
  --python <allowlisted-script>
  --python-exit-code 2
  --scene <approved-scene>
  --render-output <project-relative-pattern>
```

## File policy

Scene files, scripts, caches and outputs are stored under the project workspace. Input assets are immutable by default. A render writes to a new versioned output directory. The runner rejects output paths outside the project root and refuses to overwrite an approved delivery without an explicit replacement decision.

## Output validation

The worker validates exit code, expected file count, file size, image dimensions, color/format metadata, frame numbering and optional checksum. A render that exits zero but produces no usable output is `FAILED_OUTPUT_VALIDATION`. The current synthetic-cube fixture validates direct process success, non-empty `.blend` output and workspace containment; full scene/render metadata validation remains part of the general Blender worker slice.

## Security constraints

Disable network access for jobs that do not require it. Do not enable automatic Python execution or system environment access unless the job contract explicitly requires it. Custom Blender add-ons are dependencies and must have source, version, license and review records.

## References

[1]: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html "Blender 5.2 LTS command-line arguments"
