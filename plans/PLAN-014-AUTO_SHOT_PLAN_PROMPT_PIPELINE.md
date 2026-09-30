# PLAN-014 — Auto Shot Plan & Prompt Pipeline

## Mục tiêu

Xây dựng một workflow để người dùng nhập chủ đề, mục tiêu, thời lượng, tỷ lệ khung hình và video tham khảo ở mức moodboard. Hệ thống tự tạo research brief, claim ledger, storyboard theo beat, phân loại kỹ thuật hình ảnh từng shot, prompt có cấu trúc, kế hoạch âm thanh/phụ đề, danh sách asset và checklist review. Hệ thống tạo một video nguyên bản bằng asset tự render hoặc nguồn có provenance; không sao chép shot, watermark, lời thoại, audio hay nhận diện thương hiệu của video tham khảo.

## Kết luận về khả năng

Có thể làm được ở mức workflow orchestration. Một prompt dài duy nhất không đủ để tạo video giải thích 4 phút có tính nhất quán. Cần tách thành các artifact có schema và cổng review: brief → research/claim → shot plan → prompt → asset acquisition/render → edit plan → narration/SRT → QA → delivery.

Video tham khảo TikTok chỉ được lưu dưới dạng `referenceUrl`, `referenceUse: moodboard_only` và các đặc điểm trừu tượng như nhịp, mật độ caption, bố cục, độ tương phản, loại camera. Không lưu hoặc tái sử dụng media từ URL đó.

## Pipeline chuẩn

| Giai đoạn | Đầu vào | Đầu ra bắt buộc | Cổng kiểm tra |
|---|---|---|---|
| 1. Brief | Chủ đề, khán giả, mục tiêu, thời lượng | `video-brief` | Chủ đề và mục tiêu rõ |
| 2. Research | Câu hỏi, nguồn chính thức | `claim-ledger` | Mỗi claim có nguồn hoặc được viết lại thành quan sát |
| 3. Style extraction | Reference URL/file được phép xem | `style-profile` | Chỉ giữ thuộc tính trừu tượng, không sao chép media |
| 4. Shot planning | Brief, claim, style profile | `shot-plan` | Mỗi beat có narration, visual proof, duration |
| 5. Prompt planning | Shot plan, entity anchors | `prompt-pack` | Prompt có subject/action/camera/light/negative/continuity |
| 6. Asset route | Prompt + asset policy | `asset-ledger` | Asset generated/local/licensed và hash/provenance |
| 7. Production | Shot plan + assets | Rendered shots | Codec, duration, aspect ratio, no missing shot |
| 8. Editorial | Shots, narration, SRT | Master MP4 + sidecars | Sync, caption, loudness, crop |
| 9. Review | Master + ledgers | Delivery checklist | Người dùng duyệt nội dung, quyền và chất lượng |

## Shot plan contract đề xuất

Mỗi shot phải có các field chuẩn hóa sau:

```json
{
  "shotId": "shot-0001",
  "beatId": "beat-01",
  "startSeconds": 0,
  "durationSeconds": 5,
  "narrationText": "Một vật liệu tưởng như mềm ra khi gặp nước lại có thể thay đổi hoàn toàn.",
  "claimStatus": "needs_review",
  "visualMode": "licensed_footage | true_3d | space-25d | procedural_2d | html_motion | generated_video | live_footage",
  "visualIntent": "Cận cảnh chất liệu đang được khuấy, camera chậm tiến vào.",
  "subject": ["cement paste", "water"],
  "action": "mixing and changing texture",
  "camera": "macro close-up, slow push-in, vertical 9:16",
  "lighting": "soft directional studio light, visible texture",
  "continuityAnchors": ["gray cement paste", "metal mixing tool", "warm neutral background"],
  "negativePrompt": ["unreadable text", "extra tools", "deformed hands", "watermark", "brand logo"],
  "assetRefs": [],
  "sourceNotes": [],
  "voiceCue": null,
  "captionText": null,
  "reviewState": "draft"
}
```

`visualMode` không được chọn tùy ý. Worker chỉ nhận mode đã có adapter và chính sách tương ứng. Mode `generated_video` cần provider profile, budget approval, request receipt và provenance; mode `licensed_footage` cần source manifest, credit, license, proof, hash và phạm vi sử dụng.

## Prompt compiler

Không gửi nguyên brief dài vào model tạo hình/video. Prompt compiler tạo prompt theo thứ tự ổn định:

```text
[SUBJECT]
[VISIBLE ACTION]
[COMPOSITION + CAMERA]
[LIGHT + MATERIAL]
[STYLE BOUNDARY]
[CONTINUITY ANCHORS]
[OUTPUT: 9:16, duration, fps]
[NEGATIVE CONSTRAINTS]
```

