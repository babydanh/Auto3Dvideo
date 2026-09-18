# Blender quality workflow research — 2026-08-27

## Official Blender Manual findings

The Blender 5.2 LTS Manual groups the relevant quality skills into modeling/mesh editing, modifiers, geometry nodes, sculpting/painting, animation/keyframes/markers, rendering engines, cameras, lights, materials, shader nodes, color management, compositing and the Video Sequencer. This confirms that a visually convincing 3D shot is a stack of separate disciplines rather than a primitive generator.

The modeling index explicitly exposes bevel, subdivision surface, solidify, boolean, mirror, remesh, weighted normals and geometry nodes. These are the minimum shape-quality tools for moving beyond blockout primitives. The shader node index exposes Principled BSDF, metallic, glass, subsurface, volume, displacement, geometry, bevel, fresnel, ambient occlusion and texture-coordinate inputs; these support material response and surface detail. The camera documentation covers perspective/orthographic lens choice, focal length, dolly-zoom behavior, clipping, depth of field, focus object, aperture and safe areas. These need to become explicit style-bible fields and per-shot presets.

Sources:
- https://docs.blender.org/manual/en/latest/index.html
- https://docs.blender.org/manual/en/latest/modeling/index.html
- https://docs.blender.org/manual/en/latest/render/shader_nodes/index.html
- https://docs.blender.org/manual/en/latest/render/lights/index.html
- https://docs.blender.org/manual/en/latest/render/cameras.html

## MCP findings

The official Blender Lab MCP page supports Blender 5.1+ and explicitly warns that its server executes LLM-generated code without guards against deletion or remote data transfer. It is therefore not appropriate as the unrestricted executor for Auto3Dvideo; the existing bounded Rust/native boundary should remain the control plane.

The community ahujasid/blender-mcp project exposes object/material/scene manipulation, scene inspection, arbitrary Python execution and optional asset/model generation through Poly Haven, Sketchfab and external 3D generators. It can accelerate interaction, but its own arbitrary-code and external-asset surfaces require a separate sandbox and rights gate. It does not automatically make a primitive look photorealistic.

The PatrykIti/blender-ai-mcp repository is architecturally closer to the desired production approach: goal-first routing, curated tools, macro/workflow tools, deterministic inspection and assertion, vision as assistance rather than truth, and bounded verification. It is a useful design reference for Auto3Dvideo's future MCP bridge, but should not be installed or copied without review.

Conclusion: MCP improves scene-control ergonomics and verification. Model beauty comes from approved high-quality assets, topology/detail, UV/material/shader setup, lighting, camera/lens, compositing and per-shot art direction. An MCP connection alone cannot solve those layers.

Sources:
- https://www.blender.org/lab/mcp-server/
- https://github.com/ahujasid/blender-mcp
- https://github.com/PatrykIti/blender-ai-mcp
- https://docs.griptapenodes.com/en/stable/guides/mcp/servers/blender/

## Asset quality findings

Poly Haven publishes original HDRIs, textures and models under CC0 and states that its assets can be used commercially; its FAQ also explains that high-quality materials are based on photographic methods and physically based albedo/AO/displacement practices. This is a strong approved asset source for lookdev tests, subject to recording URLs and hashes.

Hunyuan3D-2 separates shape generation from texture generation, supports image-to-3D and multiview workflows, includes a PBR-related path and reports about 6 GB VRAM for shape generation and about 16 GB for shape plus texture. It also exposes a local API server and Blender addon, but it is a heavy new dependency and requires explicit user approval before installation. TripoSR is a fast single-image reconstruction model with MIT-licensed code/model claim and around 6 GB VRAM for a single image; it is more useful for rough asset blocking than guaranteed film-quality hero assets.

Recommended quality route: use CC0/approved human-made assets and curated HDRIs for hero scenes; use Hunyuan3D or TripoSR only as optional asset generators followed by Blender cleanup, remesh/retopology, UV/material validation, scale normalization and style-bible lookdev. Do not let MCP download arbitrary Sketchfab assets or external models without a rights gate.

Sources:
- https://polyhaven.com/license
- https://docs.polyhaven.com/en/faq
- https://github.com/Tencent-Hunyuan/Hunyuan3D-2
- https://github.com/VAST-AI-Research/TripoSR
