# Khan Gadget — KG Live Sell (Cloudflare Edition 2.5.0)

Complete browser-deployed Cloudflare Workers release. Read `START-HERE-CLOUDFLARE.md` before deployment.

## Cloudflare architecture

- Cloudflare Workers runs the API.
- A SQLite-backed Durable Object (`KGAppDatabase`) stores application data.
- Worker Static Assets serves the Vite frontend and bundled stock CSV files.
- No D1 database or R2 bucket is required for this release.

## Clean deployment

Use a **new empty private GitHub repository** and a **new Cloudflare Worker named `kg-live-sell-final`**. This avoids stale Bun lockfiles and old patch files left in the previous repository. The package contains no Bun lockfile, no `patches/` directory, and no `patchedDependencies` setting.

Workers Builds must have the Build-only variable `SKIP_DEPENDENCY_INSTALL=1`. The build command explicitly installs dependencies with npm before building. Do not put that variable in Runtime variables.

## Persistent resources

Wrangler creates the SQLite Durable Object namespace from the `v1` migration in `wrangler.toml` on first deployment. Keep the Worker name, `KGAppDatabase` class, and migration identity unchanged after deployment; changing them can create a different data namespace.

## First-run security

No `SUPER_ADMIN_PASSCODE` secret is required for the first-run setup flow. Claim the first Super Admin account immediately after deployment before sharing the site URL.
