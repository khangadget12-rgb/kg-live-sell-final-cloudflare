# Install KG Live Sell 2.5.3 update

This is a targeted update for the currently working KG Live Sell Cloudflare repository.

## Upload these files to the repository root, preserving paths

- `package.json`
- `README.md`
- `server.ts`
- `src/services/api.ts`
- `src/components/SalesLedgerView.tsx`
- `src/components/LaptopFinderView.tsx`
- `src/lib/smartSearch.ts`
- `src/lib/domain.test.ts`
- `RELEASE-NOTES-2.5.3.md`

Commit the changes to the same production branch (normally `main`). Cloudflare should automatically build and deploy.

## Do not replace or delete

- `wrangler.toml`
- `cloudflare-worker.ts`
- `server/cloudflare-sqlite.ts`
- `server/db.ts`
- Your Worker, Durable Object, `APP_DB`, `ASSETS`, or existing database
- The existing notification, Google Sheets scanner, and other app files

No SQL migration is needed.

## Verify after deployment

1. Sign in using the Super Admin account.
2. Open Sales Ledger. The Super Admin sees Delete actions on rows and in the sale detail view.
3. Open a sale's Delete confirmation, tick the acknowledgement checkbox, and click Delete Permanently.
4. A successful deletion immediately disappears from the current list and shows a success message. For completed sales the backend restores one unit to the original branch; voided sales do not restore stock a second time.
5. An Admin or Staff account must not be able to use either delete endpoint; the server returns 403.
6. In Laptop Finder, change Sort to Price: Low to High and Price: High to Low. The selected price basis controls sorting. Missing prices stay at the bottom.
7. Open Advanced Filters to use Brand, CPU Generation, Minimum RAM, Maximum Storage, and the existing filters.

If deletion still fails, the modal now displays the server response. Check Cloudflare Worker Observability logs for `Permanent sale deletion failed` and share that specific error message.
