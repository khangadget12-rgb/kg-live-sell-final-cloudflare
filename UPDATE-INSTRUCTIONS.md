# KG Live Sell – Notifications & Rajshahi Scanner Stability Update

This is an incremental source update for the existing Cloudflare-hosted KG Live Sell 2.5.x repository.

## What this update changes

### Notifications and sound
- Passes the Alerts On/Off preference handler into the notification drawer (so the per-user receive-notifications preference can actually be changed from the UI).
- Starts the Web Audio context on the first user interaction without unexpectedly playing a tone; Test Sound still plays a test tone.
- Waits for an active service worker before using `ServiceWorkerRegistration.showNotification`, with a desktop fallback.
- Uses the service worker notification path on mobile browsers.
- Polls the signed-in user's inbox every 15 seconds as a fallback and checks it immediately when the live SSE stream reports stock/sale changes.
- Retains the per-user notification preference and sound preference.

### Rajshahi live Google Sheet scanner
- Supports both standard Google Sheets edit links (`/spreadsheets/d/<id>/edit`) and published-to-web links (`/spreadsheets/d/e/<published-id>/pubhtml`). The published link is converted to the correct published CSV endpoint.
- Recognizes branch headers such as `RG Stock`, `New Market Qty`, `Jamal Supermarket Stock`, and `City Centre Units` in addition to short branch codes.
- Awaits Cloudflare Durable Object alarm writes before the request/initialization finishes, and awaits alarm rescheduling after each scan.
- Retries alarm scheduling once at 60 seconds if the normal alarm write fails; the Durable Object `alarm()` handler also leaves a retry alarm if an unexpected error escapes.
- Displays the latest checked model count, total units and branch-wise stock totals in Settings and Stock Sheet.
- Retains existing stock when Google returns an error, HTML page or invalid/missing columns.

## Upload steps

1. Extract this ZIP.
2. Open the **same GitHub repository** currently connected to your working Cloudflare Worker.
3. Upload the extracted files to the repository root using **Add file → Upload files**. Keep their folder paths exactly as shown. Replace matching files.
4. Commit the changes to the same production branch (normally `main`).
5. Wait for Cloudflare to finish the automatic build and deployment.

## Do not change these Cloudflare resources

- Do not delete or recreate the Worker.
- Do not delete or recreate the `KGAppDatabase` Durable Object or its storage.
- Do not change the `APP_DB` or `ASSETS` bindings.
- Do not edit `wrangler.toml` or `package.json` as part of this update.
- No SQL migration is required. No D1/R2 resource is required.

## After deployment: enable notifications on each device/browser

1. Sign in to KG Live Sell.
2. Open the bell / Alerts drawer.
3. Make sure **Alerts On** is enabled for that user.
4. Click **Enable Browser Alerts** and allow the browser permission.
5. Click **Test Alert**.
6. Click **Test Sound** and make sure the device volume is up.
7. Repeat on every computer/phone and every browser profile; notification permission is per device/browser.
8. On iPhone/iPad, add the site to the Home Screen and open the installed web app before requesting notification permission.

Browser sound is subject to autoplay and operating-system sound settings. The first interaction with the signed-in app silently unlocks the app's audio context; Test Sound verifies it.

**Important delivery limitation:** This release shows notifications while KG Live Sell is open or its page is running in the background. It does not implement server Web Push subscriptions/VAPID delivery, so it cannot guarantee new alerts after the browser/app is fully closed. That requires a separate Web Push backend and per-device subscriptions.

## After deployment: verify Rajshahi scanner

1. Sign in as Admin or Super Admin.
2. Open Settings → Rajshahi Live Sheet Auto-Scanner.
3. The previously saved sheet URL should remain in place; do not need to paste it again.
4. Keep Continuous Scan enabled and select **Every 30s (recommended)** or a longer interval.
5. Click **Save & Sync** once. This stores the URL/settings, runs a scan immediately, and schedules the next Cloudflare Durable Object alarm.
6. Check that the panel shows a recent `Last check`, a `Next check`, a model/unit count, and branch totals (`RG`, `NM`, `JSM`, `CC`).
7. You can close the Settings screen or turn off your PC; scheduled scanning runs in the Cloudflare Durable Object, not in the browser.

### Google Sheets publishing requirement

For published links, open the Google Sheet → File → Share → Publish to web → Published content & settings and enable **Automatically republish when changes are made**. Google may still take time to republish a changed published sheet; the scanner interval does not force Google's publication cache to update instantly.

If the scanner shows `Google returned an HTML page instead of CSV`, publish the sheet/tab to the web and use its published `/d/e/.../pubhtml` URL or a normal viewer-accessible `/d/.../edit` URL. If a scan fails validation, the current inventory is intentionally kept unchanged.

## Free-tier note

A 30-second interval is 2,880 scheduled scans per day for this one Durable Object, before normal users' requests. Shorter intervals increase Google fetches and Cloudflare usage. Cloudflare Durable Object alarms run in the background and must be rescheduled by the alarm handler after each invocation.
