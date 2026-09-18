# MoneyPrinterV2 Case Study — Pipeline lồng tiếng, video và visual grounding

**Ngày nghiên cứu:** 2026-08-23  
**Phạm vi:** Đọc repository chính thức, source hiện tại, tài liệu Mintlify chính thức và issue liên quan; không sao chép code, không chạy workflow upload/scraping và không dùng credential thật.  
**Mục đích:** Học các pattern MVP có giá trị cho Auto3Dvideo, đồng thời giải thích nguyên nhân hình ảnh ghép bị chung chung, lặp hoặc lệch chủ đề.

## 1. Kết luận điều hành

MoneyPrinterV2 là một **CLI Python end-to-end khá gọn** cho các workflow kiếm tiền trực tuyến: YouTube Shorts, Twitter/X bot, affiliate marketing và local-business outreach. Repo có giá trị làm case study về cách nối topic → script → voice → subtitle → video → delivery trong một đường happy path ngắn. README và maintainer notes mô tả đây là ứng dụng Python 3.12, không có web UI, REST API, CI hoặc test suite như một nền tảng production đa provider. [1] [2]

Điểm cần phân biệt là **“có nhiều trường cấu hình” không đồng nghĩa với “có nhiều model/provider được chuẩn hoá”**. Source hiện tại cho thấy text đi qua Ollama local, image đi qua Nano Banana 2/Gemini, TTS dùng KittenTTS, STT có faster-whisper local hoặc AssemblyAI; phần video chủ yếu là MoviePy compositor chứ không có video-model adapter tổng quát. [2] [3] [4] [5] Vì vậy, MoneyPrinterV2 rất đáng học ở mức **MVP orchestration và UX chọn model local**, nhưng không nên xem là nền tảng multi-model API hoặc control plane bền vững.

> Đánh giá ngắn: **tốt để học đường ống happy path; chưa đủ để làm chuẩn cho job state, visual continuity, provider abstraction, rights ledger hoặc automatic publishing an toàn.**

## 2. Những gì repo làm tốt và nên học

| Pattern trong MoneyPrinterV2 | Giá trị thực tế | Cách Auto3Dvideo tiếp thu |
|---|---|---|
| Stage sequence ngắn, dễ hiểu | Người dùng nhanh chóng thấy từ topic đến video cần những bước nào | Giữ pipeline dọc nhưng tách mỗi stage thành contract, attempt và evidence bền vững |
| Ollama model picker | Cho phép chọn model local đang có thay vì gắn chết một model | Giữ UX chọn profile local; bổ sung capability, context, health, resource và terms metadata |
| KittenTTS local | Có đường voice không cần cloud API; dễ thử nghiệm chi phí thấp | Dùng TTS adapter; thêm voice provenance, consent, duration, loudness và artifact metadata |
| Local Whisper hoặc AssemblyAI | Cho phép cân bằng giữa local/free và cloud/convenience | Dùng STT adapter; bắt buộc ghi provider, model, timestamps, cost/terms và fallback attempt |
| Tạo subtitle sau khi có audio | Timestamp được suy ra từ audio thay vì chỉ đoán từ script | Giữ stage này; dùng word/sentence timestamps để phân đoạn beat và căn timeline |
| Fixed argument list cho helper process | An toàn hơn ghép chuỗi shell tuỳ ý trong cron | Giữ nguyên tắc typed operation → allowlisted executable → explicit args, timeout, cancel và output validation |
| Review trước upload | Repo vẫn ghi nhận nhu cầu xem preview trước khi phát hành | Nâng thành approval gate riêng cho quality, rights, disclosure, platform và publish |

Pattern tốt nhất không phải là việc một class làm mọi thứ, mà là **khả năng đưa một người mới đi hết đường happy path với ít cấu hình**. Auto3Dvideo nên giữ sự đơn giản ở bề mặt UI, nhưng không đánh đổi state machine, audit, retry bound và provenance ở bên dưới.

## 3. Provider/API thực tế trong source hiện tại

