# KG Live Sell 2.5.1

Fixed the SQLite Durable Object storage facade. SQL `.exec()` is delegated to `ctx.storage.sql`, while `.transactionSync()` is delegated to `ctx.storage`.

No schema migration, data reset, binding change, or dependency patch is required.
