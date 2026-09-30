# Workflow 026: Multi-platform Preview Radar

## Purpose

Read public discovery cards from selected short-video platforms through the configured Obscura public scraper, with BrowserOS as a visible one-tab fallback. Return preview metadata and evidence-backed grouping for research. Do not download, remove watermarks, bypass CAPTCHA, access private pages or publish.

## Bounded run

- Input: `projectId`, one to nine allowlisted platform ids and `maxResults` from 1 to 200 per platform.
- Engine selection happens before web work: configured `obscura.exe` uses fixed public routes as single-page fetch jobs with an explicit network-idle settle window and concurrency 3; otherwise configured BrowserOS/Node uses one visible tab in selection order.
- Obscura does not receive cookies, stealth flags, proxy flags or user-supplied URLs. BrowserOS may use the user's already-open public/session page only as a fallback for platforms that Obscura did not return valid cards for, and still stops for login/CAPTCHA.
- Each route gets the requested card cap. BrowserOS fallback keeps at most eight bounded scrolls per route; Obscura stdout is parsed into a sanitized report and raw page output is not stored as report evidence.
- The native process timeout is 240 seconds for Obscura and 360 seconds for BrowserOS. A missing report, timeout or non-zero worker result cannot become success.

## State transitions

```text
no project -> blocked
no platform -> blocked
validated request -> running
Obscura configured -> obscura_public_scrape
Obscura partial -> browseros_preview_scan fallback for missing platforms only
Obscura absent + BrowserOS enabled -> browseros_preview_scan fallback
public route + cards -> success
some platforms succeed and some are blocked -> partial
login/CAPTCHA/rate limit -> waiting_user or blocked
layout changed with no readable cards -> blocked
Bilibili shell unreadable -> bounded public popular catalog fallback; success only when validated BVID cards are returned
timeout/non-zero process/missing report -> failed or blocked
```

## Card contract

Each returned card contains `previewId`, `platform`, `title`, `author`, canonical HTTPS `shareUrl`, optional `embedUrl`, optional HTTPS `thumbnailUrl`, `scannedAt`, `radarBuckets` and `rankingEvidence`. The URL validator is platform-specific and rejects navigation routes such as `/item/create`, `/item/digg`, `/video/app` and `/video/pc`. Metrics and raw page text are used only inside the worker's grouping step and are not written to the app report.

The worker may assign:

- `hot_new` when the page exposes a hot/featured signal or the observed metric is high within this bounded run.
- `rising` when the page exposes a rising signal or a fresh card has observed engagement metadata.
- `fresh` when the page exposes a relative/new date signal.
- `low_clone` only as a heuristic that title/thumbnail is not duplicated within this scan. It is not a copyright or originality conclusion.
- `unranked` when no reliable grouping signal is observed.

The Bilibili fallback uses only the fixed public popular catalog route and a finite page cap. It can produce cards when the website shell is unreadable, but it is still a public catalog snapshot rather than a guarantee of global trend coverage.

## Human-interaction stops

CAPTCHA, human verification, login-required pages and rate limits are returned per platform with a next action. The worker never clicks a CAPTCHA, solves a challenge, imports cookies or tries an alternate bypass route. The user may complete login or verification in BrowserOS and start a new bounded scan.

## Evidence and storage

The native Tauri command writes the report under `.auto3dvideo/runs/<run-id>/preview-scan/preview-scan-report.json`, validates the report as an expected process output, adds process evidence and returns it to the UI. The UI merges cards into the selected project cache while preserving a user's existing reference-plan selection.

## Rights handoff

Preview metadata is research-only. Download is a separate rights-gated action that requires an explicit ownership/license/public-domain choice, uses the allowlisted local downloader and remains human-review-required. No preview scan result is publishable or monetizable by itself.
