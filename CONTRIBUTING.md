# Contributing to Auto3Dvideo

## Current status

This repository is a planning and contract pack. It is not yet a functioning Tauri application. Contributions should improve the architecture, contracts, fixtures, validation and pilot evidence without implying that unimplemented features exist.

## Change discipline

Every change should have a bounded scope, an updated plan or issue reference, a clear acceptance statement and a validation command. Do not mix this repository with the earlier web-app workflow repository.

## Safety requirements

Never commit credentials, provider tokens, personal data, downloaded model weights, generated media or local databases. Do not add automated publishing, unauthorized reposting, watermark removal, fake engagement, account bypass or scraping that violates a service's terms. Use mock/local fixtures for tests and keep paid cloud calls opt-in with budget and rights evidence.

## Documentation requirements

Changes to state machines, schemas, workflow YAML, process execution, provider adapters, rights gates or delivery behavior must update the relevant architecture/contract document and a failure-path test plan. Claims about provider capabilities, price or license must include a dated source and an explicit uncertainty note.

## Future implementation workflow

The planned implementation sequence is: validate contracts and fixtures; scaffold the Tauri/Rust/React shell; implement SQLite migrations and durable mock runner; add process supervision; add ComfyUI/Blender/FFmpeg adapters; add UI review surfaces; then add optional cloud providers. Each stage must pass the project quality gates before the next stage begins.
