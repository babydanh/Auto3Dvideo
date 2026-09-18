# PLAN-018 — True 3D Storytelling + Authorized Voice Pilot

## Mục tiêu pilot

Tạo một video dọc 9:16 dài khoảng 30 giây có **true 3D Blender**, chuỗi shot liên tục và lời kể tiếng Việt tự nhiên. Video phải giống một mini-documentary cinematic có mở bài, diễn biến, reveal và kết luận; không dùng slideshow ảnh đứng, card HTML hoặc pseudo-3D để tuyên bố là video 3D thật.

TikTok/Douyin/YouTube chỉ được dùng làm moodboard về nhịp dựng, camera, màu sắc và cách kể. Không tải, scrape, tháo watermark, lấy footage, sao chép shot-by-shot hoặc bắt chước creator. Mọi asset render sẽ do Blender dựng/procedural hoặc có provenance rõ ràng.

## Concept đề xuất

**Tiêu đề làm việc:** “Vì sao chúng ta luôn thấy một mặt của Mặt Trăng?”

**Câu chuyện:** Người xem bắt đầu bằng một điều tưởng như nghịch lý: Mặt Trăng vừa quay quanh Trái Đất vừa quay quanh chính nó, nhưng từ Trái Đất ta gần như luôn thấy cùng một mặt. Video dùng một vệ tinh camera hư cấu làm nhân vật quan sát, bay vòng quanh hệ Trái Đất–Mặt Trăng; camera lần lượt chứng minh chuyển động, mô phỏng lực thủy triều ở mức trực quan và kết thúc bằng reveal “không phải mặt tối, mà là mặt xa”. Đây là chủ đề phù hợp để chứng minh event graph và continuity vì cùng một hệ vật thể xuất hiện trong toàn bộ shot.

| Thuộc tính | Quyết định pilot |
| --- | --- |
| Audience | Người xem TikTok phổ thông, không cần nền tảng thiên văn |
| Promise | Giải thích nghịch lý bằng hình ảnh 3D dễ kiểm tra, không giật tít |
| Format | Dọc 1080×1920, 30 fps, 25–35 giây |
| Visual mode | True 3D cinematic, stylized-realistic space, camera chuyển động có mục đích |
| Palette | Đen xanh sâu, Trái Đất xanh lam, Mặt Trăng xám bạc, accent vàng ấm cho quỹ đạo/lực |
| Audio | Voice nam tiếng Việt, documentary nhưng có nhấn ở hook/reveal; SFX space nhẹ, không lấn lời |
| Text | Chỉ overlay deterministic ở bước dựng cuối; không nhờ video model render chữ chính xác |
| Rights | Blender/procedural assets hoặc asset có license; không dùng footage TikTok |

## Storyboard event-based

| Shot | Thời lượng | Mục tiêu kể chuyện | Hành động 3D bắt buộc | Camera/âm thanh | Acceptance |
| ---: | ---: | --- | --- | --- | --- |
| 01 | 0–4s | Hook: “Bạn có thấy Mặt Trăng luôn đứng yên không?” | Trái Đất quay nhẹ, Mặt Trăng nằm bên phải, vệ tinh hư cấu lướt qua foreground | Push-in chậm, bass hit rất nhẹ, voice vào ngay frame đầu | Không có object ngẫu nhiên; silhouette đọc được trên mobile |
| 02 | 4–9s | Chứng minh Mặt Trăng đang orbit | Camera orbit theo vệ tinh; Mặt Trăng di chuyển quanh Trái Đất, texture marker ở mặt gần vẫn hướng về Trái Đất | Orbit camera 120°, SFX whoosh nhỏ | Quỹ đạo, hướng camera và identity anchor không nhảy |
| 03 | 9–14s | Chứng minh Mặt Trăng cũng spin | Tách visual trail của Mặt Trăng: một vòng quay quanh trục trong cùng thời gian một vòng orbit | Camera side-profile, accent line vàng; không dùng chữ trong render | Viewer thấy cùng một landmark quay đúng 1 vòng |
| 04 | 14–20s | Giải thích khóa thủy triều ở mức trực quan | Cutaway stylized: bulge thủy triều và mũi tên torque làm giảm tốc quay; không giả vờ là mô phỏng khoa học đầy đủ | Macro dolly-in, low rumble, nhịp voice chậm lại | Đánh dấu đây là minh họa trực quan, không hiển thị số liệu chưa kiểm chứng |
| 05 | 20–26s | Reveal: mặt xa không phải mặt tối | Camera vượt ra phía sau Mặt Trăng, sunlight vẫn chiếu vào bề mặt; vệ tinh nhìn thấy far side | Arc shot qua terminator, music mở rộng | Lighting phải chứng minh mặt xa vẫn được chiếu sáng |
| 06 | 26–32s | Kết luận và memory hook | Trái Đất–Mặt Trăng thu nhỏ thành composition đẹp; mặt gần hướng về Trái Đất, far side được silhouette hóa | Pull-out, resolve chord, voice kết luận | End frame sạch, không logo/CTA giả; overlay thêm sau bằng editor |

