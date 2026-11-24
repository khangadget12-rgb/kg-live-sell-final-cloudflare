# KG Live Sell Cloudflare 2.5.0 — Clean restart release

## Why this release exists
Earlier Workers Builds repeatedly ran `bun install` and failed while parsing a stale `patches/iconv-lite@0.7.0.patch`. The user’s Cloudflare build logs showed `hunk_header_integrity_check_failed` before the app build started. This release is intended for a new empty GitHub repository and a separate Worker, so the stale Bun lockfile/patch cannot be inherited.

## Build pipeline
- No Bun lockfiles.
- No `patches/` directory.
- No Bun `patchedDependencies` or patch configuration.
- Explicit `packageManager: npm@11.19.1` pin.
- Workers Builds automatic dependency installation is skipped using the Build-only variable `SKIP_DEPENDENCY_INSTALL=1`.
- The Build command explicitly runs `npm install --no-audit --no-fund && npm run build`.
- The build script removes `iconv-lite`'s browser-only alias map before Wrangler bundles the Worker, addressing the logged `require_streams(...) is not a function` runtime crash.

## New Cloudflare resources
- New Worker name: `kg-live-sell-final`.
- Durable Object binding: `APP_DB` → `KGAppDatabase`.
- Migration: `v1` creates a fresh SQLite-backed Durable Object namespace for the new Worker.
- Static assets binding: `ASSETS`.
- No D1 or R2 required.

## Existing app behavior preserved
The React/Vite frontend, Express API, SQLite Durable Object adapter, inventory assets, sales ledger, composer, accounts, usage monitoring, reports, and other original modules are retained. Staff can create sales and read full sales history. Admin and Super Admin manage accounts; only Admin/Super Admin void sales.

## Verification boundary
The package structure, manifests, absence of Bun patch artifacts, dependency preparation script, and TypeScript/TSX syntax are checked locally. This environment cannot authenticate to the user's GitHub/Cloudflare account, and npm dependency installation timed out in this environment. The first clean Workers Build and API smoke test must be completed in the user's account before production use. A successful build is not evidence that the live runtime is healthy until `/api/health` and `/api/auth/bootstrap-status` return the expected JSON.
