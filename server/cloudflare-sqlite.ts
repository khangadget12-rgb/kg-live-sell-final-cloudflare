/**
 * Synchronous better-sqlite3-compatible facade backed by Cloudflare's
 * SQLite Durable Object storage API. The app uses a single named Durable
 * Object, so its original synchronous database calls remain serialized.
 */
type SqlCursorLike = {
  toArray(): Array<Record<string, unknown>>;
  rowsWritten?: number;
};

type SqlStorageLike = {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
  transactionSync<T>(callback: () => T): T;
};

function normalizeQueryAndBindings(sql: string, args: unknown[]): [string, unknown[]] {
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === 'object' &&
    !Array.isArray(args[0]) &&
    !(args[0] instanceof Date)
  ) {
    const named = args[0] as Record<string, unknown>;
    const bindings: unknown[] = [];
    const rewritten = sql.replace(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key: string) => {
      bindings.push(named[key] ?? null);
      return '?';
    });
    return [rewritten, bindings];
  }

  return [sql, args.map((value) => (value === undefined ? null : value))];
}

export function createCloudflareSqliteCompat(storageSource: SqlStorageLike | (() => SqlStorageLike)) {
  const getStorage = () => typeof storageSource === 'function' ? storageSource() : storageSource;
  let transactionDepth = 0;

  const database = {
    prepare(sql: string) {
      return {
        get(...args: unknown[]) {
          const [query, bindings] = normalizeQueryAndBindings(sql, args);
          return getStorage().exec(query, ...bindings).toArray()[0];
        },
        all(...args: unknown[]) {
          const [query, bindings] = normalizeQueryAndBindings(sql, args);
          return getStorage().exec(query, ...bindings).toArray();
        },
        run(...args: unknown[]) {
          const [query, bindings] = normalizeQueryAndBindings(sql, args);
          const cursor = getStorage().exec(query, ...bindings);
          const last = getStorage().exec('SELECT last_insert_rowid() AS id').toArray()[0];
          return {
            changes: Number(cursor.rowsWritten ?? 0),
            lastInsertRowid: Number(last?.id ?? 0),
          };
        },
      };
    },

    exec(sql: string) {
      getStorage().exec(sql);
      return database;
    },

    pragma(statement: string) {
      // The Durable Object SQLite engine manages its own journaling and
      // transaction policy. Preserve SQLite foreign-key enforcement.
      if (/foreign_keys\s*=\s*ON/i.test(statement)) {
        try {
          getStorage().exec('PRAGMA foreign_keys = ON');
        } catch {
          // Foreign-key enforcement is enabled by the platform when available.
        }
      }
      return undefined;
    },

    transaction<TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) {
      return (...args: TArgs): TResult => {
        // better-sqlite3 allows nested transaction wrappers in this project.
        // Only the outer call opens the Durable Object transaction.
        if (transactionDepth > 0) return callback(...args);

        let result!: TResult;
        getStorage().transactionSync(() => {
          transactionDepth += 1;
          try {
            result = callback(...args);
          } finally {
            transactionDepth -= 1;
          }
        });
        return result;
      };
    },
  };

  return database;
}
