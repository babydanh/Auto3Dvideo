# BrowserMCP Web Handoff Runbook

## Mục đích

Tab **Browser Handoff** hiện là **Connection Center**: nó chỉ kiểm tra và hiển thị session Chrome/BrowserMCP để quy trình video dùng lại. Asset Blender, shot prompt, handoff pack và kết quả MP4 thuộc về **Quy trình video**, không nhập lại ở trang này. App không biến thành công cụ tự đăng nhập, tự thanh toán, tự upload hoặc tự publish.

> BrowserMCP v0.1.3 có 12 tools nhưng không có `upload_file` hoặc `download_file`. Extension là client WebSocket duy nhất của BrowserMCP ở cổng local 9009; Auto3Dvideo giữ một phiên MCP stdio lâu dài để gửi lệnh vào server, tuyệt đối không mở WebSocket thứ hai vào cổng của extension. Riêng image composer Google Flow có một adapter Playwright + Chrome CDP cục bộ, được gọi qua Rust executor và chỉ lưu file khi bắt được download event thật; không ghi nhận giả là đã thành công.

## Kết nối một lần

1. Mở Auto3Dvideo trước để app khởi động BrowserMCP server nền local.
2. Mở Google Flow/AI Studio trong Chrome và tự đăng nhập.
3. Trong Connection Center, bấm **Mở Chrome Auto + tạo group** nếu muốn tách hoàn toàn tab tự động khỏi Chrome thủ công. App cũng tự mở profile này khi khởi động. App sẽ gom các tab Flow vào group `Auto3Dvideo · GOOGLE FLOW · AUTO`; profile mặc định nằm ở `D:\Auto3DvideoTools\chrome-flow-cdp-profile`.
4. Mở BrowserMCP extension trên đúng tab Flow trong cửa sổ Auto và bấm **Connect**.
5. Vào **Browser Handoff → Kiểm tra kết nối Chrome**. Lệnh này chạy `browser_snapshot` qua MCP stdio, không cần handoff ID, asset hay prompt.
6. Khi hiện **ĐÃ KẾT NỐI**, quay lại **Quy trình video**. Các lần chạy sau dùng session đó; không cần chọn lại asset trong Browser Handoff.

Nếu báo **CHƯA KẾT NỐI**, kiểm tra đúng cửa sổ Auto, đúng tab Flow trong group và nút Connect trong extension rồi bấm **Kiểm tra lại kết nối**. Nút **Kiểm tra cài đặt BrowserMCP** chỉ kiểm tra package/runtime, không phải kiểm tra session Chrome.

App khởi động một MCP server nền và tái sử dụng phiên stdio đó cho các lần kiểm tra/action sau. Extension vẫn giữ WebSocket duy nhất với server. Nếu vừa cập nhật hoặc khởi động lại app, server có thể vừa được bind lại cổng 9009: bấm **Disconnect**, bấm **Connect** lại trên đúng tab Google Flow một lần, rồi quay lại app kiểm tra. Sau đó không cần Connect lại cho mỗi shot.

Trang Connection Center không có nút upload, Generate, import, approval, handoff ID hoặc prompt edit. Những thứ đó nếu cần sẽ xuất hiện trong activity của một lần chạy video cụ thể.

## Discovery lần đầu và roadmap thích ứng

Trong **Quy trình video**, nút **Kết nối & học Flow** hoặc **Quét route lần đầu** tạo một workflow local có `workflowId`. App giữ nguyên tab/project đang Connect và thực hiện một lượt an toàn `snapshot → wait 2s → snapshot`; nếu snapshot có ref `New project`/`Create project` thì app tự click đúng ref đó, đọc lại tab, rồi nếu có textbox prompt hợp lệ thì tự nạp prompt của session bằng UI ref đã học. Mọi bước bị BrowserMCP từ chối đều được ghi `waiting_user`/`failed`, không ghi thành công giả. App sau đó lưu:

