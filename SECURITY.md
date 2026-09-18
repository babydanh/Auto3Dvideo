# Security Policy

## Current status

Auto3Dvideo is currently a planning-only repository. It has no released desktop binary, hosted service or supported production API. Security controls described here are design requirements, not a claim that they are already implemented.

## Security boundaries

The future application must treat workflow YAML, prompts, imported assets, provider responses, custom nodes, Blender files and agent output as untrusted data. It must use path containment, executable allowlists, structured arguments, bounded timeouts, process-tree cancellation, output validation, secret redaction and explicit approval for external side effects.

## Do not disclose

Do not place API keys, access tokens, private keys, cookies, `.env` values, personal data, private client media or production logs in issues, commits, fixtures or reports. Provider credentials belong in the operating system credential store or an explicitly configured secret manager.

## Reporting

For a local/private copy, record the finding privately for the project owner and include reproduction steps, affected contract or boundary, impact, mitigation and whether credentials or user media may have been exposed. Do not publish exploit details before a fix and release decision exist.

## Security review triggers

A review is required before enabling a new process executable, custom node, provider, downloader, plugin, remote endpoint, publishing action, agent tool or automatic update. The review must record source, version, permissions, license/terms, rollback path and test evidence.

## Limitations

This document is not legal advice, a guarantee of platform compliance or a claim of third-party tool security. Third-party tools and provider terms must be reviewed at the time of integration and release.
