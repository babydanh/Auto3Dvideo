# PLAN-017 — BrowserMCP Web Handoff

## Mục tiêu

Cho phép Auto3Dvideo chuẩn bị một gói shot/reference/prompt để người dùng dùng BrowserMCP với Google web, đồng thời giữ toàn bộ quyền kiểm soát file, approval, provenance, state và import output trong ứng dụng Tauri. Runtime hiện đã có probe stdio và các thao tác read-only có approval; upload, Generate, login và download vẫn là các bước thủ công do người dùng thực hiện trên tab đã Connect.

## Quyết định kiến trúc

Sử dụng repository/distribution `browsermcp/mcp` theo đường cài đặt chính thức `@browsermcp/mcp@latest` + Chrome extension. Không copy standalone GitHub source vào repo vì source hiện phụ thuộc workspace packages và entrypoint dùng stdio MCP. BrowserMCP chỉ là lớp browser interaction; Tauri giữ state machine, workspace containment, hash, allowlist, budget, approval, audit và candidate import.

Package đã được cài ngoài repo ở `D:\Auto3DvideoTools\browsermcp` sau confirmation của người dùng. App không đưa `node_modules` vào repository. Node executable được resolve qua tool config/default `C:\Program Files\nodejs\node.exe`; có thể đổi package root bằng biến môi trường không nhạy cảm `AUTO3DVIDEO_BROWSERMCP_ROOT`.

## State machine

```text
prepared
  → awaiting_upload_approval   (sau snapshot attached + xác nhận login/Connect)
  → awaiting_generate_approval (sau user xác nhận upload thủ công)
  → awaiting_import            (sau user xác nhận Generate thủ công)
  → completed                  (sau import MP4 local + FFprobe thành công)
```

Các trạng thái lỗi hoặc dừng là `blocked` và `cancelled`. Không được nhảy từ `prepared` sang `completed`. Upload, Generate và Import là ba approval độc lập. State được lưu tại `.auto3dvideo/state/browser-handoff-<handoffId>.json`, handoff document được đồng bộ `state/approval`, và audit được ghi cả JSONL local lẫn `audit_events` SQLite.

## Handoff pack

Gói được tạo dưới workspace gồm `handoff.json`, `prompt.txt` và các reference path tương đối; không copy media ngoài workspace ở bước prepare, không đọc cookie/token, không tự upload. Mỗi input có `relativePath`, `mediaKind`, `sha256` và `sizeBytes`. Target URL phải là HTTPS và host `aistudio.google.com`. Prompt có giới hạn 4.000 ký tự, cấm credential-like text và không được chứa raw shell command.

## BrowserMCP runtime boundary

Tauri materializes `scripts/browsermcp_runtime_worker.mjs` vào `.auto3dvideo/tools/` và chạy nó qua external-process supervisor với Node allowlist, timeout 45 giây, output giới hạn và expected report path trong workspace. Runtime worker thực hiện `initialize` và `tools/list` ở chế độ probe; report hiện xác minh BrowserMCP v0.1.3, protocol `2025-03-26` và 12 tools. Tool surface không có `upload_file` hoặc `download_file`, vì vậy app không tuyên bố upload/download tự động.

Runtime action hiện chỉ cho phép `navigate`, `snapshot`, `screenshot` và `wait`. Navigate bắt buộc HTTPS host allowlist và confirmation trong UI. Snapshot/screenshot chỉ được gọi sau khi người dùng tự cài extension, mở đúng tab, tự login và bấm Connect. App chỉ lưu summary metadata, không lưu page text, cookie, token hoặc screenshot content vào report. Click/type/keypress bị loại khỏi bridge hiện tại để không có đường tự động chạm nút upload hoặc Generate.

Không tự xử lý login/CAPTCHA, không điều khiển tab ngoài allowlist, không tự thanh toán, không tự bật Prepay/Auto-reload và không tự publish.

## Candidate import

Sau Generate thủ công, người dùng tự tải MP4 về máy và chọn file qua file picker. Native command chỉ nhận đường dẫn tuyệt đối do user chọn, giới hạn MP4 tối đa 4 GiB, từ chối destination đã tồn tại, copy vào workspace, tính SHA-256 và chạy FFprobe. Nếu probe/metadata không hợp lệ, file copy được rollback. Chỉ sau khi FFprobe xác nhận video có duration dương, state mới chuyển `completed`; rights, quality, AI disclosure và monetization vẫn cần human review.

## Cost/privacy/rights

`networkRequired=true` vì browser web có thể gửi dữ liệu ra ngoài máy. Probe local có `networkCallsMade=false`; browser action report đánh dấu network boundary đã được gọi, không phải cam kết chi phí cụ thể. `paidGeneration` vẫn false ở prepare và không có đường thanh toán trong app. `rightsStatus` phải được user chọn; input TikTok/Douyin/YouTube không được đưa vào handoff nếu không có quyền. `termsReviewed` và human review là bắt buộc trước upload/generate/import. Chi phí Google web không được giả định miễn phí.

## Acceptance criteria

1. Request và output prepare tuân thủ `contracts/browser-handoff.schema.json`.
2. Path traversal, absolute path ở asset/destination, URL ngoài allowlist, prompt quá dài, secret-like text, input vượt giới hạn và overwrite đều bị chặn.
3. Handoff pack chỉ được ghi trong workspace và không ghi đè pack cũ.
4. Native runtime probe không navigate/click/type/upload/generate; report ghi rõ protocol, server version, tool list và session detached.
5. Browser action phải có handoff ID, state file, approval và allowlist; session/login không được đánh dấu trước snapshot thành công.
6. State transition được audit vào JSONL và SQLite; restart không thể làm state nhảy qua các cổng approval.
7. Candidate import chỉ là local copy + SHA-256 + FFprobe, không auto-download và không overwrite; lỗi validation rollback file copy.
8. Test cover worker happy path, validation/no-overwrite/hash, runtime probe, detached snapshot, Rust unit tests, frontend build và project validator.
9. UI nói rõ đây là Web Handoff; không tuyên bố app đã tự điều khiển Google web khi BrowserMCP/extension chưa được user cài và kết nối.

## Phạm vi chưa làm / giới hạn đã biết

Chưa có upload/download tool trong BrowserMCP package 0.1.3 đã probe. Vì vậy user vẫn phải chọn file trong Google web, bấm upload, nhập prompt nếu muốn, bấm Generate, chờ xử lý và tải MP4 bằng giao diện website. Chrome extension install/Connect trên máy người dùng vẫn cần được user kiểm tra; trạng thái từ browser sandbox trước đây là **chưa xác minh**, không được coi là đã cài. App không dùng Google API, Veo API, Gemini API hoặc credential trong `.env` cho route này.

## Lệnh kiểm tra

```powershell
python scripts/test_browser_handoff_worker.py
node scripts/test_browsermcp_runtime_worker.mjs --worker D:\Duancanhan\Auto3Dvideo\scripts\browsermcp_runtime_worker.mjs --server-entry D:\Auto3DvideoTools\browsermcp\node_modules\@browsermcp\mcp\dist\index.js --output-dir outputs\browsermcp-smoke
python scripts/test_local_pipeline_workers.py
cd desktop\src-tauri
cargo fmt -- --check
cargo test --lib
cd ..
pnpm build
cd ..
python scripts/validate_project.py --project .
```
