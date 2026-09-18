# Google Omni/Veo + Blender hybrid research — 2026-08-27

## Verified capability

Google's Gemini Omni overview says Omni can combine text, images and video, create video from up to five photo references, and perform conversational video editing. Google states that Gemini AI subscription access is required and that features vary by tier and geography. Google also states that generated videos carry SynthID.

Google's developer documentation says Gemini Omni Flash is the default video-generation model for multi-input reasoning across text, images, audio and video, coherence, character consistency, factual accuracy and multi-turn conversational editing. Veo 3.1 is better suited for scene extension, last-frame control and legacy pipeline integration. The docs separately identify video understanding for ingesting and analyzing existing video.

Google's Veo 3.1 announcement states that Ingredients to Video can use reference images for characters, objects, textures and style, supports native vertical output and offers 1080p/4K upscaling on supported surfaces. This is a strong match for a Blender previs-to-video workflow, but a Blender previs render is a visual guide, not a guarantee that Google will preserve exact geometry, camera path, physics or shot continuity.

## Practical hybrid design

Blender should produce a previs package per shot: clean viewport/blockout image, optional depth/normal/mask passes, an image-only storyboard frame, a concise shot prompt, negative constraints and a continuity manifest. BrowserMCP or a direct API adapter can then upload only approved reference images/video and enter a prompt per shot. Generated clips should be downloaded only after human approval, then assembled locally with the original timeline rather than trusting the web UI to create the final master.

For a multi-shot story, use one Google generation request per event/shot, reuse approved character/object/style ingredients, and use last-frame/extension where supported. Expect iteration: the model can improve beauty and motion, but may alter exact model identity, scale, orbital mechanics, text, or scene layout. Deterministic Blender remains the authority for geometry and spatial continuity; Omni/Veo is the beauty/motion layer.

## Boundary and limitations

The current Google web route is user-session based and requires manual login/session, explicit upload/generation approval and human review. BrowserMCP should not auto-login, auto-upload, auto-generate or publish. The repo's BrowserMCP slice is optional and its Chrome extension/session is not yet user-verified. Direct Gemini API use is a separate connector/cost path; it is not automatically granted by a Google AI consumer subscription.

References:
- https://gemini.google/overview/video-generation/
- https://ai.google.dev/gemini-api/docs/video
- https://deepmind.google/models/veo/
- https://blog.google/innovation-and-ai/technology/ai/veo-3-1-ingredients-to-video/
