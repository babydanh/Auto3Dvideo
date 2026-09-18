# Research — VieNeu-TTS v3 Turbo cho Voice Studio

## Nguồn chính thức

[1] VieNeu-TTS README/PyPI: https://github.com/pnnbao97/VieNeu-TTS/blob/main/README_PYPI.md

[2] VieNeu documentation: https://docs.vieneu.io/

[3] Voice cloning documentation: https://docs.vieneu.io/docs/sdk/voice-cloning/

[4] VieNeu-TTS-v3-Turbo model card: https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo

## Kết luận áp dụng

VieNeu-TTS v3 Turbo hỗ trợ preset voices, instant voice cloning từ khoảng 3–8 giây audio, denoise và `add_voice()`. Đường CPU/ONNX hỗ trợ clone mà không cần PyTorch; reference audio cần được dùng khi có quyền và consent phù hợp.

Tài liệu model card mô tả 20 preset voice với vùng Bắc/Trung/Nam, nam/nữ và character như Natural, News, Storytelling và Audiobook. Tên voice thực tế nên lấy bằng `list_preset_voices()` theo đúng SDK version đang cài.

Emotion control hiện là tính năng experimental qua inline cues như `[cười]`, `[thở dài]` và `[hắng giọng]`. Tham số `style` vẫn được chấp nhận để tương thích ở v3 Turbo nhưng bị ignore; reading character đã nằm trong preset/reference voice. Temperature khoảng 0.8 được tài liệu mô tả là ổn định; cao hơn có thể biểu cảm hơn nhưng kém ổn định hơn.

Voice Studio của Auto3Dvideo vì vậy chuẩn hóa preset voice, temperature trong khoảng 0.6–1.2, cue cảm xúc theo từng segment và preview local. Không quảng cáo slider cảm xúc như một khả năng native mà model không có. Voice cloning phải mặc định tắt, yêu cầu reference path nằm trong workspace và clone consent; không hỗ trợ impersonation.

## License/caution

Model card ghi package và preset voice assets theo Apache-2.0, đồng thời mô tả preset speakers đã có consent theo thông tin của tác giả. Khi redistribute model/asset cần giữ attribution/license notices. Audio reference của người dùng hoặc người khác không tự được bao phủ bởi license preset; quyền sử dụng voice sample vẫn là trách nhiệm của người dùng.
