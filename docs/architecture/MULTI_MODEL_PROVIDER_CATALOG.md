# Multi-Model and Multi-Provider Catalog

## Goal

One project may use many models and websites. Auto3Dvideo therefore separates the **creative operation** from the **provider implementation**. A workflow can select one model profile for script generation, another for image references, another for video shots, another for voice and a local Blender/FFmpeg worker for true 3D and delivery.

```text
operation → model profile → provider adapter → credential reference → request → evidence
```

The catalog is configuration, not a secret store. It records which adapter and model should be used; credentials are resolved only at execution time.

## Supported capability families

| Family | Example operations | Typical local option | Optional cloud option |
|---|---|---|---|
| LLM/chat | `chat`, `structured_output`, `script_draft`, `shot_plan` | Ollama-compatible local model | OpenAI-compatible, Gemini-style or other official API |
| Image | `generate_image`, `image_edit`, `reference_sheet` | ComfyUI graph/checkpoint | Official image API adapter |
| Video | `generate_video`, `extend_video`, `edit_video` | ComfyUI video graph when hardware allows | Official provider adapter such as a configured video API |
| TTS/voice | `synthesize_speech` | Piper/other approved local engine | ElevenLabs-style official voice API or another approved provider |
| STT | `transcribe` | Whisper-compatible local engine | Official speech API |
| Music/audio | `generate_music`, `mix_audio` | FFmpeg plus user-provided licensed audio | Official music/audio provider if terms permit |
| 3D asset | `generate_asset`, `normalize_asset` | Blender Python, local modeling tools | Optional asset API with rights review |
| 3D render | `render_scene`, `render_preview` | Blender CLI | Not delegated to a cloud provider by default |
| Media | `probe`, `compose`, `caption`, `mux`, `export` | FFmpeg | Not delegated to a cloud provider |

The names above describe adapter categories. They are not a promise that a specific provider, model, free tier or commercial-use right is available.

## Example profile catalog

| Profile ID | Operation | Adapter kind | Model/source | Secret reference |
|---|---|---|---|---|
| `llm_primary` | Script/shot planning | `openai_compatible` | User-selected model | `env:AUTO3DVIDEO_LLM_API_KEY` or OS keychain reference |
| `llm_local` | Script/shot planning | `ollama_compatible` | User-selected local model | None |
| `image_local` | Reference images | `comfyui` | User-selected checkpoint/workflow | None |
| `video_primary` | AI video shot | `video_http` | User-selected provider/model | `env:AUTO3DVIDEO_VIDEO_API_KEY` or OS keychain reference |
| `voice_primary` | TTS | `elevenlabs_compatible` | User-selected voice/model | `env:AUTO3DVIDEO_TTS_API_KEY` or OS keychain reference |
| `stt_local` | Transcription | `whisper_local` | Local model path reference | None |
| `blender_local` | True 3D render | `blender` | Installed Blender version | None |
| `media_local` | Compose/export | `ffmpeg` | Installed FFmpeg version | None |

The profile names are user-configurable. A profile can be disabled, replaced or pinned to a project without changing the core job graph.

## Selection rules

A stage may specify `operation`, `modelProfile`, `providerId` and a model identifier. Resolution follows this order: explicit stage profile, workflow profile default, project profile default, then mock profile when the workflow permits it. There is no silent provider switch for a paid or rights-sensitive operation.

Fallback is an explicit profile list with a separate approval and evidence record. A fallback is allowed only after the previous attempt is reconciled. It creates a new attempt/version and records the different provider, model, prompt version, terms snapshot and cost estimate.

## API abstraction

Adapters expose the same domain methods for all capability families:

```text
capabilities()
validate(request)
estimate(request)
submit(request, idempotency_key)
status(external_job_id)
cancel(external_job_id)
collect_outputs(external_job_id)
normalize_error(error)
terms_metadata()
health_check()
```

The internal request contains stable project/shot IDs, operation, prompt version, input hashes, output constraints, language, model profile, provider, idempotency key, rights state, budget state and approval state. The adapter owns the provider-specific request format.

## Credential modes

Development can read a local ignored `.env` file containing placeholders replaced by the user. A packaged Windows application should prefer the OS credential store and keep only a non-secret `credentialRef` in SQLite. UI screens show provider status and masked metadata, never the secret value. Logs, audit events and generated prompts must not contain authorization headers, signed URLs or raw environment values.

## Cost and rights

Each profile declares `pricingMode`: `free_local`, `subscription`, `free_tier`, `paid_api` or `unknown`. Unknown cost blocks a paid workflow. The catalog stores a source URL and review date for terms/pricing metadata, but runtime receipts remain authoritative. Model weights, voices, music, likeness and provider outputs require separate rights evidence.

## Provider examples and uncertainty

OpenAI-compatible, Gemini-style, ElevenLabs-style and video-provider adapters are intentionally described as adapter shapes rather than hard-coded guarantees. Before implementation, the project must verify the official endpoint, authentication method, API version, region, data retention, quota, commercial output rights and pricing for the chosen provider.
