import { ConfigError, loadConfig } from '@pf/platform/config';

/** Liveness del BFF: no toca dependencias. */
export function liveness(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Readiness del BFF. Hoy su única condición es una configuración válida; las dependencias (finance-api,
 * IdP, session store) se agregan cuando el BFF las use (ADR-0019). Mismo formato que finance-api.
 */
export function readiness(env?: Readonly<Record<string, string | undefined>>): Response {
  try {
    loadConfig('web', env);
    return Response.json(
      { status: 'ready', checks: {}, failing: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    return Response.json(
      { status: 'not_ready', checks: { config: 'down' }, failing: ['config'] },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
