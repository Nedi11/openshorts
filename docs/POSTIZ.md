# Schedule clips with Postiz

Self-host only; Instagram and Instagram Standalone are supported. Runs on Linux/WSL Docker. Existing Upload-Post publishing is unchanged.

## Configure
Set these variables in the backend environment (the PC self-host kit reads its root .env):

```
POSTIZ_API_URL=https://postiz.yourdomain.com/api/public/v1
POSTIZ_API_KEY=<your Postiz public API key>
```

Recreate the backend with ./clip up after changes. API keys stay in the backend and are removed from pipeline child environments. POSTIZ_ALLOWED_ORIGINS is a comma-separated list of exact dashboard origins if you use a custom port/domain; default localhost/127.0.0.1 ports 5175 and 5173. Keep the PC API on loopback.

## Use
On a finished clip select Schedule · Postiz. Select an Instagram account, edit its caption, and choose:
- Publish now.
- Choose date/time in your browser’s timezone; transmitted with an explicit UTC offset.
- Next Postiz queue slot: configure posting slots and timezone in Postiz first.
- After latest: delay after that account’s latest QUEUE post, including posts made directly in Postiz; if no future queued post exists, delay from now.

The saved server video is uploaded by multipart to Postiz before creating a Reel. Browser-only preview layers are not included unless already rendered into the saved file. Edits that create a new filename are separate variants. Postiz owns its stored copy, so OpenShorts retention will not delete it. Meta must be able to access Postiz’s media URLs.

Reopen the dialog and use Refresh status to see QUEUE/PUBLISHED/ERROR and a release link when provided. Edit/cancel in Postiz. Batch scheduling is not implemented.

## Duplicate and failure handling
The durable ledger output/.postiz.sqlite3 and output/.postiz.lock live in the existing output volume. Back up the ledger with your outputs. Submissions serialize across backend processes. Each server/job/filename/account can be submitted only once, even after restart or cancellation. Do not delete the ledger to retry blindly.

UNKNOWN means the create request may have succeeded. Automatic retries are deliberately blocked, including queue additions for that account until reconciled. Check Postiz before taking any further action. There is currently no UI to clear an uncertain record; reconcile the matching ledger entry with a backup and server access only after confirming whether Postiz created it. HTTP rejections after dispatch are conservatively treated the same way.

Date selection is serialized for requests from this PC. A simultaneous change directly in Postiz can still race; the external API offers no atomic reservation. Recently reserved native queue slots are rejected if Postiz returns one again; choose a specific time or retry after Postiz updates. Pending posts are queried across 1970–9999; an incompatible Postiz server returns an error rather than silently scheduling from an incomplete list.

## Verification
Run python -m pytest tests/custom/ -q and npm ci && npm run build in dashboard/. Tests use a fake Postiz and cover time modes, persistent duplicate prevention, concurrent submissions, path validation, errors and status. Real Instagram publishing has not been tested. First use a single test clip and verify its upload, scheduled appearance, and final published status in your instance.

API references checked 2026-11-05:
https://docs.postiz.com/public-api/introduction
https://docs.postiz.com/public-api/posts/create
https://docs.postiz.com/public-api/posts/list
https://docs.postiz.com/public-api/uploads/upload-file
https://docs.postiz.com/public-api/integrations/find-slot