Ví dụ prompt cho một shot giải thích:

```text
Vertical 9:16 educational macro shot of gray cement paste being mixed with a controlled amount of water in a plain metal bowl. Show the visible texture changing while the camera performs a slow, stable push-in. Soft directional studio lighting, realistic material detail, neutral background, no brand, no watermark, no on-screen text. Keep the same gray paste, metal tool, bowl shape and lighting as the previous shot. Leave clean lower-third space for Vietnamese captions. 5 seconds, smooth motion, no jump cuts.
```

Prompt không được yêu cầu “copy video tham khảo”, “giống y hệt creator”, “giữ nguyên khung hình”, “xóa watermark” hoặc lấy source media từ social platform. Style profile chỉ chứa thuộc tính như `macro educational`, `high contrast`, `slow camera`, `dense caption`, `clean infographic overlay`.

## Tự lập kế hoạch bằng agent

Agent được phép tạo và sửa artifact theo thứ tự, nhưng mỗi stage có output schema và không được tự vượt cổng. Agent có thể đề xuất mode, asset candidate và prompt; native app mới quyết định path safety, provider, network, budget, process execution và output validation.

| Agent stage | Được làm | Không được làm |
|---|---|---|
| Planner | Tách beat, viết shot, đề xuất visual mode | Tự gọi FFmpeg/Blender/cloud |
| Researcher | Tạo claim/source checklist | Tự xem claim là đúng nếu thiếu nguồn |
| Prompt compiler | Tạo prompt có continuity/negative constraints | Sao chép creator/video cụ thể |
| Asset coordinator | Chọn asset local/licensed/generated | Tải social media tùy tiện |
| Editor planner | Tạo timeline, caption và voice plan | Tự đăng bài hoặc ghi đè nguồn |
| QA agent | Phát hiện thiếu shot, overlap, crop, text overflow | Tự tuyên bố legal-cleared/publishable |

## Nâng cấp cho Auto3Dvideo

Các phần đã có thể tái sử dụng gồm Topic Profile/Prompt Registry, `narrative-visual-plan`, `video-script`, `licensed-footage-space`, `space-25d`, Voice Studio và Subtitle Studio. Slice tiếp theo nên thêm `shot-plan.schema.json`, `style-profile.schema.json`, `prompt-pack.schema.json` và một compiler không mạng để sinh prompt preview trước khi gọi provider.

UI nên có một tab `Storyboard Studio` với các cột: beat, narration, duration, visual mode, asset source, prompt preview, claim/source, voice cue và review state. Mỗi card cho phép regenerate prompt, khóa continuity anchor, đổi mode có lý do và xem blocker. Nút render chỉ hoạt động sau khi shot coverage, rights, claim, voice và cost gates hợp lệ.

## Acceptance criteria

1. Một brief tạo ra shot plan có duration liên tục, narration coverage và visual mode hợp lệ.
2. Mỗi shot có prompt subject/action/camera/light/continuity/negative constraints.
3. Agent không thể biến reference URL thành asset input hoặc source download.
4. Claim không có source bị giữ ở trạng thái cần review.
5. Asset licensed thiếu credit/license/proof/hash bị giữ lại, không được render.
6. Render thất bại không được ghi nhận là thành công; retry có giới hạn và idempotent.
7. Output có FFprobe, hash, manifest và sidecar SRT/credits khi cần.
8. Người dùng có thể chỉnh shot plan và prompt trước render.
9. Video tham khảo chỉ tạo style profile trừu tượng, không tạo bản sao.
10. Không có auto-publish, watermark removal, cookie/password automation hoặc social scraping.

## Lộ trình

Slice A là schema + prompt preview + storyboard editor không gọi mạng. Slice B nối deterministic `space-25d`, licensed footage và Subtitle/Voice Studio. Slice C thêm provider adapter cho image/video/3D với budget gate và receipt. Slice D thêm Blender true-3D route nếu người dùng cài/configure Blender; không cài tự động.

## Bổ sung đã triển khai — cinematic prompt enrichment

`cinematic_prompt_enricher` đã được gắn vào local script worker bằng adaptation bounded của repo MIT [`Rylaispirit/cinematic-video-prompt-skill`](https://github.com/Rylaispirit/cinematic-video-prompt-skill). Prompt mỗi shot hiện ghi rõ shot size/góc máy, một hành động chính, một camera movement, lighting tương thích, style/color/mood và technical output; skill chỉ là vocabulary/compiler guidance, không thay thế provider adapter, continuity, rights hoặc human review gate.
