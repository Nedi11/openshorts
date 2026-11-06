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

CAPTION-004 (implemented): caption editor offers 0–35% horizontal padding per side,
saved across caption and hook edits, and a continuous 6–70 size slider below Native.
ASS and Classic burns apply horizontal margins; preview/export width and grouping
follow the selected padding. A stroke suppresses the separate preset drop shadow;
shadow-only captions retain an adjustable shadow. Implementation: subtitles.py,
app.py, SubtitleModal.jsx, subtitleGeometry.js, remotion/compositions/Subtitles.tsx.
Verification: tests/custom/test_editor_additions.py covers small sizing, margins and
stroke/shadow separation; existing caption persistence and geometry checks retained.

EDIT-003 (implemented): render queue expands only on explicit user click. Queued
and active server/browser edits have Cancel controls. Server cancellation scopes
subprocess termination to the selected edit's executor context, waits for the
worker before releasing the FIFO, and does not commit its resulting URL. Browser
exports receive an AbortSignal. Cancelled states persist across reloads.
Implementation: render_cancel.py, render_queue.py, app.py, RenderQueue.jsx,
browserRenderQueue.js, renderInBrowser.js. Tests: tests/custom/test_word_censor.py,
dashboard/tests/renderQueue.test.cjs, dashboard/src/lib/browserRenderQueue.test.js.

CAPTION-005 (implemented): No highlight disables active-word color/effects without
losing the selected color. Bold is saved and applied to ASS, Classic and browser
captions. Bundled Liberation regular fonts support normal weight; Anton/Impact
and Montserrat ExtraBold retain their fixed heavy faces. Tests:
tests/custom/test_editor_additions.py, dashboard/tests/captionPersistence.test.cjs.

RENDER-002 (implemented): editor recuts and manual reframing reapply the saved
hook before captions, retaining text, style, font, position and duration. Newly
saved hooks also retain size. Clean derivatives remain available for restyling.
Implementation: app.py _recut_hook, recut.py perform_recut; regression:
tests/test_rerender_endpoint.py.

AUDIO-001 (implemented): editor offers Off, Mute + bleep and Cut word modes with
an editable comma-separated exact-word list. Matching ignores case/punctuation;
no language guessing or substring matching. Bleep mutes the original samples,
adds a 1 kHz tone, and replaces caption words with [bleep]. Cut removes matched
word intervals from video/audio and remaps captions to the shortened timeline.
The editable original segments are retained so Off can restore the original;
source transcript and canonical clip are never overwritten. Word-level transcript
accuracy limits boundaries. Existing captions burned into the uploaded source
cannot be erased by this feature. Implementation: word_censor.py, app.py,
recut.py, ClipEditor.jsx; tests/custom/test_word_censor.py verifies actual encoded
audio frequency suppression, duration, exact matching and caption time remapping;
tests/test_rerender_endpoint.py covers saved recipe and hook preservation.

CAPTION-006 (implemented): caption shadow has distance (0–10), direction
(0–360°, 0 right, 90 down; 45° reproduces the earlier equal x/y offset), blur
(0–10), colour and opacity. ASS burns draw the shadow on a separate layer under
the text (nearly transparent fill, libass \xshad/\yshad/\blur), so blur never
softens the letters; zero distance with blur gives a centred soft halo. A stroke
still suppresses the shadow (CAPTION-004); shadow applies to karaoke captions.
Settings save with the caption style and reapply on hook, recut and restyle.
Implementation: subtitles.py shadow_layer_tags, app.py, SubtitleModal.jsx,
subtitleGeometry.js subtitleShadowCss, remotion/compositions/Subtitles.tsx.
Tests: tests/custom/test_shadow_position.py (tag maths plus a real libass frame
proving a blurred offset shadow under unchanged white glyph pixels),
tests/test_hook_caption_persistence.py, dashboard/tests/subtitleGeometry.test.cjs.

CAPTION-007 (implemented): besides top/middle/bottom, captions offer a custom
position: the caption's bottom edge as 0–90% of the height above the bottom.
ASS and Classic burns use bottom alignment with MarginV = 288 × percentage;
the preview uses the same rounding. Split-layout seam captions keep their \an5
override. Implementation: subtitles.py custom_margin_v, app.py, SubtitleModal.jsx,
Subtitles.tsx. Tests: tests/custom/test_shadow_position.py.

HOOK-001 (implemented): besides auto/top/center/bottom, hooks offer custom
left/right and up/down sliders, each 0–100% of the box's free travel, so the
whole hook always stays in frame. Server (hooks.custom_overlay_xy) and preview
and browser export (HookOverlay.tsx flex spacers) share that definition. The
choice saves in auto_hook and reapplies on recut/reframe. Tests:
tests/custom/test_shadow_position.py, tests/test_hook_caption_persistence.py.
Manual acceptance: real 1080x1920 clip burned with a custom-position pill hook,
custom-height karaoke captions and a blurred 120° shadow in one encode.

