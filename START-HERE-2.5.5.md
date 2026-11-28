# Start Here — KG Live Sell 2.5.5

## What changed

- Fixed calibration route compatibility and added defensive database schema reconciliation.
- Added one-click Sales Ledger delete for Admin and Super Admin.
- Completed sale deletion restores one inventory unit, removes the ledger entry, and creates an audit entry. Deleting a voided transaction does not restore stock twice.
- Added deployment health details to `/api/health`.

## Deploy safely

1. Back up the existing application database from the app's backup feature.
2. Confirm the Worker name and existing Durable Object binding in Cloudflare.
3. Replace the code in the same GitHub repository and production branch with this complete project. Do not create a new Worker.
4. Let Cloudflare build and deploy the full repository. Do not publish if the build log reports an error.
5. Open `/api/health`. It must show `version: 2.5.5`, `features.monthlyBranchCalibration: true`, and `features.adminSalesDeletion: true`.
6. Sign in as Admin or Super Admin. Save monthly counts from Live Sell and test deletion on a suitable test transaction.

## Do not change

Keep the existing Worker name, `APP_DB` binding, `KGAppDatabase` Durable Object class, and migration identity `v1`. Do not delete/recreate the Durable Object or reset the database.

## Build note

Run `npm install` followed by `npm run build` in the same repository environment used by Cloudflare. This workspace could not download dependencies, so a successful Vite build is not claimed here.