## World bible

Thế giới gồm một Trái Đất, một Mặt Trăng, một vệ tinh quan sát hư cấu, một nguồn sáng Mặt Trời ngoài khung và các đường quỹ đạo/torque dạng geometry phụ trợ. Trái Đất và Mặt Trăng là persistent entities, có ID và identity anchors cố định qua toàn bộ shot. Vệ tinh chỉ là camera-story device, không được biến thành nhân vật ngẫu nhiên hoặc đổi hình dạng giữa cảnh.

Blender scene sẽ dùng một collection cho celestial bodies, một collection cho camera helpers và một collection cho explanatory overlays. Scale được ghi rõ theo “not-to-scale educational visualization” nếu không mô phỏng đúng tỷ lệ; khoảng cách và kích thước màn hình được ưu tiên để người xem đọc được chuyển động. Lighting dùng key sunlight giả lập, rim nhẹ cho silhouette và world background xanh đen; không dùng volumetric quá dày làm mất silhouette.

Negative constraints gồm: không thêm phi hành gia người thật, không logo thương hiệu, không spaceship phức tạp không phục vụ story, không chữ AI-generated, không đổi material giữa shot, không để Mặt Trăng trượt sai hướng, không để mặt xa bị hiểu là luôn tối và không dùng random stock imagery để lấp thời lượng.

## Voice plan

Bản pilot mặc định dùng **giọng nam tiếng Việt được cấp phép trong Voice Studio**, preset local hiện có, không clone người thật. Voice director instruction phải tách khỏi spoken text theo dạng tiếng Anh trước dấu hai chấm; phần sau dấu hai chấm là tiếng Việt được đọc. Ví dụ:

```text
Speak Vietnamese with a warm, clear male documentary voice, curious in the hook, calm during the explanation, and slightly brighter on the final reveal: Có một điều rất lạ về Mặt Trăng...
```

Script không dùng giọng creator TikTok hoặc giọng người thật khác nếu chưa có consent record. Nếu người dùng muốn clone **giọng của chính mình hoặc người đã cho phép**, phải có reference audio nằm trong workspace, record consent, cloneEnabled=true và cloneConsent=true; nếu thiếu một trong các điều kiện đó, workflow dùng preset voice hoặc bị chặn. Không dùng pitch shifting/AI label để thay thế consent.

Voice cues nên ngắn và có mục đích, chẳng hạn `[hắng giọng]` trước hook nếu cần và `[ngắt ngắn]` trước reveal nếu engine hỗ trợ. Không đưa tính từ cảm xúc như `[excited]` vào spoken text nếu engine có thể đọc thành tiếng; cảm xúc chính nằm trong director instruction. Audio phải được nghe lại, kiểm tra phát âm “thủy triều”, “quỹ đạo”, “Mặt Trăng” và duyệt trước khi ghép final.

## Script nháp 30 giây

```text
Có một điều rất lạ: Mặt Trăng luôn quay quanh Trái Đất, nhưng chúng ta gần như chỉ thấy một mặt của nó.

Thật ra, Mặt Trăng cũng quay quanh chính mình. Thời gian nó tự quay vừa đúng bằng thời gian nó đi hết một vòng quanh Trái Đất.

Qua hàng tỉ năm, lực thủy triều đã làm chuyển động này khóa lại. Vì thế, mặt gần luôn hướng về chúng ta.

Nhưng đó không phải “mặt tối”. Khi Mặt Trời chiếu từ phía bên kia, mặt xa của Mặt Trăng vẫn sáng. Chúng ta chỉ gọi nó là mặt xa.
```

