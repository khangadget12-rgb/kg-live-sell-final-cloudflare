# Reliability update – browser alerts and Rajshahi sheet monitoring

- Fixed Alerts On/Off wiring from the app shell to the authenticated user's notification preference.
- Improved service worker readiness handling and mobile persistent notification delivery.
- Added silent audio unlock on first signed-in user gesture; retained Test Sound.
- Added immediate notification inbox checks after live SSE inventory/sales events and a 15-second recovery poll.
- Fixed published Google Sheets `/d/e/<id>/pubhtml` URL conversion.
- Broadened recognition of common branch stock column headings.
- Made Durable Object alarm scheduling awaited and rescheduled after scans, with a retry path.
- Added branch-wise stock totals to scanner status.
- No database migration and no Wrangler binding changes.
