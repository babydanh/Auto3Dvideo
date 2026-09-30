# PLAN-026: Multi-platform Preview Radar

Status: Social discovery radar is the primary flow; public cards are topic-sorted and remix-scored, while licensed archives and creator catalogs remain optional secondary sources

## 2026-09-16 preview recovery checkpoint

- Preview cards now reject discovery/page/navigation URLs such as `/explore`, `/item/create`, `/item/digg`, `/video/app` and `/video/pc`; validation is platform-specific and only accepts a known video/note identifier route, so a menu link cannot become the selected preview.
- TikTok preview derives the player URL from a valid video ID when the worker did not include `embedUrl`. Thumbnail CSP includes the known public CDN families used by supported public card metadata; a failed expiring thumbnail is shown as a fallback instead of a blank card.

## 2026-09-15 UI simplification checkpoint

- `Kho Preview` now puts the `Video đã quét` gallery first so the operator sees results before secondary actions.
- The scan bar now supports multiple platform checkboxes, a bounded result count and one `Quét toàn bộ` action. Keyword and manual ranking choices are removed from the primary flow.
- Results now expose worker-owned auto buckets: hot-new, rising, low-clone, fresh and unranked. The worker must provide evidence before the app shows real ranking data.
- The activity log is compact and paged at the top instead of occupying the preview workspace.
- Manual URL import is collapsed under `Thêm bằng URL thủ công`; the selected card and rights-gated download remain in the side panel.
- The scan button now prefers the native Obscura public scraper when `obscura.exe` is configured in Settings. It sends only fixed public discovery routes as bounded single-page `fetch` jobs (concurrency 3) with an explicit `networkidle0` settle window, does not enable stealth/proxy, returns cards and per-platform failure reasons, and never fabricates metrics. If Obscura returns valid cards for only some selected platforms, the desktop app preserves those cards and sends only the missing platforms to the one-tab BrowserOS worker; an invalid configured Obscura path still blocks instead of silently switching engines.
- The BrowserOS fallback keeps one visible tab, makes a bounded eight-scroll pass per selected public route, and extracts both rendered cards and non-secret public structured data embedded in the page. Returned cards are interleaved across detected topics and receive an editorial remix-potential score from observable title, thumbnail, freshness and engagement signals. Missing cards remain blocked with diagnostics; the worker never fabricates a trend result.
- If Bilibili is selected but Obscura/BrowserOS cannot read its SPA shell, the scan now makes a bounded fallback to Bilibili's public popular catalog endpoint. It returns validated BVID links, thumbnails, public view/like signals, an official player URL and topic/remix scoring; it does not download media or infer reuse rights.
- `Quét creator / playlist` is now a separate, explicit source mode backed by the allowlisted `yt-dlp.exe`. It accepts one public HTTPS creator/playlist URL for the one selected platform, uses `--flat-playlist --skip-download --dump-single-json`, normalizes only valid video URLs into cards, writes a bounded report, and labels missing engagement data as `unranked` instead of pretending the source is globally trending.
- The upstream `you-get` repository is vendored at `tools/vendor/you-get` for optional direct-URL extraction research. Its current code is not used as the global trend engine because its playlist coverage and JSON schema are not reliable across Douyin/Kuaishou; it never receives cookies, proxy settings or CAPTCHA work.

## Goal

Add one simple desktop tab where the operator can create a bounded scan plan, collect allowed public video URLs from Chinese short-video platforms, review each result as a card, optionally download an explicitly rights-approved source into the project, and hand the local asset to voice/subtitle tools. The app never silently scrapes, bypasses access controls or reposts source media.

The primary research path is social discovery. It reads public routes from the selected platforms, rotates through the finite page/scroll budget, interleaves different detected topics and scores potential for a transformative voice/subtitle/edit workflow. The score is an editorial shortlist signal only: it never says a video is safe to reup. Licensed footage discovery remains available as an optional secondary source for cases where the operator wants explicit public-domain/CC evidence.

## User flow

1. Select the project and open `Kho Preview`.
2. Select one or more social platforms and press the single scan button. The native worker prefers `Obscura · public scrape · concurrency 3` and falls back to `BrowserOS neo · 1 tab tuần tự` when the session is attached. It reads public cards, rotates a bounded scroll budget, and sorts the result by detected topic and editorial remix potential.
3. Use the optional licensed-footage or creator/playlist sections only when that specific source is wanted.
5. Paste one allowed HTTPS URL per line to create local preview cards immediately.
6. Select a card to inspect its platform preview or open the original file page. Mark a card as a reference for the current content plan.
7. Review the potential score, license, attribution and content. Choose a rights status and download one approved video at a time with the allowlisted `yt-dlp.exe` worker.
8. Review the imported asset, then open Subtitle Studio or Voice Studio. Transcript/STT, translation and TTS remain explicit, reviewable steps.

## State transitions

