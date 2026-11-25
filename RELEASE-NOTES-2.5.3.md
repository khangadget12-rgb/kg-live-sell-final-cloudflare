# KG Live Sell — Update 2.5.3

## Sales Ledger deletion reliability

- Keeps permanent sale deletion exclusive to `super_admin` on the server.
- Adds a same-origin `POST /api/sales/:id/delete` endpoint alias while retaining the existing `DELETE /api/sales/:id` endpoint.
- The client uses the POST alias to avoid method-handling issues in browser/proxy layers.
- Adds the delete action to the sale detail panel as well as the ledger row actions.
- Replaces the fragile typed-word confirmation with an explicit acknowledgement checkbox.
- Removes a successfully deleted sale from the visible list immediately.
- Separates a successful delete from a later ledger refresh failure, so refresh errors are no longer reported as delete failures.
- Shows the server result and any actual delete error clearly.
- Logs server-side deletion errors for Cloudflare Observability.
- Restores one stock unit for completed sales only; voided sales are not restocked a second time.

## Laptop Finder improvements

- Adds numeric price sorting: low-to-high and high-to-low.
- Adds sorting by total stock, RAM, storage, brand A–Z, and newest entry.
- Sorts using the selected price basis (discounted, asking, or border price).
- Keeps missing/zero prices at the bottom in both price directions.
- Adds dynamic brand and CPU-generation filters based on the loaded dataset.
- Adds minimum-RAM and maximum-storage filters while retaining exact RAM and minimum-storage filters.
- Sorted order is also used by filtered selection and list-copy operations.

## Deployment and data

- No SQL migration is required.
- No Durable Object or D1 changes are required.
- No Wrangler configuration or Cloudflare bindings need to be replaced.
- Existing sales, users, inventory, notification, and scanner data are preserved.
