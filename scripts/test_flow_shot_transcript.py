"""Fake BrowserOS/Flow transcripts for the per-shot workflow contract.

These tests are deliberately provider-free.  They exercise the invariants that
must hold around the live adapter: one prompt/output per shot, a single bounded
revision, no cross-shot reuse, and no credit spend when the composer is missing.
"""

from __future__ import annotations

import unittest
from dataclasses import dataclass


@dataclass(frozen=True)
class Event:
    kind: str
    shot_id: str | None = None
    revision_id: str | None = None
    media_id: str | None = None
    prompt: str | None = None
    decision: str | None = None


class TranscriptViolation(ValueError):
    pass


def replay(events: list[Event]) -> dict[str, object]:
    generated: dict[str, int] = {}
    prompts: dict[str, tuple[str, str]] = {}
    decisions: dict[str, str] = {}
    downloaded: dict[tuple[str, str], str] = {}
    approved: set[str] = set()
    credits = 0
    for event in events:
        if event.kind == "observe":
            continue
        if event.kind == "close_overlay":
            # A semantic in-page dismiss is safe; it is not a generation.
            continue
        if event.kind == "blocked_missing_composer":
            continue
        if event.kind == "existing_review":
            if not event.shot_id or not event.media_id:
                raise TranscriptViolation("existing review identity is missing")
            continue
        if event.kind == "type_prompt":
            if not event.shot_id or not event.revision_id or not event.prompt:
                raise TranscriptViolation("prompt identity is missing")
            shot_markers = [line for line in event.prompt.splitlines() if line.startswith("SHOT_ID:")]
            if shot_markers != [f"SHOT_ID: {event.shot_id}"]:
                raise TranscriptViolation("a prompt must contain exactly one current SHOT_ID")
            key = event.shot_id
            previous = prompts.get(key)
            if previous and decisions.get(key) != "revise":
                raise TranscriptViolation("a shot cannot receive a second prompt without a revise decision")
            prompts[key] = (event.revision_id, event.prompt)
            continue
        if event.kind == "generate":
            if not event.shot_id or event.shot_id not in prompts:
                raise TranscriptViolation("generation without the current shot prompt")
            generated[event.shot_id] = generated.get(event.shot_id, 0) + 1
            credits += 1
            if generated[event.shot_id] > 2:
                raise TranscriptViolation("revision budget exceeded")
            continue
        if event.kind == "download":
            if not event.shot_id or not event.revision_id or not event.media_id:
                raise TranscriptViolation("download identity is missing")
            current = prompts.get(event.shot_id)
            if not current or current[0] != event.revision_id:
                raise TranscriptViolation("download does not match the current shot revision")
            if event.media_id in set(downloaded.values()):
                raise TranscriptViolation("media cannot be reused across shots")
            key = (event.shot_id, event.revision_id)
            if key in downloaded:
                raise TranscriptViolation("a shot revision cannot consume two downloads")
            downloaded[key] = event.media_id
            continue
        if event.kind == "evaluate":
            if not event.shot_id or not any(key[0] == event.shot_id for key in downloaded):
                raise TranscriptViolation("evaluation requires the downloaded current image")
            if event.decision == "pass":
                decisions[event.shot_id] = "pass"
                continue
            if event.decision == "revise":
                decisions[event.shot_id] = "revise"
                continue
            if event.decision == "needs_review":
                decisions[event.shot_id] = "needs_review"
                continue
            raise TranscriptViolation("unknown evaluator decision")
        if event.kind == "approve":
            if not event.shot_id or not any(key[0] == event.shot_id for key in downloaded):
                raise TranscriptViolation("approval requires a validated current image")
            approved.add(event.shot_id)
            continue
        raise TranscriptViolation(f"unknown transcript event: {event.kind}")
    return {"generated": generated, "downloaded": downloaded, "approved": approved, "credits": credits}


