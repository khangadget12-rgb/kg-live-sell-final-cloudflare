# KG Live Sell 2.5.1 — Durable Object transaction fix

This is a one-file hotfix for the deployed Cloudflare Worker.

## Why this fixes the 500 error

The log reported:

`getStorage(...).transactionSync is not a function`

Cloudflare's SQLite Durable Object API exposes SQL execution as `ctx.storage.sql.exec(...)`, but exposes `transactionSync(...)` on `ctx.storage`, not on `ctx.storage.sql`.

The previous Worker assigned `ctx.storage.sql` to the compatibility adapter even though that adapter also calls `transactionSync`. This replacement exposes both methods through the expected facade.

## Apply it

1. Open the existing GitHub repository used by the currently failing Worker.
2. Open the root-level file `cloudflare-worker.ts`.
3. Edit it and replace its entire contents with the `cloudflare-worker.ts` file in this ZIP, OR use Add file → Upload files to upload this replacement at the repository root and confirm it replaces the existing file.
4. Commit to the same production branch (normally `main`).
5. Let the existing Cloudflare GitHub build deploy automatically.

## Do not change

- Do not delete or recreate the Worker.
- Do not delete or recreate the Durable Object.
- Do not change `wrangler.toml`, the `APP_DB` binding, the `KGAppDatabase` class name, or the migrations.
- Do not rerun database migrations.
- Do not upload any old `patches/` ZIP or change dependencies for this fix.

## Verify

After a successful deployment, open:

`/api/health`

Then open:

`/api/auth/bootstrap-status`

The health route should return `ok: true` and `db: connected` if the Worker and Durable Object are initialized correctly.
