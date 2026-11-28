# KG Live Sell 2.5.5 — Calibration & Sales Ledger Repair

## Fixes

- Calibration now uses `POST /api/sales/monthly-counts` as its canonical endpoint.
- The previous `/api/sales/monthly-counts/calibrate` route remains supported, with an additional `/api/sales/calibrate-monthly-counts` alias.
- Startup now reconciles the calibration table and customer-location column even if a previous migration marker exists. Existing sales and inventory are preserved.
- `/api/health` reports version `2.5.5` and confirms whether calibration and Admin sales deletion routes are included.
- Admin and Super Admin can permanently delete ledger sales with one click. The server checks the role, writes an audit entry, and restores one inventory unit for a completed sale before removing the ledger record. Voided sales are not restocked a second time.
- The delete operation uses the existing POST alias for reliability through browser and proxy layers.

## Deployment verification

After deploying the complete repository to the existing Worker, open `/api/health`. Confirm `version` is `2.5.5` and both `features.monthlyBranchCalibration` and `features.adminSalesDeletion` are `true`. Keep the existing Worker name, `APP_DB` binding, `KGAppDatabase` Durable Object class, and migration identity. Back up the application database before deployment; do not delete or recreate the Durable Object.

## Validation

The package includes the complete Cloudflare Worker source and Vite application source. A Vite production build could not be run in the build environment because npm dependency installation timed out; the release must not be described as a verified production build until `npm run build` completes successfully in the repository build environment.
