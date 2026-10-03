import { getBff } from '../../../../../src/bff/runtime';

export const dynamic = 'force-dynamic';

/** Callback OIDC: canje del código, provisión JIT y creación de la sesión server-side. */
export function GET(req: Request): Promise<Response> {
  return getBff().callback(req);
}