- route step và capability mà BrowserMCP thực sự có;
- danh sách tool BrowserMCP đã trả về trong lần discovery;
- các UI ref giới hạn (`role`, `label`, `reference`) để dùng cho bước sau, không lưu raw page text;
- asset local với `assetId`, tên, vai trò và `processId`;
- `sessionId` của phiên video hiện tại và bảng `fileId → relativePath → kind → processId` cho scene, manifest, preview, edit plan và các file Gemini/reference;
- roadmap có dependency, evidence, trạng thái và `nextAction`.

Workflow Browser Flow được lưu riêng tại `.auto3dvideo/browser-flow/workflow-<workflowId>.json` nhưng luôn mang `sessionId`. Khi người dùng mở lại một phiên video, app lọc đúng workflow theo `projectId + sessionId`, khôi phục roadmap, process log, asset ID và file binding của phiên đó; không lấy nhầm workflow mới nhất của phiên khác. Mỗi lần workflow thay đổi, process và roadmap được ghi trước/sau bước để có thể tiếp tục sau khi đóng app.

Roadmap không đoán thành công. Discovery thành công sẽ tự coi project/không gian của tab đang Connect là project hiện tại, rồi chuyển sang milestone nạp prompt. Prompt của cùng session chỉ được nạp một lần, luôn `submit=false`; sau đó app chờ và snapshot lại, không tự gõ lại hoặc gửi Enter lần hai. Nếu Flow hỏi chọn cách làm, app ưu tiên tự chọn **Storyboard all shots first** để dựng đủ shot trước, rồi chờ Flow xử lý và đọc lại trạng thái. Mỗi lần BrowserMCP trả output thật, app gắn output vào process, chuyển milestone hiện tại và mở milestone kế tiếp. Nếu trang có thể đang hiển thị control nhưng accessibility snapshot không trả textbox/button ref, roadmap chuyển sang `waiting_user` và ghi rõ đây là giới hạn truy cập UI; app không tự bịa tọa độ hoặc ref. Tool thiếu, tab chưa Connect, ref sai hoặc cần thao tác người dùng cũng chuyển sang `waiting_user`/`blocked`/`failed` và hiển thị nguyên nhân ngay trong workspace. Khi snapshot học được nút **Add ingredients to the prompt box**, app có thể bấm đúng ref qua nút **Mở Ingredients để gắn ảnh**, sau đó dừng ở `waiting_user` để người dùng chọn file trong file chooser. **Tiếp tục sau khi đã chọn asset** chỉ ghi process đang chờ file chooser; nó không giả upload. Khi snapshot học được nút **Approve**, app chỉ bấm nút đó sau thao tác rõ ràng của người dùng qua **Duyệt tạo video trên Flow**; không tự bấm **Always approve** và không tự tiêu credit. Nút **Quét lại & cập nhật roadmap** tạo phiên discovery mới để học lại route sau khi giao diện Flow thay đổi.

### Playwright + CDP cho image composer Flow

Khi snapshot đã xác nhận đúng image composer Nano Banana Pro nhưng BrowserMCP
không trả ref ổn định, quy trình ảnh dùng `run_google_flow_playwright_action` qua
Rust. Worker chỉ nhìn đúng tab project đã khóa và có bốn mode:

- `observe`: đọc control đang hiển thị, Accessibility tree, DOMSnapshot và chụp
  screenshot để planner/agent hiểu trạng thái hiện tại; không click.
- `type_prompt`: tìm editor `contenteditable` của image composer, nhập prompt có
  `SHOT_ID` + `REVISION_ID`, rồi kiểm tra lại nội dung đã nhận.
- `click_generate`: chọn duy nhất nút Generate có accessible name phù hợp; nếu
  nhiều nút ngang điểm hoặc không rõ thì dừng.
- `download_image`: lọc đúng batch theo `SHOT_ID` + `REVISION_ID`, chờ event
  download thật của Chrome, lưu tên file riêng trong `Downloads`, kiểm tra file
  ảnh khác rỗng rồi mới trả `ready`.