| Năng lực | Thực tế quan sát được | Nhận định |
|---|---|---|
| LLM/text | `src/llm_provider.py` tạo Ollama client, list model local và lưu một model được chọn ở process-level | Hữu ích cho local picker, nhưng chưa phải provider-neutral adapter; không có capability schema, cost, terms hay per-stage model profile |
| Image | `YouTube.py` gọi tuyến Nano Banana 2/Gemini và tạo danh sách prompt từ script | Có image generation thật trong happy path, nhưng routing hiện hard-coded và prompt grounding còn yếu |
| TTS | `Tts.py` dùng `KittenML/kitten-tts-mini-0.8`, voice cấu hình và WAV 24 kHz | Đơn giản, local-first; còn thiếu quyền voice/likeness, kiểm tra duration, loudness và artifact contract |
| STT | Local `faster-whisper` hoặc cloud AssemblyAI để sinh SRT | Đây là switch provider hữu ích, nhưng cần normalized timestamps, cost/terms và retry/reconciliation |
| Video | MoviePy ghép image, audio, subtitle, music; không thấy adapter video model tổng quát trong source được khảo sát | Cần phân biệt media assembly với text-to-video/image-to-video generation |
| Publishing | Selenium điều khiển Firefox profile đã đăng nhập; Post Bridge là connector cross-post tùy chọn | Đây là side effect rủi ro, phải tách khỏi core và bị khóa sau human approval |
| Configuration | `config.json` chứa nhiều provider-specific fields, một số key fallback từ environment | Dễ khởi động nhưng không đạt chuẩn OS credential store, secret redaction và profile catalog |
| State/scheduling | JSON cache trong `.mp/`, scratch files và Python `schedule`/cron subprocess | Dễ làm MVP; không thay thế SQLite job graph, lease, heartbeat, restart recovery và idempotency |

Tài liệu Mintlify mô tả đúng đường đi tổng quát topic → script → metadata → image → voice → assembly → upload, đồng thời tài liệu API liệt kê các method như `generate_topic`, `generate_script`, `generate_prompts`, `generate_image`, `generate_script_to_speech`, `generate_subtitles`, `combine` và `upload_video`. [6] [7] Tuy nhiên, API dạng method của một class không tự tạo ra domain contract độc lập; nó vẫn gắn chặt creative generation, filesystem scratch, browser upload và lịch sử upload trong cùng operational model.

## 4. Vì sao visual montage bị “xàm”, lặp và không bám chủ đề

### 4.1. Prompt count không phải visual plan

Trong `YouTube.py`, số prompt hình được ước tính xấp xỉ `len(script) / 3`, sau đó prompt yêu cầu mô tả subject hoặc nội dung chung. Cách này chỉ biến độ dài chuỗi thành số ảnh; nó không biến script thành các **narrative beats** có chủ thể, hành động, bối cảnh, visual proof và thời lượng riêng. [3]

Ví dụ, một script năm câu có thể cần sáu shot vì có establishing shot, close-up hành động, insert bằng chứng, reaction và closing shot; ngược lại, một câu mô tả dài có thể chỉ cần một shot. Công thức dựa trên số ký tự hoặc độ dài script không biết những khác biệt đó.

### 4.2. Equal-duration slideshow làm mất quan hệ với narration

Ảnh được giữ trong thời lượng trung bình bằng tổng thời lượng TTS chia cho số ảnh. Khi số ảnh chưa đủ, danh sách ảnh được lặp để lấp đầy audio. Điều này làm cho một hình có thể xuất hiện khi narration đã chuyển sang claim khác, còn claim quan trọng lại không có hình chứng minh tương ứng. [3]

Đây là nguyên nhân kỹ thuật chính của cảm giác “ghép ảnh không theo chủ đề”: **audio timeline và visual timeline không có chung một beat map**. Hệ thống biết tổng thời lượng video nhưng không biết câu nào nói từ giây nào đến giây nào và shot nào chịu trách nhiệm minh hoạ câu đó.

### 4.3. Generic subject prompt không bảo đảm entity continuity

