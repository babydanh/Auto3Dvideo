# PLAN-016 — Mechanism Explainer Studio

## Mục tiêu

Biến một chủ đề “cơ chế hoạt động như thế nào” thành một chuỗi event có quan hệ nguyên nhân–kết quả, sau đó tạo shot plan và frame sequence original thay vì ghép các ảnh card đứng im. Slice đầu tiên dùng chủ đề “Vì sao xi măng gặp nước lại cứng hơn thay vì tan ra?”.

## Kiến trúc slice local-first

```text
mechanism-plan.json
  → validate event graph/timing/dependencies/policy
  → procedural renderer
  → scene-manifest.json + frame sequence + captions.srt
  → FFmpeg direct typed runner
  → MP4 + probe/hash evidence
```

Mỗi event có `dependsOn`, frame range liên tục, narration, caption, claim/source note, visual mode, subject/action/camera, continuity anchors, negative constraints, transition và review state. Điều này giữ được chuỗi diễn biến: tiếp xúc → thâm nhập → phản ứng → mạng liên kết → đặc/cứng dần → takeaway.

## Visual modes

`2d_motion` dùng kinetic typography/infographic; `2_5d_parallax` dùng các lớp depth chuyển động khác tốc độ; `pseudo_3d` dùng shading, mặt khối, particle và camera-like motion được render bằng code. `true_3d` được giữ trong contract để route tương lai qua Blender, nhưng slice hiện tại không tự cài Blender và không giả vờ là mô phỏng khoa học chính xác.

## Policy và review

Slice mặc định `allowNetwork=false`, `externalAssetsAllowed=false`, `paidGeneration=false`, `rightsRequired=true` và `humanReviewRequired=true`. Không nhận social URL làm asset, không download/repost/watermark removal. Source notes chỉ là đường dẫn kiểm tra claim; output chưa được xem là legal-cleared, publishable hoặc monetizable.

## Chưa làm

Slice chưa có Blender true 3D, fluid/particle physics, VLM, auto research, VieNeu narration hoặc cloud video. Audio fixture có thể im lặng; subtitle được giao sidecar. Những phần này chỉ được thêm sau khi có approval về model, hardware, network, cost, privacy và license.

## Acceptance criteria

1. Event graph có timing frame-based liên tục và dependencies chỉ trỏ tới event trước.
2. Worker từ chối traversal, policy network/external asset, event thiếu field và gap/overlap.
3. Renderer tạo frame sequence, manifest, source-plan hash và SRT sidecar.
4. FFmpeg tạo MP4 dọc có video/audio stream và FFprobe đọc được output.
5. Không có social media download hoặc provider call.
6. Output giữ `needs_review` cho claim, rights, chất lượng và final release.
