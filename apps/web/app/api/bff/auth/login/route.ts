import { getBff } from '../../../../../src/bff/runtime';

export const dynamic = 'force-dynamic';

/** Inicio de login OIDC (Authorization Code + PKCE S256). */
export function GET(req: Request): Promise<Response> {
  return getBff().login(req);
}