Các mode này không login, không xử lý CAPTCHA, không đọc credential, không tự
duyệt credit và không publish. Sau download, native runner vẫn phải thấy file
ảnh mới, hash/import vào Asset Library và giữ rights ở `pending`. UI sau đó chuyển
sang `waiting_user` và hiện đúng ảnh vừa import: chỉ khi người dùng bấm **Ảnh đúng —
làm tiếp** workflow mới gửi shot kế tiếp; **Ảnh sai — dừng tại shot này** trả về
`blocked` để sửa prompt/revision, không tự chạy tiếp. Report/screenshot/spec nằm
trong `.auto3dvideo/runs/<runId>/playwright-flow/`.

Nếu BrowserOS báo một control bị `<span.mat-focus-indicator>` của chính Angular
Material che tại điểm bấm, runtime có đúng một nhánh phục hồi: gửi `Enter` vào
cùng accessibility ref và yêu cầu BrowserOS trả kết quả thành công. Đây không
phải bypass overlay chung; modal backdrop, banner, consent hoặc lớp phủ không rõ
nguồn vẫn chuyển `blocked` để người dùng xử lý. Report thành công ghi
`interactionRecovery=enter_after_benign_material_overlay`, còn không có field này
thì không được coi là đã dùng nhánh phục hồi.

## Chuẩn bị một handoff

Trước tiên mở project có workspace local và vào tab **Browser Handoff**. Chọn MP4 shot Blender hoặc keyframe PNG/JPG nằm trong workspace, đặt Handoff ID chữ thường, kiểm tra target `https://aistudio.google.com/`, sửa prompt để giữ object identity/event order/camera direction và chọn rights status đúng với tài sản. Không đưa API key, cookie, password, token hoặc raw command vào prompt.

Bấm **Tạo handoff pack local**. Bước này chỉ chạy worker Python local, hash asset, ghi `handoff.json` và `prompt.txt`; chi phí web là `not_called`, network là `false`, upload/generate/import là `false`. Nếu output đã tồn tại, app từ chối ghi đè.

## Kiểm tra runtime và tab

Bấm **Probe runtime** trước. Kết quả `ready` chỉ chứng minh Node và BrowserMCP package trả lời `initialize/tools/list`; nó không chứng minh extension đã cài hoặc tab đã nối. Trong Chrome, người dùng phải tự cài/pin extension chính thức, mở đúng tab Google AI Studio, tự đăng nhập và bấm **Connect** trên extension. Không gửi thông tin đăng nhập cho Auto3Dvideo. Native app gửi MCP JSON-RPC qua stdin/stdout; không được thêm worker WebSocket thứ hai vào cổng 9009.

Sau khi Connect, bấm **Snapshot tab đã Connect**. Chỉ khi report trả session attached thì mới bấm **Tôi đã Connect + login**. Nếu snapshot trả `blocked` hoặc `detached`, dừng tại đây, kiểm tra đúng tab/extension rồi thử lại; không được đánh dấu login bằng tay để vượt gate.

Nút **Mở target qua BrowserMCP** có confirmation riêng và chỉ cho HTTPS host `aistudio.google.com`. Nút này là tùy chọn; nó không login và không upload. Screenshot chỉ dùng để kiểm tra trạng thái và report không lưu page text, cookie, token hoặc ảnh nội dung.

## Upload và Generate

### Gemini storyboard stills (tùy chọn)

Từ **Quy trình video**, sau khi có semantic Blender storyboard, bấm **Chuẩn bị phác ảnh Gemini**. App tạo một handoff pack local tới `https://gemini.google.com/app` với board theo shot và prompt beat. Pack này chỉ là prompt/input evidence; app không tự đăng nhập, upload, bấm Generate hay tải file.

Trong Gemini, người dùng tạo từng ảnh tĩnh theo `SHOT-01`, `SHOT-02`… rồi tải PNG/JPG về máy. Quay lại Quy trình video, bấm **Nhập ảnh Gemini**, chọn các file đã tải; app copy/hash/ghi provenance vào Asset Library với quyền `pending`. Sau khi review ảnh, bấm **Chuẩn bị prompt Google Omni**. Handoff Omni sẽ nhận semantic Blender boards + Gemini stills + user reference images (nếu có), nhưng vẫn dừng ở bước người dùng duyệt/tác động trên web.

