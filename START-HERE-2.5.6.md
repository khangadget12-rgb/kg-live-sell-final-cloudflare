# Start Here — KG Live Sell 2.5.6

## What changed
This release focuses on the recurring Branch Sell Count Calibration failure.

- Monthly actual sales are counted in one aggregate SQL query rather than four separate branch queries.
- Routine database writes no longer trigger an unnecessary `last_insert_rowid()` read unless the caller actually needs the new ID.
- Migration 7 adds the matching `(status, sold_at, branch)` index.
- The four branch offsets are saved together in one SQL statement.
- Successful saves return the saved values directly instead of running another sales-count query.
- Failed saves now expose a safe diagnostic detail and error code in the calibration panel.
- The Admin/Super Admin one-click Sales Ledger delete from 2.5.5 is preserved.

## Deploy safely
1. Back up the production database.
2. Replace the complete project in the same GitHub repository/production branch connected to the existing Cloudflare Worker.
3. Keep the existing Worker name, `APP_DB` binding, `KGAppDatabase` class, and Durable Object migration identity `v1`.
4. Do not delete/recreate the Durable Object and do not reset the database.
5. Let the configured build pipeline install dependencies and run the production build before deploying.
6. Open `/api/health` on the production domain. It must show `version: "2.5.6"` and `features.monthlyBranchCalibration: true`.
7. Sign in as Admin or Super Admin, adjust counts for the selected sale month, save, reload, and verify persistence. Then create a test sale and verify the relevant branch count increments.

## If calibration still fails
The panel now shows the backend error detail and code. Send the exact text plus a Cloudflare Workers log export filtered to `POST /api/sales/monthly-counts` at the same timestamp. Do not include passwords, session cookies, or authorization headers.

## Build verification note
This workspace could not install dependencies from the npm registry, so no successful Vite production build is claimed. Run `npm install`, `npm test`, `npm run typecheck`, and `npm run build` in the repository build environment before publishing.
