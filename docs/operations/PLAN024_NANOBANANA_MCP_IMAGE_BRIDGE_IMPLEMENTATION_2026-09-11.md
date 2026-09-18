# PLAN-024 — Nano Banana MCP image bridge

Status: `NEEDS_HUMAN_REVIEW`

## Outcome

Auto3Dvideo now uses Nano Banana MCP through a signed-in Google Flow Chrome session as the preferred image-reference path after the Blender semantic preview. ComfyUI remains available only through its explicit legacy command.

## Changed surface

- `contracts/nanobanana-image-job.schema.json` and `contracts/nanobanana-image-report.schema.json` define the typed job/report boundary.
- `scripts/nanobanana_mcp_worker.py` launches a fixed, user-installed JavaScript MCP entry with Node, performs MCP `initialize` → `tools/list` → `tools/call`, collects output images, hashes them and writes a report.
- `desktop/src-tauri/src/lib.rs` validates project/task/rights/path/CDP inputs, runs the worker through the existing process boundary, validates outputs and imports them into the Asset Library.
- `desktop/src/App.tsx` changes the primary reference-image button and activity text to `Nano Banana MCP / Google Flow`.
- `.env.example` and `configs/provider-profiles.example.yaml` document the non-secret server entry, CDP URL, model and tool defaults.

## Required user setup

1. Install/build a Nano Banana MCP server that exposes `generate_image` over stdio. The tested reference implementation is [`frannkurt/nano-banana-mcp`](https://github.com/frannkurt/nano-banana-mcp); it is third-party code, not a Google product.
2. Start Chrome with a dedicated signed-in profile and loopback remote debugging at `http://127.0.0.1:9222`.
3. Open a Google Flow project in that profile and configure `AUTO3DVIDEO_NANOBANANA_MCP_SERVER_ENTRY` if the server entry is not at the documented default.
4. Run the app button `Tạo asset ảnh Nano Banana` after the Blender preview is ready.

The repository does not download or execute a server from a prompt, and it does not store a Gemini/Flow API key. The external MCP package and Google Flow account remain user-controlled dependencies.

## Validation

- `python scripts/test_nanobanana_mcp_worker.py` — fake MCP stdio server creates a deterministic image and passes output containment/report checks.
- `python -m py_compile scripts/nanobanana_mcp_worker.py scripts/test_nanobanana_mcp_worker.py`.
- `cargo fmt --all -- --check` and `cargo check --manifest-path desktop/src-tauri/Cargo.toml`.
- `pnpm build` from `desktop`.
- `python scripts/validate_project.py --project .`.

## Limits and policy

The bridge creates reference images only; it does not create a final video. Provider output remains `rights=pending` and requires human review for likeness, provenance, cost, quality, accessibility and platform policy. A missing MCP entry, missing Chrome CDP connection or missing `generate_image` tool is a blocker, not a successful empty result.

## Cost impact

No generation is run by validation. Real Google Flow usage is controlled by the user's account/plan and any provider-side limits; the app does not estimate or auto-approve paid generation in this bridge.

## Next action

Install/configure the selected Nano Banana MCP server and verify one single-shot generation in the app before running all shots.
