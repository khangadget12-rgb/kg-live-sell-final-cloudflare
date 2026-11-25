# KG Live Sell login HTTP 500 repair

This repair is based on the supplied 2.5.3 source package.

## Changes

- `server/db.ts`: verifies the authentication session tables and session-log index idempotently after migrations. This repairs a partially/mis-recorded prior schema update without dropping or rewriting users, password hashes, sessions, inventory, or sales.
- `server.ts`: adds a final JSON error handler and writes method, path, message, and stack to Worker Observability. This replaces Express's generic HTML 500 response with a useful safe client message while keeping sensitive stack details server-side.
- `src/services/api.ts`: reads API response bodies once and preserves useful plain-text/proxy errors instead of always displaying only `Request failed (500)`.

## Critical deployment safety

1. Deploy this package to the **same Cloudflare Worker and same Durable Object namespace/binding** used by the existing live application.
2. Keep `wrangler.toml`'s existing `APP_DB` binding, `KGAppDatabase` class, migration history, and Durable Object name `kg-live-sell-main` unchanged.
3. Do not delete/recreate the Durable Object namespace, change its binding name, run a reset, or create a new production database. Those actions can make the old live data inaccessible.
4. Do not run first-run setup if an owner account already exists. Sign in with the existing account.
5. After deploy, open `/api/health`. It should return JSON with `ok: true`. Then try login.
6. If login still fails, open Cloudflare Workers & Pages → your Worker → Observability → Logs, find `KG Live Sell API request failed`, and use its message/stack to identify the remaining cause. The stack is intentionally not exposed to public browsers.

## Important limitation

The source package cannot inspect or recover data from a physical device or a Cloudflare Durable Object that has already been deleted/replaced. This patch does not reset the database. If the old Durable Object still exists under the same namespace and ID, its stored data should remain available to the deployed Worker.
