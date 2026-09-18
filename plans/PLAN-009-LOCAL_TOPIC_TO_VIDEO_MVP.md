# Kế hoạch 009 — MVP video cục bộ từ chủ đề

## Mục tiêu

Hoàn thiện một đường chạy dọc, cục bộ và có thể kiểm chứng trên Windows: người dùng nhập chủ đề trong Topic Studio, xem trước brief và prompt, duyệt nội dung, tạo kịch bản có cấu trúc bằng Command Code local, tạo cảnh minh họa xác định bằng SVG/HTML, tạo giọng đọc bằng VieNeu-TTS local, tạo phụ đề đơn giản, ghép thành tệp MP4 bằng FFmpeg, rồi ghi bằng chứng và trạng thái vào workspace/SQLite.

MVP này không cố giải quyết mọi loại video cùng lúc. Nó ưu tiên video giải thích dọc 9:16, thời lượng ngắn, không phụ thuộc tài sản bên ngoài và không cài thêm phần mềm mới. Sau khi đường chạy này đạt nghiệm thu, có thể mở rộng sang ảnh có giấy phép, ComfyUI, Blender, quay màn hình và nhà cung cấp video đám mây.

## Hai hướng khả thi

| Hướng | Đánh đổi | Chi phí | Độ phức tạp |
|---|---|---:|---:|
| **A. Cục bộ xác định: SVG/HTML + VieNeu + FFmpeg** | Ít đẹp như video AI, nhưng không cần thêm dịch vụ, dễ kiểm tra, dễ tái lập và không phụ thuộc giấy phép tài sản ngoài | Không phát sinh phí dịch vụ; dùng CPU/thời gian máy | Trung bình |
| **B. ComfyUI/Blender ngay từ đầu** | Có thể tạo hình và 3D phong phú hơn, nhưng cần cài/kiểm tra GPU, model, workflow và giấy phép; lỗi khó chẩn đoán hơn | Có thể không tốn API nhưng cần tài nguyên máy; model có thể có điều khoản riêng | Cao |

MVP chọn **Hướng A** trước. Hướng B chỉ được mở sau khi người dùng có cài đặt và chấp thuận rõ ràng cho từng công cụ/model.

## Phạm vi được làm

1. Chuẩn hóa dữ liệu đầu vào từ Project và Topic Studio.
2. Tạo `brief.json`, `script.json`, `shot-plan.json` và `timeline.json` trong workspace.
3. Gọi Command Code local bằng một worker có allowlist URL/model, giới hạn độ dài, timeout, thử lại tối đa một lần, không truyền khóa qua tham số và không lưu khóa.
4. Bắt buộc kiểm tra phản hồi JSON; nếu sai định dạng thì dừng, không tự đoán thành công.
5. Cho người dùng xem và duyệt script trước khi tạo âm thanh/video.
6. Tạo cảnh hình học, biểu đồ hoặc chữ bằng SVG/HTML xác định; không dùng ảnh ngẫu nhiên và không giả nhận đó là tài sản có bản quyền.
7. Chạy VieNeu-TTS qua worker allowlist; kiểm tra WAV, tần số mẫu, số kênh, thời lượng và kích thước.
8. Tạo phụ đề SRT theo các đoạn narration đã được duyệt; ghi rõ đây là timing ước tính nếu chưa có căn chỉnh âm vị.
9. Chạy FFmpeg bằng mảng tham số cố định do Rust tạo, không qua shell và không nối chuỗi lệnh từ nội dung người dùng.
10. Kiểm tra MP4 bằng FFprobe, hash đầu ra, ghi manifest, nhật ký, attempt và trạng thái review.
11. Thêm nút `Tạo video cục bộ` sau bước duyệt; các bước nguy hiểm vẫn có cổng xác nhận.

## Ngoài phạm vi MVP

