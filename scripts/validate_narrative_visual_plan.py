"""Validate a NarrativeVisualPlan without generating media or starting workers."""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
BEAT_ID = re.compile(r"^beat-[0-9]{3}$")
LANGUAGE = re.compile(r"^[a-z]{2,3}(-[A-Z]{2})?$")
ENV_OR_SECRET_MARKERS = ("api_key", "apikey", "secret", "token", "password", "sk-", "bearer ")
FORBIDDEN_KEYS = {"command", "rawcommand", "shell", "rawargs", "executable", "upload", "publish", "url"}
REQUIRED_TOP_LEVEL = {
    "schemaVersion",
    "planId",
    "projectId",
    "episodeId",
    "language",
    "aspectRatio",
    "frameRate",
    "scriptUnitCount",
    "sourceScriptRef",
    "styleBibleRef",
    "continuityPolicy",
    "policy",
    "beats",
    "totalDurationFrames",
    "createdAt",
    "updatedAt",
}
REQUIRED_BEAT = {
    "beatId",
    "sequence",
    "narration",
    "timing",
    "narrativeClaim",
    "visualIntent",
    "setting",
    "entities",
    "visualEvidence",
    "prompt",
    "referenceAssetIds",
    "expectedAsset",
    "candidate",
    "review",
    "risk",
    "policy",
}


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def safe_relative(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    normalized = value.replace("\\", "/")
    if normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized) or "://" in normalized:
        return False
    parts = normalized.split("/")
    return all(part not in {"", ".", ".."} for part in parts)


def safe_id(value: Any) -> bool:
    return isinstance(value, str) and bool(SAFE_ID.fullmatch(value))


def content_tokens(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9][a-z0-9-]{2,}", value.casefold()) if token not in {"same", "one", "the", "with", "and", "into", "from"}}


def contains_forbidden_key(value: Any, path: str = "plan") -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).casefold())
            if normalized in {re.sub(r"[^a-z0-9]", "", item) for item in FORBIDDEN_KEYS}:
                return f"{path}.{key} is not allowed"
            result = contains_forbidden_key(child, f"{path}.{key}")
            if result:
                return result
    elif isinstance(value, list):
        for index, child in enumerate(value):
            result = contains_forbidden_key(child, f"{path}[{index}]")
            if result:
                return result
    return None


