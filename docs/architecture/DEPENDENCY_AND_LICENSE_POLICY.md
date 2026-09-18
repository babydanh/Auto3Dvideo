# Dependency and License Policy

## Principle

The core orchestrator should remain small, auditable and redistributable. Every dependency, model, custom node, editor and provider must be evaluated independently; “free to download” is not equivalent to “free for commercial use.”

## Dependency record

```text
dependency_id
name
version_or_commit
source
license
transitive_license_status
runtime_or_build_scope
network/filesystem permissions
model_or_asset_terms
reviewed_at
reviewer
upgrade_or_removal_note
```

## Categories

| Category | Default policy |
|---|---|
| Rust/TypeScript library | Pin version, review license and advisories, keep lockfile |
| System binary | User-installed or clearly licensed redistributable; verify path/version |
| Blender add-on | Treat as untrusted extension; record license/version and test in isolation |
| ComfyUI custom node | Quarantine, inspect dependencies/permissions, pin and fixture-test |
| Model weights | Record source, license, use restrictions, checksum and storage location |
| Cloud provider | Record terms, privacy, region, data retention, quota and price evidence |
| User media | Require rights record; never infer ownership from local presence |

## Distribution decision

The project license remains **TBD** until the user chooses. A permissive license such as MIT or Apache-2.0 may fit original orchestration code, but the final distribution must separately account for bundled dependencies, model weights, sample media, generated assets and provider terms. Do not copy third-party licenses into a release without checking their actual applicability.

## Upgrade gate

A dependency upgrade requires changelog review, license/advisory review, fixture tests, performance check, migration review when state changes, and a rollback note. Automated upgrades are not enabled in the planning stage.