Script này là bản nháp cần đối chiếu claim trước khi đưa vào narration final. Claim về synchronous rotation, tidal locking và far side phải có nguồn được duyệt trong claim matrix; nếu chưa có evidence, narration ghi `NEEDS_REVIEW` thay vì nói chắc chắn.

## Pipeline thực thi trong Auto3Dvideo

1. **Brief và claim matrix:** nhập topic vào profile `cinematic-3d`, tạo claim list và review nguồn thiên văn. TikTok chỉ ghi ở moodboard, không đưa thành input asset.
2. **World bible và entity anchors:** khóa Trái Đất, Mặt Trăng, vệ tinh, palette, lighting, camera language, scale convention và negative constraints.
3. **Shot plan:** biên dịch 6 shot trên thành narrative visual plan; mỗi shot có narration span, visual proof, expected asset, continuity anchor và review state.
4. **Blender blocking:** tạo camera, body geometry, orbit animation và landmark marker; render preview thấp trước để kiểm tra event order và camera continuity.
5. **Lookdev:** thêm material, lighting, background, orbit trails và stylized tidal visualization; không thêm detail chỉ để làm cảnh đẹp nhưng không phục vụ câu chuyện.
6. **Voice preview:** tạo WAV từng đoạn hoặc một bản narration local qua Voice Studio; nghe và duyệt phát âm, cảm xúc, nhịp. Không chạy clone nếu chưa có consent.
7. **Timing pass:** điều chỉnh frame range theo voice thực tế; không ép TTS phải khớp tuyệt đối bằng prompt vì duration TTS không deterministic.
8. **Final Blender render:** render từng shot hoặc image sequence vào thư mục version mới; kiểm tra frame count, dimensions, codec/output và continuity.
9. **Compose:** dùng FFmpeg hoặc editor local để nối shot, mix voice/SFX, thêm subtitle/overlay deterministic và xuất MP4 1080×1920.
10. **Review gate:** kiểm tra factual claims, 3D continuity, motion, audio, subtitle readability, rights/provenance, AI disclosure và platform policy. Chỉ sau gate này mới cân nhắc Web Handoff polish; không tự upload/publish.

## Gate và tiêu chí pass

| Gate | Pass condition | Block condition |
| --- | --- | --- |
| Story | Có hook, causal sequence, reveal và kết luận trong 25–35s | Shot đẹp nhưng không có event order hoặc continuity |
| True 3D | Geometry, camera, lighting, animation đều từ Blender render | Card HTML, ảnh đứng, parallax giả bị trình bày như true 3D |
| Voice | Giọng preset/clone có quyền, phát âm rõ, nghe đã duyệt | Clone creator TikTok hoặc sample thiếu consent |
| Claims | Mỗi câu factual có source/evidence hoặc đánh dấu review | Claim chưa kiểm chứng được đọc như sự thật |
| Continuity | Entity anchors, orbit direction, landmark và palette giữ ổn định | Mặt gần đổi hướng, scale/camera nhảy, thêm object vô cớ |
| Delivery | MP4 probe được, subtitle deterministic, hash/provenance lưu | Output rỗng, overwrite, thiếu provenance hoặc chưa review |

## Cost và fallback

Pilot ưu tiên local Blender, FFmpeg và Voice Studio. Chi phí cloud là `not_called` cho tới khi người dùng chọn provider/web route và duyệt budget. Nếu Blender render quá chậm, giảm resolution/frame count ở preview, không đổi sang slideshow. Nếu voice clone không được phép, dùng preset nam tiếng Việt; nếu web polish cần BrowserMCP, dừng ở local handoff và chờ người dùng Connect/approval.

## Tài liệu nền

Kế hoạch này bám role của Blender là deterministic true-3D worker, contract `blender-job.schema.json`, pipeline AI generation theo brief → script → visual bible → shot plan → render → review, và Voice Studio consent gate. Các reference TikTok chỉ là moodboard; không phải nguồn footage hay identity reference.

## References

[1]: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html "Blender command line arguments"
[2]: https://github.com/browsermcp/mcp "BrowserMCP repository"
[3]: https://docs.browsermcp.io/setup-extension "BrowserMCP extension setup"
[4]: https://www.nasa.gov/moon/ "NASA Moon reference hub for claim review"
[5]: https://science.nasa.gov/moon/moon-phases/ "NASA Moon phases and illumination reference"
