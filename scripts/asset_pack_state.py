"""Pure state-transition rules for the Asset Pack pipeline."""
from __future__ import annotations

from typing import Any

PACK_TRANSITIONS: set[tuple[str, str]] = {
    ("planned", "validated"),
    ("planned", "blocked"),
    ("planned", "failed"),
    ("validated", "queued"),
    ("validated", "blocked"),
    ("validated", "failed"),
    ("queued", "generating"),
    ("queued", "blocked"),
    ("queued", "failed"),
    ("generating", "ingested"),
    ("generating", "blocked"),
    ("generating", "failed"),
    ("ingested", "needs_review"),
    ("ingested", "blocked"),
    ("ingested", "failed"),
    ("needs_review", "approved"),
    ("needs_review", "generating"),
    ("needs_review", "blocked"),
    ("needs_review", "failed"),
}


def can_transition(current: str, target: str) -> bool:
    return (current, target) in PACK_TRANSITIONS


def validate_transition(previous: Any, current: Any) -> list[str]:
    """Return deterministic errors for a pack-state transition."""
    errors: list[str] = []
    if not isinstance(previous, dict) or not isinstance(current, dict):
        return ["previous and current pack states must be objects"]
    if previous.get("packId") != current.get("packId"):
        errors.append("packId cannot change during a transition")
    if previous.get("projectId") != current.get("projectId"):
        errors.append("projectId cannot change during a transition")
    old_status, new_status = previous.get("status"), current.get("status")
    if not isinstance(old_status, str) or not isinstance(new_status, str) or not can_transition(old_status, new_status):
        errors.append(f"invalid asset pack transition: {old_status!r} -> {new_status!r}")
    return errors
