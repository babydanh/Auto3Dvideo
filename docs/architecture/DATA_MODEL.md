# Project Data Model

## Entity hierarchy

```text
Project
  └── Episode
        └── Video
              ├── Brief
              ├── StyleBible
              ├── PromptPreset
              ├── Shot
              │     ├── PromptVersion
              │     ├── ReferenceLink
              │     ├── GenerationJob
              │     └── Review
              ├── Timeline
               ├── Asset / AssetLibrary
               │     └── ReferenceSet / ReferenceAssignment
              ├── RightsRecord
              ├── Delivery
              └── AuditEvent
```

## Identity rules

Every entity has a stable ID, schema version, created/updated timestamps and owner/project scope. Files are identified by relative project path and content hash. A path alone is not a durable identity because files may be moved or overwritten.

## State ownership

| Entity | Primary state |
|---|---|
| Project | `active`, `archived`, `locked`, `restoring` |
| Episode/video | `draft`, `in_production`, `review`, `approved`, `delivered`, `blocked` |
| Shot | `planned`, `generating`, `generated`, `needs_review`, `approved`, `rejected`, `archived` |
| Asset | `ready`, `quarantined`, `missing`, `archived` |
| Job | `draft`, `queued`, `running`, `succeeded`, `failed`, `cancelled`, `blocked` |
| Delivery | `draft`, `validated`, `approved`, `exported`, `published_pending`, `published` |
| PromptPreset | `draft`, `active`, `archived` |

## Data separation

Creative content, operational metadata, rights evidence and secrets are separate concerns. Secrets are not stored in the database. Raw provider payloads are minimized and redacted. Generated media remains in the project filesystem/object store; SQLite stores references, metadata and hashes.

## Versioning

Schema changes use numbered migrations. Contract changes require a compatibility note, fixture update and migration path. Prompt/style/workflow changes receive explicit versions so an output can be reproduced or explained later.

Prompt presets are project-scoped local records. An update is append-only at the metadata level: it creates a new `presetId` with a new `version` and `parentPresetId`, while the previous version remains available for review or restoration. Archive/restore changes only the preset state; it never deletes prompt text or rights notes. Preset templates may contain only declared variable keys and must not contain secrets, credentials or raw provider payloads.

Asset Library records are project-scoped and preserve the imported file's relative path and SHA-256 as evidence. Import accepts only bounded local files with a supported MIME/type mapping; files outside the workspace are copied into `assets/references/` before the record is committed. Rights states `unknown`, `pending`, `restricted` and `rejected` quarantine the asset; metadata updates cannot alter the hash or path evidence. Reference assignments capture the current asset hash, role, strength, priority, optional shot ID and approval state so continuity drift can be detected before a run.

## Deletion

Deletion is soft by default for metadata and versioned by default for media. A purge operation requires explicit confirmation and records scope, actor and timestamp. Backups must not silently retain data after a user-requested purge policy is applied.

## Privacy

The project should minimize personal data. Voice, face, likeness, user-provided media and creator account information require a rights/privacy state. Logs should reference stable IDs rather than copying private content.
