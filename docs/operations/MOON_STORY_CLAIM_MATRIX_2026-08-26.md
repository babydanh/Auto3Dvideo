# Claim matrix — Moon story pilot

## Phạm vi

Tài liệu này kiểm tra các câu thoại chính trong `outputs/moon-story-pilot/moon-story-subtitles.srt` và narration tương ứng. Mục tiêu là phân biệt claim đã có nguồn chính thức với phần minh họa đã được đơn giản hóa cho video dọc 30 giây. Pilot chỉ là sản phẩm kỹ thuật nội bộ; chưa phải chứng nhận nội dung giáo dục, pháp lý hay monetization.

## Ma trận claim

| ID | Claim trong pilot | Nguồn đối chiếu | Kết quả | Giới hạn khi diễn đạt |
|---|---|---|---|---|
| C1 | “Mặt Trăng vừa quay quanh Trái Đất, vừa quay quanh chính nó.” | NASA, *The Moon’s Rotation* [1] | **SUPPORTED** | Nên hiểu là Mặt Trăng có rotation trên trục và orbital motion quanh Trái Đất; không nên nói Mặt Trăng “đứng yên”. |
| C2 | “Hai chu kỳ ấy trùng nhau: đó là khóa thủy triều.” | NASA, *Tidal Locking* [2]; NASA, *The Moon’s Rotation* [1] | **SUPPORTED** | NASA mô tả thời gian spin và thời gian hoàn thành quỹ đạo là như nhau, gọi đây là synchronous tidal locking/synchronous rotation. Video dùng arrow minh họa, không phải mô phỏng lực và tiêu tán năng lượng định lượng. |
| C3 | “Mặt xa không phải mặt tối.” | NASA, *Top Moon Questions* [3] | **SUPPORTED** | “Far side” là phía thường không hướng về Trái Đất, còn “dark side” không phải một phía vĩnh viễn không có ánh sáng. |
| C4 | “Nó vẫn nhận ánh sáng Mặt Trời.” | NASA, *Top Moon Questions* [3] | **SUPPORTED** | Mặt xa có ngày và đêm như Mặt Trăng nói chung; lượng chiếu sáng trung bình không biến nó thành một vùng vĩnh viễn tối. Cảnh pilot chỉ là sơ đồ, không mô phỏng phase/ánh sáng thật theo ephemeris. |
| C5 | “Chúng ta luôn thấy một mặt của Mặt Trăng.” | NASA, *Tidal Locking* [2] | **SUPPORTED WITH SIMPLIFICATION** | Đây là cách nói phổ thông về cùng một mặt/hướng gần Trái Đất. Không nên diễn giải thành “chỉ nhìn thấy đúng 50% bề mặt trong mọi thời điểm”, vì libration cho phép quan sát dao động một phần quanh 50% theo thời gian. |

## Quyết định biên tập

Các claim C1–C4 có thể giữ trong pilot với nguồn NASA. C5 giữ được ở mức hook phổ thông nhưng phải giữ chú thích nội bộ “same face/hemisphere, simplified”; nếu nâng thành video giáo dục chính thức, nên thêm một dòng về libration hoặc thay lời thoại bằng “gần như luôn cùng một mặt hướng về chúng ta”.

Không được mô tả sản phẩm là mô phỏng khoa học chính xác theo tỷ lệ. Scene hiện dùng hình học, camera, material, orbit và helper arrows procedural để truyền đạt trực giác. Kích thước, khoảng cách, tốc độ và ánh sáng không được xem là scale/ephemeris thực tế.

## Review gates

| Gate | Trạng thái | Người duyệt |
|---|---|---|
| Claim/source review | Nguồn NASA đã đối chiếu; cần human editorial sign-off trước khi xuất bản | User/editor |
| Voice quality and pronunciation | Chưa có human listening approval | User |
| Visual motion continuity | Đã kiểm tra các frame mốc; chưa xem toàn bộ chuyển động theo thời gian thực | User |
| Rights/policy | Dùng preset VieNeu `Adam`, không reference audio, không clone người thật; TikTok chỉ là moodboard | User/editor |

## References

[1]: https://science.nasa.gov/resource/the-moons-rotation/ "NASA Science — The Moon's Rotation"

[2]: https://science.nasa.gov/moon/tidal-locking/ "NASA Science — Tidal Locking"

[3]: https://science.nasa.gov/moon/top-moon-questions/ "NASA Science — Top Moon Questions"
