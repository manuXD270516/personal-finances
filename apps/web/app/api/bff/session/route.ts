import { getBff } from '../../../../src/bff/runtime';

export const dynamic = 'force-dynamic';

/** Estado de la sesión para el navegador (token CSRF, workspace activo); nunca tokens OAuth. */
export function GET(req: Request): Promise<Response> {
  return getBff().session(req);
}

/** Cambia el workspace activo de la sesión. */
export function PUT(req: Request): Promise<Response> {
  return getBff().updateSession(req);
}
