# Rights and Platform Gates

This document is the short routing index for decisions involving ownership, licensing, likeness, music, voice, disclosure, monetization or platform delivery. It complements the detailed rights ledger and the general automation gates.

## Required reading by operation

| Operation | Required documents | Minimum evidence |
|---|---|---|
| Import an asset | `docs/17_RIGHTS_AND_PROVENANCE.md`, `contracts/rights-record.schema.json` | Source, license/permission, usage scope and reviewer state |
| Generate with a cloud provider | `docs/architecture/AI_PROVIDER_ARCHITECTURE.md`, `docs/11_COST_BUDGET_AND_RETRY.md` | Provider, terms snapshot, cost estimate, budget approval and request hash |
| Use a person, voice or likeness | Rights document and project-specific permission record | Permission scope, identity/likeness review and disclosure decision |
| Use music/audio | Rights document plus source terms | License, territory/platform scope and attribution requirement |
| Prepare monetization | `docs/16_PUBLISHING_AND_PLATFORM_POLICY.md` | Rights approval, originality assessment, disclosure and human review |
| Prepare platform delivery | `docs/09_RENDER_AND_DELIVERY_WORKFLOW.md`, `docs/16_PUBLISHING_AND_PLATFORM_POLICY.md` | Valid media, captions, metadata, safety review and delivery manifest |
| Publish externally | All relevant policy documents | Separate explicit confirmation; publishing is disabled in MVP |

## Gate rule

A missing, expired, ambiguous or contradictory rights record blocks delivery for the affected asset or output. The app may still save a draft or private preview, but it must not label the result approved, publishable or monetizable.

## Policy-change rule

Platform rules and provider terms change. The app stores the source URL, retrieval date and reviewer note for policy evidence, but does not treat an old snapshot as permanent legal advice. Current platform requirements must be rechecked before an actual release or post.

## Safety boundary

This project does not automate unauthorized reposting, watermark removal, account or region bypass, fake engagement, impersonation or evasion of platform review. Any future publishing adapter requires separate scope, current API support, user authorization and a confirmation gate.
