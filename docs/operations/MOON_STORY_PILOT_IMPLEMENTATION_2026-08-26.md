# Moon Story True-3D Pilot — NEEDS_HUMAN_REVIEW

> **Post-cleanup amendment (2026-08-26):** Theo yêu cầu người dùng, toàn bộ media render của pilot đã được retirement, gồm final MP4, intermediate MP4, still previews, QA frames và PNG sequence. `.blend`, source, manifests, WAV, SRT, claim matrix và evidence metadata được giữ. Chi tiết tại `outputs/moon-story-pilot/cleanup-evidence-2026-08-26.md`.

## Tóm tắt

Pilot dọc “Vì sao chúng ta luôn thấy một mặt của Mặt Trăng?” đã được dựng bằng scene procedural true-3D trong Blender, render thành image sequence, encode/mux bằng FFmpeg, tạo narration tiếng Việt bằng VieNeu preset `Adam`, và burn subtitle SRT deterministic. Media output sau đó đã được retirement theo yêu cầu cleanup; report này giữ lại provenance và kết quả QA lịch sử, không đại diện cho file MP4 hiện còn trên disk.

Cấu trúc kể chuyện gồm hook, orbit, synchronous rotation, giải thích tidal locking, far-side reveal và conclusion. Scene dùng persistent Earth–Moon–satellite entities, camera animation, orbit/helper geometry và lighting procedural. Các helper arrows ở shot tidal-lock là minh họa trực quan, không phải mô phỏng lực, tỷ lệ khoảng cách hay ephemeris đầy đủ.

## Một status marker

| Trường | Giá trị |
|---|---|
| Status | `NEEDS_HUMAN_REVIEW` |
| Delivery review state | `needs_human_review` |
| Hình thức bàn giao | Local review package; không upload, không publish |

## Files đã thay đổi hoặc bổ sung

| File | Vai trò |
|---|---|
| `scripts/true3d_moon_story_worker.py` | Tạo scene Blender procedural, six still previews và scene manifest. |
| `scripts/render_moon_story_animation.py` | Worker bounded render PNG sequence từ `.blend`; chỉ nhận relative workspace paths. |
| `scripts/inspect_blender_render_api.py` | Diagnostic read-only cho Blender 5.2 output API. |
| `scripts/run_moon_story_subtitle_encode.cmd` | Wrapper project-specific burn SRT bằng FFmpeg. |
| `scripts/moon_story_subtitle_filter.txt` | Filter reference thử nghiệm, được giữ và đăng ký để trace provenance. |
| `scripts/test_true3d_moon_story_worker.py` | Coverage không render cho safe path và argument parsing. |
| `scripts/README.md` | Ghi command/boundary cho Moon true-3D pilot. |
| `MANIFEST.json` | Đăng ký source/docs/scripts mới. |
| `docs/operations/MOON_STORY_CLAIM_MATRIX_2026-08-26.md` | Claim matrix và nguồn NASA. |

## Output package

| Artifact | Metadata / evidence |
|---|---|
| `outputs/moon-story-pilot/moon-story-final.mp4` | Historical render metadata: H.264, 540×960, 30 fps, AAC mono 48 kHz, 30.000 s; file đã bị retirement; SHA-256 `eb9a7f264d12fffafd76afac0ec64ee25a49187c5205779917b90089f8fc1708`. |
| `outputs/moon-story-pilot/moon-story-pilot.blend` | Scene source; SHA-256 `2529ed4d7741600c29bde17623f01f43312c4443b8eab0afc0cfc270754352a8`. |
| `outputs/moon-story-pilot/scene-manifest.json` | Six shot markers, entity IDs, procedural/local rights state. |
| `.auto3dvideo/tts/moon-story-narration.wav` | VieNeu `Adam`, ONNX int8, Vietnamese, 24.92 s trước khi pad; SHA-256 `d2fc7992080245fdb14b682b4887251562d3f9207c5115e46f55ccdeb14a02a7`. |
| `outputs/moon-story-pilot/moon-story-subtitles.srt` | SRT deterministic; cue far-side bắt đầu ở 20.2 s sau QA; SHA-256 `3cd4eeb7e175b81c4874226b945074a07f696af7847cd56fe4a45829a58ae043`. |
| `outputs/moon-story-pilot/final-ffprobe-v2.json` | Probe evidence của container, codec, streams, dimensions, rate và duration. |
| `outputs/moon-story-pilot/delivery-manifest-v1.json` | Provenance, tool versions, hashes, QA gates và policy flags. |
| `outputs/moon-story-pilot/delivery-hashes.txt` | Hash evidence của MP4, scene, narration, SRT, scene manifest và Blender executable. |
| `outputs/moon-story-pilot/qa-frame-05s.png`, `qa-frame-19s.png`, `qa-frame-21s.png`, `qa-frame-26s.png` | Historical visual QA checkpoints; files đã bị retirement trong cleanup. |

## QA đã thực hiện

Frame 05 giây cho thấy bố cục Earth–Moon true-3D đọc được trên khung dọc và subtitle lớn, tương phản cao. Frame 19 giây phát hiện cue “Mặt xa không phải mặt tối” xuất hiện sớm khi helper tidal-lock vẫn còn trên khung. Cue đã được dời sang 20.2 giây; frame 21 giây xác nhận câu reveal xuất hiện sau khi helper kết thúc, không còn leakage của arrow. Frame 26 giây xác nhận conclusion không bị cắt chữ, nhưng layout bốn dòng hơi lớn; đây là khoản cần cải thiện ở lookdev/social-master pass.

