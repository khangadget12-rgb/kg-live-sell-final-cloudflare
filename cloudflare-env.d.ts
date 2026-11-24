declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response>;
  };
}

declare module 'cloudflare:workers' {
  export class DurableObject<Env = Record<string, unknown>> {
    protected ctx: any;
    protected env: Env;
    constructor(ctx: any, env: Env);
  }
}
