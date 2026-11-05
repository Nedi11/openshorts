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
| EDIT-001 | implemented | Center height-fit uses a fixed horizontal center and preserves the full source height; narrow sources get side padding | centered_fit.py; main.py; tests/custom/test_editor_additions.py; tests/test_rerender_endpoint.py |
| EDIT-002 | implemented | Visible browser and self-host server FIFOs with queued/running/completed/failed states, clip/job identity, elapsed time and server restart recovery | render_queue.py; dashboard/src/components/RenderQueue.jsx; tests/custom/test_editor_additions.py; dashboard/src/lib/browserRenderQueue.test.js |
| CAPTION-001 | implemented | Native clean preset uses smaller sentence-case Arial, white text, no outline and a soft shadow | subtitles.py; dashboard/src/components/SubtitleModal.jsx; tests/custom/test_editor_additions.py |

For each implemented scheduling feature add file links, behavior tests, timezone/error cases and a manual acceptance result. Do not mark implemented on documentation alone.

Implementation checks: 20 automated backend tests; frontend production build. Live acceptance (Postiz upload, scheduled Reel, actual published status) pending user connection. SCHED-006 remains planned. Scheduling supports Linux/WSL Docker; the submission lock uses flock. FORK-001 preserved; SCHED-001..005 added without altering upstream publishing.

Editor behavior: the centered mode intentionally preserves source captions at the top/bottom as part of the full height. A source narrower than the output gets black side padding. Choosing manual per-scene reframing afterward switches the clip to track mode so manual positions take effect. Render queue serializes edit, rerender, reframe, caption and hook operations on the single-worker self-host backend. New source-video generation retains its existing progress UI. Browser disconnects allow an accepted render to finish. Native clean is an additional selectable preset; existing defaults are retained.

Browser exports have a separate tab-local queue and progress percentages. They need the tab to stay open. Server edits continue if the browser disconnects, and their recent history persists in output/.render-queue.json. The UI polls every two seconds and shows actual states rather than an estimated server completion percentage. Caption Native size is 16 in the existing scale, approximately one third of the default, with Arial mapped to the installed Liberation Sans font in Docker.
