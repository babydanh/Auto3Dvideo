"""Pure contract tests for the Flow visual evaluator worker."""

from __future__ import annotations

import unittest

from scripts.flow_visual_evaluator_worker import response_json, validate_evaluation


def valid_payload() -> dict:
    return {
        "decision": "pass",
        "overallScore": 88,
        "confidence": 0.91,
        "criteria": {
            "promptAdherence": 90,
            "identity": 86,
            "composition": 88,
            "lighting": 84,
            "continuity": 89,
        },
        "flags": [],
        "revisionInstruction": "",
        "summary": "The shot is usable.",
    }


class FlowVisualEvaluatorContractTests(unittest.TestCase):
    def test_valid_payload_is_normalized(self) -> None:
        result = validate_evaluation(valid_payload())
        self.assertEqual(result["decision"], "pass")
        self.assertEqual(result["criteria"]["identity"], 86.0)

    def test_missing_criterion_is_rejected(self) -> None:
        payload = valid_payload()
        del payload["criteria"]["continuity"]
        with self.assertRaises(ValueError):
            validate_evaluation(payload)

    def test_scores_are_bounded(self) -> None:
        payload = valid_payload()
        payload["overallScore"] = 101
        with self.assertRaises(ValueError):
            validate_evaluation(payload)

    def test_extra_model_claim_is_rejected(self) -> None:
        payload = valid_payload()
        payload["approved"] = True
        with self.assertRaises(ValueError):
            validate_evaluation(payload)

    def test_fenced_json_is_parsed_without_markdown_leaking(self) -> None:
        parsed = response_json('```json\n{"decision":"needs_review"}\n```')
        self.assertEqual(parsed["decision"], "needs_review")


if __name__ == "__main__":
    unittest.main()
