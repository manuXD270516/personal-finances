import { getBff } from '../../../../../src/bff/runtime';

export const dynamic = 'force-dynamic';

/** Logout: revocación del refresh token, borrado de la sesión y URL de RP-initiated logout. */
export function POST(req: Request): Promise<Response> {
  return getBff().logout(req);
}
