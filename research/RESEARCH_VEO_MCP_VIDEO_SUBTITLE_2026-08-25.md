# Nghiên cứu Veo MCP và video-to-subtitle — 2026-08-25

## Phạm vi

Người dùng hỏi liệu có thể làm MCP cho Veo và dùng video để sinh ngôn ngữ/phụ đề hay không. Phân tích chỉ đọc tài liệu công khai; không tải hoặc tái sử dụng video TikTok/YouTube không được người dùng cung cấp quyền.

## Findings

1. Google có Gemini API programmatic cho Veo. Tài liệu Veo mô tả request tạo video bất đồng bộ, trả operation rồi poll đến khi `done=true`. Các tham số gồm prompt, ảnh đầu vào, last frame, reference images tùy model, aspect ratio `16:9`/`9:16`, duration, person generation và resolution. Đây là API trực tiếp, không phải MCP Veo chính thức.

2. Gemini API có video understanding qua Interactions API. Có thể upload file qua Files API, truyền inline video nhỏ hoặc một số URL được tài liệu hỗ trợ, sau đó yêu cầu model mô tả, phân đoạn, hỏi đáp, lấy insight và tham chiếu timestamp. Tài liệu khuyến nghị Files API cho file lớn/tái sử dụng; inline phù hợp file nhỏ. Kết quả model có thể dùng để tạo transcript có timestamp nhưng không nên coi là phụ đề cuối nếu chưa căn chỉnh/kiểm tra bằng STT và người review.

3. Google có public Gemini Docs MCP tại `https://gemini-api-docs-mcp.dev`, nhưng tài liệu chính thức mô tả đây là MCP để tra cứu tài liệu/API definitions cho coding agent, không phải server expose tool tạo video Veo. Không tìm thấy match Veo trong connector config hiện tại.

4. Có repo MCP Veo bên thứ ba trên GitHub, ví dụ `alohc/veo-mcp-server`; README mô tả wrapper expose text-to-video, image-to-video, video extension và styled generation. Đây là code bên thứ ba, không phải xác nhận chính thức của Google và chưa được cài/chạy.

## Kiến trúc đề xuất

- Veo: ưu tiên native Google Gemini API adapter trong Rust/backend boundary, key chỉ từ OS/env secret reference, job bất đồng bộ có timeout/poll/retry bounded, lưu operation metadata và cost estimate; chỉ sau đó mới bọc thành MCP server nội bộ nếu cần cho agent.
- MCP: nếu thật sự cần agent gọi, expose tool hẹp `veo_create_video`, `veo_get_operation`, `veo_download_result` sau rights/cost approval. Không expose raw HTTP, arbitrary URL, cookie, auto-publish hay download social.
- Video-to-subtitle: local-first chạy FFmpeg probe → local Whisper/STT nếu có → SRT draft → optional Gemini video understanding cho segment/translation/claim review → align/validate SRT → human review → burn-in/mux. Video input phải là file người dùng sở hữu/được phép xử lý.
- Dịch phụ đề: giữ `source.srt`, `translated.srt`, locale, model, timestamps, confidence và review state; không tự ghi đè phụ đề gốc.

## Giới hạn/quyền

Veo API cần API key/billing/quyền model theo tài khoản và khu vực; Google AI Studio web benefits không mặc nhiên là API quota. Video understanding/API call có thể phát sinh phí theo model/tier; không gọi API trong nghiên cứu này. Không gọi video TikTok người dùng gửi cho pipeline; chỉ phân tích tham khảo. Output tạo bằng Veo hoặc dịch phụ đề vẫn cần kiểm tra rights, claim, AI disclosure, platform và chất lượng.

## Sources

- https://ai.google.dev/gemini-api/docs/veo — Google Veo API guide.
- https://ai.google.dev/gemini-api/docs/video-understanding — Google Gemini video understanding guide.
- https://ai.google.dev/gemini-api/docs/coding-agents — Google Gemini Docs MCP guide.
- https://github.com/alohc/veo-mcp-server — third-party Veo MCP reference, not official Google.


## Pricing/config check

Trang pricing chính thức của Gemini API tách Free, Paid và Enterprise; Free có giới hạn model/quota, còn các tính năng/model nâng cao có thể yêu cầu Paid. Không dùng Google AI Pro web benefit để suy ra API quota. Không có connector/config Veo trong session hiện tại (`manus-config config load --search veo` không tìm thấy match), và không gọi Veo API trong lần nghiên cứu này.
