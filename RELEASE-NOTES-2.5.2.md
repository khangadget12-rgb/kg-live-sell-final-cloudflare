# KG Live Sell 2.5.2 — Live Sell, Ledger and copy update

### Live Sell calibration
Added an editable **Calibrate Live Sell** dialog to adjust the generated customer-facing post before copying and saving it with a sale. Changes to composer fields invalidate the previous calibration so it cannot silently become stale.

### Customer location
Added an optional, blank-by-default Customer's Location field to the Live Sell Composer. It is stored on the sale and appears in the generated post (when supplied), search and transaction details. Existing sales are preserved by automatic schema migration v5.

### Laptop Finder copy
Removed internal laptop remarks from customer-facing quotation/copy output. The internal remarks field itself is not deleted.

### Super Admin-only permanent sales deletion
Added an explicit Delete button to Sales Ledger for Super Admin only. The API independently enforces `requireRole('super_admin')`. A completed sale deletion restores its stock unit to the original branch if the laptop still exists; already-voided sales do not restore twice. The action is audited and requires typing `DELETE` in the UI.

### Database compatibility
Migration v5 adds `sales.customer_location` automatically. No manual SQL migration is required.
