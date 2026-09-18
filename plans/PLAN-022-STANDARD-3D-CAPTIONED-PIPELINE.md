# PLAN-022 — Standard 3D Topic-to-Delivery Pipeline

## Mục tiêu

Đưa workflow video 3D về một đường chuẩn duy nhất:

```text
chủ đề → research/claim → style + world bible → script → shot plan
→ reference/image asset → Blender scene/render → voice → word alignment
→ frame-locked captions → timeline/FFmpeg → quality gate → delivery
```

## Quyết định

- `shotId`, `assetId`, `frameRate` và integer frame range là nguồn sự thật nội bộ.
- Prompt chỉ mô tả ý định; không được coi semantic blockout hoặc contact sheet là asset cuối.
- Subtitle có `startFrame`/`endFrame`; SRT/VTT chỉ là bản xuất quy đổi từ frame.
- TTS/STT/provider chỉ chạy sau approval, cost và rights gate; mặc định workflow là dry-run.
- Chất lượng cuối vẫn cần human review; worker chỉ có thể chặn lỗi cấu trúc, timing và output.

## Phạm vi thay đổi

- Thêm contract `frame-caption-plan` cho phụ đề frame-locked.
- Thêm worker local tạo manifest frame-locked và SRT không overwrite.
- Thêm workflow mẫu nối đủ topic, 3D, voice, alignment, caption, compose và review.
- Cập nhật skill map để các role dùng cùng một state/contract.

## Acceptance

1. Workflow compile được thành pending worker plan, không chạy provider.
2. Cue subtitle hợp lệ có frame range nguyên, không overlap, không vượt duration.
3. Cue liền nhau quy đổi thành timestamp SRT ổn định ở FPS 24/25/30/60.
4. Cue overlap, frame fractional, path traversal và overwrite đều bị từ chối.
5. Không stage nào được đánh dấu final/publish trước quality gate và human review.

## Chưa tuyên bố

Worker này không tự đảm bảo giọng đọc đúng nội dung hoặc chất lượng cinematic. Để có alignment thật, STT/forced-alignment adapter phải trả word/segment timing; nếu chưa có thì manifest giữ `needs_review`.
