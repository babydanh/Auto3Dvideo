# Antigravity IDE Runbook — Auto3Dvideo

## Mục đích

Tài liệu này chuẩn hóa cách mở và làm việc với Auto3Dvideo trong **Antigravity IDE**. Antigravity được xem là IDE/agent workspace; nó không thay thế Tauri, Rust, MSVC, Windows SDK, Node.js, pnpm hoặc các worker local. Mọi thay đổi vẫn phải đi qua contract, phạm vi file, validator và release evidence của repository.

> Quy tắc ngắn: **mở đúng root, đọc đúng context, sửa nhỏ, validate ngay, không đọc secret, không tự bật side effect**.

## Mở project đúng cách

Mở duy nhất thư mục repository root:

```text
D:\Duancanhan\Auto3Dvideo
```

Không mở riêng `desktop/` nếu task cần contracts, workflows, policy hoặc manifest. `desktop/` chỉ là một subtree của control plane Tauri.

Sau khi mở project, terminal của Antigravity phải chạy từ root:

```powershell
cd D:\Duancanhan\Auto3Dvideo
```

Nếu terminal đang ở `desktop/`, quay lại root trước khi chạy project validator. Những lệnh build frontend mới chạy trong `desktop/`.

## Context tối thiểu agent cần đọc

Agent không cần nạp toàn bộ repository cho mỗi task. Với một change thông thường, đọc theo thứ tự sau:

| Bước | File hoặc thư mục | Mục đích |
|---:|---|---|
| 1 | `AGENTS.md` | Boundary, policy, required delivery status |
| 2 | `README.md` | Product scope, stack và quick start |
| 3 | `plans/MASTER_IMPLEMENTATION_PLAN.md` | Phase và exit gate |
| 4 | Một architecture document liên quan | Quyết định kỹ thuật của task |
| 5 | Contract liên quan trong `contracts/` | Shape và enum được phép |
| 6 | Một workflow fixture trong `workflows/` | Cách contract được dùng thực tế |
| 7 | `docs/PROJECT_STATUS.md` | Blocker và trạng thái thật hiện tại |

Ví dụ task FFmpeg chỉ cần đọc `MEDIA_PROCESSING.md`, `media-plan.schema.json`, `delivery.schema.json` và `example-local-free-pipeline.yaml`; không cần đọc toàn bộ research pack.

## Vòng lặp task chuẩn

Mỗi prompt cho agent nên được chia thành sáu phần: mục tiêu, phạm vi file, contract phải giữ, điều không được làm, lệnh kiểm thử và tiêu chí hoàn tất.

```text
Mục tiêu: <một kết quả có thể đo được>
Phạm vi file: <các file được phép sửa>
Contract: <schema/state/policy phải giữ>
Không làm: không đọc .env/secret; không gọi cloud; không publish; không chạy binary nếu chưa được phê duyệt
Kiểm thử: <các lệnh cụ thể>
Hoàn tất khi: validator PASS và docs/evidence khớp kết quả thật
```

Agent phải dừng và báo `NEEDS_CLARIFICATION` khi task không chỉ rõ workspace/project, output path, policy gate hoặc file được phép sửa. Agent phải báo `BLOCKED` thay vì giả vờ thành công khi thiếu MSVC, FFmpeg, GPU, provider credential hoặc human approval.

## Các task an toàn có thể chạy ngay

Chạy từ root repository:

```powershell
python scripts/check_agent_workspace.py --project .
python scripts/validate_project.py --project .
python scripts/validate_markdown_links.py --project .
python scripts/test_migration.py --project .
python scripts/test_job_state_machine.py
python scripts/test_process_spec.py
python scripts/test_media_plan.py
python scripts/test_tool_readiness.py
python scripts/test_execution_attempt.py
python scripts/test_compile_worker_plan.py
```

Tạo và kiểm tra plan pending-only:

```powershell
python scripts/compile_worker_plan.py `
  --workflow workflows/example-local-free-pipeline.yaml `
  --output outputs/worker-plan.json
python scripts/validate_worker_plan.py --plan outputs/worker-plan.json
```

Các lệnh trên chỉ validate hoặc tạo metadata trong `outputs/`. Chúng không đọc nội dung `.env`, không gọi network, không spawn FFmpeg/Blender/ComfyUI và không publish.

## Kiểm tra native prerequisites

