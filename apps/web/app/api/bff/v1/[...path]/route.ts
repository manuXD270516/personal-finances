import { getBff } from '../../../../../src/bff/runtime';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

/** Proxy autenticado `/api/bff/v1/*` → finance-api `/api/v1/*` (Bearer server-side, CSRF en mutaciones). */
async function handle(req: Request, ctx: Context): Promise<Response> {
  const { path } = await ctx.params;
  return getBff().proxy(req, path);
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
