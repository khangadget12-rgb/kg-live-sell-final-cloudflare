# KG Live Sell 2.5.4 — Branch Calibration & Finder Update

## New features

- **Live Sell branch count calibration:** Super Admin and Admin roles can adjust RG, NM, JSM and CC monthly sell counts from the Live Sell page. The server stores a monthly offset instead of editing sale records, applies the adjustment to generated Live Sell posts, and increments the visible count as new completed sales are recorded. Every calibration is written to the audit log.
- **Customer location:** Added an optional, initially empty customer-location field to the Live Sell composer. The value appears in the generated post, is stored with the sale, and is searchable/viewable in the Sales Ledger.
- **Advanced laptop filters:** Added brand, minimum RAM, minimum CPU generation, minimum display size and operating-system filters. Existing filters and natural-language search remain available.
- **Price range sliders:** Added minimum and maximum price sliders tied to the existing exact min/max price fields and selected price basis.
- **Monthly count query optimization:** Monthly branch counts now use bounded month/date queries against the existing branch/date sales index instead of loading every completed sale row.
- **Real-time sales/count sync:** When an administrator calibrates counts, or a sale is recorded, voided or deleted, other active sessions refresh their monthly counters. This uses the existing real-time event stream.

## Data safety

- Database migration 5 adds `sales.customer_location` (only when missing) and the monthly branch calibration table. Existing sale and inventory records are retained.
- Calibration stores an offset against completed monthly sales; it does not rewrite or delete sale history.
- Only `admin` and `super_admin` can call the calibration endpoint.

## Validation

- Changed TypeScript/TSX files passed syntax transpilation.
- Existing domain and sheet-sync test suites passed: 15 tests.
- A full dependency-backed Vite production build and whole-project TypeScript check could not be run in this environment because `npm install` did not complete and the project dependencies were not present.