Chạy diagnostic từ root để xem Cargo/Rustup, active toolchain, `link.exe`, Visual Studio C++ workload, dung lượng C:/D: và các binary local. Script chỉ đọc trạng thái hệ thống; nó không cài đặt, không mở `.env`, không chạy FFmpeg/Blender và không gọi network:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check_windows_native.ps1
```

Nếu `msvcLinker=missing` hoặc `visualStudioWithCpp=missing`, hãy giải phóng đủ dung lượng C: rồi cài **Visual Studio Build Tools** với workload **Desktop development with C++** và **Windows 10/11 SDK**. Không truyền tham số installer không được tài liệu hỗ trợ và không xóa hàng loạt file để giải phóng đĩa. Sau khi cài xong, mở terminal mới để cập nhật PATH/Developer environment rồi chạy lại diagnostic.

## Frontend và native build

Frontend preview/build chạy trong `desktop/`:

```powershell
cd desktop
pnpm install
pnpm build
```

Đây chỉ xác nhận TypeScript/Vite bundle. Để chạy Tauri thật, máy cần MSVC C++ Build Tools, Windows SDK, Rust toolchain đúng target và WebView2:

```powershell
pnpm tauri info
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri dev
```

Hiện trạng repository vẫn ghi nhận native build bị chặn bởi `link.exe`/MSVC. Antigravity có thể chỉnh source và chạy static checks, nhưng không được tuyên bố native app đã launch chỉ vì frontend build thành công.

## Quy tắc security cho agent

Không đưa `.env`, API key, bearer token, private key, OS credential, cookie, production personal data hoặc nội dung secret vào prompt, terminal output, issue hay commit. Agent chỉ được kiểm tra `.env` có tồn tại hay không; không được mở hoặc in nội dung. Provider profile chỉ được lưu reference như `env:AUTO3DVIDEO_TTS_API_KEY`, không lưu giá trị thật.

Không dùng raw shell string, `cmd.exe /c`, PowerShell concatenation hoặc lệnh do prompt sinh trực tiếp để chạy worker. Process thật phải đi qua executable allowlist, structured args, normalized workspace-relative paths, timeout, cancellation, bounded logs và output validation. P0 chỉ có dry-run; worker thật chưa được bật.

Không tự động repost, scrape trái phép, dịch lại nội dung không có quyền, xóa watermark, giả mạo, bypass account/region, fake engagement hoặc publish. Mọi delivery phải qua rights, disclosure, privacy, budget, platform và human-review gates.

## Khi task bị lỗi hoặc bị chặn

Agent không được sửa bằng cách nới policy hoặc bỏ qua validator. Hãy ghi rõ:

| Trạng thái | Cách xử lý |
|---|---|
| `DONE` | Change và validator đã PASS; nêu giới hạn còn lại |
| `BLOCKED` | Nêu dependency thiếu và lệnh/hành động để unblock |
| `NEEDS_CLARIFICATION` | Câu hỏi cụ thể về scope, output, provider hoặc policy |
| `NEEDS_HUMAN_REVIEW` | Cần người duyệt rights, chi phí, nội dung, privacy hoặc publish |

Mọi report cuối phải có changed files, commands/tests, outputs, limitations, cost impact, rights/policy status và next action.

## Prompt mẫu cho Antigravity

```text
Bạn đang làm việc trong D:\Duancanhan\Auto3Dvideo.

Mục tiêu: thêm một validator semantic cho <contract>.
Phạm vi được phép sửa: <danh sách file>.
Bắt buộc giữ: vi-VN policy, no secrets, no network, no publish, no raw shell command.
Không được: đọc .env; chạy FFmpeg/Blender/ComfyUI; thay đổi file ngoài scope.
Kiểm thử: <commands>.
Hoàn tất khi: manifest, Markdown links, contract test và release evidence đều khớp kết quả thật.
Báo cáo cuối bằng tiếng Việt với status DONE/BLOCKED/NEEDS_CLARIFICATION/NEEDS_HUMAN_REVIEW.
```

## Ranh giới hiện tại

Antigravity giúp giảm ma sát khi điều phối task, nhưng chưa tạo ra worker runtime. Batch hiện tại đã có Tauri/React/Rust source, SQLite migrations, process dry-run, execution-attempt evidence, mock delivery, FFmpeg media plan, tool readiness và pending worker plan. Batch tiếp theo sau khi cài MSVC là live supervised Tokio worker, lease/heartbeat, process-tree cancellation, real FFmpeg probe/compose và integration tests.
