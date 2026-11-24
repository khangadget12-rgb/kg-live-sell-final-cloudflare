import { DurableObject } from 'cloudflare:workers';

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}
interface Env {
  APP_DB: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
  ASSETS: AssetFetcher;
  SUPER_ADMIN_PASSCODE?: string;
}

const BUILTIN_INVENTORY_FILES = [
  'KG_Stock__Rajshahi_dcce8414',
  'Bogura_5732320b',
  'Rangpur_082285aa',
  'Multiplan_ed47830a',
  'Basundhara_City_890cbcc9',
  'Mymensingh_dca747a2',
  'Sylhet_51adc23d',
];

type ApiHandler = {
  fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response>;
};

export class KGAppDatabase extends DurableObject<Env> {
  private initialization?: Promise<void>;
  private apiHandler?: ApiHandler;
  private serverModule?: {
    startServer(options: { cloudflare: boolean }): Promise<ApiHandler>;
    runScheduledRajshahiSync(): Promise<void>;
  };

  private async initialize(): Promise<void> {
    const globalRuntime = globalThis as typeof globalThis & Record<string, any>;

    // Load packaged inventory CSVs through the static Assets binding. Workers'
    // virtual filesystem is intentionally not used for persistent data.
    const builtinAssets: Record<string, string> = {};
    for (const fileName of BUILTIN_INVENTORY_FILES) {
      const assetUrl = new URL(`/assets/aistudio/${fileName}`, 'https://kg-assets.internal');
      const response = await this.env.ASSETS.fetch(new Request(assetUrl));
      if (response.ok) {
        builtinAssets[fileName] = await response.text();
      }
    }

    // Cloudflare exposes SQL statements on ctx.storage.sql, but the
    // synchronous transaction API belongs to ctx.storage itself.
    // Do not pass ctx.storage.sql directly: SqlStorage has exec(), but no
    // transactionSync(), which caused login/session requests to throw 500.
    const durableStorage = this.ctx.storage;
    const sqlStorage = durableStorage.sql;
    globalRuntime.__KG_SQL_STORAGE__ = {
      exec: (query: string, ...bindings: any[]) => sqlStorage.exec(query, ...bindings),
      transactionSync: <T>(callback: () => T): T => durableStorage.transactionSync(callback),
    };
    globalRuntime.__KG_BUILTIN_ASSETS__ = builtinAssets;
    globalRuntime.__KG_SCHEDULE_ALARM__ = (delayMs: number) =>
      this.ctx.storage.setAlarm(Date.now() + Math.max(15_000, delayMs));
    globalRuntime.__KG_DELETE_ALARM__ = () => this.ctx.storage.deleteAlarm();

    // Optional bootstrap secret. When configured, first-run setup is locked
    // and the owner signs in as `superadmin` using this passcode.
    globalRuntime.__KG_SUPER_ADMIN_PASSCODE__ = this.env.SUPER_ADMIN_PASSCODE || '';

    // Keep the Express HTTP bridge singleton per Worker isolate. Durable
    // Object instances can be re-created while an isolate remains warm; a
    // second app.listen() on the same routing port would otherwise collide.
    let handlerPromise = globalRuntime.__KG_API_HANDLER_PROMISE__ as Promise<ApiHandler> | undefined;
    if (!handlerPromise) {
      handlerPromise = (async () => {
        const serverModule = await import('./server.ts');
        globalRuntime.__KG_SERVER_MODULE__ = serverModule;
        return serverModule.startServer({ cloudflare: true });
      })();
      globalRuntime.__KG_API_HANDLER_PROMISE__ = handlerPromise;
    }

    try {
      this.apiHandler = await handlerPromise;
      this.serverModule = globalRuntime.__KG_SERVER_MODULE__;
    } catch (error) {
      delete globalRuntime.__KG_API_HANDLER_PROMISE__;
      delete globalRuntime.__KG_SERVER_MODULE__;
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initialize().catch((error) => {
        // Permit a later request to retry after a transient initialization error.
        this.initialization = undefined;
        throw error;
      });
    }
    await this.initialization;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();
    if (!this.apiHandler) {
      return new Response('KG Live Sell API did not initialize.', { status: 503 });
    }
    return this.apiHandler.fetch(request, this.env, this.ctx);
  }

  async alarm(): Promise<void> {
    try {
      await this.ensureInitialized();
      await this.serverModule?.runScheduledRajshahiSync();
    } catch (error) {
      console.error('Rajshahi scheduled scan alarm failed:', error);
      // Cloudflare removes the current alarm before invoking alarm(). Keep a
      // retry scheduled even if initialization or an unexpected DB error fails.
      try {
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
      } catch (rescheduleError) {
        console.error('Could not schedule Rajshahi alarm retry:', rescheduleError);
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const id = env.APP_DB.idFromName('kg-live-sell-main');
      return env.APP_DB.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
