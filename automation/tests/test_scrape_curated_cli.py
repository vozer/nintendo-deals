import subprocess
import sys
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]


class CuratedScraperCliTests(unittest.TestCase):
    def test_direct_script_invocation_loads_project_modules(self):
        result = subprocess.run(
            [sys.executable, "scripts/scrape-curated.py", "--help"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--apply", result.stdout)


if __name__ == "__main__":
    unittest.main()
