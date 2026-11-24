# KG Live Sell 2.5.0 — Clean Cloudflare Deployment

This is a **complete repository**, not a patch/update. It is designed to avoid the stale Bun patch failure from earlier attempts.

## Before you start

1. Download and extract this ZIP.
2. Do not upload the ZIP itself. Upload the extracted folder contents.
3. Use a **new empty private GitHub repository**. Do not reuse the old repository for this clean deployment; the previous build logs prove it still contained the invalid `patches/iconv-lite@0.7.0.patch` file and/or Bun dependency configuration.
4. Keep the old Cloudflare Worker and its resources until the new site passes the health and login tests. The old Worker is a rollback reference.

## Part A — Create a clean GitHub repository

1. Sign in to GitHub.
2. Create a new **Private** repository named `kg-live-sell-final-cloudflare`.
3. Do not initialize it with a README, license, or `.gitignore`.
4. Open the empty repository and choose **Add file → Upload files**.
5. Upload the **contents** of the extracted ZIP to the repository root, preserving folder structure.
6. Commit all files to the `main` branch.
7. Confirm the root contains `package.json`, `wrangler.toml`, `cloudflare-worker.ts`, `server.ts`, `scripts/`, `server/`, `src/`, and `public/`.
8. Confirm the repository does **not** contain `bun.lock`, `bun.lockb`, `patches/`, `package-lock` from an older package, or `patchedDependencies` in `package.json`.

## Part B — Create a separate clean Worker

Do not delete the existing Worker yet.

1. Open Cloudflare Dashboard → **Workers & Pages**.
2. Choose **Create application → Create Worker**.
3. Name the new Worker exactly `kg-live-sell-final`.
4. Deploy the starter Worker.
5. Open the new Worker → **Settings → Builds** (or **Builds** depending on dashboard layout).
6. Connect GitHub and select `kg-live-sell-final-cloudflare`.
7. Production branch: `main`.
8. Root directory: `/`.

The `name` in this package's `wrangler.toml` is `kg-live-sell-final`. Do not rename it unless you also change the dashboard Worker and commit the matching `wrangler.toml`.

## Part C — Configure Workers Builds (important)

Under the Worker's **Settings → Builds → Build variables and secrets**, add:

- Name: `SKIP_DEPENDENCY_INSTALL`
- Value: `1`
- Type: regular build variable, **not a secret**

This must be a **Build variable**, not a Runtime variable. Do not add this variable under Runtime variables and secrets.

Set these commands:

**Build command**

```bash
npm install --no-audit --no-fund && npm run build
```

**Deploy command**

```bash
npx wrangler deploy
```

Root directory: `/`.

The `SKIP_DEPENDENCY_INSTALL=1` build variable tells Workers Builds to skip its automatic package-manager install. The explicit build command then uses npm. The new repository intentionally has no Bun lockfile or patch file, so the old Bun patch cannot be selected.

## Part D — Verify the build log

The build log should show `npm install`, not `bun install`.

During `npm run build`, look for a message similar to:

```text
[cloudflare-build] Removed iconv-lite browser mapping (0.7.0).
[cloudflare-build] Checked 1 iconv-lite package(s); adjusted 1.
```

Then Vite should build and `npx wrangler deploy` should report the Worker name `kg-live-sell-final` and bindings:

- `env.APP_DB` → Durable Object `KGAppDatabase`
- `env.ASSETS` → Static Assets

If the log still says `bun install`, stop. That means you are not deploying from the new clean repository or `SKIP_DEPENDENCY_INSTALL` was not saved under Build variables.

## Part E — First-run setup and checks

The new Worker URL will be similar to:

`https://kg-live-sell-final.<your-account-subdomain>.workers.dev`

Open these endpoints on that exact URL:

- `/api/health` — expected JSON includes `"ok": true` and `"db": "connected"`.
- `/api/auth/bootstrap-status` — on an empty new Durable Object database, expected `"needsSetup": true` and `"hasEnvOverride": false`.

Then open `/` and immediately create the first Super Admin. Because the optional `SUPER_ADMIN_PASSCODE` secret is not used, anyone who reaches the setup screen before you could claim the first account. Do not share the URL until the first Super Admin is created.

## Database and old resources

- This release uses the `KGAppDatabase` SQLite Durable Object. It does not use D1 or R2.
- The new Worker name creates a **new Durable Object namespace/database** through the `v1` migration. The older Worker and its database are left untouched.
- The older D1 database from the earlier 2.3.x release is not used by this 2.5.0 application. Keep it as a separate archive until you're certain you no longer need it.
- Do not change `name`, the Durable Object class name `KGAppDatabase`, or the migration tag `v1` after deploying; these identify the new app's persistent database.
- Do not delete the old Worker until the new app passes login, sales, inventory, ledger, account-management, activity, and backup/restore tests.

## Included app behavior

- Staff, Admin, and Super Admin can use Live Sell Composer and create sale entries.
- Staff can view the complete Sales Ledger and branch sales; staff are not tied to one branch and choose a branch per sale.
- Admin and Super Admin can create and delete accounts, including Super Admin accounts, subject to last-active-Super-Admin protection.
- Only Admin and Super Admin can void sales.
- Lightweight five-second sync-version polling is included.
- Admin and Super Admin can view user session and active-time reports.
- Existing inventory, Laptop Finder, Accessories, refill reminders, reports, SpecLedger, and Google Sheets functionality remain in the source project.

## Recovery

If the new build fails, keep the old Worker. Send the complete build log. Do not delete Durable Objects or migrations to troubleshoot a build failure.
