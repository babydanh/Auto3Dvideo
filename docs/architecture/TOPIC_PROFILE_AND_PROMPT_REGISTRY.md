# Topic Profile và Prompt Registry

## Mục đích

Auto3Dvideo hỗ trợ nhiều loại video bằng cách tách **chủ đề**, **cách kể**, **loại cảnh**, **nguồn asset** và **prompt** thành các lớp có thể thay thế. Người dùng không phải sửa prompt trong Rust hoặc JSX. Prompt mẫu nằm trong `configs/prompt-templates.example.json`; profile chủ đề nằm trong `configs/topic-profiles.example.json`.

> Người dùng nhập nội dung ở ô **Chủ đề / ý tưởng** trong màn hình tạo dự án. Registry chỉ cung cấp khung xử lý và prompt version; không tự biến một prompt thành video hoàn chỉnh và không tự gọi cloud.

## Luồng dữ liệu

```text
Chủ đề người dùng + mục tiêu + đối tượng xem
    → Topic Profile
    → Prompt Template version
    → brief / claims / entity bible / narration
    → NarrativeVisualPlan
    → asset candidates + provenance + review
    → recipe/template render
    → output validation
```

Topic Profile quyết định recipe mặc định, visual mode, chiến lược shot, nguồn asset được phép và checklist QA. Prompt Template chỉ là văn bản có biến đầu vào và output contract. Một prompt không được chứa API key, command, shell, upload, publish hoặc credential field.

## Vị trí nhập prompt

| Nhu cầu | Nơi nhập | Kết quả |
|---|---|---|
| Ý tưởng video | Màn hình **Tạo dự án mới**, ô `Chủ đề / ý tưởng` | Brief ban đầu gắn với profile |
| Mục tiêu nội dung | Cùng màn hình, ô `Mục tiêu nội dung` | Điều chỉnh audience/promise/CTA |
| Prompt hệ thống | `configs/prompt-templates.example.json` | Template có `templateId`, `version`, `inputKeys`, guardrails |
| Profile chủ đề | `configs/topic-profiles.example.json` | Chọn recipe, visual mode, asset policy, QA |
| Prompt per-shot | `NarrativeVisualPlan.beats[].prompt` | `promptVersion`, positive, negative, grounding tokens |
| Prompt thử nghiệm riêng | Thư mục workspace của project, sau khi người dùng preview | Phải lưu version, source và review decision; không sửa prompt gốc âm thầm |

Trong UI, trường **Prompt nội dung bổ sung** chỉ là dữ liệu người dùng nhập cho phiên preview. Nó được hiển thị lại trước khi compile và không được coi là system instruction. Từ ngữ có thể ảnh hưởng đến quyền, publish, credential hoặc process execution phải bị chặn hoặc chuyển thành `NEEDS_REVIEW`.

Prompt per-shot được enrich bởi `cinematic_prompt_enricher`, một adaptation có giới hạn từ [cinematic-video-prompt-skill](https://github.com/Rylaispirit/cinematic-video-prompt-skill) (MIT). Adapter chỉ bổ sung vocabulary và thứ tự khối điện ảnh: shot size/góc máy, subject/action, setting, lighting, một camera movement, style/color, mood và technical output. Nó không được phép tạo command, gọi provider, bỏ qua identity/continuity/reference/rights gate hoặc biến reference media thành source asset.

## Profile mẫu

Catalog hiện có sáu profile: khoa học/giải thích, lịch sử/tài liệu, truyện/kể chuyện, sản phẩm/demo, gameplay/hướng dẫn và cinematic 3D. Các profile đều yêu cầu provenance, loại candidate lệch chủ đề và review của người dùng. Profile không có nghĩa là mọi asset hay claim trong chủ đề được phép sử dụng.

## Quy tắc version

`templateId` không đổi khi prompt được chỉnh nhỏ; mọi thay đổi nội dung phải tăng `version` theo SemVer dạng `vMAJOR.MINOR.PATCH`. NarrativeVisualPlan lưu `promptVersion` đã dùng để tái lập kết quả. Không overwrite prompt version cũ nếu project đã tham chiếu nó. Registry mẫu không chứa secret và không được dùng để chứa dữ liệu cá nhân hoặc script người dùng dài hạn.

## State và gate

Việc chọn profile/template chỉ là bước lập kế hoạch. State hợp lệ tiếp theo là `draft` hoặc `preview_ready`, không tự nhảy sang `running`, `published` hay `succeeded`. Trước generation cần kiểm tra capability, model/license, budget, rights và approval. Trước delivery cần kiểm tra output, subtitles, audio, accessibility, AI disclosure và human review. Publish vẫn bị khóa trong local-first MVP.

## Mở rộng an toàn

Profile mới phải thêm schema-compliant record, prompt IDs hợp lệ, QA checklist, allowed sources và test fixture. Template mới phải có output contract, guardrails và placeholder khớp `inputKeys`. Nếu profile chọn ComfyUI, Blender, Remotion hoặc cloud provider, workflow vẫn phải đi qua Rust executor/adapter tương ứng; không cho prompt tự tạo command hoặc gọi executable.
