# Update Instructions — KG Live Sell 2.5.5

1. Back up the existing application database before deployment.
2. Verify the existing Worker name in Cloudflare. Keep the same repository, production branch, Worker name, `APP_DB` binding, `KGAppDatabase` class and migration identity `v1`.
3. Commit and push the complete 2.5.5 project, not selected files.
4. Allow Cloudflare Workers Builds to run the configured production build. Do not publish a failed/partial build.
5. Visit `/api/health`; confirm version `2.5.5` and both calibration and Admin sales deletion feature flags are `true`.
6. Test calibration using an Admin or Super Admin account. Change the four branch totals for the selected sale month and save. Reload the page and verify the values persist.
7. Test a ledger delete using a suitable test sale. Admin and Super Admin see the button; Staff do not. Deleting a completed sale restores stock, and the action appears in Audit Logs.

No database reset is required. Migration 6 safely ensures the calibration table and customer-location column exist without deleting rows.
