import unittest

from scripts.run_event_research import build_research_prompt


class EventResearchPromptTests(unittest.TestCase):
    def test_preflight_prompt_requires_active_research_and_a_brief_user_update(self):
        prompt = build_research_prompt(
            trigger_kind="content_preflight",
            objective="Improve the next content decision.",
            event_context={"content_count": 1},
            attempt_token="production:run-1",
        )

        self.assertIn("content_preflight", prompt)
        self.assertIn("no more than three", prompt)
        self.assertIn("quality feedback", prompt.lower())
        self.assertIn("not causal proof", prompt)
        self.assertIn("manual_analytics_store.py", prompt)
        self.assertIn("exact metric, scope, window", prompt)
        self.assertIn("성과 업데이트", prompt)
        self.assertIn("Do not expose IDs", prompt)
        self.assertIn("at most three short bullets", prompt)
        self.assertIn("Do not ask the user to use internal feedback labels", prompt)
        self.assertIn("AGENTS.md autonomous engineering contract", prompt)
        self.assertNotIn("dirty-tree isolation", prompt)

    def test_result_review_prompt_does_not_treat_one_checkpoint_as_causal_proof(self):
        prompt = build_research_prompt(
            trigger_kind="result_review",
            objective="Interpret newly collected checkpoints.",
            event_context={
                "checkpoints": [{"result_id": 1, "content_id": "C-1", "target_hours": 24}]
            },
            attempt_token="metrics:run-2",
        )

        self.assertIn("result_review", prompt)
        self.assertIn("not causal proof", prompt)
        self.assertIn("24h", prompt)

    def test_manual_url_prompt_requires_source_first_correlated_admission(self):
        prompt = build_research_prompt(
            trigger_kind="manual",
            objective="Evaluate user-provided knowledge.",
            event_context={"user_urls": ["https://example.com/article"]},
            attempt_token="interactive:run-3",
        )

        self.assertIn("user-provided URL", prompt)
        self.assertIn("candidate knowledge", prompt)
        self.assertIn("inspect the original URL first", prompt)
        self.assertIn("Do not decide from that URL alone", prompt)
        self.assertIn("independent corroborating or contradicting sources", prompt)
        self.assertIn("adopted, duplicate, or not adopted", prompt)


if __name__ == "__main__":
    unittest.main()
