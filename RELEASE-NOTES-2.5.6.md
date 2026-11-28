# KG Live Sell 2.5.6 — Monthly Calibration Reliability Update

## Branch Sell Count Calibration
- Consolidates the four monthly branch-count queries into one indexed aggregate query.
- Makes `lastInsertRowid` lookup lazy in the Durable Object SQLite adapter, avoiding an unnecessary SQL row read after writes that do not need a generated ID.
- Adds migration 7 index `idx_sales_status_date_branch` for the aggregate query.
- Writes all four branch offsets in one atomic multi-row `INSERT OR REPLACE` statement.
- Avoids re-reading the sales ledger after a successful calibration write; returns the values just saved.
- Keeps existing completed-sale records unchanged. New completed sales continue to increase the adjusted monthly count.
- Returns a structured error code and database detail when a save fails, instead of hiding the underlying cause behind a generic message.
- Tries the three documented calibration route aliases only when the preceding route returns 404.

## Preserved features
- Admin and Super Admin calibration permissions.
- Monthly baseline/offset model keyed by sale month and time zone.
- Real-time branch counter refresh.
- Admin and Super Admin one-click Sales Ledger deletion from 2.5.5.
- Existing database, Durable Object binding, and historical sales records.

## Verification
- Changed TypeScript/TSX files passed TypeScript transpilation/syntax checks.
- SQLite simulation passed for monthly baseline persistence, replacing prior calibration, voided-sale exclusion, and incrementing after a new completed sale.
- The full project test suite and Vite production build were not run because project dependencies are not installed in this environment and registry access was unavailable.
