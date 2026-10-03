import { ConfigError, loadConfig } from '@pf/platform/config';

/** Liveness del BFF: no toca dependencias. */
export function liveness(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}

const noStore = { 'Cache-Control': 'no-store' };

/**
 * Readiness del BFF (mismo formato que finance-api): configuración válida y almacén de sesiones
 * (`iam.bff_session`, rol `pf_bff`) accesible. El IdP y finance-api no se chequean: su caída no debe sacar de
 * servicio a la UI (las rutas del BFF responden 503 por su cuenta).
 */
export async function readiness(
  env?: Readonly<Record<string, string | undefined>>,
  pingSessionStore?: () => Promise<void>,
): Promise<Response> {
  try {
    loadConfig('web', env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    return Response.json(
      { status: 'not_ready', checks: { config: 'down' }, failing: ['config'] },
      { status: 503, headers: noStore },
    );
  }
  const ping = pingSessionStore ?? (await import('./bff/runtime')).pingSessionStore;
  try {
    await ping();
  } catch {
    return Response.json(
      { status: 'not_ready', checks: { config: 'up', sessionStore: 'down' }, failing: ['sessionStore'] },
      { status: 503, headers: noStore },
    );
  }
  return Response.json(
    { status: 'ready', checks: { config: 'up', sessionStore: 'up' }, failing: [] },
    { headers: noStore },
  );
}
