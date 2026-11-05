# Custom feature register

| ID | Status | Contract | Implementation / verification |
|---|---|---|---|
| FORK-001 | implemented | Personal branch retains our commits; upstream updates require PR checks | AGENTS.md; .github/workflows/personal-checks.yml; scripts/check-custom-features.py |
| SCHED-001 | implemented | Clip dialog: account, editable caption, publish now or chosen time | dashboard/src/components/PostizSchedule.jsx; tests/custom/test_postiz.py (mock API; real publishing pending) |
| SCHED-002 | implemented | Uses selected account’s Postiz-managed queue slots/timezone; UTC dates | postiz_integration.py; tests/custom/test_postiz.py (mock API) |
| SCHED-003 | implemented | Delay after selected account's latest pending post, including posts made in Postiz; fallback to now | postiz_integration.py; tests/custom/test_postiz.py (mock API) |
| SCHED-004 | implemented | Transfer video to durable Postiz storage before scheduling; keep remote post ID; prevent duplicates | postiz_integration.py; tests/custom/test_postiz.py (mock API) |
| SCHED-005 | implemented | Show scheduled/published/failed and Postiz link | postiz_integration.py; tests/custom/test_postiz.py (mock API) |
| SCHED-006 | planned | Batch clips fill slots in stable order | Not implemented |

For each implemented scheduling feature add file links, behavior tests, timezone/error cases and a manual acceptance result. Do not mark implemented on documentation alone.

Implementation checks: 20 automated backend tests; frontend production build. Live acceptance (Postiz upload, scheduled Reel, actual published status) pending user connection. SCHED-006 remains planned. Scheduling supports Linux/WSL Docker; the submission lock uses flock. FORK-001 preserved; SCHED-001..005 added without altering upstream publishing.