Khi state là `awaiting_upload_approval`, người dùng phải review asset hash, prompt, rights và đúng tab. Bấm **Duyệt bước upload** trong app để ghi approval/audit. App vẫn không click upload. Người dùng tự chọn file trong hộp thoại Google, kiểm tra tên file, quyền sử dụng và thông tin gửi đi, sau đó bấm **Tôi đã upload thủ công** trong app.

Khi state là `awaiting_generate_approval`, người dùng review lại prompt, model/web terms và khả năng phát sinh chi phí. Với workflow Browser Flow đang có ref **Approve**, nút **Duyệt tạo video trên Flow** sẽ click đúng nút **Approve** đã học sau xác nhận rõ ràng của người dùng; app không click **Always approve** và không bypass cost/rights gate. Nếu chưa có ref phù hợp, người dùng tự bấm Generate/Approve trên website. Sau khi website báo candidate hoàn tất, bấm **Tôi đã Generate thủ công** trong app để chuyển sang `awaiting_import`.

Không bấm approval nếu chưa thực hiện đúng bước ở website. Approval trong app là nhật ký quyết định của người dùng, không phải bằng chứng rằng BrowserMCP đã upload hoặc Generate thành công.

## Import candidate

Tải MP4 candidate bằng giao diện website về máy. Trong app, bấm **Chọn MP4**, chọn đúng file `.mp4`, bấm **Duyệt import local**, rồi bấm **Import candidate vào workspace**. Native code chỉ copy file vào destination mới, từ chối overwrite, tính SHA-256 và chạy FFprobe. File copy bị rollback nếu không có video stream, JSON probe lỗi hoặc duration không dương.

Sau import, state là `completed`, nhưng sản phẩm chưa được coi là publishable/monetizable/legal cleared. Người dùng vẫn phải review chất lượng 3D, continuity, rights/provenance, AI disclosure, captions, platform/territory rules và quyết định delivery.

## State và evidence

State bền vững nằm tại `.auto3dvideo/state/browser-handoff-<handoffId>.json`. Handoff document được đồng bộ tại output directory. Audit local nằm tại `.auto3dvideo/audit/browser-handoff.jsonl`; audit SQLite nằm trong bảng `audit_events`. Runtime report nằm tại `.auto3dvideo/reports/` và chỉ giữ metadata summary.

Các lệnh kiểm tra từ repository root:

```powershell
python scripts/test_browser_handoff_worker.py
node scripts/test_browsermcp_runtime_worker.mjs --worker D:\Duancanhan\Auto3Dvideo\scripts\browsermcp_runtime_worker.mjs --server-entry D:\Auto3DvideoTools\browsermcp\node_modules\@browsermcp\mcp\dist\index.js --output-dir outputs\browsermcp-smoke
node scripts/test_browsermcp_stdio_protocol.mjs --server-entry D:\Auto3DvideoTools\browsermcp\node_modules\@browsermcp\mcp\dist\index.js
cd desktop\src-tauri
cargo fmt -- --check
cargo test --lib
cd ..
pnpm build
cd ..
python scripts/validate_project.py --project .
```

## Không hỗ trợ trong Browser Handoff slice

Connection Center không tự login, không xử lý CAPTCHA, không dùng credential từ `.env`, không gọi Google API/Veo/Gemini API, không tự upload, không tự thanh toán, không bật Prepay/Auto-reload và không auto-publish. Handoff upload/download vẫn là thao tác thủ công. Riêng nút chạy image composer Flow đã được user chủ động bấm có thể dùng adapter Playwright ở trên để nhập prompt, Generate và bắt download thật theo từng shot; các gate identity, file validation, rights và human review vẫn giữ nguyên. Nếu BrowserMCP package sau này bổ sung upload/download tool, phải audit tool schema, thiết kế approval riêng, cập nhật contract và test trước khi expose; không tự bật chỉ vì package version thay đổi.

## Tài liệu tham khảo

[1]: https://github.com/browsermcp/mcp "BrowserMCP GitHub repository"
[2]: https://docs.browsermcp.io/setup-server "BrowserMCP server setup"
[3]: https://docs.browsermcp.io/setup-extension "BrowserMCP extension setup"
[4]: https://browsermcp.io/install "BrowserMCP installation"
