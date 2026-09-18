# Research: Repository video vision/content planning — 2026-08-26

## VILA

Repository: https://github.com/NVlabs/VILA

VILA hỗ trợ video understanding, video captioning, in-context learning và multi-image reasoning. README mô tả các model 3B/8B/13B/40B, có quantization AWQ 4-bit và hướng triển khai trên desktop/edge GPU. Code dùng Apache-2.0 nhưng pretrained weights được ghi là CC-BY-NC-SA-4.0, vì vậy không nên coi toàn bộ repository/weights là commercial-safe. Phù hợp để học cách xây video sampler + VLM adapter; không phải lựa chọn nhẹ cho Windows CPU.

## Qwen3-VL

Repository: https://github.com/QwenLM/Qwen3-VL

Qwen3-VL nhận video từ local path, URL hoặc danh sách frame; có tham số fps/num_frames/pixel budget để kiểm soát chi phí và VRAM. README nêu video OCR, grounding, timestamp alignment, temporal reasoning, long-video context và deployment local qua vLLM/SGLang. Có các kích thước 2B/4B/8B/30B/235B; model/license cần kiểm tra theo checkpoint cụ thể. Đây là ứng viên mạnh nhất để đọc video, OCR caption, đánh dấu timestamp và tạo shot evidence; bản 2B/4B vẫn cần benchmark thực tế trên GPU, không nên hứa chạy mượt CPU.

## LLaVA-Video / LLaVA-NeXT

Repository: https://github.com/LLaVA-VL/LLaVA-NeXT

README công bố LLaVA-Video-178K với caption, open-ended QA và multiple-choice QA, cùng model 7B/72B. Phù hợp cho video QA, narrative analysis và benchmark; model lớn, setup nặng hơn và cần kiểm tra license checkpoint/dataset trước khi dùng thương mại. Có giá trị để học temporal sampling, evaluation và prompt format hơn là đem thẳng vào Windows desktop MVP.

## Initial assessment

Qwen3-VL là ứng viên tích hợp ưu tiên cho video-to-evidence nếu người dùng có GPU đủ mạnh. VILA là ứng viên nghiên cứu/edge quantization nhưng weights có hạn chế NC-SA. LLaVA-Video mạnh ở benchmark/QA nhưng nặng hơn và nên dùng như reference architecture. Tất cả phải chạy sau rights gate; video tham khảo social chỉ là moodboard, không tự biến thành input download.

## InternVideo

Repository: https://github.com/OpenGVLab/InternVideo

InternVideo là họ video foundation models gồm InternVideo2, InternVideo2.5, InternVideo3 và InternVideo-Next. README hiện nêu InternVideo3 có model instruct 8B, long-video SFT dataset, evaluation scripts và initial video-agent implementation trong Vidify. Đây là nguồn tốt để nghiên cứu long-horizon video reasoning và agent evaluation, nhưng setup model lớn và không phù hợp để nhúng trực tiếp vào Windows desktop MVP.

## ViMax

Repository: https://github.com/HKUDS/ViMax

ViMax là framework agentic video creation kết nối narrative planning, visual consistency, image/video generation và final assembly. README có pipeline `idea2video` và `script2video`, cấu hình chat model/image generator/video generator, trong đó có adapter Veo Google API. Đây là repo gần nhất với mục tiêu “nhập chủ đề rồi tự plan từng cảnh”, đáng học về decomposition/agent stages; không nên copy nguyên hệ thống vì phụ thuộc API/model bên ngoài, cần audit license/credential/billing và có nhiều moving parts.

## Livepeer Storyboard

Repository: https://github.com/livepeer/storyboard

Storyboard là creative canvas có agent orchestration, story/film flows, image/video/audio/3D generation, edit/animate và image analysis; README mô tả MCP/agent integration và các flow như stories/films. Nó hữu ích để học UX canvas, tool routing, project replay và storyboard editing. Đây là sản phẩm có backend/provider ecosystem riêng, không phải model video understanding local; chỉ nên tham khảo architecture/UI và kiểm tra license trước khi dùng code.

## Practical editorial utilities

PySceneDetect: https://github.com/Breakthrough/PySceneDetect — shot/scene cut detection, tự động chia clip; phù hợp làm low-level prior trước khi đưa frame/shot vào VLM.

TransNetV2: https://github.com/soCzech/TransNetV2 — neural shot transition detection; phù hợp khi cần phát hiện cut nhanh hơn heuristic, nhưng cần kiểm tra license/runtime trước khi nhúng.

## Shortlist direction

Để nâng “tư duy content video”, không nên tìm một repo duy nhất. Nên ghép `PySceneDetect hoặc TransNetV2` cho shot boundary, `Whisper/WhisperX` cho lời thoại/timestamp, `Qwen3-VL` hoặc API vision cho frame/video evidence, `ViMax` cho decomposition/narrative orchestration, và `Video-MME/TVBench` cho regression evaluation. Auto3Dvideo vẫn giữ Rust process boundary, schema, rights gate và human review; các repo chỉ cung cấp adapter/ý tưởng, không được bypass governance.
