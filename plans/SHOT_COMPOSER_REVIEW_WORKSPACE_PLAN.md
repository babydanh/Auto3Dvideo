# Shot Composer Review Workspace Plan

## Objective

Turn the topic workflow into a two-column production workspace where the user can inspect and approve each shot before any render or provider handoff.

## First vertical slice

- Keep the existing topic, storyboard and local-video actions working.
- Add a left shot navigator with shot number, duration and lifecycle state.
- Add a right review rail with selected-shot prompt, camera intent, continuity notes, preview status and approval state.
- Make the full visual prompt readable and editable without horizontal compression.
- Provide explicit actions for Composer preview, Blender preview and cloud handoff; unavailable integrations remain visibly blocked.
- Preserve the existing safety boundary: no automatic login, upload, provider generation or publishing.

## State model

`planned → prompt_ready → composer_preview → blender_preview → provider_ready → generated → approved`

Failures must remain visible and never become an approved state.

## Follow-up slices

1. Persist shot-plan JSON and selected-shot edits.
2. Generate a versioned Blender scene/script from the shot plan.
3. Render preview frames through the allowlisted Blender supervisor.
4. Add provider adapters with estimate, approval, retry and output validation.
5. Add continuity scoring and final FFmpeg assembly evidence.

## Implemented in current slice

- Two-column review workspace with a production-flow rail, shot navigator and review rail.
- Editable long-form visual prompt and continuity checklist.
- Tauri `build_blender_shot_preview` command wired to the bounded multi-shot Blender builder.
- Blender builder now emits a Workbench `preview.png` alongside `.blend` and manifest evidence.
- Shot approval is now tracked in the workspace UI and reflected in the shot navigator and review rail.

## Validation

- `pnpm build`
- Manual desktop click-through: create project → generate storyboard → select shot → edit prompt → inspect review rail.
- Verify blocked actions explain their prerequisite and do not create false output evidence.
