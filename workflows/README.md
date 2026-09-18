# Workflow Examples

The YAML files in this directory are planning and fixture examples. They describe typed stages, dependencies, executors, outputs and policy. They are not permission to publish or to spend money.

| Workflow | Purpose |
|---|---|
| `example-local-free-pipeline.yaml` | CPU/mock-safe pipeline with paid generation and external publishing blocked |
| `example-3d-product-explainer.yaml` | Hybrid 3D/product explainer with reference, Blender preview and human review |
| `example-cinematic-3d-topic-to-frame-captioned.yaml` | Canonical topic → true 3D → voice alignment → frame-locked captions → delivery gate |
| `example-ai-short.yaml` | Original AI short with script, references, generation, captions, rights review and delivery |
| `example-2d-image-slideshow.yaml` | Images with deterministic timing, voiceover, captions, compose and delivery |
| `example-html-motion-graphics.yaml` | React/HTML composition with data payload, TTS, captions and FFmpeg mux |
| `example-screen-demo.yaml` | OBS/browser screen capture with privacy review and export |
| `example-voiceover-captioned.yaml` | Voiceover, transcription/alignment, translated captions and delivery variants |

Before execution, a runner validates schema, graph acyclicity, input paths, dependencies, resource limits, cost policy and approval state. The MVP defaults to dry run or mock mode. The current Python prototype only inspects a fixture safely; it does not execute these workers.

`example-cinematic-3d-topic-to-frame-captioned.yaml` is the reference orchestration path for the desktop app. Its frame-caption stage must consume the alignment output from STT/forced alignment; the generated SRT is a derived editor sidecar and `frame-caption-plan.json` remains the exact timing source.