Nếu prompt chỉ lặp tên chủ đề hoặc subject chính, model có thể thay đổi tuổi, hình dáng, trang phục, vật thể, kiến trúc, palette hoặc thời điểm giữa các ảnh. Không có character/object bible, identity anchors, reference-image conditioning hay continuity check để phát hiện drift. Vì vậy, các ảnh riêng lẻ có thể “đẹp” nhưng ghép lại thành một video không có cùng thế giới.

### 4.4. Center crop chỉ sửa format, không sửa composition

Pipeline resize/crop về 9:16 và 1080×1920 giúp đầu ra hợp Shorts, nhưng center crop không hiểu subject, vùng chữ, hướng nhìn hoặc hành động. Một ảnh ngang có thể mất vật thể chính khi cắt giữa; một ảnh đúng subject nhưng sai framing vẫn được chấp nhận vì không có composition acceptance criteria. [3] [7]

### 4.5. Không có semantic rerank, visual proof hoặc reject loop

Source được khảo sát không cho thấy bước chấm điểm semantic similarity giữa narration và candidate image, không có LLM/CLIP judge theo beat, không có negative constraints theo entity, và không có per-shot review trước khi đưa asset vào timeline. Retry vì thế không phải là retry có điều kiện dựa trên lỗi visual; nó chỉ tạo lại hoặc tiếp tục với asset hiện có.

Music ngẫu nhiên được mix ở volume thấp và subtitle dùng style cố định có thể làm video hoàn chỉnh về mặt kỹ thuật, nhưng không giải quyết câu hỏi quan trọng: **shot này đang chứng minh hoặc truyền đạt ý gì?** [3]

### 4.6. Root cause

Đây không đơn thuần là “model image kém”. Root cause là kiến trúc đã gộp ba quyết định khác nhau vào một bước: **narrative decomposition**, **asset generation** và **timeline assembly**. Khi không có intermediate representation cho shot/beat, compositor chỉ có thể chia đều thời gian và lặp ảnh.

## 5. Cách Auto3Dvideo nên sửa bằng `NarrativeVisualPlan`

Auto3Dvideo đã có các khái niệm style bible, shot plan, reference asset, provider profile, review và delivery evidence trong workflow hiện tại. [14] [15] Case study này xác nhận cần biến chúng thành một contract trung gian cụ thể, đặt sau script và trước provider generation:

```text
brief
  → normalized script + narration timestamps
  → NarrativeVisualPlan
  → per-beat asset candidates
  → continuity/semantic review
  → shot timeline
  → render/probe
  → human-approved delivery package
```

Mỗi beat hoặc shot nên có tối thiểu các trường sau:

| Nhóm | Trường đề xuất | Mục đích |
|---|---|---|
| Identity | `beatId`, `shotId`, `order`, `episodeId` | Bảo đảm thứ tự liên tục và truy vết |
| Narration | sentence/word span, `startMs`, `endMs`, narration text hash | Căn visual với câu nói thật, không chia đều tổng audio |
| Intent | claim, visual intent, shot type, camera/action | Nói rõ shot cần truyền đạt gì |
| Entities | entity IDs, immutable identity anchors, relations | Giữ nhân vật/vật thể/bối cảnh không drift |
| World | setting, time, palette, lighting, wardrobe/material constraints | Kế thừa style bible và continuity |
| Evidence | visual proof requirement, must-show/must-not-show | Chống hình đẹp nhưng không chứng minh claim |
| Generation | prompt, negative prompt, prompt version, reference asset IDs | Tái lập prompt và reference conditioning |
| Provider | model profile ref, adapter, resolution/aspect ratio | Không lưu secret; ghi profile đã chọn |
| Candidates | output asset IDs, semantic score, continuity score, reviewer note | Không overwrite candidate bị reject |
| Governance | rights/provenance, cost estimate, budget decision, disclosure | Chặn paid/risky generation chưa được duyệt |
| State | planned → generating → needs_review → approved/rejected/blocked | Retry và approval có trạng thái rõ ràng |

### 5.1. Quy trình sửa visual theo beat

Đầu tiên, script được chuẩn hóa thành các beat có mục đích, claim và span narration. Beat không bắt buộc phải tương ứng một câu; nó có thể gộp hoặc tách câu theo ý nghĩa hình ảnh. Sau khi TTS hoặc STT có timestamp, beat nhận khoảng thời gian thực tế thay vì thời lượng trung bình.

