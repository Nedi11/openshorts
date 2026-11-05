# Custom feature register

| ID | Status | Contract | Implementation / verification |
|---|---|---|---|
| FORK-001 | implemented | Personal branch retains our commits; upstream updates require PR checks | AGENTS.md; .github/workflows/personal-checks.yml; scripts/check-custom-features.py |
| SCHED-001 | planned | Clip dialog: account, editable caption, publish now or chosen time | Not implemented; requires live Postiz API verification |
| SCHED-002 | planned | Queue fills configured local-time slots; UTC storage | Not implemented |
| SCHED-003 | planned | Delay after selected account's latest pending post, including posts made in Postiz; fallback to now | Not implemented |
| SCHED-004 | planned | Transfer video to durable Postiz storage before scheduling; keep remote post ID; prevent duplicates | Not implemented |
| SCHED-005 | planned | Show scheduled/published/failed and Postiz link | Not implemented |
| SCHED-006 | planned | Batch clips fill slots in stable order | Not implemented |

For each implemented scheduling feature add file links, behavior tests, timezone/error cases and a manual acceptance result. Do not mark implemented on documentation alone.
