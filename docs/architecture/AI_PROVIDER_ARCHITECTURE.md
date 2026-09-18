# AI Provider Adapter Architecture

## Purpose

Provide a stable internal contract for local and cloud AI generation while allowing providers, models, plans and regions to change. The app must store what actually happened and must never claim that two providers have identical semantics.

## Adapter boundary

```text
Auto3Dvideo domain request
  → capability check
  → estimate
  → approval/budget gate
  → provider request
  → provider job ID
  → status polling/callback
  → output download/validation
  → provenance record
```

## Normalized operations

| Operation | Meaning |
|---|---|
| `generateImage` | Create reference image or still |
| `generateVideo` | Create a video from text/reference inputs |
| `extendVideo` | Continue an existing output if provider supports it |
| `editVideo` | Modify an existing video or targeted time range |
| `transcribe` | Produce timestamped speech text |
| `synthesizeSpeech` | Produce voice audio from approved text |
| `analyzeOutput` | Run local or provider analysis; never replace human review |

## Required adapter methods

```text
getCapabilities()
validateRequest(request)
estimateCost(request)
submit(request, idempotencyKey)
getStatus(providerJobId)
cancel(providerJobId)
fetchOutputs(providerJobId)
normalizeError(error)
getTermsMetadata()
healthCheck()
```

## Request contract

A request includes project/episode/shot identity, operation, prompt version, reference asset IDs, input file hashes, language, aspect ratio, resolution, duration, frame rate, audio mode, model/provider selection, safety flags, budget decision and idempotency key.

A prompt must be versioned and stored separately from the provider request. The app stores redacted request metadata, not secrets or unnecessary personal data.

## Configuration resolution

Provider selection is resolved from three layers: a non-secret project/profile catalog, environment variables for development overrides and the Windows OS credential store for secret values. The resolution order is explicit and recorded as metadata without recording the secret itself.

```text
stage.modelProfile
  → workflow.providerDefaults
  → project provider catalog
  → mock profile when permitted

profile.baseUrlEnv / profile.modelEnv
  → local .env only in development
  → packaged settings or UI-managed non-secret config

profile.credentialRef
  → env:VARIABLE_NAME for local development
  → os:credential-name for packaged use
  → never serialized as a secret value in SQLite/logs
```

A `.env.example` file contains names and empty placeholders only. The desktop development loader reads only bounded `AUTO3DVIDEO_*` assignments from a local `.env`, with process environment values taking precedence; it never returns secret values to the UI or logs. A local `.env` is ignored by Git and must not be uploaded, printed or attached. For a packaged Windows build, the preferred path is an OS credential store/keychain reference with a one-time setup screen that displays only masked status. The persisted reference grammar is intentionally narrow: `none`, `env:ASCII_ENV_NAME` or `os:approved-handle`; a raw credential value, file path or arbitrary URI is invalid. The current desktop slice resolves only development environment values for masked readiness, stores and displays credential handles without secret values, and does not yet resolve an OS credential store or call a provider.

## Provider capability matrix

| Capability | Local graph | Cloud provider |
|---|---|---|
| Stable endpoint | Local URL/port | Provider API or official SDK |
| Cost | Hardware/time | Per request/second/token/plan |
| Queue | Local persisted runner + provider queue | Provider job/status system |
| Output access | Local path | Authenticated download URL/object |
| Retry | Controlled local retry | Reconcile provider job before retry |
| Rights | Model/checkpoint/custom-node terms | Provider plan/output terms |
| Availability | GPU/VRAM dependent | Account, region, quota dependent |

## Error taxonomy

Errors are normalized to `INVALID_INPUT`, `UNSUPPORTED_CAPABILITY`, `AUTHENTICATION`, `AUTHORIZATION`, `RATE_LIMIT`, `QUOTA`, `TIMEOUT`, `NETWORK`, `PROVIDER_REJECTED`, `OUTPUT_INVALID`, `RIGHTS_UNKNOWN`, `BUDGET_BLOCKED`, `CANCELLED` and `UNKNOWN`. The UI shows actionable safe text; raw upstream responses are kept out of user-facing errors unless redacted.

## Safety rules

Provider hosts are allowlisted. API keys are retrieved at the last responsible moment from the configured credential backend. The adapter never logs authorization headers, raw signed URLs or full provider payloads containing private data. A cloud request is not submitted when estimated cost is unknown, terms metadata is missing for a commercial workflow or the budget gate is not approved. Environment-variable support is a development convenience, not a reason to expose secrets to the UI or commit them to the project.

## Local-first fallback

Every cloud adapter has a mock implementation and a deterministic fixture output. The UI can demonstrate the complete workflow with no API key. A provider outage should leave the project in `BLOCKED` or `RETRYABLE`, not break the rest of the project or delete prior outputs.

## Google Flow / Nano Banana image path

The preferred reference-image path is the Nano Banana composer built into the user's signed-in Google Flow project. BrowserMCP supplies fresh UI refs, Auto3Dvideo submits one shot at a time, waits for a newly downloaded image, hashes/imports it into the Asset Library, and resumes by `(shotId, revisionId, inputHash)` without creating a duplicate. The image path does not claim final video generation, never stores provider credentials, and keeps every imported asset at `rights=pending` until human review.

The older Nano Banana MCP stdio/CDP worker remains a compatibility path for historical reports and installations, but it is not the default route. ComfyUI remains an explicit local fallback rather than an implicit cloud provider.

## Evaluation

Provider evaluation uses the same prompt/reference/shot set and a human acceptance rubric. Store latency, cost, retries, output dimensions, motion/consistency notes and reviewer decision. Never select a provider solely from marketing claims or one showcase clip.