Tiếp theo, hệ thống tạo một shot brief có entity anchors, setting, visual proof, camera và negative prompt. Nếu entity lặp lại, shot phải tham chiếu cùng identity record hoặc reference asset đã được chấp thuận. Nếu claim là factual, visual proof phải mô tả thứ bắt buộc xuất hiện; nếu không có bằng chứng phù hợp, beat phải `needs_revision` hoặc `blocked`, không tự lấp bằng ảnh chung chung.

Sau đó, mỗi beat có thể sinh nhiều candidate. Candidate được kiểm tra tối thiểu về file/dimension, semantic alignment với narration, entity continuity với approved reference, composition trong safe area và rights/provenance. Candidate kém được giữ ở trạng thái rejected để audit; không ghi đè candidate đã duyệt.

Cuối cùng, timeline lấy `startMs/endMs` của beat để đặt shot. Shot thiếu asset không được loop im lặng; hệ thống phải hiện blocker, dùng placeholder rõ ràng trong preview hoặc yêu cầu người dùng duyệt phương án thay thế. Đây là khác biệt cốt lõi so với equal-duration slideshow.

### 5.2. Acceptance gates tối thiểu

Một visual plan chỉ được chuyển sang generation khi coverage của narration đã đủ, beat IDs không trùng/không nhảy, output path nằm trong workspace, prompt không chứa raw shell command, provider profile hợp lệ và các entity lặp có identity anchors. Một candidate chỉ được `approved` khi semantic/continuity checks và rights state không bị block; điểm máy chỉ là tín hiệu hỗ trợ, không thay thế human review.

## 6. So sánh với kiến trúc Auto3Dvideo hiện tại

| Chủ đề | MoneyPrinterV2 | Auto3Dvideo | Kết luận học hỏi |
|---|---|---|---|
| Creative flow | Một class YouTube điều phối gần như toàn bộ | Brief, script, style, shot, generation, ingest, review, delivery là các stage | Giữ happy path đơn giản ở UI, không gộp domain state |
| Model selection | Ollama picker; image route hard-coded | Operation → model profile → adapter → credential ref → evidence | Học UX picker, giữ provider-neutral contract |
| Visual continuity | Không có beat/entity/semantic layer rõ ràng | Style bible, shot plan, character/object continuity đã được định hướng | Bổ sung `NarrativeVisualPlan` và validator là vertical slice tiếp theo |
| Timing | TTS duration chia đều cho images, có loop | Workflow hướng tới timestamped script, timeline và output validation | Căn theo narration timestamps, không loop im lặng |
| Local worker | Python/MoviePy/ImageMagick và nhiều dependency trong một CLI | Rust/Tokio process boundary, FFmpeg/Blender/ComfyUI adapter riêng | Tách capability và supervised worker |
| State | JSON cache/scratch files | SQLite migrations, jobs, attempts, leases, audit | Không dùng JSON scratch làm source of truth |
| Publish | Selenium Firefox profile và Post Bridge | Publish disabled mặc định, delivery package + human approval | Chỉ học review payload/retry HTTP có bounded policy; không auto-upload |
| Safety | Có preflight/helper nhưng active network/credential checks | No-spawn readiness, rights/cost/security gates, explicit confirmation | Preflight phải nói rõ có spawn/network hay không |

Auto3Dvideo không cần thay kiến trúc hiện tại để học repo này. Ngược lại, các tài liệu [AI Provider Architecture](../docs/architecture/AI_PROVIDER_ARCHITECTURE.md), [AI Generation Workflow](../docs/07_AI_GENERATION_WORKFLOW.md), [3D Asset and Scene Workflow](../docs/08_3D_ASSET_AND_SCENE_WORKFLOW.md), [Security Boundaries](../docs/architecture/SECURITY_BOUNDARIES.md) và [Render and Delivery Workflow](../docs/09_RENDER_AND_DELIVERY_WORKFLOW.md) đã đặt đúng các boundary mà MoneyPrinterV2 còn gộp. Khoảng trống cần làm tiếp là contract/validator/preview cho visual plan, không phải thêm một image API ngay lập tức.

