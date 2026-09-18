# Nghiên cứu workflow 2.5D/3D infographic vũ trụ

## Findings ban đầu

Video TikTok reference có ngôn ngữ motion graphic/infographic vũ trụ: nền tối, Mặt Trời, quỹ đạo đồng tâm, hành tinh, tia tốc độ, chữ và narration. Mục tiêu phù hợp nhất cho Auto3Dvideo là tạo nội dung mới cùng ngôn ngữ hình ảnh bằng procedural scene, không sao chép video gốc.

Repository [kristinriebe/solarsystem-workshop](https://github.com/kristinriebe/solarsystem-workshop) trình bày cách tạo hành tinh, quỹ đạo và animation rotation bằng Blender Python. README nêu các file `create_planet.py`, `rings.py`, `planets.csv` và `animate_camera.py`; đây là tài liệu học/tham khảo có thể giúp thiết kế recipe procedural, nhưng mã cũ được kiểm thử quanh Blender 2.75 nên không nên bê nguyên vào Blender hiện đại. Cần kiểm tra license trước khi tái sử dụng code; phương án an toàn là tự viết recipe mới dựa trên ý tưởng kỹ thuật.

Tài liệu chính thức [Blender 5.2 LTS Grease Pencil](https://docs.blender.org/manual/en/latest/grease_pencil/introduction.html) mô tả Grease Pencil là object nhận stroke và đặt trong không gian 3D; có thể dùng cho traditional 2D, cut-out animation, motion graphics và storyboard. Tài liệu cũng ghi nhận stroke có thể được chỉnh sửa, gắn material, modifier, lighting và visual effects. Điều này xác nhận Blender có thể làm 2D/2.5D trong môi trường 3D, nhưng video infographic vũ trụ phù hợp hơn với mesh primitive + vật liệu emissive + camera keyframes, có thể kết hợp Grease Pencil cho nhãn/tia đồ họa.

## Quyết định tạm thời

Ưu tiên recipe Blender procedural tự viết: scene 9:16, camera orthographic hoặc perspective nhẹ, nền sao procedural, Sun emissive, planet sphere, orbit curves, rocket/marker đơn giản, keyframe cho camera và hành tinh, render PNG sequence, rồi FFmpeg ghép với VieNeu/SRT. Không cần model AI; model/texture ngoài chỉ là tùy chọn và phải có provenance/license.

## Quyền và giới hạn

Không lấy lại video TikTok/Douyin để repost hoặc “nâng cấp” nếu chưa có quyền. Có thể nhận file mà người dùng sở hữu hoặc asset có giấy phép rõ ràng, lưu hash/license/source, rồi chạy transform được phép. Không xóa watermark, không tách watermark, không clone giọng người khác và không tự đăng.

## Findings bổ sung

Repository [JacquesLucke/Blender-Camera-Addon](https://github.com/JacquesLucke/Blender-Camera-Addon) tập trung vào camera animations cho motion graphics, có Python 100%, nhiều commit/tag nhưng hoạt động chính được cập nhật gần nhất trên trang là năm 2020. Vì vậy nên xem như nguồn tham khảo camera path, không đưa thẳng vào sản phẩm nếu chưa kiểm tra tương thích Blender hiện đại và license.

Tài liệu chính thức [Blender Rendering Animations](https://docs.blender.org/manual/en/latest/render/output/animation.html) khuyến nghị frame sequence cho animation cần hậu kỳ, timing chính xác hoặc muốn có khả năng tiếp tục render; các frame PNG/JPG có thể đưa qua compositor/sequencer rồi nén thành video. Đây là cơ sở để Auto3Dvideo không render thẳng thành một movie file: recipe nên ghi PNG sequence vào thư mục job, kiểm tra frame count/size, sau đó dùng FFmpeg để ghép audio/SRT và FFprobe để xác nhận output.

## Kiến trúc rút ra

Recipe 2.5D nên tách bốn lớp: tạo scene procedural, render frame sequence, hậu kỳ/ghép audio, và evidence/provenance. Camera và object keyframes là dữ liệu có thể kiểm tra; mỗi asset cần source/license/hash; video TikTok reference chỉ là moodboard và không được làm input media mặc định.

## So sánh workflow code-generated

[Tài liệu Motion Canvas](https://motioncanvas.io/docs/) mô tả một thư viện TypeScript dùng generator để lập trình animation và một editor preview thời gian thực; công cụ được định hướng cho informative vector animations đồng bộ voice-over và là dự án free/open source. Đây là lựa chọn tốt cho motion graphic vector 2D, nhưng thêm runtime/editor mới vào ứng dụng hiện tại sẽ tăng phạm vi; chưa chọn cho recipe đầu tiên.

[Trang license của Remotion](https://www.remotion.dev/docs/license) xác nhận Remotion có trang license/terms riêng cho việc dùng thương mại, pricing và telemetry. Vì cần kiểm tra điều kiện thương mại trước khi dùng cho sản phẩm kiếm tiền, không chọn Remotion làm dependency mặc định trong bản local-first hiện tại; có thể nghiên cứu thêm ở một change riêng.

## Quyết định công cụ

Recipe đầu tiên dùng Pillow + FFmpeg procedural vì đã có trong project, chạy được trên máy hiện tại và không cần cài thêm model/runtime. Blender recipe được thiết kế làm nhánh nâng cấp khi Blender có mặt trong allowlist. Motion Canvas/Remotion chỉ được đưa vào catalog sau khi có quyết định license, packaging và test tương thích riêng.

## License review

File header của [JacquesLucke/Blender-Camera-Addon `__init__.py`](https://github.com/JacquesLucke/Blender-Camera-Addon/blob/master/__init__.py) ghi GNU GPL version 3 hoặc bản sau. Vì vậy không đưa add-on này vào core Auto3Dvideo ở change hiện tại; chỉ học ý tưởng camera target/path và tự viết code tương thích. Nếu sau này tích hợp hoặc phân phối derivative, phải có review license riêng và giữ notice/nghĩa vụ tương ứng.

License của `kristinriebe/solarsystem-workshop` chưa được xác nhận rõ trên trang repository đã xem, nên cũng chỉ dùng làm tài liệu tham khảo, không copy code/assets vào sản phẩm.