EDIT-004 (implemented): in the hook and caption editors the preview is sticky on
desktop widths, so scrolling the controls no longer scrolls the video away.
Phones keep the stacked layout. Implementation: HookModal.jsx, SubtitleModal.jsx.
PERF-001 (implemented): main.py sets OMP_NUM_THREADS (TORCH_THREADS, else up to
8) before importing ultralytics, which otherwise forces it to 1 for the whole
job process. That had left TransNetV2 scene detection, YOLO and faster-whisper
single-threaded. Measured on a Ryzen 7 5700G (CPU, AMD VAAPI encode, 60 s
clips): scene detection ~41 s -> ~13 s; total reframe ~56 s -> 30-33 s even with
TRACK-001's extra detection work; medium int8 transcription of 30 s of audio
35.7 s -> 12.7 s. scene_detection.apply_torch_threads covers the API process.
An explicit OMP_NUM_THREADS or TORCH_THREADS still wins.

TRACK-001 (implemented): face detection runs every 2nd frame (DETECT_STRIDE=2,
was 4) and the no-face person fallback uses YOLOv8 Small (yolov8s.pt, baked
into the image beside yolov8n.pt). The tracker's per-detection damping keeps
its tuned timing in frames: JUMP_CONFIRM_FRAMES defaults to 12 / stride
detections and the speaker score decay to 0.85^(stride/4). DETECT_STRIDE=4 with
YOLO_MODEL_PATH=yolov8n.pt restores the previous tracker exactly. Benchmarked
cost before PERF-001: about 2-4 s per 60 s clip. Speaker detection from mouth
motion (SPEAKER_SIGNAL) remains off. Tests: tests/custom/test_tracking_defaults.py
(fresh-interpreter import checks; skipped without the ML stack).

AUDIO-001 update (implemented): each matched word becomes a section starting
`pad_before` (default 0.15 s) before and ending `pad_after` (default 0.05 s)
after its transcript timing, since Whisper tends to start words after their
sound does. The editor lists every matched word in the current segments with its
clip time and length; each edge can be nudged in 0.05 s steps, a word can be
skipped, and a section can be played on the source monitor. Nudges are keyed by
the word's source start time and saved. Sections clamp to the segment holding
the word. The render records the final source sections (and clip-time sections
for bleep), and captions show [bleep] only inside those, so skipped words keep
their text. dashboard/src/lib/censorSections.js mirrors word_censor.sections.
Tests: tests/custom/test_word_censor.py, tests/test_rerender_endpoint.py,
dashboard/tests/censorSections.test.cjs.

AUDIO-002 (implemented): editor offers background music Keep / Remove (voice
only) / Turn down (6–30 dB, default 18). Demucs htdemucs (MIT) separates the
rendered clip's audio; the voice stem is kept and the rest (original minus
voice) is dropped or attenuated. The video stream is copied. Runs before bleeps,
so the tone survives. Saved per clip (music_removal) and re-applied on manual
reframe. Weights are baked into the image at /opt/demucs (outside the
/app/.cache volume); torchaudio comes from the CPU index. Cost: about 27 s per
60 s clip on a Ryzen 7 5700G CPU. A cancel takes effect after separation (it
runs in-process). Sung vocals stay; Remove also drops crowd and room sound.
Implementation: music_removal.py, app.py _audio_processor, ClipEditor.jsx,
Dockerfile, requirements.txt. Tests: tests/custom/test_music_removal.py,
tests/test_rerender_endpoint.py. Manual acceptance: a 60 s section of a real
video separated into a voice track (223 transcribed words, level unchanged) and
a residual about 13 dB lower containing no transcribable speech.

AUDIO-001 controls fix (implemented): each listed word shows the section it
actually removes (clip start–end). Start/End move one edge and Move shifts the
whole section, 0.05 s per click. Per-word adjustments are effectively
unlimited (the section clamps to the segment holding the word). Shrinking
below 0.1 s is refused, widening never is, and each word has a reset. The
general lead/tail and a word's own adjustment add together, so changing the
general setting keeps every per-word offset. Edges that cross are flagged,
block rendering in the editor, and are refused by the server (400): before,
such a word was silently left uncensored. Tests: tests/custom/test_word_censor.py,
dashboard/tests/censorSections.test.cjs (the reported crossed case).

AUDIO-001 fine sections (implemented): sections down to 0.01 s are applied
(word_censor.MIN_SECTION, mirrored in censorSections.js), and the editor's edge
buttons step by a chosen 0.01 / 0.05 / 0.25 s. Bleep is sample-accurate; Cut
re-encodes frame-accurately, so the picture moves in whole frames (~0.033 s at
30 fps) around the cut. Tests: tests/custom/test_word_censor.py,
dashboard/tests/censorSections.test.cjs (0.07 s section shrunk to 0.02 s).

AUDIO-001 hand-set edges (implemented): the start-earlier / end-later settings
are presets. They place only the edges of a word the user has not moved. An
edge moved by hand is saved as an absolute source time (adjustments[key].start
/ .end) that later preset changes leave alone; the other edge keeps following
its preset. Move fixes both edges; reset hands them back to the presets. The
editor labels hand-set edges. Relative before/after offsets saved earlier are
still read. Tests: tests/custom/test_word_censor.py
(test_presets_only_place_edges_that_were_not_set_by_hand),
dashboard/tests/censorSections.test.cjs.

AUDIO-001 millisecond steps (implemented): the censor edge buttons also step by
0.001 s and 0.005 s, and the list shows times to the millisecond, the precision
word_censor and recut keep throughout. The shortest applied section stays
0.01 s. Tests: dashboard/tests/censorSections.test.cjs,
tests/custom/test_word_censor.py (millisecond edges reach the render).
