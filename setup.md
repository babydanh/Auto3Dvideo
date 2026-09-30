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
| WebView2 Runtime | WebView của Tauri | [tải WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) · kiểm tra Apps/Installed apps |
| Node.js LTS | Vite, pnpm, worker `.mjs` | [nodejs.org](https://nodejs.org/) · `node --version` |
| pnpm 9.x | cài dependency frontend theo `desktop/pnpm-lock.yaml` (`lockfileVersion: '9.0'`; package không pin `packageManager`) | `pnpm --version` |
| Rust stable + Cargo | compile/test Tauri backend | [rustup.rs](https://rustup.rs/) · `rustc --version`, `cargo --version` |
| Visual Studio C++ Build Tools + Windows SDK | link native Tauri trên Windows | [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) · `where.exe cl.exe` |
| Python 3.12+ thật | planner/worker `.py` của repo; phải chạy được `--version` | [python.org](https://www.python.org/downloads/) · `python --version` |

Máy hiện tại đã được xác minh có MSVC tại `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`. Máy mới cài Visual Studio **Build Tools** workload **Desktop development with C++**, Windows 10/11 SDK và WebView2 Runtime; có thể tải từ [Visual Studio downloads](https://visualstudio.microsoft.com/downloads/) và [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/). Không cần cài Visual Studio IDE. Antigravity chỉ là IDE/agent workspace, không cung cấp `cl.exe` hoặc linker native.

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

Sau đó vào **Cài đặt → Cấu hình môi trường chạy**, nhập và **Lưu** đúng executable path, rồi bấm **Kiểm tra**. App sẽ bỏ qua venv stale và chọn fallback local hợp lệ nếu có; fallback chỉ đủ cho worker chuẩn thư viện. Video local cần Pillow; Voice Studio cần PyTorch, OmniVoice và model/tokenizer đã cài vào đúng Python.

## 3. Cài core dependency và chạy app

Mở **Developer PowerShell for VS 2022** tại repo (hoặc PowerShell đã nạp `VsDevCmd.bat` như mục trên) để chạy lệnh native:

```powershell
Set-Location D:\Duancanhan\Auto3Dvideo

# Nếu pnpm chưa có và Node có Corepack:
corepack enable
corepack prepare pnpm@9 --activate

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

Để tạo bản release, vẫn dùng **Developer PowerShell for VS 2022** hoặc môi trường đã nạp `VsDevCmd.bat`:

```powershell
Set-Location D:\Duancanhan\Auto3Dvideo\desktop
pnpm tauri build
```

Installer được tạo dưới `desktop/src-tauri/target/release/bundle/`. Không dùng file `.exe` release cũ nếu source hoặc `desktop/dist` mới hơn; hãy build lại.

## 4. BrowserMCP / BrowserOS neo — chỉ cài khi cần Flow web

### Package BrowserMCP fallback (optional)

The desktop video route defaults to the BrowserOS neo backend. Install `@browsermcp/mcp` only if explicitly switching to the fallback with `AUTO3DVIDEO_BROWSER_BACKEND=browsermcp`; the default route does not require the standalone BrowserMCP npm server.

The fallback package version previously probed by this project is `@browsermcp/mcp` **0.1.3**. Install it outside the repository:

```powershell
New-Item -ItemType Directory -Force D:\Auto3DvideoTools\browsermcp | Out-Null
Set-Location D:\Auto3DvideoTools\browsermcp
pnpm init
pnpm add @browsermcp/mcp@0.1.3
$env:AUTO3DVIDEO_BROWSER_BACKEND = 'browsermcp'
```

If upgrading this fallback, re-probe the runtime protocol/tools. Set `AUTO3DVIDEO_BROWSERMCP_ROOT` only when the package root differs from `D:\Auto3DvideoTools\browsermcp`:

```powershell
$env:AUTO3DVIDEO_BROWSERMCP_ROOT = 'D:\Auto3DvideoTools\browsermcp'
```

The configured Node executable must be available to the app; the default is `C:\Program Files\nodejs\node.exe`.

### BrowserOS neo và extension

BrowserOS neo là ứng dụng/runtime bên ngoài, không phải repo con của Auto3Dvideo. Cần cài và mở BrowserOS neo theo bản phân phối của nhà cung cấp, sau đó xác nhận MCP endpoint local mặc định:

```text
http://127.0.0.1:9000/mcp
```

Nếu máy dùng endpoint 9010:

```powershell
$env:AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT = 'http://127.0.0.1:9010/mcp'
```

Open Google Flow in the selected BrowserOS profile, sign in manually and press **Connect** in the extension. The desktop One-Prompt video route uses this connected session; it may type prompts and click **Generate** only after an explicit visible-price batch-cap approval. Setup/probe does not generate media. The app does not automate login, CAPTCHA or payment, and it does not upload subject images for you.

Profile Chrome Flow mặc định trong runbook là `D:\Auto3DvideoTools\chrome-flow-cdp-profile`.

### Standalone Google Flow MCP for Antigravity (optional; separate from desktop video)

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

This vendored Google Flow MCP project is a separate Antigravity experiment; it is not the desktop One-Prompt video route. The current desktop path calls `check_browsermcp_session` and uses BrowserOS neo by default (`AUTO3DVIDEO_BROWSER_BACKEND` defaults to BrowserOS). It may enter prompts and click Generate only after the app obtains user approval for the visible-price batch cap. The **Kết nối Google Flow** action uses the separate gflow-cli profile and does not replace the connected BrowserOS session.

Verify the active session with **Browser Handoff → Kiểm tra kết nối Chrome**. In the shot canvas, local reference assignment does not upload an image; import the same image into the saved Flow project manually, visually match its card and save the exact Flow media ID before running shots. Missing/ambiguous media or price evidence blocks before prompt entry/Generate.

Local no-credit checks (these do not connect to Flow or spend credits):

```powershell
Set-Location D:\Duancanhan\Auto3Dvideo
node scripts/test_browseros_mcp_runtime_worker.mjs
node scripts/test_flow_shot_provenance.mjs
```

The tests validate the local BrowserOS protocol and shot-reference gates only. They do not prove that the signed-in Flow UI will work on every account, upload media, or perform a live Generate.

## 5. Công cụ media/3D tùy workflow

| Công cụ | Khi nào cần | Nguồn / cách cung cấp |
|---|---|---|
| Blender CLI | true 3D scene/render | [blender.org/download](https://www.blender.org/download/); cấu hình `blender.exe` trong Settings |
| FFmpeg + FFprobe | local 2.5D/Flow MP4, subtitle, mux/probe | [ffmpeg.org/download](https://ffmpeg.org/download.html); cấu hình cả `ffmpeg.exe` và `ffprobe.exe` |
| Pillow + PyTorch + OmniVoice | local 2.5D video và narration | Dùng cùng Python 3.12+ đã cấu hình trong Settings. `python -m pip install Pillow`; chọn PyTorch wheel đúng CPU/GPU tại [pytorch.org](https://pytorch.org/get-started/locally/), cài OmniVoice theo [hướng dẫn upstream](https://github.com/k2-fsa/OmniVoice#installation), rồi dùng **Voice Studio → Cài model OmniVoice** để tải model và tokenizer vào workspace cache. |
| BrowserOS neo / BrowserMCP | Flow video theo shot trong desktop | Chỉ cần khi dùng paid Flow route; xem mục 4 phía trên và root [README.md](README.md). |
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
node scripts/test_browseros_mcp_runtime_worker.mjs
node scripts/test_flow_shot_provenance.mjs

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
