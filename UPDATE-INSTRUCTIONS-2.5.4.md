# Update Instructions — KG Live Sell 2.5.4

1. Download and extract the 2.5.4 ZIP.
2. Confirm the existing Worker name in Cloudflare Dashboard. The logs supplied for this project identify `kg-live-sell-final-cloudflare`; `wrangler.toml` is aligned to that name. If the dashboard shows another name, stop and set `wrangler.toml` to the exact existing name before deploying. Commit the complete project contents to the same GitHub repository/production branch used by the current Cloudflare deployment. Do not copy only edited component files: this release includes the matching server route, API types, database migration and client changes.
3. Keep the existing Cloudflare Worker name, Durable Object binding, environment variables/secrets, and database namespace unchanged. Do not delete or recreate the Durable Object.
4. Let the existing Cloudflare Workers Builds pipeline build and deploy the project using its current build configuration. Do not create a second Worker or a new Durable Object namespace.
5. On first startup after this update, the app automatically applies database migration 5. It adds the customer-location column only if needed and creates the branch-calibration table. It does not wipe inventory or sales.
6. Sign in as an Admin or Super Admin, open Live Sell, expand **Adjust Branch Counts**, enter the four branch totals, and save. Staff accounts cannot calibrate counts.
7. Verify a Live Sell draft with a customer location, then confirm the saved customer location is searchable and visible in the Sales Ledger. Record a test sale only if appropriate, and confirm the branch counts increment across active sessions.

## Safety notes

- Do not reset the Durable Object or delete existing database rows.
- Keep a Cloudflare backup before deployment, using the existing backup feature.
- If the Cloudflare build reports an error, do not publish a partially built Worker; retain the currently deployed version and review the build output first.
