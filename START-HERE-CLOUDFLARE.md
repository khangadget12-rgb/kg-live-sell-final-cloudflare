# KG Live Sell 2.5.4 — Existing Cloudflare Deployment Update

This package is an update to the existing KG Live Sell Cloudflare application, not instructions to create a second Worker or database.

## Before deploying

1. Make a database backup using the existing application's backup feature and retain a copy outside the Worker.
2. Confirm the current production Worker name in Cloudflare Dashboard → Workers & Pages. The Cloudflare logs provided for this project identify it as `kg-live-sell-final-cloudflare`; this package's `wrangler.toml` is aligned to that name.
3. Confirm the Worker still uses the `APP_DB` binding to the `KGAppDatabase` Durable Object and the existing `v1` migration identity.
4. Use the same GitHub repository and production branch already connected to this Worker. Upload/commit the complete contents of this release, preserving the repository's directory structure.
5. Preserve existing Workers Builds commands, build variables, runtime variables, and secrets. Do not add a new Worker or a new Durable Object namespace.

## Deploy

Let the existing Cloudflare Workers Builds pipeline build and deploy the update. If deploying manually, use the repository's existing build and deploy procedure. Do not change the Worker name, `APP_DB` binding, `KGAppDatabase` class, or `v1` migration tag.

On first startup, database migration 5 runs automatically. It adds `sales.customer_location` only if missing and creates `monthly_branch_sales_calibrations`; existing sales and inventory rows are retained. Calibration records store count offsets and audit information; historical sale records are not rewritten.

## Verify after deployment

1. Open `/api/health` and confirm the service reports a healthy database connection.
2. Sign in using an existing account. Do not use first-run setup on a populated production database.
3. As Admin or Super Admin, open Live Sell → **Adjust Branch Counts** and verify the four branch values load. Do not save a calibration unless you intend to change the displayed monthly totals.
4. Open Laptop Finder and verify the price sliders and new filters are available.
5. In Live Sell, enter a customer location in the optional field, verify it appears in the preview, and confirm a real sale only when appropriate. Check the location in Sales Ledger.
6. With multiple sessions open, confirm a sale or calibration refreshes the monthly branch counters across sessions.

## Safety notes

- Do not reset the Durable Object or delete existing database rows.
- Keep the pre-deployment backup until the update has passed login, sales, finder, ledger, account and backup checks.
- If the dashboard Worker name differs from `kg-live-sell-final-cloudflare`, stop and align `wrangler.toml` to the exact existing name before deployment. Never knowingly deploy this update to a new Worker if the intention is to preserve the current database.
- A full production build was not run in the preparation environment because dependency installation did not complete; the release passed local syntax, targeted TypeScript and test checks. Let Cloudflare's build pipeline validate the actual deployment before traffic is switched.
