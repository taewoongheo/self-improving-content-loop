import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HYPOTHESIS_LOOP = ROOT / "docs" / "hypothesis-loop.md"


class PolicyContractTests(unittest.TestCase):
    def setUp(self):
        self.contract = HYPOTHESIS_LOOP.read_text()

    def test_hypothesis_contract_does_not_duplicate_cron_schedule(self):
        self.assertEqual(
            self.contract.count(
                "The Hermes production job alone owns recurring timing and per-event quantity."
            ),
            1,
        )
        for duplicated_schedule_language in (
            "two hours before each fixed publication slot",
            "scheduled slot allocates exactly one content",
            "daily content slots",
            "publication target",
            "contents per day",
        ):
            self.assertNotIn(duplicated_schedule_language, self.contract)

    def test_adoption_does_not_create_a_version_without_a_child_hypothesis(self):
        adoption = self.contract.split(
            "## Autonomous hypothesis adoption and owner updates", 1
        )[1].split("## Ancestor traversal range", 1)[0]

        self.assertIn(
            "Do not create a new version merely to mark adoption.", adoption
        )
        self.assertIn(
            "create the next version and a matching-axis child hypothesis together before use",
            adoption,
        )
        self.assertIn(
            "new version and matching-axis child or sibling before use", adoption
        )
        for conflicting_version_instruction in (
            "when an already-used message changes",
            "when the selected version has already been used",
            "new used-state version",
        ):
            self.assertNotIn(conflicting_version_instruction, adoption)


if __name__ == "__main__":
    unittest.main()
