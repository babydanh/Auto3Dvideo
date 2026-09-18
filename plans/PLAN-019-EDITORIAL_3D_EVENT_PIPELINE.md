# PLAN-019 — Editorial 3D Event Pipeline

## Mục tiêu

Nâng Auto3Dvideo từ technical true-3D animatic thành dây chuyền sản xuất video science-editorial có nhiều event, visual proof, lookdev, hậu kỳ và provenance. TikTok chỉ là moodboard; không tải, scrape, repost, tháo watermark, clone voice/likeness hoặc sao chép creator.

## Kiến trúc

```text
reference video / user upload
      -> intake + rights gate
      -> media probe + audio transcription
      -> shot detection + keyframe sampling
      -> vision/audio evidence per shot
      -> reference grammar (not media reuse)
brief -> claim ledger -> script -> style bible -> event graph -> asset provenance
      -> Blender hero 3D / motion graphics / licensed footage
      -> timeline composer -> voice/music/SFX/subtitles
      -> automated QA -> human review -> delivery manifest
```

## Reference Video Intake

Workflow phải nhận được toàn bộ video tham khảo qua local file, user-owned upload, screen recording hoặc URL được phép phân tích. Mọi intake bắt buộc ghi `sourceSha256`, duration, resolution, FPS, source type và rights gate. Với TikTok/Douyin không có quyền tái sử dụng, `useMode=analysis_only_moodboard`, `downloadForReuse=false`, `derivativeUse=false`, `voiceReuse=false` và mọi output chỉ là evidence/grammar.

Sau intake, pipeline probe media bằng FFprobe, trích audio để transcription nếu được phép, chạy shot detection theo histogram/content change/manual marker hoặc hybrid, rồi lấy keyframe đại diện mỗi shot. Vision pass ghi visual description, camera grammar, motion grammar, text/graphic layers, inferred asset mode và learning notes. Kết quả nằm trong `reference-shot-evidence.schema.json`; không copy video/audio vào asset registry và không đưa reference media vào timeline output.

Shot extraction phải có confidence, frame range, keyframe paths, audio span và reviewState. Khi shot detection sai, editor sửa marker thủ công; bản sửa được version hóa. Không dùng inferred asset mode để kết luận reference chắc chắn là Blender/AI/footage nếu không có bằng chứng.

## Contracts

Để tránh trùng lặp, `narrative-visual-plan.schema.json` là contract chính cho beat/event và visual evidence; `media-plan.schema.json` là contract cho FFmpeg/FFprobe composition. PLAN-019 bổ sung các contract còn thiếu cho intake, claim, style và timeline.

| Contract | Trường bắt buộc |
|---|---|
| Claim Ledger | `claimId`, text, source URLs, evidence, confidence, reviewer, reviewState |
| Event Graph | `eventId`, cause, effect, narrationSpan, visualProof, frame range, dependencies, entityAnchors, cameraIntent, assetMode, claimIds, reviewState |
| Style Bible | palette, contrast, lens, camera verbs, material, light direction, typography, safe area, audio direction, negative constraints, version |
| Asset Registry | `assetId`, sourceType, path, SHA-256, owner, license, commercialUse, derivativeUse, model, promptHash, reviewState |
| Timeline Graph | video/overlay/caption/audio layers, transitions, ducking, look preset, FPS, output profile |

## Shot grammar

Mỗi event phải trả lời: đang kể điều gì, visual proof là gì, camera có ý định gì và entity nào phải giữ continuity. Video 45–60 giây nên có 10–12 beat: hook, question, establish, proof, macro, causal diagram, complication, scale reveal, second proof, payoff, misconception correction và memory hook.

## Phân vai công cụ

Blender lo geometry, camera, lighting và hero motion. Motion graphics lo diagram, text, overlays, transitions và easing. Footage chỉ dùng khi có provenance/license. TTS giữ clone-consent gate. Timeline composer lo cuts, caption, audio mix, normalization và export.

## Safety và quality gates

Worker chỉ nhận typed schema, executable allowlist, relative workspace paths, frame bounds, timeout/cancellation, redacted logs và output probe. Không nối raw user text thành shell command và không expose arbitrary Blender execution. QA phải kiểm narrative, visual proof, continuity, audio, caption safe-area, claim, rights, ffprobe, hash và manifest. Render thành công không đồng nghĩa publishable.

## Roadmap

1. Thêm `reference-video-intake` và `reference-shot-evidence` trước khi tạo shot plan.
2. Reuse `narrative-visual-plan` cho event/visual evidence và `media-plan` cho FFmpeg/FFprobe.
3. Thêm schemas `claim-ledger`, `style-bible` và `timeline-composition`.
4. Mở rộng planner từ reference evidence + brief sang event graph có `visualProof` bắt buộc.
5. Nối claim, asset, prompt, model và rights vào từng shot; cấm reference media reuse nếu chưa có license.
6. Xây deterministic timeline composer cho cuts, overlays, captions, audio và transitions.
7. Tạo Blender style presets, reusable materials, camera rigs và light rigs.
8. Thêm QA cho intake rights, shot confidence, timing, continuity, safe area, streams, claim coverage và provenance.
9. Làm pilot 45–60 giây với 10–12 event sau khi reference grammar, graph và style bible được duyệt.
10. Đóng delivery package; BrowserMCP chỉ optional sau local approval.

## Definition of done

Một topic mới đi qua claim ledger, script, style bible, event graph, registry, worker, composer, QA và human review mà không sửa source code theo từng episode. Output reproduce được từ versioned inputs và không tự động publish.

## References

[1]: https://docs.blender.org/manual/en/latest/animation/index.html "Blender 5.2 LTS Manual — Animation & Rigging"

[2]: https://www.capcut.com/tools/keyframe-animation "CapCut — Keyframe Animation"
