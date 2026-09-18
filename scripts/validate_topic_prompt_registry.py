#!/usr/bin/env python3
"""Validate the sanitized topic and prompt registries without network access."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,63}$")
VERSION_RE = re.compile(r"^v[0-9]+\.[0-9]+\.[0-9]+$")
PLACEHOLDER_RE = re.compile(r"\{\{([a-z][a-zA-Z0-9_]*)\}\}")
RECIPE_KINDS = {"image_slideshow", "html_to_video", "voiceover_package", "screen_demo", "hybrid_2d_3d", "true_3d"}
VISUAL_MODES = {"documentary", "editorial-data", "narrative", "product-demo", "gameplay", "cinematic-3d"}
SECRET_VALUE_RE = re.compile(r"(?i)(api[_ -]?key|password|secret|bearer|token)\s*[:=]\s*[^\s,}]+")


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def load_json(path: Path, errors: list[str]) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(errors, f"{path}: cannot parse JSON: {exc}")
        return {}
    if not isinstance(value, dict):
        fail(errors, f"{path}: root must be an object")
        return {}
    return value


def validate_profiles(data: dict, path: Path, errors: list[str]) -> set[str]:
    if data.get("schemaVersion") != "1.0.0":
        fail(errors, f"{path}: schemaVersion must be 1.0.0")
    profiles = data.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        fail(errors, f"{path}: profiles must be a non-empty array")
        return set()
    ids: set[str] = set()
    for index, profile in enumerate(profiles):
        prefix = f"{path}:profiles[{index}]"
        if not isinstance(profile, dict):
            fail(errors, f"{prefix} must be an object")
            continue
        profile_id = profile.get("profileId")
        if not isinstance(profile_id, str) or not ID_RE.fullmatch(profile_id):
            fail(errors, f"{prefix}.profileId is invalid")
        elif profile_id in ids:
            fail(errors, f"{prefix}.profileId is duplicated")
        else:
            ids.add(profile_id)
        if profile.get("defaultRecipeKind") not in RECIPE_KINDS:
            fail(errors, f"{prefix}.defaultRecipeKind is unsupported")
        if profile.get("visualMode") not in VISUAL_MODES:
            fail(errors, f"{prefix}.visualMode is unsupported")
        if not isinstance(profile.get("promptTemplateIds"), list) or not profile["promptTemplateIds"]:
            fail(errors, f"{prefix}.promptTemplateIds must be non-empty")
        policy = profile.get("assetPolicy")
        if not isinstance(policy, dict) or any(policy.get(key) is not True for key in ("requiresProvenance", "rejectIrrelevantCandidates", "requiresHumanReview")):
            fail(errors, f"{prefix}.assetPolicy must keep all safety booleans true")
        if not isinstance(profile.get("qaChecklist"), list) or len(profile["qaChecklist"]) < 3:
            fail(errors, f"{prefix}.qaChecklist must contain at least three checks")
    return ids


def validate_prompts(data: dict, path: Path, errors: list[str]) -> set[str]:
    if data.get("schemaVersion") != "1.0.0":
        fail(errors, f"{path}: schemaVersion must be 1.0.0")
    templates = data.get("templates")
    if not isinstance(templates, list) or not templates:
        fail(errors, f"{path}: templates must be a non-empty array")
        return set()
    ids: set[str] = set()
    for index, template in enumerate(templates):
        prefix = f"{path}:templates[{index}]"
        if not isinstance(template, dict):
            fail(errors, f"{prefix} must be an object")
            continue
        template_id = template.get("templateId")
        if not isinstance(template_id, str) or not ID_RE.fullmatch(template_id):
            fail(errors, f"{prefix}.templateId is invalid")
        elif template_id in ids:
            fail(errors, f"{prefix}.templateId is duplicated")
        else:
            ids.add(template_id)
        if not isinstance(template.get("version"), str) or not VERSION_RE.fullmatch(template["version"]):
            fail(errors, f"{prefix}.version is invalid")
        body = template.get("body")
        input_keys = template.get("inputKeys")
        if not isinstance(body, str) or len(body) < 50:
            fail(errors, f"{prefix}.body is too short")
        if not isinstance(input_keys, list) or not input_keys:
            fail(errors, f"{prefix}.inputKeys must be non-empty")
            input_keys = []
        placeholders = set(PLACEHOLDER_RE.findall(body if isinstance(body, str) else ""))
        expected = set(input_keys)
        if placeholders != expected:
            fail(errors, f"{prefix}: placeholders {sorted(placeholders)} do not equal inputKeys {sorted(expected)}")
        if not isinstance(template.get("outputContract"), list) or not template["outputContract"]:
            fail(errors, f"{prefix}.outputContract must be non-empty")
        if not isinstance(template.get("guardrails"), list) or len(template["guardrails"]) < 3:
            fail(errors, f"{prefix}.guardrails must contain at least three rules")
        serialized = json.dumps(template, ensure_ascii=False)
        if SECRET_VALUE_RE.search(serialized):
            fail(errors, f"{prefix}: possible secret assignment found")
    return ids


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    project = args.project.resolve()
    errors: list[str] = []
    profile_path = project / "configs" / "topic-profiles.example.json"
    prompt_path = project / "configs" / "prompt-templates.example.json"
    profiles = load_json(profile_path, errors)
    prompts = load_json(prompt_path, errors)
    profile_ids = validate_profiles(profiles, profile_path, errors)
    prompt_ids = validate_prompts(prompts, prompt_path, errors)
    for index, profile in enumerate(profiles.get("profiles", [])):
        for template_id in profile.get("promptTemplateIds", []) if isinstance(profile, dict) else []:
            if template_id not in prompt_ids:
                fail(errors, f"{profile_path}:profiles[{index}] references missing prompt {template_id}")
    if errors:
        print("TOPIC_PROMPT_REGISTRY_INVALID")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print(f"TOPIC_PROMPT_REGISTRY_OK profiles={len(profile_ids)} templates={len(prompt_ids)} network=false secrets=false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
