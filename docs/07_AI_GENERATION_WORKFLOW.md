# AI Generation Workflow

## Purpose

Turn a structured brief into safe, repeatable AI-assisted assets and shots. The workflow separates creative planning, model invocation, output ingestion and human acceptance.

## Stages

| Stage | Required result |
|---|---|
| Brief | Audience, objective, message, language, duration and platform |
| Research | Source notes and claim review when the content is factual |
| Script | Versioned script with narration, on-screen copy and timing |
| Style bible | Palette, materials, camera, character/object continuity and negative constraints |
| Narrative visual plan | Ordered narration-to-beat spans, entity identity anchors, visual proof, grounded prompt/reference requirements and candidate/review state |
| References | Approved input assets with rights records and hashes |
| Shot plan | Shot objective, duration, action, camera, audio and acceptance criteria |
| Estimate | Provider/model, expected cost, quota and resource class |
| Approval | Required decision before paid or risky generation |
| Generation | Provider job with prompt/reference versions and idempotency key |
| Ingest | Output copied, probed, hashed and associated with the shot |
| Review | Human quality, continuity, safety, rights and disclosure decision |

## Prompt discipline

Prompts are stored as versioned content. The system tracks what changed between versions and prevents hidden provider defaults from becoming unrecorded behavior. Exact UI text, prices, scores, names and legal claims should be generated in a deterministic overlay or editor layer rather than trusted to a video model.

For Google Flow cinematic shots, the planner may add a bounded `flowDirectives` list. These `/...` values are creative prompt annotations, not actions to click or type into the browser UI. The compiled provider prompt includes the allowlisted token and a plain-language explanation, and the script validator rejects unknown or duplicate values before generation.

## Shot-level generation

Generate short shots, preserve the best accepted reference, and use extension/reference features only when the provider supports them. The narrative visual plan must be compiled before generation: every beat has an explicit narration span, visual claim, required visual evidence, grounded positive/negative prompt, expected output path and review state. Persistent entities keep immutable identity anchors across beats. The runner records every attempt, including rejected outputs, without overwriting the accepted version.

The desktop Google Flow shot runner asks once for an explicit batch credit cap:
the first shot's fresh visible unit price multiplied by the planned shot count.
Before every paid click it re-reads the live composer, settings and price. It
stops before the next Generate if the settings change, the price is unknown or
the cumulative visible-price estimate would exceed the approved cap. A click
with uncertain submission status is never retried automatically.

## Voice emotion planning

Before TTS, compile narration through `voice_emotion_planner`. Every segment carries one `emotionCode` from the shared allowlist: `neutral`, `calm`, `warm`, `friendly`, `happy`, `excited`, `joyful`, `triumphant`, `sad`, `melancholic`, `tender`, `concerned`, `fearful`, `angry`, `shouting`, `urgent`, `serious`, `surprised`, `mysterious`, `curious`, `sarcastic`, or `whisper`. Use `neutral` when the beat does not justify a change. Inline tags such as `[EXCITED]` are allowed only for a real within-segment transition and must be removed before subtitle/alignment text is produced.

Emotion is a delivery instruction, not an image prompt. The shot plan should express the same narrative beat through action, camera, lighting and pacing, but must not place voice tags in `visualPrompt`, `onScreenText` or subtitles. The manifest records the requested code and the provider's actual capability/fallback so a near-match cue is not reported as native emotion control.

## Review rubric

| Dimension | Question |
|---|---|
| Intent | Does the shot communicate its declared objective? |
| Continuity | Are subject, geometry, palette, lighting and camera consistent? |
| Motion | Is movement physically and aesthetically acceptable? |
| Text | Is all exact text added deterministically and readable on mobile? |
| Audio | Are voice, music and effects synchronized and licensed? |
| Rights | Are references and outputs permitted for intended use? |
| Policy | Is AI disclosure required and recorded? |

## Stopping rule

A generation run stops when an accepted output exists, the retry budget is exhausted, the cost cap is reached or a human/policy blocker is recorded. The app never retries indefinitely just because a provider returned an unsatisfactory output. A beat with missing narration coverage, entity-anchor drift, ungrounded visual evidence or unresolved rights remains blocked before provider submission.
