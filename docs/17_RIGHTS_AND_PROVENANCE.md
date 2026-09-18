# Rights and Provenance Workflow

## Purpose

Make each asset traceable before it reaches a monetized or client-facing delivery. “AI-generated” does not itself establish copyright ownership, commercial permission or platform eligibility.

## Rights ledger

Every asset record includes:

```text
asset_id
asset_type
source_uri_or_origin
owner
license_name
commercial_use
commercial_restrictions
derivative_use
platforms
territories
voice_or_likeness_consent
music_rights
proof_path
expiry
reviewer
status
```

## Asset classes

| Class | Minimum evidence |
|---|---|
| Self-created | Creator identity/ownership note and source project |
| Licensed | License/contract, scope, territory, expiry and proof |
| Public domain | Source and jurisdiction check |
| Provider output | Provider/account/plan terms snapshot and generation record |
| Third-party permission | Written permission with derivative/commercial/platform scope |
| Unknown | Blocked from publish/client use |

## AI-generated media

Record provider, model, generation ID, prompt version, reference assets, input rights state, output terms metadata, date, account/plan and any required disclosure. Do not promise that a provider's terms grant exclusive ownership or that an output is free from third-party claims.

## Voice and likeness

A real person's voice, face, performance, name or recognizable likeness requires consent appropriate to the intended use. A voice clone is not made safe by changing pitch or adding an AI label. If consent scope is unclear, the asset is blocked.

## Music and sound

Music, SFX and voice have separate rights from video footage. A license must cover commercial use, target platforms, territories, edits, ads and client delivery when applicable.

## Review decision

`approved` means approved for the recorded scope only. A change in platform, territory, campaign, asset version or monetization context invalidates the decision and requires re-review.
