"""Consumer-visible invariants for original coding lessons; no provider calls."""
from __future__ import annotations

import copy
import unittest

from coding_lesson import build_local_script, normalize_gateway_script, validate_coding_script, UnsupportedCodingPrompt


def request(topic: str, **kwargs):
    return {"requestId": "coding-test", "briefId": "brief-coding-test", "topic": topic,
            "objective": "Giải thích invariant và trade-off", "language": "vi-VN",
            "durationSeconds": 40, "sourcePromptHash": "a" * 64, **kwargs}


def states(script):
    return [state for segment in script["segments"] for state in segment["teachingScene"]["states"]]


def variables(state):
    return {item["name"]: item["value"] for item in state["variables"]}


class CodingLessonTests(unittest.TestCase):
    def test_cache_write_uses_update_and_delete_not_read_and_fill(self):
        script = build_local_script(request("system design cache-aside"))
        for segment in script["segments"]:
            scene = segment["teachingScene"]
            for state in scene["states"]:
                if variables(state).get("database") == "v2":
                    operations = [scene["edges"][i]["label"] for i in state["activeEdges"]]
                    self.assertEqual(operations, ["UPDATE", "DELETE"])

    def test_maximum_bounded_dataset_preserves_last_hash_map_entries(self):
        values = list(range(999999984, 1000000000))
        script = build_local_script(request(f"Two Sum nums={values}, target=1", requestedShotCount=12))
        stored = next(s for s in states(script) if s["label"].startswith("Lưu 999999999"))
        self.assertIn("999999999:15", " ".join(variables(stored).values()))

    def test_parameter_followed_by_sentence_punctuation_is_preserved(self):
        script = build_local_script(request("Two Sum nums=[3,3], target=6. Giải thích hash map."))
        result = next(variables(s)["result"] for s in states(script) if "result" in variables(s))
        self.assertEqual(result, "[0, 1]")

    def test_unsupported_parameters_are_not_silently_ignored(self):
        with self.assertRaises(UnsupportedCodingPrompt):
            build_local_script(request("system design cache-aside replicas=3"))
        with self.assertRaises(UnsupportedCodingPrompt):
            build_local_script(request("Two Sum bằng C++"))

    def test_two_sum_duplicates_return_distinct_indices(self):
        script = build_local_script(request("LeetCode Two Sum nums=[3,3], target=6"))
        result = next(state for state in states(script) if "result" in variables(state))
        self.assertEqual(variables(result)["result"], "[0, 1]")
        self.assertEqual(result["activeIndices"], [0, 1])

    def test_two_sum_no_solution_does_not_invent_a_pair(self):
        script = build_local_script(request("Two Sum nums=[2,4], target=9"))
        result = next(state for state in states(script) if "result" in variables(state))
        self.assertEqual(variables(result)["result"], "[]")

    def test_binary_search_tracks_not_found_and_shrinks_interval(self):
        script = build_local_script(request("binary search nums=[1,3,5,7], target=4"))
        visits = [variables(state) for state in states(script) if "mid" in variables(state)]
        self.assertEqual([int(item["mid"]) for item in visits], [1, 2])
        self.assertEqual(next(variables(s)["result"] for s in states(script) if "result" in variables(s)), "-1")

    def test_binary_search_rejects_unsorted_explicit_input(self):
        with self.assertRaises(ValueError):
            build_local_script(request("binary search nums=[5,1,3], target=1"))

    def test_longest_substring_handles_repeated_characters(self):
        script = build_local_script(request('sliding window longest substring s="abba"'))
        self.assertEqual(next(variables(s)["result"] for s in states(script) if "result" in variables(s)), "2")
        windows = [s for s in states(script) if "left" in variables(s) and "right" in variables(s)]
        for state in windows:
            left, right = int(variables(state)["left"]), int(variables(state)["right"])
            self.assertEqual(len(set("abba"[left:right + 1])), right - left + 1)

    def test_bfs_marks_nodes_on_enqueue_to_avoid_revisit(self):
        script = build_local_script(request('BFS graph={"A":["B","C"],"B":["C"],"C":["A"]}, start=A'))
        result = next(variables(s)["result"] for s in states(script) if "result" in variables(s))
        self.assertEqual(result, "A → B → C")

    def test_rate_limiter_respects_token_capacity(self):
        script = build_local_script(request("system design token bucket capacity=2 refill=1 requests=[0,0,0,1]"))
        decisions = [variables(s)["decision"] for s in states(script) if "decision" in variables(s)]
        self.assertEqual(decisions, ["ALLOW", "ALLOW", "DENY", "ALLOW"])
        denied = next(s for s in states(script) if variables(s).get("decision") == "DENY")
        self.assertNotIn("service", denied["activeNodes"])

    def test_prompt_timing_and_identity_are_preserved(self):
        script = build_local_script(request("Two Sum nums=[2,7,11,15], target=9", requestedShotCount=6,
                                            requestedDurationSeconds=18))
        self.assertEqual(len(script["segments"]), 6)
        self.assertAlmostEqual(sum(s["durationSeconds"] for s in script["segments"]), 18)
        self.assertEqual(script["sourcePromptHash"], "a" * 64)
        self.assertIn("invariant", " ".join(script["codingLesson"]["learningObjectives"]))

    def test_unsupported_topic_does_not_become_two_sum(self):
        with self.assertRaises(UnsupportedCodingPrompt):
            build_local_script(request("LeetCode dynamic programming knapsack"))
        with self.assertRaises(UnsupportedCodingPrompt):
            build_local_script(request("Two Sum bằng JavaScript"))

    def test_explicit_malformed_dataset_is_rejected(self):
        for topic in ("Two Sum nums=[true,3], target=6", "Two Sum nums=[3,3], target=abc",
                      "Two Sum nums=[], target=1", "Two Sum nums=[1,2", "Two Sum nums=[1000000001,2]"):
            with self.subTest(topic=topic), self.assertRaises(ValueError):
                build_local_script(request(topic))

    def test_scene_references_are_validated_before_render(self):
        script = build_local_script(request("Two Sum"))
        bad = copy.deepcopy(script)
        bad["segments"][0]["teachingScene"]["states"][0]["activeIndices"] = [99]
        with self.assertRaises(ValueError):
            validate_coding_script(bad)
        bad = build_local_script(request("system design cache-aside"))
        bad["segments"][0]["teachingScene"]["edges"][0]["to"] = "missing"
        with self.assertRaises(ValueError):
            validate_coding_script(bad)

    def test_gateway_cannot_approve_claims_or_change_prompt_identity(self):
        req = request("Two Sum")
        payload = build_local_script(req)
        payload["approvalStatus"] = "approved"
        for segment in payload["segments"]:
            segment["claimStatus"] = "verified"
        result = normalize_gateway_script(req, payload)
        self.assertEqual(result["approvalStatus"], "pending")
        self.assertTrue(all(s["claimStatus"] == "needs_review" for s in result["segments"]))
        self.assertEqual(result["codingLesson"]["planner"], "configured-gateway")
        payload["segments"][0]["teachingScene"]["shell"] = "not permitted"
        with self.assertRaises(ValueError):
            normalize_gateway_script(req, payload)

    def test_nonfinite_and_total_timing_mismatch_are_rejected(self):
        script = build_local_script(request("Two Sum"))
        script["segments"][0]["durationSeconds"] = float("nan")
        with self.assertRaises(ValueError):
            validate_coding_script(script)
        script = build_local_script(request("Two Sum"))
        script["totalDurationSeconds"] += 1
        with self.assertRaises(ValueError):
            validate_coding_script(script)


if __name__ == "__main__":
    unittest.main()
