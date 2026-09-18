# Reference Video Workflow — NEEDS_HUMAN_REVIEW

## Tóm tắt

Auto3Dvideo đã được mở rộng về mặt workflow contract để xử lý **video tham khảo đầy đủ → phân tích audio/vision → tách shot → tạo reference grammar → lập Event Graph**, trước khi tạo media mới. Đây là thiết kế và contract foundation; worker intake/shot detection/vision execution chưa được triển khai ở bước này.

## Files đã thêm hoặc cập nhật

| File | Vai trò |
|---|---|
| `plans/PLAN-019-EDITORIAL_3D_EVENT_PIPELINE.md` | Production workflow từ reference intake đến delivery. |
| `contracts/reference-video-intake.schema.json` | Input media, metadata, rights gate, analysis config và output paths. |
| `contracts/reference-shot-evidence.schema.json` | Shot range, keyframes, audio span, camera/motion grammar, text layers và reuse policy. |
| `contracts/claim-ledger.schema.json` | Factual claim, source, evidence, confidence và reviewer state. |
| `contracts/style-bible.schema.json` | Palette, lens, camera, lighting, material, typography, safe area và audio direction. |
| `contracts/timeline-composition.schema.json` | Video/overlay/caption/audio tracks, clips, transitions và output profile. |
| `MANIFEST.json` | Đăng ký các contracts và PLAN-019. |
| `outputs/moon-story-pilot/cleanup-evidence-2026-08-26.md` | Ghi nhận media pilot cũ đã được xóa, source còn giữ. |

## Workflow đích

```text
full reference video
→ intake + SHA-256 + media probe
→ rights gate
→ audio transcription nếu được phép
→ histogram/content/manual shot detection
→ representative keyframes
→ vision/audio evidence per shot
→ reference grammar only
→ claim ledger + script
→ style bible + narrative visual plan
→ event graph + asset provenance
→ Blender/motion graphics/licensed assets
→ timeline composition
→ QA + human review
```

Reference media không được đưa vào asset registry hoặc timeline nếu chỉ có quyền moodboard. Schema mặc định cấm reuse media và voice reuse; inferred asset mode chỉ là quan sát có độ tin cậy, không phải kết luận reference được làm bằng Blender, AI hay footage.

## Tests và validation

`python scripts/validate_project.py --project .` pass với `manifest_inventory_files=266`, `physical_files_checked=266`, `json_files_checked=52` và `yaml_files_checked=16`. Validator đã parse tất cả JSON contracts mới. Chưa chạy render, chưa tải video TikTok, chưa gọi vision cloud, chưa trích audio từ third-party URL và chưa tạo output media mới.

## Limits và next action

Browser TikTok không render frame ổn định trong phiên nghiên cứu, vì vậy workflow không được phép tự suy đoán loại pipeline của creator. Muốn phân tích frame-level cần local file, screen recording hoặc upload mà người dùng có quyền phân tích. Khi đó cần implement bounded workers: `reference_probe`, `shot_detect`, `keyframe_extract`, `audio_transcribe` và `vision_evidence`; mỗi worker phải có timeout, path containment, output contract, retry bound, redacted logs và human review.

## Cost, rights và policy

Hiện chưa có cloud generation cost và chưa có download/reuse third-party media. Tiktok/Douyin chỉ là moodboard; không clone voice/likeness, không repost, không tháo watermark và không tự động upload/publish. Nếu user-owned reference được đưa vào, vẫn cần lưu source hash và permission evidence; nếu chỉ moodboard thì chỉ lưu evidence/grammar.

## References

[1]: https://docs.blender.org/manual/en/latest/animation/index.html "Blender 5.2 LTS Manual — Animation & Rigging"

[2]: https://www.capcut.com/tools/keyframe-animation "CapCut — Keyframe Animation"

[3]: https://github.com/AcademySoftwareFoundation/OpenTimelineIO "OpenTimelineIO official repository"
