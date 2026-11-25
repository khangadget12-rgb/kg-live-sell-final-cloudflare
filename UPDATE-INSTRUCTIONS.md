# KG Live Sell 2.5.2 — GitHub update instructions

This is a targeted source update for an already deployed KG Live Sell Cloudflare Worker. It is not a new Worker and does not require a new Durable Object, new D1 database, or manual SQL execution.

## Included changes

- Adds an optional Customer's Location field to Live Sell Composer. It is blank by default, is included in the generated Live Sell post only when supplied, is saved with the sale, and appears in Sales Ledger details/search.
- Adds **Calibrate Live Sell**, an editable generated-post draft. The calibrated text is copied and stored with the sale. Editing other composer fields resets the calibration to avoid copying stale details.
- Removes internal laptop inspection remarks from Laptop Finder customer-copy/quotation text. Internal remarks remain stored and available inside the app; they are simply not copied into customer-facing quotations.
- Adds a permanent Delete action in Sales Ledger visible only to Super Admin. The API independently requires the `super_admin` role. Deleting a completed sale restores one unit to the original branch if its laptop still exists; deleting an already-voided sale does not restore stock twice. The deletion is written to the audit log.
- Adds database migration v5 for `sales.customer_location`. It runs automatically at Worker startup and preserves existing sales with a blank customer location.

## Upload steps

1. Back up the current app from its Settings/Backup screen before changing code.
2. Extract this ZIP.
3. Open the existing GitHub repository connected to your currently working Cloudflare Worker.
4. Upload the extracted files to the repository root, preserving their folders, and replace matching files.
5. Commit the changes to the same production branch (normally `main`).
6. Wait for Cloudflare Builds to finish successfully.
7. Hard-refresh the app (`Ctrl+F5`) and test the four changes.

## Do not replace or delete

Do not replace `wrangler.toml`, `cloudflare-worker.ts`, `server/cloudflare-sqlite.ts`, the Durable Object binding, or the existing Worker configuration. Do not delete/recreate the Worker or Durable Object. Do not create a new database. Do not manually rerun an old SQL migration.

## Smoke tests after deployment

- Create a test sale with Customer's Location blank and confirm the field remains blank.
- Create another test sale with a location and confirm it appears in the copied post and Sales Ledger details.
- Use Calibrate Live Sell, change a line, Apply Calibration, then create a test sale and confirm the saved/copied post matches the calibrated text.
- Copy a Laptop Finder quotation and verify internal `remarks` text is absent.
- Sign in as a Super Admin and confirm the Delete button appears in Sales Ledger. Sign in as Admin/Staff and confirm it does not appear. The server returns 403 for non-Super-Admin delete attempts.

Permanent deletion cannot be undone. Test with a disposable sale first.