MVP không tự lấy video từ TikTok/Douyin, không scraping, không đăng bài, không xử lý cookie/mật khẩu, không xóa watermark, không dùng giọng/diện mạo người khác, không gọi API video đám mây, không tự chọn tài sản có giấy phép không rõ ràng, không cài ComfyUI/Blender/model mới và không tuyên bố video đã đủ điều kiện kiếm tiền hoặc phát hành.

## Trạng thái và cổng

```text
draft
  → preview_ready
  → script_pending
  → script_ready
  → human_script_approved
  → audio_pending
  → audio_ready
  → render_pending
  → rendered
  → human_delivery_approved
  → delivered
```

Mỗi bước lỗi chuyển sang `blocked`, `retryable` hoặc `failed` có nguyên nhân. Không được coi `mock`, HTTP 200 của bước chat hay process exit code riêng lẻ là video thành công. `human_script_approved` và `human_delivery_approved` là các quyết định của người dùng, không tự suy ra.

## Hợp đồng đầu ra tối thiểu

| Tệp | Nội dung bắt buộc |
|---|---|
| `brief.json` | Chủ đề, ngôn ngữ, mục tiêu, thời lượng, tỷ lệ, profile, prompt/template version |
| `script.json` | Tiêu đề, đoạn narration, chữ trên màn hình, claim/source status, thời lượng dự kiến |
| `shot-plan.json` | Cảnh theo thứ tự, visual intent, entity anchors, màu, thời lượng và đường dẫn cảnh |
| `narration.wav` | WAV hợp lệ do VieNeu tạo cục bộ |
| `captions.srt` | Phụ đề UTF-8, timeline không chồng lấn |
| `master.mp4` | MP4 đọc được, video dọc, có audio, duration trong sai số cho phép |
| `manifest.json` | Hash, kích thước, codec/stream, phiên bản worker, trạng thái rights/review |

## Tiêu chí nghiệm thu

- Với một chủ đề tiếng Việt ngắn, app tạo được workspace output hoàn chỉnh mà không cần API video, ComfyUI hoặc Blender.
- Khi Command Code không khả dụng, app dừng ở bước script với lỗi hành động được; không tạo video giả.
- Khi VieNeu lỗi, app giữ lại script và không đánh dấu delivery thành công.
- Khi FFmpeg/FFprobe thiếu hoặc lỗi, app ghi attempt thất bại và không xóa output trước đó.
- Có thể mở lại app và xem job, attempt, output evidence, chi phí và quyết định duyệt.
- Không có API key, token, cookie hoặc nội dung nhạy cảm nằm trong args, log, SQLite payload hay manifest.
- Có test cho happy path, provider lỗi, JSON sai, timeout, hủy, output thiếu, path traversal và khởi động lại.

## Thứ tự triển khai

1. Contract và trạng thái pipeline.
2. Worker script Command Code có input cấu trúc và kết quả JSON đã kiểm tra.
3. Bộ tạo SVG/HTML xác định.
4. Adapter VieNeu và SRT.
5. Bộ ghép FFmpeg/FFprobe.
6. Job graph và attempt durable.
7. UI duyệt script, tạo video và xem output.
8. Kiểm thử Windows, validator, tài liệu và pilot.

## Quyền, chi phí và chính sách

Đường chạy đầu tiên chỉ dùng nội dung do người dùng nhập, SVG/HTML do ứng dụng tạo, VieNeu local và FFmpeg local. Chi phí dịch vụ được ghi là `local_gateway_unreported` khi đi qua gateway; không tuyên bố miễn phí chỉ vì tên model có chữ `free`. Người dùng vẫn phải duyệt claim, nguồn, giọng đọc, phụ đề, công bố AI và quyền sử dụng trước khi bàn giao. Không có bước tự động đăng bài.

## Bàn giao

Bản hoàn thành phải kèm tệp MP4 kiểm thử, WAV, SRT, manifest, log bằng chứng đã lọc, ảnh chụp UI nếu cần, kết quả validator và báo cáo giới hạn. Không kèm `.env`, khóa, database cá nhân hoặc dữ liệu riêng tư.
