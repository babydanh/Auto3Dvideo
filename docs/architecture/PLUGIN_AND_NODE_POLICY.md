# Plugin and Custom-Node Policy

## Scope

Auto3Dvideo may integrate ComfyUI custom nodes, Blender add-ons and provider adapters. These are extension points, not trusted by default.

## Extension record

```text
extension_id
kind
source_uri
version
commit_or_digest
license
permissions
required_models
tools_used
reviewer
approved_at
rollback_path
status
```

## Install flow

```text
discover
  → display source/license/permissions
  → download to quarantine
  → verify checksum/signature where available
  → review dependency and filesystem/network needs
  → explicit user approval
  → install into isolated/configured location
  → health check
  → enable for selected project
```

## Prohibited behavior

An extension must not silently access secrets, scan unrelated project folders, upload media, execute arbitrary downloads or alter the global environment. A workflow URL or prompt cannot authorize an installation.

## Version pinning

The project records extension version and graph compatibility. Upgrading an extension invalidates or rechecks affected workflows. A rollback keeps the old version available until the project confirms the new one.

## Disable switch

The user can disable an extension/provider globally or per project. Existing output evidence remains readable even when the extension is disabled.

## Review levels

| Level | Requirement |
|---|---|
| Local trusted | Known official tool, pinned version and limited permissions |
| Community node | Source/license review, quarantine, explicit approval and fixture test |
| Cloud provider | Terms/cost/region/API review and provider adapter test |
| Unknown binary | Blocked |
