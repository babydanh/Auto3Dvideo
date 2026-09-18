# Auto3Dvideo — UX và hành vi bắt buộc

Tài liệu này là chuẩn làm việc cho mọi thay đổi giao diện và luồng thao tác của Auto3Dvideo.

## Bản đồ skill của agent

Danh sách skill, file nguồn, trạng thái chạy thật và phần còn thiếu nằm ở [`docs/operations/AGENT_SKILL_MAP.md`](docs/operations/AGENT_SKILL_MAP.md). Đây là chỗ kiểm tra chung trước khi thêm hoặc sửa workflow Blender, chủ đề, prompt ảnh, asset hay provider.

## 1. Quy tắc không có nút im lặng

Mọi `button` phải trả lời được ngay ba câu hỏi:

1. Tôi vừa bấm thao tác gì?
2. Ứng dụng đang làm đến đâu và có đang chờ không?
3. Kết quả là thành công, thất bại hay bị chặn vì điều kiện nào?

Không thêm button chỉ đổi state nội bộ mà không có thông báo cho người dùng.

Button chạy tác vụ phải:

- hiển thị trạng thái đang chạy (`Đang ...` hoặc `Đang xử lý ...`);
- có spinner hoặc dấu hiệu loading ngay sau khi bấm;
- khóa trong lúc đang chạy để chống bấm lặp;
- hiển thị kết quả thành công hoặc lỗi có nguyên nhân;
- ghi bước quan trọng vào `WORKSPACE / LIVE ACTIVITY` nếu tác vụ có nhiều bước;
- không báo thành công nếu backend chưa thật sự hoàn tất.

Button bị khóa phải có lý do nhìn thấy được gần button hoặc trong thông báo, ví dụ: `Cần chọn project`, `Chưa kết nối Chrome`, `Thiếu FFmpeg`.

## 2. Chuẩn feedback chung

Giao diện dùng một lớp feedback chung ở đầu workspace:

- `running`: đang làm, có animation;
- `success`: hoàn tất;
- `error`: thất bại hoặc bị chặn;
- `info`: cần người dùng nhập/chọn/duyệt.

Feedback phải dùng tiếng Việt dễ hiểu, tránh chỉ hiển thị mã state như `prepared`, `awaiting_import`, `Detached`.

Nếu tác vụ kéo dài, thông báo phải nêu bước hiện tại, ví dụ:

```text
[1/5] Kiểm tra project và shot plan
[2/5] Đang dựng scene Blender
[3/5] Đang render frame 1–900
[4/5] Đang kiểm tra MP4 bằng FFprobe
[5/5] Hoàn tất — mở preview để xem
```

## 3. Nút điều hướng và nút thao tác

Nút điều hướng chỉ cần chuyển màn hình nhưng vẫn phải có phản hồi nhẹ, không được làm người dùng tưởng app không nhận lệnh.

Nút thao tác native/backend phải bắt lỗi và đưa lỗi vào feedback chung. Không nuốt lỗi bằng `catch {}` rỗng.

Không dùng `alert` cho trạng thái bình thường. Dùng workspace notice, activity log hoặc kết quả ngay cạnh button. Chỉ hỏi xác nhận khi hành động có network, chi phí, ghi đè, import hoặc side effect.

## 4. Browser Handoff

Browser Handoff là **Connection Center**, chỉ có nhiệm vụ:

- kiểm tra Chrome/BrowserMCP đã Connect;
- hiển thị rõ `ĐÃ KẾT NỐI`, `CHƯA KẾT NỐI`, `ĐANG KIỂM TRA`;
- tự kiểm tra một lần khi mở trang;
- có một nút kiểm tra lại và thông báo kết quả.

Không đặt asset picker, prompt editor, handoff ID, approval gate, upload/import candidate trong Connection Center.

Asset Blender, shot prompt, handoff pack và activity thuộc `Quy trình video`. Khi BrowserMCP không có capability upload/download, phải báo đúng một bước người dùng cần làm; không giả lập thành công.

## 5. Workspace log

`WORKSPACE / LIVE ACTIVITY` phải mô tả việc thật đang xảy ra, không lặp câu chung chung. Mỗi log nên có:

- thời gian;
- bước hiện tại / tổng bước nếu biết;
- tool đang chạy (`Blender`, `FFmpeg`, `FFprobe`, `BrowserMCP`);
- output hoặc nguyên nhân lỗi;
- thời lượng khi hoàn tất nếu có.

Không ghi cookie, token, API key, password, prompt chứa bí mật hoặc raw command vào log.

## 6. Khi thêm tính năng mới

Trước khi hoàn tất thay đổi, phải kiểm tra:

- button có feedback lúc bắt đầu và kết thúc;
- loading có khóa chống spam;
- failure path có thông báo dễ hiểu;
- output thật sự tồn tại và được validate;
- build/typecheck và test liên quan đã chạy;
- tài liệu kế hoạch/contract/runbook được cập nhật nếu thay đổi state hoặc capability.

Nếu không thể tự động hóa vì giới hạn tool/provider, ghi rõ giới hạn ngay tại điểm người dùng cần biết. Không dùng chữ `hoàn tất`, `đã render`, `đã upload` khi chỉ mới tạo request hoặc mock state.

## 7. Skill voice emotion planner dùng chung cho workflow

Mọi workflow có lời dẫn phải chạy qua skill `voice_emotion_planner` trước khi gọi TTS. Skill này biến nhịp kể chuyện thành kế hoạch giọng có thể kiểm tra được; nó không được tự ý bịa cú pháp riêng cho từng provider.

### Mã cảm xúc được phép

Chỉ dùng các `emotionCode` sau, viết thường trong JSON/manifest:

```text
neutral, calm, warm, friendly, happy, excited, joyful, triumphant,
sad, melancholic, tender, concerned, fearful, angry, shouting, urgent,
serious, surprised, mysterious, curious, sarcastic, whisper
```

Quy tắc bắt buộc:

- Mỗi segment phải có đúng một `emotionCode`; mặc định là `neutral` nếu cảnh chưa có lý do rõ ràng để đổi giọng.
- Chỉ đổi cảm xúc khi beat kể chuyện, hành động hoặc thông tin trong câu thật sự đổi. Không xen kẽ cảm xúc ngẫu nhiên.
- Có thể dùng tag nội dòng như `[EXCITED] ... [SHOUTING] ...` khi một segment cần chuyển cảm xúc; tag phải dùng đúng mã trong danh sách và được đặt ngoài nội dung chữ hiển thị.
- Không đưa tag cảm xúc vào `onScreenText`, subtitle, visual prompt, Blender prompt hoặc prompt ảnh. Subtitle phải lấy từ lời sạch sau khi bỏ tag.
- Prompt/manifest phải giữ lại `emotionCode` theo từng segment để TTS, alignment và review dùng cùng một nguồn; không để model TTS tự đoán cảm xúc im lặng.
- Nếu provider chỉ hỗ trợ cue gần đúng, phải ghi rõ fallback/capability trong voice manifest; không tuyên bố là đã điều khiển cảm xúc native.
- `emotionCode` mô tả cách đọc, không thay thế đạo diễn hình ảnh. Visual prompt vẫn phải mô tả hành động, camera, ánh sáng và continuity tương ứng với nhịp cảm xúc.
- Audio phải được nghe duyệt. Khi chưa có timing thật từ STT/forced alignment, subtitle chỉ là draft và không được gọi là khóa đúng từng frame.
