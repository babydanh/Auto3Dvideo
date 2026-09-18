# BrowserMCP Runtime Probe — 2026-08-26

## Scope

The BrowserMCP package selected by the user was installed at `D:\Auto3DvideoTools\browsermcp` after explicit confirmation. The pinned package is `@browsermcp/mcp@0.1.3`; installation used `--ignore-scripts`, and no package was added to the Auto3Dvideo repository. No Google login, tab connection, upload, generation or download was performed.

## Environment

The user's Windows environment has Node.js `v24.14.0`, npm/npx `11.9.0`. The npm package metadata resolved to version `0.1.3`. The local executable `mcp-server-browsermcp` returned `Version 0.1.3`.

## Direct stdio probe

A typed local probe sent MCP `initialize`, `notifications/initialized` and `tools/list` to the package entrypoint. The server returned protocol version `2025-03-26`, server name `Browser MCP`, version `0.1.3`, and 12 tools:

- `browser_navigate(url)`
- `browser_go_back()`
- `browser_go_forward()`
- `browser_snapshot()`
- `browser_click(element, ref)`
- `browser_hover(element, ref)`
- `browser_type(element, ref, text, submit)`
- `browser_select_option(element, ref, values)`
- `browser_press_key(key)`
- `browser_wait(time)`
- `browser_get_console_logs()`
- `browser_screenshot()`

The probe did not connect to Chrome and did not perform browser actions. The inspected tool list did not include a dedicated file-upload tool or download/import tool. Therefore upload must be handled through a supported extension/client capability or a user-driven browser file chooser, and must not be assumed in the standalone stdio tool surface.

## Runtime worker verification

`browsermcp_runtime_worker.mjs` was added as a bounded stdio client. Its `probe` mode calls only `initialize` and `tools/list`, writes a sanitized report under the project workspace, and returns `status=ready`, `toolCount=12`, `browserActionsPerformed=false` and `networkCallsMade=false`. Its `snapshot` mode was tested against the current environment without an attached extension session; it returned `status=blocked`, `browserSessionAttached=false`, `browserActionsPerformed=false` and `networkCallsMade=false`. A regression script confirms both behaviors and confirms that `upload_file` and `download_file` are absent.

The native Tauri bridge resolves Node through the existing tool configuration, materializes the worker inside `.auto3dvideo/tools/`, runs it through the external-process supervisor, limits operations to `navigate`, `snapshot`, `screenshot` and `wait`, enforces the `aistudio.google.com` HTTPS allowlist for navigate, and requires the handoff ID/state. Click/type/keypress are deliberately not exposed through the app bridge because the current package surface could otherwise be used to reach upload or Generate controls without a separate design and approval review.

## Safety decision

Auto3Dvideo must keep BrowserMCP behind a typed allowlist and approval state machine. The local runtime may be used for navigation/snapshot/read-only status only after a user-connected tab is confirmed. Login, CAPTCHA, file upload, Generate, billing, download and import require explicit human steps or separate approvals. BrowserMCP must not be treated as a security boundary; the Tauri app owns workspace containment, prompt/file review, network/cost/rights gates and output hashing.

## References

[1]: https://github.com/browsermcp/mcp "BrowserMCP GitHub repository"
[2]: https://docs.browsermcp.io/setup-server "BrowserMCP setup server documentation"
[3]: https://docs.browsermcp.io/setup-extension "BrowserMCP setup extension documentation"
[4]: https://browsermcp.io/install "BrowserMCP installation page"
