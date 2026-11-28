# Khan Gadget — KG Live Sell (Cloudflare Edition 2.5.5)

Complete browser-deployed Cloudflare Workers release. Read `START-HERE-2.5.5.md` before deployment.

## Cloudflare architecture

- Cloudflare Workers runs the API.
- A SQLite-backed Durable Object (`KGAppDatabase`) stores application data.
- Worker Static Assets serves the Vite frontend and bundled stock CSV files.
- No D1 database or R2 bucket is required for this release.

## Update the existing production deployment

The Cloudflare logs supplied with this project identify the running Worker as `kg-live-sell-final-cloudflare`. The `name` in `wrangler.toml` is aligned to that service so this release targets the existing Worker rather than creating a second Worker/database.

- Update the same GitHub repository and production branch already connected to Cloudflare Workers Builds.
- Keep the current Worker, Durable Object namespace/binding (`APP_DB` → `KGAppDatabase`), migration identity (`v1`), environment variables and secrets.
- Do not create a replacement Worker, delete/recreate the Durable Object, or reset the database.
- Back up the application database before deployment and let migrations 5–6 apply automatically on startup.
- Preserve the existing Cloudflare build settings; deploy the complete repository, not a partial set of changed files.

If the Worker shown in the Cloudflare dashboard is not `kg-live-sell-final-cloudflare`, stop before deployment and update `wrangler.toml` to the exact existing Worker name. Do not deploy under a different name as a way to update the current database.

## Persistent resources

This app uses a SQLite-backed Durable Object (`KGAppDatabase`). Keep the existing Worker name, `APP_DB` binding, class name and migration identity unchanged after deployment; changing them can point the app at a different persistent namespace.

## Existing account security

This update is intended for an already-populated application. Sign in with the existing accounts after deployment; do not run first-run bootstrap setup or create a new Durable Object namespace for this update. The first-run Super Admin claim flow applies only to a genuinely empty, separately provisioned database.