Đã chạy FFprobe sau khi re-burn: output lịch sử giữ 30.000 giây, 540×960, 30 fps, H.264 và AAC mono 48 kHz. Media đã bị retirement; toàn bộ motion chưa được xem liên tục theo thời gian thực và narration chưa có human listening approval.

## Claim và editorial review

Claim về việc Mặt Trăng quay trên trục với tốc độ bằng chuyển động quỹ đạo được NASA mô tả là synchronous rotation, một trường hợp của tidal locking [1]. NASA cũng mô tả Moon quay một vòng cho mỗi vòng quỹ đạo nên cùng một mặt hướng về Trái Đất [2]. Claim “mặt xa không phải mặt tối” và việc mặt xa vẫn nhận ánh sáng Mặt Trời được đối chiếu với NASA Top Moon Questions [3].

Video vẫn dùng cách nói phổ thông “chúng ta luôn thấy một mặt”. Khi xuất bản như nội dung giáo dục chính thức, editor nên cân nhắc thêm chú thích về libration hoặc đổi thành “gần như luôn cùng một mặt hướng về chúng ta”. Claim matrix đầy đủ và giới hạn mô phỏng nằm tại `docs/operations/MOON_STORY_CLAIM_MATRIX_2026-08-26.md`.

## Voice, rights và policy

Narration dùng preset nam tiếng Việt được phép `Adam`; không dùng reference audio, không clone creator TikTok và không dùng pitch shifting để mô phỏng người thật. Model preparation đã có một lần tải model qua network; synthesis đã chạy offline và không gọi cloud. TikTok/Douyin chỉ được dùng làm moodboard về nhịp/camera, không tải footage, không scrape, không tháo watermark và không sao chép creator. Scene và asset đều procedural/local, không có third-party footage. Không có auto-login, upload, publish, payment hay browser polish trong slice này.

Blender 5.2.1 LTS portable được cài ngoài repo theo permission trước đó; executable SHA-256 là `8f7a131ad8bc148edc218b334f07d92a57f5a357fa66d913b290537fd8353c06`. Vì Blender 5.2.1 có hành vi không nhất quán khi gán FFMPEG output sau khi load blend, pipeline đã tách render PNG sequence và FFmpeg encode/burn. Chi tiết reproducibility nằm trong `outputs/moon-story-pilot/delivery-manifest-v1.json`.

## Tests và commands

| Command | Kết quả |
|---|---|
| `python scripts/test_true3d_moon_story_worker.py` | 4 tests, pass; chỉ boundary/argument, không render. |
| `python scripts/test_browser_handoff_worker.py` | 4 tests, pass. |
| `python scripts/test_local_pipeline_workers.py` | 20 tests, pass. |
| `cd desktop\\src-tauri && call D:\\VSBuildTools\\Common7\\Tools\\VsDevCmd.bat && cargo fmt -- --check && cargo test --lib` | 48 passed, 4 ignored, 0 failed. |
| `cd desktop && pnpm build` | TypeScript/Vite production build pass. |
| `python scripts/validate_project.py --project .` | `AUTO3DVIDEO_PROJECT_VALID`; 264 inventory/physical files checked after workflow contracts. |
| FFprobe final MP4 | Container/stream validation pass; evidence ở `final-ffprobe-v2.json`. |
| `certutil -hashfile ... SHA256` | Hash evidence đã lưu ở `delivery-hashes.txt`. |

## Cost và giới hạn

| Hạng mục | Ghi nhận |
|---|---|
| Blender/FFmpeg | Local execution; không gọi cloud video API. |
| VieNeu | Local synthesis; có network một lần để prepare/download model cache. Không có cloud TTS call trong synthesis. |
| BrowserMCP | Không cần bật cho local pilot; không thực hiện web polish. |
| `Disk` | PNG sequence và các render artifact cũ đã được xóa theo cleanup request; `.blend` và provenance vẫn giữ. |
| Chất lượng | 540×960 là technical pilot, chưa phải 1080×1920 social master; material/lighting còn procedural/simple. |
| Human gates | Chưa duyệt full-motion, audio listening, final editorial claim wording hoặc publishability. |

## Next action của người dùng

Nếu cần review lại hình/âm thanh, phải rerender từ `.blend` theo một plan mới; bản MP4 cũ không còn trên disk. Không nên đăng hoặc gửi sang BrowserMCP trước khi có workflow mới, output mới và human approval.

Nếu cần nâng fidelity, bước tiếp theo nên là một lookdev pass được duyệt riêng với material Earth/Moon tốt hơn, far-side lighting proof rõ hơn, safe-area caption nhỏ hơn và target 1080×1920; không nên gọi bản hiện tại là polished social master.

## References

[1]: https://science.nasa.gov/resource/the-moons-rotation/ "NASA Science — The Moon's Rotation"

[2]: https://science.nasa.gov/moon/tidal-locking/ "NASA Science — Tidal Locking"

[3]: https://science.nasa.gov/moon/top-moon-questions/ "NASA Science — Top Moon Questions"