## 7. Nên adopt và không nên adopt

| Quyết định | Nội dung |
|---|---|
| **Adopt** | Stage ordering compact: brief/topic → script → voice/STT → visual/asset → timeline → review/delivery. |
| **Adopt** | Local Ollama discovery/selection như một profile UX, nhưng lưu profile/capability/health thay vì process-global singleton. |
| **Adopt** | Local TTS/STT trước cloud để có đường free-first; mọi voice/model vẫn phải có terms và rights metadata. |
| **Adopt** | Fixed typed subprocess arguments, timeout, bounded retries, logs redacted và preflight rõ side effect. |
| **Adopt cautiously** | HTTP client pattern của Post Bridge: timeout, retryable status, pagination, idempotency và response validation; chỉ dùng sau publish gate. |
| **Do not adopt** | Direct `config.json` credential fields, raw keys trong UI/project hoặc fallback làm lộ secret. |
| **Do not adopt** | Một class vừa lập kế hoạch, gọi provider, ghép media, quản lý scratch state và upload. |
| **Do not adopt** | Equal-duration image slideshow, image loop để lấp audio và center crop như tiêu chí duy nhất. |
| **Do not adopt** | Selenium điều khiển Firefox profile, automatic upload/cross-post hoặc scheduler chạy side effect khi chưa có confirmation. |
| **Do not adopt** | Google Maps scraping, cold outreach, affiliate posting, spam hoặc các workflow social bot làm default product capability. |
| **Do not adopt** | Issue #259 như một cơ chế viral-video download → re-edit → re-upload; chỉ học review payload có thumbnail/source/draft/approve/reject khi nguồn và quyền hợp lệ. |
| **Do not adopt** | Recursive/unbounded retry, JSON scratch state, marketing claim hoặc số star như bằng chứng chất lượng/production readiness. |

## 8. License, rights và policy boundary

MoneyPrinterV2 công bố giấy phép AGPLv3. [1] Code, prompt, dependency và asset của repo không được xem là tài sản có thể copy vào Auto3Dvideo mà không phân tích license tương ứng. Research này chỉ ghi nhận pattern kiến trúc và hành vi quan sát được; không sao chép implementation. KittenTTS, Ollama, Gemini/Nano Banana, AssemblyAI, MoviePy, ImageMagick, Selenium, Firefox, Post Bridge, nhạc nền và media tải ngoài đều có terms/license riêng phải kiểm tra lại trước mỗi integration.

Đặc biệt, việc một pipeline có thể upload không chứng minh output được phép monetization. Auto3Dvideo tiếp tục yêu cầu rights/provenance cho footage, image, music, voice, likeness và model output; AI disclosure, platform policy, privacy, budget và human review vẫn là các gate độc lập. [16] [17] Không tự động hóa unauthorized reposting, watermark removal, account/region bypass, fake engagement, impersonation, scraping hoặc publish không có explicit confirmation.

## 9. Traceability và backlog đề xuất

| Finding | Quyết định | Artifact cần tạo ở vertical slice kế tiếp | Verification |
|---|---|---|---|
| Prompt count gần `len(script)/3` không đại diện shot | Tách narrative decomposition khỏi image generation | `narrative-visual-plan.schema.json`, sanitized fixture và validator | Reject thiếu beat, beat trùng/nhảy, coverage thiếu và field raw command |
| Image duration chia đều và loop | Dùng timestamp span của narration | Compiler preview không spawn provider | Beat timeline có start/end rõ; không tự loop asset |
| Subject drift giữa các ảnh | Dùng identity anchors + reference assets + adjacent-shot review | Entity/continuity fields và review state | Fixture có entity lặp nhưng thiếu anchor phải fail |
| API/config provider-specific | Profile/adapter/credentialRef tách khỏi workflow | Mapping vào provider-profile và provider-request contracts | No secret in JSON/log; capability/terms/cost gate |
| Generate-and-upload gộp một bước | Delivery package trước, publish sau và disabled mặc định | Review payload + delivery manifest | Publish không thể xảy ra trong mock/no-spawn path |
| Retry không theo quality reason | Bounded per-beat attempts và reject evidence | Attempt/evidence record | Exhaustion hoặc approval stop, không retry vô hạn |