def validate_plan(document: Any, project_root: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(document, dict):
        return ["plan must be an object"], warnings

    forbidden = contains_forbidden_key(document)
    if forbidden:
        errors.append(forbidden)
    allowed_top = REQUIRED_TOP_LEVEL | {"width", "height"}
    unknown_top = set(document) - allowed_top
    if unknown_top:
        errors.append(f"unknown top-level fields: {sorted(unknown_top)}")
    missing_top = REQUIRED_TOP_LEVEL - set(document)
    if missing_top:
        errors.append(f"missing top-level fields: {sorted(missing_top)}")
        return errors, warnings

    if document.get("schemaVersion") != "1.0.0":
        errors.append("schemaVersion must be 1.0.0")
    for field in ("planId", "projectId", "episodeId"):
        if not safe_id(document.get(field)):
            errors.append(f"{field} must be a safe lowercase id")
    if not isinstance(document.get("language"), str) or not LANGUAGE.fullmatch(document["language"]):
        errors.append("language must use a locale such as vi-VN")
    if document.get("aspectRatio") not in {"16:9", "9:16", "1:1", "4:5", "custom"}:
        errors.append("aspectRatio is unsupported")
    if not is_number(document.get("frameRate")) or not 0 < document["frameRate"] <= 240:
        errors.append("frameRate must be between 0 and 240")
    if not isinstance(document.get("scriptUnitCount"), int) or not 1 <= document["scriptUnitCount"] <= 10000:
        errors.append("scriptUnitCount must be between 1 and 10000")
    if not safe_relative(document.get("sourceScriptRef")):
        errors.append("sourceScriptRef must be project-relative")
    if not safe_relative(document.get("styleBibleRef")):
        errors.append("styleBibleRef must be project-relative")
    for field in ("sourceScriptRef", "styleBibleRef"):
        value = document.get(field)
        if safe_relative(value):
            candidate = project_root.joinpath(*value.replace("\\", "/").split("/"))
            if not candidate.is_file():
                errors.append(f"{field} does not exist under project root: {value}")

    required_true = ("entityIdentityRequired", "visualEvidenceRequired", "promptGroundingRequired", "repeatedEntityAnchorsImmutable")
    continuity = document.get("continuityPolicy")
    if not isinstance(continuity, dict) or any(continuity.get(field) is not True for field in required_true):
        errors.append("continuityPolicy must enable all continuity invariants")
    policy = document.get("policy")
    if not isinstance(policy, dict):
        errors.append("policy must be an object")
    else:
        expected_policy = {"rightsRequired": True, "humanReviewRequired": True, "paidGeneration": False, "externalPublish": False, "allowNetwork": False}
        for field, expected in expected_policy.items():
            if policy.get(field) is not expected:
                errors.append(f"policy.{field} must be {expected}")

    beats = document.get("beats")
    if not isinstance(beats, list) or not beats:
        errors.append("beats must contain at least one beat")
        return errors, warnings
    if len(beats) > document["scriptUnitCount"] * 16:
        errors.append("beat count is implausibly high for the script unit count")

    expected_sequences = list(range(1, len(beats) + 1))
    actual_sequences = [beat.get("sequence") if isinstance(beat, dict) else None for beat in beats]
    if actual_sequences != expected_sequences:
        errors.append("beat sequence values must be contiguous starting at 1")

    previous_end = 0
    previous_narration_end = 0
    repeated_entities: dict[str, tuple[str, ...]] = {}
    total_duration = 0
    for index, beat in enumerate(beats):
        prefix = f"beats[{index}]"
        if not isinstance(beat, dict):
            errors.append(f"{prefix} must be an object")
            continue
        missing = REQUIRED_BEAT - set(beat)
        unknown = set(beat) - REQUIRED_BEAT
        if missing:
            errors.append(f"{prefix} missing fields: {sorted(missing)}")
        if unknown:
            errors.append(f"{prefix} unknown fields: {sorted(unknown)}")
        if missing:
            continue
        beat_id = beat.get("beatId")
        if not isinstance(beat_id, str) or not BEAT_ID.fullmatch(beat_id) or beat_id != f"beat-{index + 1:03d}":
            errors.append(f"{prefix}.beatId must be beat-{index + 1:03d}")

        narration = beat["narration"]
        timing = beat["timing"]
        if not isinstance(narration, dict) or not isinstance(timing, dict):
            errors.append(f"{prefix} narration/timing must be objects")
            continue
        for field in ("text", "startUnit", "endUnit"):
            if field not in narration:
                errors.append(f"{prefix}.narration.{field} is required")
        if not isinstance(narration.get("text"), str) or not narration.get("text", "").strip():
            errors.append(f"{prefix}.narration.text must be non-empty")
        start_unit, end_unit = narration.get("startUnit"), narration.get("endUnit")
        if not isinstance(start_unit, int) or not isinstance(end_unit, int) or not 0 <= start_unit < end_unit <= document["scriptUnitCount"]:
            errors.append(f"{prefix}.narration span is outside script coverage")
        elif start_unit != previous_narration_end:
            errors.append(f"{prefix}.narration span has a gap or overlap")
        else:
            previous_narration_end = end_unit

        for field in ("startFrame", "endFrame", "durationFrames"):
            if not isinstance(timing.get(field), int):
                errors.append(f"{prefix}.timing.{field} must be an integer")
        if all(isinstance(timing.get(field), int) for field in ("startFrame", "endFrame", "durationFrames")):
            start_frame, end_frame, duration = timing["startFrame"], timing["endFrame"], timing["durationFrames"]
            if start_frame != previous_end or end_frame <= start_frame or duration != end_frame - start_frame:
                errors.append(f"{prefix}.timing must be contiguous and durationFrames=endFrame-startFrame")
            previous_end = end_frame
            total_duration += duration

        entities = beat["entities"]
        if not isinstance(entities, list) or not entities:
            errors.append(f"{prefix}.entities must contain at least one entity")
        else:
            entity_ids: set[str] = set()
            for entity_index, entity in enumerate(entities):
                entity_prefix = f"{prefix}.entities[{entity_index}]"
                if not isinstance(entity, dict):
                    errors.append(f"{entity_prefix} must be an object")
                    continue
                for field in ("entityId", "name", "role", "continuityMode", "identityAnchors", "referenceAssetIds"):
                    if field not in entity:
                        errors.append(f"{entity_prefix}.{field} is required")
                entity_id = entity.get("entityId")
                if not safe_id(entity_id):
                    errors.append(f"{entity_prefix}.entityId must be a safe id")
                elif entity_id in entity_ids:
                    errors.append(f"{prefix} contains duplicate entityId {entity_id}")
                else:
                    entity_ids.add(entity_id)
                anchors = entity.get("identityAnchors")
                if not isinstance(anchors, list) or not anchors or any(not isinstance(anchor, str) or not anchor.strip() for anchor in anchors):
                    errors.append(f"{entity_prefix}.identityAnchors must be non-empty")
                elif entity.get("continuityMode") == "persistent":
                    anchor_tuple = tuple(anchors)
                    if entity_id in repeated_entities and repeated_entities[entity_id] != anchor_tuple:
                        errors.append(f"persistent entity {entity_id} changed immutable identityAnchors")
                    repeated_entities[entity_id] = anchor_tuple
                refs = entity.get("referenceAssetIds")
                if not isinstance(refs, list) or any(not safe_id(ref) for ref in refs):
                    errors.append(f"{entity_prefix}.referenceAssetIds contains an invalid asset id")

        visual = beat["visualEvidence"]
        if not isinstance(visual, dict) or not isinstance(visual.get("requiredElements"), list) or not visual.get("requiredElements"):
            errors.append(f"{prefix}.visualEvidence.requiredElements must be non-empty")
        prompt = beat["prompt"]
        if not isinstance(prompt, dict):
            errors.append(f"{prefix}.prompt must be an object")
        else:
            positive = prompt.get("positive")
            negative = prompt.get("negative")
            grounding = prompt.get("groundingTokens")
            if not isinstance(positive, str) or not positive.strip() or not isinstance(negative, str) or not negative.strip():
                errors.append(f"{prefix}.prompt positive/negative must be non-empty")
            if not isinstance(grounding, list) or not grounding:
                errors.append(f"{prefix}.prompt.groundingTokens must be non-empty")
            elif isinstance(positive, str):
                positive_tokens = content_tokens(positive)
                for token in grounding:
                    if not isinstance(token, str) or not content_tokens(token).issubset(positive_tokens):
                        errors.append(f"{prefix}.prompt grounding token is absent from positive prompt: {token}")
            if isinstance(visual, dict) and isinstance(visual.get("requiredElements"), list) and isinstance(positive, str):
                positive_tokens = content_tokens(positive)
                for element in visual["requiredElements"]:
                    if not isinstance(element, str) or not content_tokens(element).issubset(positive_tokens):
                        errors.append(f"{prefix}.visualEvidence element is not grounded in positive prompt: {element}")

        refs = beat["referenceAssetIds"]
        if not isinstance(refs, list) or any(not safe_id(ref) for ref in refs):
            errors.append(f"{prefix}.referenceAssetIds contains an invalid asset id")
        expected = beat["expectedAsset"]
        if not isinstance(expected, dict) or not safe_id(expected.get("assetId")) or expected.get("mediaKind") not in {"image", "video", "image_sequence"}:
            errors.append(f"{prefix}.expectedAsset identity is invalid")
        elif expected.get("mustBeNew") is not True:
            errors.append(f"{prefix}.expectedAsset.mustBeNew must be true")
        if not isinstance(expected, dict) or not safe_relative(expected.get("relativePath")) or not str(expected.get("relativePath", "")).replace("\\", "/").startswith("outputs/visual-plan/"):
            errors.append(f"{prefix}.expectedAsset.relativePath must be under outputs/visual-plan")

        candidate = beat["candidate"]
        if not isinstance(candidate, dict) or candidate.get("selectionState") not in {"not_generated", "candidate", "accepted", "rejected"}:
            errors.append(f"{prefix}.candidate.selectionState is invalid")
        elif candidate.get("selectionState") == "not_generated" and candidate.get("score") is not None:
            errors.append(f"{prefix}.candidate.score must be null before generation")
        if isinstance(candidate, dict):
            for field in ("providerProfileRef", "modelProfileRef"):
                value = candidate.get(field)
                if value is not None and not safe_id(value):
                    errors.append(f"{prefix}.candidate.{field} must be a safe profile id or null")
                if isinstance(value, str) and any(marker in value.casefold() for marker in ENV_OR_SECRET_MARKERS):
                    errors.append(f"{prefix}.candidate.{field} must not contain a secret marker")

        review = beat["review"]
        if not isinstance(review, dict) or review.get("decision") not in {"not_started", "needs_review", "approved", "rejected"}:
            errors.append(f"{prefix}.review.decision is invalid")
        if isinstance(review, dict) and review.get("rightsState") not in {"pending", "pass", "fail"}:
            errors.append(f"{prefix}.review.rightsState is invalid")
        risk = beat["risk"]
        if not isinstance(risk, dict) or risk.get("level") not in {"low", "medium", "high"} or risk.get("needsHumanReview") is not True:
            errors.append(f"{prefix}.risk must require human review")
        beat_policy = beat["policy"]
        if not isinstance(beat_policy, dict) or any(beat_policy.get(field) is not expected for field, expected in {"rightsRequired": True, "humanReviewRequired": True, "paidGeneration": False, "externalPublish": False, "allowNetwork": False}.items()):
            errors.append(f"{prefix}.policy violates safe generation defaults")

    if previous_narration_end != document["scriptUnitCount"]:
        errors.append("narration spans do not cover the complete script")
    if previous_end != document.get("totalDurationFrames") or total_duration != document.get("totalDurationFrames"):
        errors.append("totalDurationFrames does not equal contiguous beat timing")
    if errors:
        return errors, warnings
    warnings.append("No media was generated; candidate scores and semantic/continuity checks remain pending.")
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--project", default=".", type=Path)
    args = parser.parse_args()
    plan_path = args.plan.resolve()
    project_root = args.project.resolve()
    try:
        document = json.loads(plan_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(json.dumps({"valid": False, "errors": [f"cannot read plan: {error}"], "warnings": []}, ensure_ascii=False, indent=2))
        return 1
    errors, warnings = validate_plan(document, project_root)
    result = {
        "valid": not errors,
        "planId": document.get("planId") if isinstance(document, dict) else None,
        "beats": len(document.get("beats", [])) if isinstance(document, dict) and isinstance(document.get("beats"), list) else 0,
        "errors": errors,
        "warnings": warnings,
        "generationStarted": False,
        "externalPublish": False,
        "paidGeneration": False,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
