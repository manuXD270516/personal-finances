import { unitOfWorkKysely } from '@pf/platform/api';
import { sql, type Kysely } from 'kysely';
import type { RateFeedEpisodeRepository } from '../application/ports/index.js';
import type { OpenFeedEpisode } from '../domain/index.js';

interface EpisodeDb {
  'fx.rate_feed_episode': {
    id: string;
    workspace_id: string;
    base_currency: string;
    quote_currency: string;
    opened_at: string;
    last_rate_as_of: string | null;
    closed_at: string | null;
    recovered_rate_id: string | null;
    closed_reason: string | null;
  };
}

// Reutiliza la transacción de la unidad de trabajo en curso (la del ciclo del worker con `SET LOCAL app.workspace_id`).
const db = (): Kysely<EpisodeDb> => unitOfWorkKysely<EpisodeDb>();
const iso = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Episodios de obsolescencia (`fx.rate_feed_episode`, add-rate-feed-alerts; D233). Abrir es `ON CONFLICT DO NOTHING`
 * sobre el índice único parcial (un solo episodio abierto por par aunque haya dos réplicas del worker); cerrar es un
 * `UPDATE … WHERE closed_at IS NULL`. Ambos devuelven si ESTA llamada hizo el cambio: el hecho solo lo publica quien lo hizo.
 */
export class PgRateFeedEpisodeRepository implements RateFeedEpisodeRepository {
  async listOpen(workspaceId: string): Promise<OpenFeedEpisode[]> {
    const rows = await db()
      .selectFrom('fx.rate_feed_episode')
      .select([
        'id',
        'base_currency',
        'quote_currency',
        iso('opened_at').as('opened_at'),
        iso('last_rate_as_of').as('last_rate_as_of'),
      ])
      .where('workspace_id', '=', workspaceId)
      .where('closed_at', 'is', null)
      .orderBy('opened_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      base: r.base_currency,
      quote: r.quote_currency,
      openedAt: r.opened_at,
      lastRateAsOf: r.last_rate_as_of,
    }));
  }

  async open(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly base: string;
    readonly quote: string;
    readonly openedAt: string;
    readonly lastRateAsOf: string | null;
  }): Promise<boolean> {
    const result = await db()
      .insertInto('fx.rate_feed_episode')
      .values({
        id: input.id,
        workspace_id: input.workspaceId,
        base_currency: input.base,
        quote_currency: input.quote,
        opened_at: input.openedAt,
        last_rate_as_of: input.lastRateAsOf,
        closed_at: null,
        recovered_rate_id: null,
        closed_reason: null,
      })
      // El índice único parcial `rate_feed_episode_open_uk` (un episodio abierto por par).
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0n) === 1;
  }

  async close(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly closedAt: string;
    readonly recoveredRateId: string | null;
    readonly reason: 'RECOVERED' | 'PAIR_REMOVED' | 'COVERAGE_LOST';
  }): Promise<boolean> {
    const result = await db()
      .updateTable('fx.rate_feed_episode')
      .set({
        closed_at: input.closedAt,
        recovered_rate_id: input.recoveredRateId,
        closed_reason: input.reason,
      })
      .where('id', '=', input.id)
      .where('workspace_id', '=', input.workspaceId)
      .where('closed_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }
}