**Trạng thái implementation:** case study này chưa triển khai contract `NarrativeVisualPlan`, chưa gọi Ollama/Gemini/KittenTTS và chưa tạo media thật. Đây là research-to-backlog evidence, không phải claim rằng visual planner hoặc provider worker đã chạy.

## 10. Hạn chế của nghiên cứu

Kết luận được rút ra từ revision/source/docs công khai quan sát tại ngày nghiên cứu. Số star, fork, issue, PR và commit là metadata theo thời điểm, không phải benchmark. Tài liệu Mintlify có dấu hiệu drift so với source/README cũ, vì vậy source hiện tại được ưu tiên khi mô tả hành vi. Provider pricing, quota, region, retention, commercial rights và platform policy phải được recheck khi implement hoặc release; case study này không phải tư vấn pháp lý, không bảo đảm monetization và không xếp hạng model.

## References

[1]: https://github.com/FujiwaraChoki/MoneyPrinterV2 "MoneyPrinterV2 official repository and README"
[2]: https://github.com/FujiwaraChoki/MoneyPrinterV2/blob/main/CLAUDE.md "MoneyPrinterV2 maintainer architecture notes"
[3]: https://raw.githubusercontent.com/FujiwaraChoki/MoneyPrinterV2/main/src/classes/YouTube.py "MoneyPrinterV2 YouTube pipeline source"
[4]: https://raw.githubusercontent.com/FujiwaraChoki/MoneyPrinterV2/main/src/classes/Tts.py "MoneyPrinterV2 KittenTTS source"
[5]: https://raw.githubusercontent.com/FujiwaraChoki/MoneyPrinterV2/main/src/llm_provider.py "MoneyPrinterV2 Ollama provider source"
[6]: https://fujiwarachoki-moneyprinterv2.mintlify.app/api/youtube "MoneyPrinterV2 YouTube API documentation"
[7]: https://fujiwarachoki-moneyprinterv2.mintlify.app/features/youtube-automation "MoneyPrinterV2 YouTube automation documentation"
[8]: https://fujiwarachoki-moneyprinterv2.mintlify.app/configuration/settings "MoneyPrinterV2 settings documentation"
[9]: https://github.com/FujiwaraChoki/MoneyPrinterV2/blob/main/config.example.json "MoneyPrinterV2 example configuration"
[10]: https://github.com/FujiwaraChoki/MoneyPrinterV2/blob/main/LICENSE "MoneyPrinterV2 AGPLv3 license"
[11]: https://github.com/FujiwaraChoki/MoneyPrinterV2/issues/259 "MoneyPrinterV2 issue #259 review and video sourcing proposal"
[12]: https://raw.githubusercontent.com/FujiwaraChoki/MoneyPrinterV2/main/src/cron.py "MoneyPrinterV2 cron runner source"
[13]: https://raw.githubusercontent.com/FujiwaraChoki/MoneyPrinterV2/main/src/classes/PostBridge.py "MoneyPrinterV2 Post Bridge client source"
[14]: ../docs/architecture/AI_PROVIDER_ARCHITECTURE.md "Auto3Dvideo AI provider architecture"
[15]: ../docs/07_AI_GENERATION_WORKFLOW.md "Auto3Dvideo AI generation workflow"
[16]: ../docs/architecture/SECURITY_BOUNDARIES.md "Auto3Dvideo security boundaries"
[17]: ../docs/policy/RIGHTS_AND_PLATFORM_GATES.md "Auto3Dvideo rights and platform gates"
[18]: ../docs/08_3D_ASSET_AND_SCENE_WORKFLOW.md "Auto3Dvideo 3D asset and scene workflow"
[19]: ../docs/09_RENDER_AND_DELIVERY_WORKFLOW.md "Auto3Dvideo render and delivery workflow"
