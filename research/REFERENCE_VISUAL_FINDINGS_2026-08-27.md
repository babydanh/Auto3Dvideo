# Reference visual findings — 2026-08-27

Nguồn quan sát: TikTok URL do người dùng cung cấp, chỉ đọc, không tải media.

Screenshot sandbox cho thấy player hiển thị một khung ngang trong feed, nền gần đen, một dải thiên hà/ánh sáng trắng xanh chạy chéo, các vệt tốc độ hướng về vùng trung tâm, một hình tròn cyan ở phần dưới trung tâm và typography tiếng Trung màu đỏ rất lớn ở vùng trên. Logo/branding khoa học nằm góc trên bên phải. Player hiển thị khoảng 20.9K likes, 370 comments, 2,021 saves và 3,600 shares trong phiên quan sát.

Metadata markdown của page hiện trả caption: “Bạn thấy âm thanh nào ghê nhất? 🤔 #LearnOnTikTok #hoccungtiktok #davoslingo”. Trang không cung cấp timeline/frame-by-frame ổn định trong sandbox; không kết luận loại media là Blender, AI hay footage. Các đặc điểm trên chỉ được dùng để rút ra visual grammar: hook typography mạnh, một hero visual có chuyển động hướng tâm, tương phản đen–cyan–trắng, overlay/branding và visual proof tập trung.

Policy: reference chỉ là moodboard/analysis evidence; không download, không reuse footage/audio, không clone voice/likeness và không sao chép bố cục/typography exact.

## Workflow research findings

Blender's official Video Editing manual describes the Video Sequencer as a multi-channel editing system that combines clips, overlays, transitions and synchronized audio. Blender Studio's OpenTimelineIO production note documents transporting a substantial edit from Blender to other editorial tools and emphasizes separate video/audio tracks plus inspectable clip metadata. The 2026 Blender Foundation GSoC project describes OTIO as a structured object graph carrying cut information, media references, markers, transitions and effects. These support an architecture where each 3D shot is rendered independently and the final edit is represented deterministically rather than hidden inside one long scene.

ComfyUI's public multi-shot workflow shows a different path: a storyboard shot list feeds image/video nodes and a save-video node, with a prompt per shot. It is useful as a reference for shot-level orchestration but is not a replacement for Blender true-3D continuity; cloud API access also requires its own plan/key. Auto3Dvideo should therefore use a provider-neutral shot graph and let Blender, ComfyUI/local models or licensed footage act as pluggable workers.

Sources: Blender Studio OpenTimelineIO article; Blender Foundation 2026 GSoC OTIO project; Blender Video Editing Manual; ComfyUI multi-shot workflow page.

## Repo/framework comparison

BlenderProc is useful as a pattern for deterministic scene construction, reusable object/material/light/camera helpers and repeated render passes, but it is research-render oriented and should not be installed into the user project without confirmation. OpenTimelineIO is the strongest candidate for the editorial interchange layer: it represents cut order and timing plus external media references, but is not a media container. Blender's VSE can combine multiple video channels, overlays, transitions and synchronized audio. The public multi-shot ComfyUI workflow demonstrates shot-level prompt orchestration, but its cloud API requires a plan/key and it does not solve true-3D identity continuity.

Recommendation: Auto3Dvideo should keep its bounded Rust executor and add local Python workers around a provider-neutral Shot Graph. Use Blender scene-per-shot or collection-per-shot with shared asset IDs, deterministic camera/lighting presets and render manifests. Use OTIO or an internal OTIO-compatible timeline for edit interchange. Treat ComfyUI as an optional provider adapter, not the core continuity system. Avoid adopting the unmaintained Power Sequencer repository for Blender 5 because its README says recent Blender 5 support is unavailable.

Sources: BlenderProc repository, OpenTimelineIO repository, Blender Studio OTIO article, Blender Video Editing Manual, ComfyUI multi-shot workflow, GDQuest Power Sequencer repository.

## Studio pipeline findings

Blender Studio's production-pipeline notes emphasize a single source of truth around editorial, task/status tracking, render management, storage and assets; Kitsu is used for production tracking while deeper integration remains an explicit pipeline concern. Prism documents scene versioning, asset import/export, shot cameras, frame range, FPS, resolution, scene building, rendering and OTIO support. Blender-Kitsu documents metadata strips that link edit ranges to shots, which is a useful model for associating multiple visual elements with one shot.

Recommended architecture for Auto3Dvideo: keep the existing local Rust/Tauri bounded executor as the control plane; add a project-local shot/asset/version database rather than installing a full studio tracker immediately. Use Prism/Kitsu as optional future integrations, not mandatory dependencies. The core should support scene-per-shot or collection-per-shot, shared asset IDs, versioned lookdev, render/playblast review, and an OTIO-compatible editorial timeline. This is the class of workflow needed for a polished multi-model 3D short; the previous sphere/rings test did not yet have these production layers.