class FlowShotTranscriptTests(unittest.TestCase):
    def test_existing_image_review_is_read_only(self) -> None:
        result = replay([Event("observe"), Event("existing_review", shot_id="SHOT-001", media_id="history-media-1")])
        self.assertEqual(result["credits"], 0)

    def test_one_approved_shot_has_one_prompt_generate_download_and_review(self) -> None:
        result = replay([
            Event("type_prompt", shot_id="SHOT-001", revision_id="rev-001", prompt="SHOT_ID: SHOT-001\nREVISION_ID: rev-001"),
            Event("generate", shot_id="SHOT-001"),
            Event("download", shot_id="SHOT-001", revision_id="rev-001", media_id="media-1"),
            Event("evaluate", shot_id="SHOT-001", decision="pass"),
            Event("approve", shot_id="SHOT-001"),
        ])
        self.assertEqual(result["credits"], 1)
        self.assertEqual(result["approved"], {"SHOT-001"})

    def test_failed_evaluation_allows_exactly_one_revision(self) -> None:
        result = replay([
            Event("type_prompt", shot_id="SHOT-001", revision_id="rev-001", prompt="SHOT_ID: SHOT-001\nREVISION_ID: rev-001"),
            Event("generate", shot_id="SHOT-001"),
            Event("download", shot_id="SHOT-001", revision_id="rev-001", media_id="media-1"),
            Event("evaluate", shot_id="SHOT-001", decision="revise"),
            Event("type_prompt", shot_id="SHOT-001", revision_id="rev-002", prompt="SHOT_ID: SHOT-001\nREVISION_ID: rev-002"),
            Event("generate", shot_id="SHOT-001"),
            Event("download", shot_id="SHOT-001", revision_id="rev-002", media_id="media-2"),
            Event("evaluate", shot_id="SHOT-001", decision="pass"),
            Event("approve", shot_id="SHOT-001"),
        ])
        self.assertEqual(result["credits"], 2)
        with self.assertRaises(TranscriptViolation):
            replay([
                Event("type_prompt", shot_id="SHOT-001", revision_id="rev-001", prompt="SHOT_ID: SHOT-001"),
                Event("generate", shot_id="SHOT-001"),
                Event("download", shot_id="SHOT-001", revision_id="rev-001", media_id="media-1"),
                Event("evaluate", shot_id="SHOT-001", decision="revise"),
                Event("type_prompt", shot_id="SHOT-001", revision_id="rev-002", prompt="SHOT_ID: SHOT-001"),
                Event("generate", shot_id="SHOT-001"),
                Event("download", shot_id="SHOT-001", revision_id="rev-002", media_id="media-2"),
                Event("evaluate", shot_id="SHOT-001", decision="revise"),
                Event("type_prompt", shot_id="SHOT-001", revision_id="rev-003", prompt="SHOT_ID: SHOT-001"),
                Event("generate", shot_id="SHOT-001"),
            ])

    def test_two_shots_cannot_reuse_prompt_or_media(self) -> None:
        with self.assertRaises(TranscriptViolation):
            replay([
                Event("type_prompt", shot_id="SHOT-001", revision_id="rev-001", prompt="SHOT_ID: SHOT-001"),
                Event("generate", shot_id="SHOT-001"),
                Event("download", shot_id="SHOT-002", revision_id="rev-001", media_id="media-1"),
            ])
        with self.assertRaises(TranscriptViolation):
            replay([
                Event("type_prompt", shot_id="SHOT-001", revision_id="rev-001", prompt="SHOT_ID: SHOT-002"),
            ])
        with self.assertRaises(TranscriptViolation):
            replay([
                Event("type_prompt", shot_id="SHOT-001", revision_id="rev-001", prompt="SHOT_ID: SHOT-001"),
                Event("generate", shot_id="SHOT-001"),
                Event("download", shot_id="SHOT-001", revision_id="rev-001", media_id="media-1"),
                Event("type_prompt", shot_id="SHOT-002", revision_id="rev-001", prompt="SHOT_ID: SHOT-002"),
                Event("generate", shot_id="SHOT-002"),
                Event("download", shot_id="SHOT-002", revision_id="rev-001", media_id="media-1"),
            ])

    def test_missing_composer_never_spends_credit(self) -> None:
        result = replay([Event("observe"), Event("blocked_missing_composer"), Event("close_overlay")])
        self.assertEqual(result["credits"], 0)


if __name__ == "__main__":
    unittest.main()
