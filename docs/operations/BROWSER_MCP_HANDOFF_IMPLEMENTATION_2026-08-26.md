# BrowserMCP Web Handoff Implementation Report — NEEDS_HUMAN_REVIEW

## Kết quả tổng quan

Auto3Dvideo đã được nối từ local handoff pack sang một native BrowserMCP bridge có kiểm soát. Từ slice UX mới, Browser Handoff trên UI là Connection Center: app kiểm tra `browser_snapshot` mà không cần handoff ID/asset/prompt, rồi để quy trình video sở hữu việc tạo pack theo shot hiện tại. Runtime worker hỗ trợ các operation đã allowlist `navigate`, `snapshot`, `screenshot`, `wait`, `click`, `type` và `press_key`. Upload, Generate, login, download và publish vẫn không được tự động hóa nếu package không expose capability tương ứng.

Đây chưa phải bằng chứng extension Chrome trên máy người dùng đã cài và Connect thành công. Probe thực tế trong môi trường hiện tại trả `status=blocked`, `browserSessionAttached=false`, vì vậy app không đánh dấu session/login giả và vẫn dừng đúng tại human gate.

## Files đã thay đổi

| Khu vực | Files | Nội dung |
| --- | --- | --- |
| Native Tauri | `desktop/src-tauri/src/browser_handoff.rs` | Runtime probe/action bridge, strict host/operation allowlist, durable JSON state, SQLite/local JSONL audit, reducer approval, MP4 candidate import, SHA-256 và FFprobe rollback |
| Command registration | `desktop/src-tauri/src/lib.rs` | Đăng ký thêm `check_browsermcp_session`; probe/session check không yêu cầu tạo handoff trước |
| Runtime scripts | `scripts/browsermcp_runtime_worker.mjs`, `scripts/test_browsermcp_runtime_worker.mjs` | JSON-RPC stdio worker bounded và regression test probe/detached snapshot/no upload-download tool |
| Desktop UI | `desktop/src/App.tsx`, `desktop/src/App.css` | Browser Handoff là Connection Center gọn: trạng thái kết nối, một nút kiểm tra, hướng dẫn thu gọn; asset/prompt/import không còn nằm ở đây |
| Contracts/docs | `plans/PLAN-017-BROWSER_MCP_WEB_HANDOFF.md`, `docs/operations/BROWSER_MCP_HANDOFF_RUNBOOK.md`, `research/RESEARCH_BROWSER_MCP_RUNTIME_2026-08-26.md` | Cập nhật state machine, runbook thao tác, giới hạn package và evidence runtime |
| Inventory/evidence | `MANIFEST.json`, `outputs/browsermcp-smoke/` | Đăng ký source/docs/test và lưu probe/snapshot/cargo evidence |

## State machine và policy đã thực thi

State bền vững nằm tại `.auto3dvideo/state/browser-handoff-<handoffId>.json`, handoff document được đồng bộ `state` và `approval`, còn audit được ghi tại `.auto3dvideo/audit/browser-handoff.jsonl` và bảng SQLite `audit_events`. Luồng hợp lệ là `prepared` → `awaiting_upload_approval` → `awaiting_generate_approval` → `awaiting_import` → `completed`; `cancelled` là luồng dừng riêng.

App chỉ cho xác nhận Connect/login sau khi snapshot thành công báo session attached. Approval upload, Generate và import là các hành động ghi state/audit; chúng không click website. Native import chỉ nhận MP4 tuyệt đối do người dùng chọn, từ chối destination tồn tại, copy vào workspace, hash SHA-256, FFprobe video stream/duration và rollback nếu validation thất bại.

> BrowserMCP package `@browsermcp/mcp@0.1.3` đã trả 12 tools nhưng không có `upload_file` hoặc `download_file`. Vì vậy không có cơ sở để tuyên bố app tự upload hoặc tự tải candidate.

## Tests và commands

| Command | Kết quả |
| --- | --- |
| `python scripts/test_browser_handoff_worker.py` | `4 tests passed` |
| `node scripts/test_browsermcp_runtime_worker.mjs ...` | `passed`; probe có 12 tools, snapshot detached trả `blocked` |
| `python scripts/test_local_pipeline_workers.py` | Passed trong final chain |
| `cd desktop\\src-tauri && cargo fmt -- --check && cargo test --lib` | `48 passed; 0 failed; 4 ignored` |
| `cd desktop && pnpm build` | TypeScript và Vite build thành công; 32 modules transformed |
| `python scripts/validate_project.py --project .` | `AUTO3DVIDEO_PROJECT_VALID`; 248 inventory files, 47 JSON, 16 YAML |

Evidence chính gồm `outputs/browsermcp-smoke/runtime-probe-2.json`, `outputs/browsermcp-smoke/runtime-snapshot-test.json`, `outputs/browsermcp-smoke/cargo-test-browser-handoff.txt` và report test runtime mới nhất trong cùng thư mục.

## Cost, privacy, rights và policy

Google AI Studio/Veo/Gemini API không được gọi trong slice này; chi phí external generation được giữ `not_called`. Package BrowserMCP được cài ngoài repository sau confirmation của người dùng, không đưa `node_modules` vào repo. Runtime probe không mở tab và không network; browser action nếu được user bấm sẽ đi qua network boundary, nhưng app không suy đoán giá web subscription/API.

App không đọc hoặc lưu credential, cookie, password, token hay `.env`. App không xử lý login/CAPTCHA, không thanh toán, không bật Prepay/Auto-reload và không auto-publish. `rightsStatus` vẫn là thông tin do người dùng chọn; build/probe/import thành công không đồng nghĩa asset đã được cleared, publishable hoặc monetizable. Trước delivery vẫn cần review rights/provenance, chất lượng shot, continuity, AI disclosure, captions và platform/territory/monetization policy.

## Giới hạn còn lại và bước tiếp theo

Chrome extension trên máy người dùng hiện chưa có evidence verified trong session này. Người dùng cần mở `D:\Duancanhan\Auto3Dvideo`, vào tab Browser Handoff, probe runtime, kiểm tra extension chính thức đã cài/pin, mở đúng tab Google AI Studio, tự login, bấm Connect và sau đó bấm Snapshot. Nếu Snapshot vẫn detached, không được chuyển qua login/upload gate.

Khi snapshot attached, người dùng tự review hash/prompt/rights, bấm approval tương ứng trong app, tự chọn file và upload trên website, tự bấm Generate, tự tải MP4 về máy, rồi chọn MP4 và import local. Nếu muốn expose upload/download tự động trong tương lai, cần một design review mới cho file chooser/tool schema, approval riêng, provenance, cancellation và test; không tự bật chỉ vì BrowserMCP package đổi version.

## Tài liệu tham khảo

[1]: https://github.com/browsermcp/mcp "BrowserMCP GitHub repository"
[2]: https://docs.browsermcp.io/setup-server "BrowserMCP server setup documentation"
[3]: https://docs.browsermcp.io/setup-extension "BrowserMCP extension setup documentation"
[4]: https://browsermcp.io/install "BrowserMCP installation page"
