"""Guard the feature inventory; runtime feature tests must be added with implementation."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
text = (root / "docs/custom-features.md").read_text()
for feature in ["FORK-001", *[f"SCHED-{n:03}" for n in range(1, 7)]]:
    assert f"| {feature} |" in text, f"Missing feature: {feature}"
assert "Never replace the personal branch" in (root / "AGENTS.md").read_text()
assert (root / "docs/upstream-updates.md").is_file()
print("Feature inventory intact (not a runtime scheduling test)")

assert (root / "postiz_integration.py").is_file()
assert (root / "tests/custom/test_postiz.py").is_file()
assert "PostizSchedule" in (root / "dashboard/src/components/ResultCard.jsx").read_text()