```text
no project -> blocked
no selected platform -> blocked
selected platform -> planned (discovery scan)
licensed-footage scan -> candidate cards with license + potential score
valid manual URL -> success card
invalid host or non-HTTPS URL -> blocked import
card selected -> review only
card reviewed -> keep or skip
card marked -> reference plan only
license candidate -> file-page/credit/third-party review
approved rights + configured yt-dlp -> downloading
valid MP4 -> imported asset / needs_review
timeout, blocked host or non-zero exit -> failed or blocked; no success claim
```

## Current implementation scope

- `Kho Preview` navigation tab and tab guide.
- Scan-plan form: multiple platforms, discovery mode and maximum results per platform.
- Explicit creator/playlist catalog form: one selected platform, public HTTPS source URL and bounded `yt-dlp` metadata scan.
- Licensed-footage discovery form: one fixed Wikimedia Commons source, public API scan, license filter, potential score and playable preview media URL.
- Result buckets are computed by the worker from observed metadata: hot-new, rising, low-clone heuristic, fresh and unranked. The UI never fabricates metrics and labels the low-clone result as a within-scan heuristic.
- Every public-platform card now carries a visible `Cần xin quyền` state and evidence note. Selecting an allowed rights status changes only the card label to `Người dùng đã xác nhận`; it is an operator attestation, not an automatic copyright/license verdict.
- Selected cards now expose an explicit content review step: `Giữ nội dung` or `Bỏ qua`. This records the operator's editorial decision in the project-scoped preview cache; it does not grant reuse rights.
- Platform registry and bounded public discovery adapters for TikTok, Douyin, Kuaishou, Xiaohongshu, Bilibili, Xigua, Huoshan, Weishi and Haokan; Huoshan is tracked as a ByteDance-family route, not a bypass path.
- Manual URL import with host validation, deduplication and a 2,000-card project limit.
- Project-scoped local persistence for cards.
- Card grid with empty state, selected state, platform label, source URL and reference-plan toggle.
- TikTok player URL for recognized `/video/{id}` links; other platforms safely fall back to the original link until an embed adapter exists.
- BrowserOS cards can be recovered from rendered anchors or public structured data in SPA script payloads when a route does not expose normal card links; the report includes anchor/script/card diagnostics.
- Bilibili has a public catalog fallback that can fill only the missing Bilibili portion of a multi-platform run, preserving per-platform blocked messages for the other providers.
- Wikimedia cards expose thumbnail, playable media URL, file page, license URL, attribution and a potential score; the score is an editorial shortlist signal, never a rights approval.
- Activity log entries for scan start, per-platform success/block/waiting-user state, validation failures, URL import and reference selection.
- Rights-gated one-video download through the native process supervisor; output is validated, hashed and imported into Asset Library.
- Handoff buttons prefill the downloaded video in Subtitle Studio and open Voice Studio for explicit text-to-speech work.
- `yt-dlp.exe` is optional and must be configured by the user in Settings; the app does not auto-install it, pass browser cookies or bypass CAPTCHA.
- The vendored `you-get` source is reference-only for now; no automatic package install is performed and the app does not claim that it can enumerate every platform's trending feed.
- `obscura.exe` is optional; the app auto-detects the local build at `D:\Auto3DvideoTools\obscura-source\target\release\obscura.exe`, with Settings available for a custom path. It is used only for fixed public routes with bounded concurrency; the app does not enable stealth/proxy, pass cookies or bypass CAPTCHA/rate limits.

## Adapter hardening still required

- Keep the worker's route/DOM fixtures current as providers change their public pages. A layout change must be shown as a per-platform block, never as an empty successful scan.
- Keep one tab per worker, finite navigation timeouts, bounded scrolls, bounded result counts and evidence snapshots.
- Persist the worker result through a durable project/asset contract rather than relying only on local browser storage.
- Add per-platform preview adapters and explicit fallback when a provider blocks embeds.
- Add user-assisted login sessions per platform, with one isolated browser profile per account. CAPTCHA is an interactive stop state for the user, never an automated bypass step.
- Add a rights gate before any reference is used in generation, export or publishing.

## Safety and policy boundary

This tab does not bypass CAPTCHA, access private accounts, remove watermarks or auto-post. Download is allowed only after the operator explicitly selects a rights status for an HTTPS URL on the platform host allowlist. The downloaded file is marked for human review because watermark status, creator permission, derivative use and platform policy are not inferred by the app. Failed or timed-out workers never become successful assets. Any reuse of a source video still requires rights review and human approval before generation or publishing.

## Validation target

- Happy path: select multiple platforms, create discovery plan, import valid URLs, select card, inspect auto buckets, mark reference, reload project and confirm cards persist.
- Licensed path: run Wikimedia Commons footage scan, verify cards contain thumbnail/media/license/file-page/score, select a candidate, then confirm the rights gate remains required before download.
- Failure path: no project, no selected platform, invalid host, non-HTTPS URL, duplicate URL and card-limit handling.
- Download path: no selected card, unapproved rights, missing yt-dlp, worker timeout/non-zero exit, missing output, oversized output and successful import with source hash.
- Build: `pnpm build` from `desktop`.
- Desktop check: `cargo check --manifest-path desktop/src-tauri/Cargo.toml --lib`.
- Project validator is expected to continue reporting the repository's existing generated-build inventory issue until that baseline is addressed separately.
