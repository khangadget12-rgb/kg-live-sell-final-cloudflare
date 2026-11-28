# Build and Deploy — KG Live Sell 2.5.6

## Required checks
Use Node.js 22.16 or later and a compatible npm version. From the repository root:

```bash
npm install
npm test
npm run typecheck
npm run build
```

Do not deploy if any command fails. This editing environment had no installed project dependencies and could not resolve the npm registry, so the full Vite production build could not be completed here.

## Cloudflare deployment
- Deploy through the existing GitHub repository and production branch attached to the current Worker.
- Preserve the current Worker name and `APP_DB` Durable Object binding.
- Keep `KGAppDatabase` and Durable Object migration identity `v1` unchanged.
- Do not create a new Worker or delete/recreate the existing Durable Object namespace.

## Production verification
Open `/api/health`. Confirm it returns `version: "2.5.6"` and `features.monthlyBranchCalibration: true`.

Then test:
1. Admin and Super Admin can open calibration.
2. Set branch counts for the desired sale month and save.
3. Reload the page; values should persist.
4. Record one completed test sale; the adjusted count should increment by one.
5. Verify staff cannot access the calibration POST route.
6. Verify Admin and Super Admin can still use the one-click Sales Ledger delete button.

If the save fails, the UI now displays the backend diagnostic detail and code. Export Cloudflare logs for `POST /api/sales/monthly-counts` at the same time and share them with credentials redacted.
