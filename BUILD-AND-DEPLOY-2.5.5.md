# Build and Deploy — KG Live Sell 2.5.5

## Before deploying

- Back up the existing application database.
- Confirm the exact production Worker name in Cloudflare. The uploaded source was configured for `kg-live-sell-final-cloudflare`; do not rely on that value if your dashboard shows a different existing Worker.
- Keep the existing `APP_DB` Durable Object binding, `KGAppDatabase` class and migration identity `v1`.

## Build locally

Use Node.js 22.16 or later and npm 11.19 or later. From the repository root run:

```bash
npm install
npm test
npm run typecheck
npm run build
```

Do not deploy if any command fails. This build environment could run the existing tests and targeted checks, but it could not download the project dependencies from npm, so it could not generate or verify the Vite `dist/` build.

## Cloudflare deployment

Push the complete project to the same GitHub repository and production branch attached to your existing Cloudflare Worker. Let the existing Workers Builds pipeline install dependencies, run `npm run build`, and deploy. Do not create a new Worker or Durable Object namespace.

## Verify the actual backend

After deployment, open `/api/health`. It must return `version: "2.5.5"` and show:

```json
{
  "features": {
    "monthlyBranchCalibration": true,
    "adminSalesDeletion": true
  }
}
```

This check is important: the browser can show the new calibration panel while an older Worker backend is still deployed. If the version or feature flags are missing, the backend has not been updated on the Worker serving this domain.

## Functional checks

1. Sign in as Admin or Super Admin. Open Live Sell and expand calibration.
2. Confirm the current month values load, change a value, save, reload, and verify it remains.
3. Record one test sale and confirm the relevant branch count increments.
4. In Sales Ledger, verify Admin and Super Admin see a Delete button and Staff do not. Test deletion on a suitable test transaction. A completed sale is permanently removed and one stock unit is restored; a voided sale is removed without restoring a second unit. There is intentionally no confirmation dialog.
5. Check Audit Logs for `DELETE_SALE` and `CALIBRATE_MONTHLY_BRANCH_SELL_COUNTS`.
