# Auto3Dvideo — Setup Contract cho agent

Tài liệu này là checklist cài đặt lại môi trường Windows cho agent hoặc máy phát triển mới. Repo hiện chạy theo hướng local-first; core desktop không cần API trả phí, BrowserMCP, ComfyUI, Blender hay FFmpeg để mở giao diện và chạy test Rust/TypeScript.

## 1. Repo và thư mục chuẩn

```text
Repo chính:       D:\Duancanhan\Auto3Dvideo
Desktop app:      D:\Duancanhan\Auto3Dvideo\desktop
BrowserMCP ngoài: D:\Auto3DvideoTools\browsermcp
Chrome Flow:      D:\Auto3DvideoTools\chrome-flow-cdp-profile
Obscura binary:   D:\Auto3DvideoTools\obscura-source\target\release\obscura.exe
```

Không copy `node_modules`, source BrowserMCP standalone, credential hoặc file `.env` vào repo chính.

## 2. Bắt buộc cho core desktop

| Thành phần | Mục đích | Cách kiểm tra |
|---|---|---|
| Windows 10/11 x64 | Native Tauri desktop | `winver` |
| WebView2 Runtime | WebView của Tauri | kiểm tra Apps/Installed apps |
| Node.js LTS | Vite, pnpm, worker `.mjs` | [nodejs.org](https://nodejs.org/) · `node --version` |
| pnpm 12.4.2 hoặc tương thích lockfile v9 | cài dependency frontend theo `desktop/pnpm-lock.yaml` | `pnpm --version` |
| Rust stable + Cargo | compile/test Tauri backend | [rustup.rs](https://rustup.rs/) · `rustc --version`, `cargo --version` |
| Visual Studio C++ Build Tools + Windows SDK | link native Tauri trên Windows | `where.exe cl.exe` |
| Python 3.12+ thật | planner/worker `.py` của repo; phải chạy được `--version` | [python.org](https://www.python.org/downloads/) · `python --version` |

Máy hiện tại đã được xác minh có MSVC tại `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`. Máy mới phải cài Visual Studio **Build Tools** workload **Desktop development with C++**, Windows 10/11 SDK và WebView2; không cần cài Visual Studio IDE. Antigravity chỉ là IDE/agent workspace, không cung cấp `cl.exe` hoặc linker native.

Trước mọi lệnh build native, nạp môi trường MSVC trong đúng process PowerShell:

```powershell
$vsDevCmd = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat'
$nativeCmd = "call `"$vsDevCmd`" -arch=x64 -host_arch=x64 && cd /d D:\Duancanhan\Auto3Dvideo && pnpm --dir desktop tauri build --no-bundle"
cmd.exe /d /s /c $nativeCmd
```

Nếu đường dẫn khác, tìm `VsDevCmd.bat` trong thư mục Visual Studio Build Tools rồi thay đúng path. Không chỉ chạy `pnpm tauri build` từ PowerShell thường nếu `where.exe cl.exe` không trả kết quả.

### Quy tắc Python trên Windows

Không nhập đường dẫn Python dưới dạng command string. Trong Settings chỉ nhập executable path, ví dụ:

```text
C:\Users\<user>\AppData\Local\Programs\Python\Python312\python.exe
```

Không cần thêm dấu nháy quanh path; app tự bỏ dấu nháy ngoài nếu người dùng dán nhầm. Một file `python.exe` trong `.venv` chưa đủ chứng minh Python chạy được: `pyvenv.cfg` phải còn trỏ tới một Python base tồn tại. Khi log báo `No Python at ...`, chạy kiểm tra trực tiếp:

```powershell
& 'C:\Users\<user>\AppData\Local\Programs\Python\Python312\python.exe' --version
```

Sau đó vào **Cài đặt → Tools**, lưu lại đúng executable path và bấm **Probe**. App sẽ bỏ qua venv stale và chọn fallback local hợp lệ nếu có; fallback chỉ đủ cho worker chuẩn thư viện, còn VieNeu/TTS cần Python 3.12 cùng dependency của worker.

## 3. Cài core dependency và chạy app

Mở PowerShell tại repo:

```powershell
Set-Location D:\Duancanhan\Auto3Dvideo

# Nếu pnpm chưa có và Node có Corepack:
corepack enable
corepack prepare pnpm@12.4.2 --activate

Set-Location .\desktop
pnpm install --frozen-lockfile

# Kiểm tra frontend:
pnpm build

# Kiểm tra native backend:
cargo test --manifest-path .\src-tauri\Cargo.toml --lib

# Mở app desktop development:
pnpm tauri dev
```

Muốn chỉ xem UI trên browser thì dùng `pnpm dev`, nhưng BrowserOS/FFmpeg/Blender native command chỉ được kiểm tra trong bản Tauri desktop.

Để tạo bản release:

```powershell
Set-Location D:\Duancanhan\Auto3Dvideo\desktop
pnpm tauri build
```

Installer được tạo dưới `desktop/src-tauri/target/release/bundle/`. Không dùng file `.exe` release cũ nếu source hoặc `desktop/dist` mới hơn; hãy build lại.

## 4. BrowserMCP / BrowserOS neo — chỉ cài khi cần Flow web

### BrowserMCP package

Nguồn upstream được plan sử dụng là [browsermcp/mcp](https://github.com/browsermcp/mcp). App dùng package phân phối `@browsermcp/mcp`, không vendor source vào repo.

Bản đã được probe trong project là `@browsermcp/mcp` **0.1.3**. Cài ở ngoài repo:

```powershell
New-Item -ItemType Directory -Force D:\Auto3DvideoTools\browsermcp | Out-Null
Set-Location D:\Auto3DvideoTools\browsermcp
pnpm init
pnpm add @browsermcp/mcp@0.1.3
```

Nếu nâng version, agent phải chạy lại probe protocol/tools và cập nhật evidence; không tự coi `@latest` là tương thích. Có thể đổi package root bằng biến môi trường không nhạy cảm:

```powershell
$env:AUTO3DVIDEO_BROWSERMCP_ROOT = 'D:\Auto3DvideoTools\browsermcp'
```

Node mặc định được app tìm ở `C:\Program Files\nodejs\node.exe`.

### BrowserOS neo và extension

BrowserOS neo là ứng dụng/runtime bên ngoài, không phải repo con của Auto3Dvideo. Cần cài và mở BrowserOS neo theo bản phân phối của nhà cung cấp, sau đó xác nhận MCP endpoint local mặc định:

```text
http://127.0.0.1:9000/mcp
```

Nếu máy dùng endpoint 9010:

```powershell
$env:AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT = 'http://127.0.0.1:9010/mcp'
```

Cài/pin BrowserMCP Chrome extension chính thức, mở Google Flow trong profile riêng, đăng nhập thủ công và bấm **Connect**. App chỉ probe/snapshot theo approval; không nhận cookie/token, không tự login, CAPTCHA, thanh toán, upload, Generate hoặc publish.

Profile Chrome Flow mặc định trong runbook là `D:\Auto3DvideoTools\chrome-flow-cdp-profile`.

### Google Flow MCP thử nghiệm cho Antigravity và desktop Tauri

Repo thử nghiệm đã clone tại:

```text
D:\Duancanhan\Auto3Dvideo\vendor\google-flow-mcp
```

Upstream: [retrolyze52/google-flow-mcp](https://github.com/retrolyze52/google-flow-mcp). Repo này là MCP server local điều khiển Flow bằng profile Chromium riêng, có `flow_inspect_account`, job ID bền vững, identity asset và download theo đúng job; không dùng gallery item mới nhất để đoán output. Bản trong repo đã được cập nhật cho giao diện mới `https://flow.google.com/?pli=1` và route project `/project/<id>`; không quay về `labs.google`.

Trên máy mới, chạy trong thư mục clone ổn định:

```powershell
Set-Location D:\Duancanhan\Auto3Dvideo\vendor\google-flow-mcp
npm ci
npm run check
npm run setup:antigravity
```

Sau đó trong Antigravity chọn **Settings → Customizations → Installed MCP Servers → Refresh**. Trong Brave thường, load unpacked extension tại `D:\Duancanhan\Auto3Dvideo\vendor\google-flow-mcp\extension`, mở `https://flow.google.com/?pli=1`, rồi dùng luồng `Connect my Google Flow account`. Sau khi sửa extension, phải bấm **Reload** ở `brave://extensions` trước khi bấm **Connect Flow**; chỉ tiếp tục khi `flow_list_accounts` báo account đã `connected` và có `defaultAccountId`.

Không chạy `npx playwright install chromium` và không gọi `flow_generate_*` nếu chưa có yêu cầu tạo media/duyệt credit. Desktop Tauri đã có adapter trực tiếp: nút **Tạo ảnh Google Flow · Nano Banana Pro** và **Tự làm toàn bộ** gọi worker MCP, lưu output theo `RUN_ID/SHOT_ID` rồi nhập vào Asset Library. Nhánh BrowserOS DOM cũ chỉ còn cho phiên/debug tương thích; one-click desktop không dùng nhánh đó và không có thao tác xoá gallery.

Adapter desktop yêu cầu MCP có ít nhất một account Flow ở trạng thái `connected` và có `defaultAccountId`. Nếu `flow_list_accounts` trả `[]`, hãy load extension, đăng nhập Google Flow và hoàn tất **Connect my Google Flow account** trước khi bấm Generate. App sẽ chặn với nguyên nhân cụ thể, giữ các asset đã có và không tự tạo lại/xoá shot cũ.

Probe runtime và protocol:

```powershell
Set-Location D:\Duancanhan\Auto3Dvideo
node scripts/test_browsermcp_runtime_worker.mjs `
  --worker D:\Duancanhan\Auto3Dvideo\scripts\browsermcp_runtime_worker.mjs `
  --server-entry D:\Auto3DvideoTools\browsermcp\node_modules\@browsermcp\mcp\dist\index.js `
  --output-dir outputs\browsermcp-smoke

node scripts/test_browsermcp_stdio_protocol.mjs `
  --server-entry D:\Auto3DvideoTools\browsermcp\node_modules\@browsermcp\mcp\dist\index.js
```

## 5. Công cụ media/3D tùy workflow

| Công cụ | Khi nào cần | Nguồn / cách cung cấp |
|---|---|---|
| Blender CLI | true 3D scene/render | [blender.org/download](https://www.blender.org/download/); cấu hình `blender.exe` trong Settings |
| FFmpeg + FFprobe | media fixture, subtitle, mux/probe | [ffmpeg.org/download](https://ffmpeg.org/download.html); cấu hình cả `ffmpeg.exe` và `ffprobe.exe` |
| ComfyUI | local image/video graph | [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI); chỉ cần khi chạy graph local, endpoint mặc định `http://127.0.0.1:8188` |
| yt-dlp.exe | creator/playlist metadata hoặc download có rights gate | [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp); app không tự cài, không truyền cookie |
| Obscura | preview radar public scrape ưu tiên | binary ngoài repo tại `D:\Auto3DvideoTools\obscura-source\target\release\obscura.exe`; nếu thiếu thì route này blocked/fallback theo policy |

`tools/vendor/you-get` đã có trong repo và chỉ là reference research; không cần tải lại hoặc dùng làm trend engine mặc định.

## 6. Lệnh validation trước khi báo “setup xong”

```powershell
Set-Location D:\Duancanhan\Auto3Dvideo

python scripts/validate_project.py --project .
python scripts/test_migration.py --project .
python scripts/test_process_spec.py
python scripts/test_tool_readiness.py
python scripts/test_browser_handoff_worker.py

Set-Location .\desktop\src-tauri
cargo fmt -- --check
cargo test --lib

Set-Location ..
pnpm build
```

Nếu cần kiểm tra workflow preview, đọc `plans/PLAN-026-MULTI-PLATFORM-PREVIEW-RADAR.md` và `workflows/WORKFLOW-026-MULTI-PLATFORM-PREVIEW-RADAR.md`; không tự mở download/publish chỉ vì worker trả `success`.

## 7. Quy tắc cho agent

- Đọc `AGENTS.md`, `README.md`, plan liên quan, architecture, contract và workflow trước khi sửa.
- Chỉ sửa trong repo và scope đã được người dùng yêu cầu; không đọc/in/commit `.env`, API key, private key, cookie, token hoặc dữ liệu cá nhân.
- Không truyền raw prompt thành shell command. Process phải đi qua typed allowlist, workspace-relative paths, timeout, cancellation và output validation.
- Không tự tải source/provider/model có chi phí. Paid generation, upload, Generate, import và publish đều cần approval riêng.
- Không claim video publishable, monetizable, legally compliant hoặc production-ready chỉ vì build/test thành công; luôn giữ human review cho chất lượng, rights, safety, accessibility và policy.
