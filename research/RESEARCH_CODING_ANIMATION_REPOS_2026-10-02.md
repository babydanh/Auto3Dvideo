# Coding animation repository evaluation — 2026-10-02

## Decision

Use the repository's installed Pillow renderer boundary plus existing Rust-supervised FFmpeg for the coding-25d path. Implement original state-based geometry, code highlighting and directed packets. Do not import every animation repository: that multiplies render environments, dependencies, license reviews and failure modes without improving instructional correctness.

## Primary sources inspected

| Candidate | Relevant capability | License evidence | Decision |
|---|---|---|---|
| [Manim Community](https://github.com/ManimCommunity/manim) | Python mathematical/explanatory animation | [MIT source license](https://raw.githubusercontent.com/ManimCommunity/manim/main/LICENSE); asset rights separate | Good option for sophisticated mathematical scenes; not installed on this machine, do not add its Cairo/Pango/optional TeX toolchain just to draw arrays |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas) | TypeScript generator animation, preview and narration synchronization; [code selection API](https://motioncanvas.io/docs/code) | [MIT](https://raw.githubusercontent.com/motion-canvas/motion-canvas/main/LICENSE) | Useful reference for code/state synchronization; no second Node canvas rendering application introduced |
| [Remotion](https://github.com/remotion-dev/remotion) | React compositions and frame-based rendering | [Current source license](https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md): free for individuals, eligible <=3-employee for-profit entities, nonprofits and noncommercial evaluation; larger for-profit entities require Company License; derivative distribution restrictions | Not a blanket-MIT dependency; do not assume commercial or redistribution clearance |
| [PixiJS](https://github.com/pixijs/pixijs) | GPU-backed 2D browser renderer | [Upstream MIT license](https://github.com/pixijs/pixijs/blob/dev/LICENSE) surfaced by primary-source search | Candidate for heavier interactive previews; not needed for this bounded original scene renderer |
| [d3-ease](https://github.com/d3/d3-ease) | Easing-function reference | Upstream repository reports BSD-3-Clause | No source copied; simple easing can be original application code without a dependency |

The license files for Manim, Motion Canvas and Remotion were read directly. PixiJS/d3-ease repository metadata was searched; no package/transitive dependency audit or installation was performed. This is a suitability comparison, not a benchmark or security certification. No claim that one repo is universally best.

## Technical consequence

A typed teaching-scene contract owns correctness-relevant state independently from rendering. The local catalog computes original Two Sum, binary search, longest-unique-substring and BFS traces, plus explicit cache-aside/token-bucket/queue/URL-shortening flows. Additional prompts require the configured gateway and strict JSON validation; arbitrary generated code is never executed. Scene code, numbers and graph labels are deterministic overlays, not AI-generated lettering.

## Rights and costs

No third-party video/music/logo/problem statement or repository source was copied into the renderer. Local rendering has no generation API fee but consumes machine time/storage. Runtime gateway requests may have provider costs, and generated content always remains pending human technical/creative/rights review. Project license is still TBD under the existing dependency policy; original implementation does not resolve distribution licenses of FFmpeg, fonts or optional models.
