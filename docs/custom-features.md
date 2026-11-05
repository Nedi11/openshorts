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
| EDIT-002 | implemented | Visible browser and self-host server FIFOs with queued/running/completed/failed states, clip/job identity, elapsed time and server restart recovery | render_queue.py; dashboard/src/components/RenderQueue.jsx; tests/custom/test_editor_additions.py; tests/custom/test_render_queue_reliability.py; dashboard/src/lib/browserRenderQueue.test.js; dashboard/tests/renderQueue.test.cjs |
| CAPTION-001 | implemented | Native clean preset uses smaller sentence-case Arial, white text, no outline and a soft shadow | subtitles.py; dashboard/src/components/SubtitleModal.jsx; tests/custom/test_editor_additions.py |
| CAPTION-002 | implemented | Saved caption styling and edited words reload after hook updates and survive later style-only applies | app.py; dashboard/src/components/SubtitleModal.jsx; tests/test_hook_caption_persistence.py; dashboard/tests/captionPersistence.test.cjs |
| CAPTION-003 | implemented | Preview uses the server font aliases, per-font libass size metrics, margins, zero outline and static Classic highlighting; each subtitle render has a new URL | dashboard/src/lib/subtitleGeometry.js; dashboard/tests/subtitleGeometry.test.cjs; tests/test_subtitles.py |
| RENDER-001 | implemented | Hook updates compose hook and saved captions in one FFmpeg encode by default, keeping a lazy hook-only recipe for later restyling | app.py; hooks.py also path; tests/test_hook_caption_persistence.py |
| GPU-001 | implemented | Explicit AMD/Intel VAAPI H.264 encoding with real device probe and CPU fallback; retain CPU filters, captions, hooks, framing and audio maps | ffmpeg_utils.py; vaapi_ffmpeg.py; bin/ffmpeg; Dockerfile; tests/custom/test_vaapi.py |

For each implemented scheduling feature add file links, behavior tests, timezone/error cases and a manual acceptance result. Do not mark implemented on documentation alone.

Implementation checks: 20 automated backend tests; frontend production build. Live acceptance (Postiz upload, scheduled Reel, actual published status) pending user connection. SCHED-006 remains planned. Scheduling supports Linux/WSL Docker; the submission lock uses flock. FORK-001 preserved; SCHED-001..005 added without altering upstream publishing.

Editor behavior: the centered mode intentionally preserves source captions at the top/bottom as part of the full height. A source narrower than the output gets black side padding. Choosing manual per-scene reframing afterward switches the clip to track mode so manual positions take effect. Render queue serializes edit, rerender, reframe, caption and hook operations on the single-worker self-host backend. New source-video generation retains its existing progress UI. Browser disconnects allow an accepted render to finish. Native clean is an additional selectable preset; existing defaults are retained.

Browser exports have a separate tab-local queue and progress percentages. They need the tab to stay open. Server edits continue if the browser disconnects, and their recent history persists in output/.render-queue.json. The UI polls every two seconds and shows actual states rather than an estimated server completion percentage. Caption Native size is 16 in the existing scale, approximately one third of the default, with Arial mapped to the installed Liberation Sans font in Docker.

Queue reliability checks cover corrupted history, restart timestamps, write failures, history bounds, subscriber failures, monotonic progress, queued aborts, stale server status, stalled polling, UI cleanup and conflicting edits. Queue history is best-effort diagnostic storage and reports a warning when it cannot be saved. Queued server edits verify the clip revision before execution. A conflicting request returns HTTP 409 and requires reopening the clip. Same-clip browser edits are guarded before changing their layers. Independent clips can still queue. The frontend refresh timeout is 10 seconds with a 2-second retry interval, and elapsed time has an independent clock.

GPU-001: set FFMPEG_ENCODER=vaapi and optionally VAAPI_DEVICE=/dev/dri/renderD128.
Linux Docker must expose that render device and add its host numeric group ID
for appuser. The image installs mesa-va-drivers. Only encoding is accelerated;
CUDA analysis, NVDEC and osrender are not enabled for AMD. Failed initial device
probes use existing x264 settings. A failure during an already accepted GPU
encode remains a visible render error, rather than silently retrying pipe inputs.
VAAPI uses QP 18 (quality/intermediate) and QP 22 (delivery); these numbers are
not equivalent to x264 CRF. Review output quality before changing these defaults.
Manual acceptance: Ryzen 7 5700G/amdgpu, host VAAPI encode and decode succeeded
for centered framing, subtitles, hook-style overlay and two-output filter graph.
Container acceptance: Debian 13 image with Mesa VAAPI, appuser plus render GID
990: 37 encoder/VAAPI tests passed, including real device encode/decode, audio
retention, centered framing, caption and hook graphs, and multiple outputs.
The actual burn_subtitles/add_hook_to_video functions also succeeded on a real
1080x1920 clip; a device-less container correctly selected x264.

Caption editor initialization reads the saved style and edited words from the clip transcript endpoint. Applying a style without new words preserves saved corrections. An explicit empty words array restores the original transcript. Applying is disabled until saved settings load successfully. Hook-update/removal and modal-remount regression tests preserve CAPTION-001 and CAPTION-002.

Hook updates reuse hooks.add_hook_to_video(also=...) with the existing default HOOK_LAZY=1. Saved caption text, styles, edited timelines and layout ranges are prepared before encoding. The combined output gets a unique numeric generation ID. Hook removal keeps its caption-only pass. Setting HOOK_LAZY=0 explicitly retains two output encodes in one FFmpeg invocation. The existing recipe-write-failure fallback can materialize the hook-only file as an additional encode. Watermark delivery retains its existing behavior.

Manual acceptance: an isolated container on the desktop AMD VAAPI device produced one combined H.264 encode for both native ASS and classic SRT captions, with audio, 1080x1920 geometry, duration, saved style and edited words preserved. This used a synthetic eight-second clip, not the earlier 71-second operation.

CAPTION-003: bundled Liberation bold fonts make Arial/Verdana/Helvetica, Georgia and Courier previews independent of browser OS. Preview sizing follows the integer ASS size and Windows ascent/descent of each bundled font. Classic top/middle use ASS alignments 8/5. Explicit zero outlines stay zero. Subtitle/restyle output IDs use nanoseconds to avoid same-second URL reuse. CSS active-word animations remain an approximation of libass effects; face-aware hook avoidance can also shift server captions.

Caption outline regression: preview/browser exports use a continuous CSS stroke painted before the fill, rather than four offset copies of each glyph. This preserves thick outlines without the duplicated-word artifact. Covered by dashboard/tests/subtitleGeometry.test.cjs.
