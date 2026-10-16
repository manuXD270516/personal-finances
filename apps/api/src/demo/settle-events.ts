import type { Logger } from '@pf/platform/logging';
import type { Pool } from 'pg';

/**
 * Espera a que los consumidores asíncronos del outbox terminen con los hechos del workspace de demostración (openspec
 * add-phase-4-demo-data): la carga confirma todo en una sola unidad de trabajo y el relay publica miles de hechos de
 * golpe (cargos de suscripciones, aportes de metas, periodos, notificaciones…). Marcar `READY` antes de que converjan
 * mostraría una demo incompleta y, sobre todo, una limpieza inmediata competiría con consumidores en vuelo (filas
 * sueltas después de la purga). Quieto = ningún hecho sin publicar del workspace y ningún trabajo de consumidor
 * pendiente o en curso que lo mencione, en dos lecturas seguidas (los consumidores pueden publicar hechos nuevos).
 * Devuelve `false` si se agotó el tiempo (la carga sigue: `READY` no depende de la convergencia).
 */
export async function settleWorkspaceEvents(
  pool: Pool,
  workspaceId: string,
  logger: Pick<Logger, 'warn'>,
  options: { readonly timeoutMs?: number; readonly pollMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? 240_000);
  const pollMs = options.pollMs ?? 500;
  let quiet = 0;
  for (;;) {
    const { rows } = await pool.query<{ pending: number }>(
      `SELECT (SELECT count(*) FROM platform.outbox WHERE workspace_id = $1::uuid AND published_at IS NULL)::int
            + (SELECT count(*) FROM pgboss.job
                WHERE state IN ('created', 'retry', 'active')
                  AND data -> 'payload' ->> 'workspaceId' = $1::text)::int AS pending`,
      [workspaceId],
    );
    quiet = rows[0]?.pending === 0 ? quiet + 1 : 0;
    if (quiet >= 2) return true;
    if (Date.now() > deadline) {
      logger.warn(
        { 'demo.workspace_id': workspaceId },
        'demo load: the event consumers did not settle in time',
      );
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
