# Upstream updates

Source: https://github.com/mutonby/openshorts
Fork: https://github.com/Nedi11/openshorts (personal branch)

1. Start from clean personal: git fetch origin; git switch personal; git pull --ff-only.
2. git fetch upstream main; git switch -c update/upstream-YYYY-MM-DD.
3. git merge upstream/main. Resolve conflicts by preserving registered implemented behavior.
4. Read the feature register and report each implemented ID. Run python3 scripts/check-custom-features.py, upstream checks and feature behavior tests. Build all images and smoke-test clip generation and scheduling when implemented.
5. Open a PR to personal. Required checks must pass. Review clean merges for behavior regressions too.
6. After merge, update openshorts-selfhost/openshorts.ref to the exact tested fork commit; rebuild and check /health and dashboard. Keep the previous commit and Docker image IDs for rollback. Never delete data volumes during updates.

## History
- 2026-11-05: fork foundation based on upstream 894514049a3c6210a7cd65676344f44371b3717a. Scheduling intentionally deferred until Postiz is deployed and a real Reel publishes.
