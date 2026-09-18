# Output and Provider Adapters

## Goal

Keep the core workflow stable while external AI providers, local engines and editors change. Adapters translate between a versioned internal contract and a tool-specific request; they do not leak provider-specific assumptions into the project model.

## Adapter categories

| Adapter | Input | Output |
|---|---|---|
| Local ComfyUI | Typed graph + bindings | Local media outputs + provider job metadata |
| Cloud video | Prompt/reference request | Downloaded media + provider terms/cost/job evidence |
| Blender | Scene/render spec | Images/video/metadata + process evidence |
| FFmpeg | Media operation | Normalized media + probe evidence |
| Editor handoff | Delivery folder/timeline | User-openable package; no hidden mutation |
| Platform preparation | Approved delivery | Platform-specific folder; publish remains gated |

## Adapter lifecycle

```text
capability discovery
  → input validation
  → cost/rights/availability estimate
  → approval check
  → submit
  → status/reconcile
  → download/ingest
  → output validation
  → evidence persistence
```

## Capability contract

Adapters report supported operations, duration/resolution bounds, input types, reference count, audio support, extension/edit support, asynchronous status support, cancellation, pricing unit, regional availability and terms metadata state. An unsupported capability must be reported before submit.

## Output normalization

Every media output is probed, copied into a versioned project path, hashed and associated with an asset record. The adapter must not silently transcode or alter output without recording the operation. Provider URLs are treated as temporary and are never the durable project identity.

## Provider failover

Failover is not automatic for a paid request unless the original provider side effect is reconciled and the user policy permits a different provider. A provider can be disabled without deleting historical outputs. Switching provider changes the generation evidence and requires a new attempt/version.

## Editor handoff

The app exports standard MP4/WAV/SRT/VTT/PNG/JSON files and optional OTIO. It may open the configured editor, but cannot assume that a GUI launch means a delivery succeeded.

## Publish boundary

Platform adapters prepare files and metadata. External posting is a separate, explicit capability with account authorization, current API support, disclosure state, rights state and user confirmation.
