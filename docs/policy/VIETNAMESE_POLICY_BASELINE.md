# Vietnamese Policy Baseline

## Mục đích

Tài liệu này định nghĩa các quy tắc vận hành mặc định bằng tiếng Việt cho Auto3Dvideo. Đây là **hàng rào kỹ thuật và quy trình nội bộ**, không phải tư vấn pháp lý và không thay thế việc kiểm tra luật, điều khoản nền tảng hoặc hợp đồng tại thời điểm sử dụng.

## Nguyên tắc mặc định

Auto3Dvideo ưu tiên nội dung do người dùng sở hữu hoặc có quyền sử dụng rõ ràng. Ứng dụng không tự động tải lại, dịch, lồng tiếng, xóa watermark, vượt giới hạn tài khoản hoặc đăng lại video của bên thứ ba. Việc một file có thể tải xuống không chứng minh người dùng có quyền thương mại hoặc quyền phái sinh.

Mọi asset hình ảnh, video, âm thanh, nhạc, font, logo, nhân vật, khuôn mặt và giọng nói phải có trạng thái quyền riêng. Nếu chưa có bằng chứng phù hợp, asset ở trạng thái `rights_pending` và job delivery bị chặn.

## Voice, face và likeness

Không dùng giọng nói, khuôn mặt hoặc đặc điểm nhận diện của người khác nếu chưa có sự cho phép phù hợp. Voice cloning và likeness transformation phải có người duyệt, nguồn bằng chứng, phạm vi sử dụng, lãnh thổ, thời hạn và nền tảng được phép. Việc chọn một giọng “giống” người nổi tiếng không được xem là an toàn mặc định.

## Nội dung AI và minh bạch

Khi nền tảng hoặc bối cảnh yêu cầu gắn nhãn nội dung AI hoặc nội dung được biến đổi đáng kể, ứng dụng phải tạo một quyết định disclosure trong review record. App không tự tuyên bố video chắc chắn đủ điều kiện kiếm tiền hoặc chắc chắn được nền tảng chấp thuận.

## Chi phí và API

API cloud, TTS trả phí, video generation, model hosting và dịch vụ có quota phải có profile riêng, estimate, giới hạn ngân sách và receipt. `.env` chỉ chứa endpoint/model reference hoặc credential do người dùng tự cấu hình; không ghi secret vào workflow, database, log, screenshot hoặc delivery package.

## Dữ liệu cá nhân và screen capture

Screen/browser capture phải có mục tiêu, viewport, audio source và privacy review. Trước khi capture, người dùng cần đóng hoặc che thông tin tài khoản, token, email, tài liệu riêng, thông báo hệ thống và dữ liệu cá nhân không cần thiết. Auto3Dvideo không upload capture tự động trong MVP.

## Publish gate

Publishing mặc định là `blocked`. Delivery package chỉ là output đã qua kiểm tra kỹ thuật; người dùng vẫn phải tự kiểm tra quyền, nội dung, accessibility, disclosure, điều khoản nền tảng, thông tin thương mại và quyết định đăng. Không có job thành công nào tự biến thành cam kết “được monetization”.

## Việt Nam và nền tảng

Đối với nội dung phát hành từ Việt Nam hoặc nhắm tới người dùng Việt Nam, cần kiểm tra riêng các yêu cầu hiện hành về bản quyền, quyền nhân thân, quyền hình ảnh/giọng nói, dữ liệu cá nhân, quảng cáo, thương mại điện tử và quy định của từng nền tảng. Không hard-code một kết luận pháp lý chung vào phần mềm; policy profile phải có ngày rà soát, nguồn tham chiếu và người chịu trách nhiệm.

## Quy tắc thực thi trong app

| Gate | Nếu chưa đạt | Hành động |
|---|---|---|
| Quyền asset | Không có proof hoặc phạm vi không rõ | Chặn generation/delivery |
| Voice/likeness | Chưa có permission record | Chặn TTS/cloning |
| AI disclosure | Chưa quyết định khi cần | Chặn delivery platform variant |
| Budget | Không có estimate hoặc vượt hạn mức | Chặn provider call |
| Privacy capture | Chưa review mục tiêu capture | Chặn screen/browser capture |
| Human review | Chưa duyệt preview | Không xuất delivery cuối |
| Publish | Luôn blocked trong MVP | Chỉ tạo package để người dùng kiểm tra |

## Ngôn ngữ giao diện

Locale mặc định là `vi-VN`. Backend trả về error code ổn định; UI dịch code thành tiếng Việt. Tên field kỹ thuật, provider ID, model ID, file path và command có thể giữ nguyên tiếng Anh để tương thích, nhưng label, helper text, cảnh báo, checklist và review state phải có bản tiếng Việt.

## References

Các tài liệu nền tảng, provider và công cụ được lập chỉ mục tại [`research/RESEARCH_SOURCES.md`](../../research/RESEARCH_SOURCES.md). Nguồn có thể thay đổi; phải rà soát lại trước khi phát hành hoặc bật provider/publish adapter.
