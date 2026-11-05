# Personal fork rules
Read docs/custom-features.md and docs/upstream-updates.md before edits or merges.
Preserve all implemented feature IDs unless the user explicitly authorizes removal.
Never replace the personal branch with upstream, reset it to upstream, or force-push it.
Merge upstream into a separate update branch and open a PR to personal. Never deploy upstream automatically.
For every feature change, update the register, implementation links and meaningful behavior tests.
Planned features are not implemented: never claim they work. Documentation checks do not prove runtime behavior.
Report each implemented feature as preserved, adapted, or blocked after an upstream merge.
Keep Postiz credentials server-side. Keep integration code separate with minimal edits to upstream screens.
