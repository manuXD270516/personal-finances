import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';
import type {
  ShortfallEpisode,
  ShortfallEpisodeRepository,
  SpendableSettingsRow,
} from '../application/ports/index.js';
import type { SpendableSettingsRepository } from '../application/spendable-settings.use-cases.js';
import type { SpendableSettingsValue } from '../domain/index.js';

/**
 * `reporting.spendable_setting` y `reporting.spendable_essential_category` (RLS forzada por workspace). Sin fila = valores
 * por omisión en versión 1; la primera escritura inserta la versión 2. Las consultas son secuenciales sobre el cliente de la
 * unidad de trabajo (nunca en paralelo).
 */
export class PgSpendableSettingsRepository implements SpendableSettingsRepository {
  async read(workspaceId: string): Promise<SpendableSettingsRow | null> {
    const { rows } = await sql<{
      horizon_mode: SpendableSettingsRow['horizonMode'];
      subtract_essentials: boolean;
      version: number;
    }>`
      SELECT horizon_mode, subtract_essentials, version
        FROM reporting.spendable_setting WHERE workspace_id = ${workspaceId}`.execute(unitOfWorkKysely());
    const row = rows[0];
    if (!row) return null;
    const categories = await sql<{ category_id: string }>`
      SELECT category_id::text AS category_id FROM reporting.spendable_essential_category
       WHERE workspace_id = ${workspaceId} ORDER BY category_id`.execute(unitOfWorkKysely());
    return {
      horizonMode: row.horizon_mode,
      subtractEssentials: row.subtract_essentials,
      essentialCategoryIds: categories.rows.map((c) => c.category_id),
      version: Number(row.version),
    };
  }

  async write(
    workspaceId: string,
    value: SpendableSettingsValue,
    expectedVersion: number,
  ): Promise<SpendableSettingsRow | null> {
    const k = unitOfWorkKysely();
    let version: number;
    if (expectedVersion === 1) {
      // Sin fila (versión 1): la inserta con la versión 2; una escritura concurrente ya la creó ⇒ precondición vencida.
      const inserted = await sql<{ version: number }>`
        INSERT INTO reporting.spendable_setting (workspace_id, horizon_mode, subtract_essentials, version, updated_at)
        VALUES (${workspaceId}, ${value.horizonMode}, ${value.subtractEssentials}, 2, now())
        ON CONFLICT (workspace_id) DO NOTHING
        RETURNING version`.execute(k);
      if (inserted.rows[0]) {
        version = Number(inserted.rows[0].version);
      } else {
        // Con una fila existente en versión 1 no puede haber sido editada nunca: la versión 1 solo existe sin fila.
        return null;
      }
    } else {
      const updated = await sql<{ version: number }>`
        UPDATE reporting.spendable_setting
           SET horizon_mode = ${value.horizonMode}, subtract_essentials = ${value.subtractEssentials},
               version = version + 1, updated_at = now()
         WHERE workspace_id = ${workspaceId} AND version = ${expectedVersion}
        RETURNING version`.execute(k);
      if (!updated.rows[0]) return null;
      version = Number(updated.rows[0].version);
    }
    await sql`DELETE FROM reporting.spendable_essential_category WHERE workspace_id = ${workspaceId}`.execute(
      k,
    );
    for (const categoryId of [...value.essentialCategoryIds].sort()) {
      await sql`
        INSERT INTO reporting.spendable_essential_category (workspace_id, category_id)
        VALUES (${workspaceId}, ${categoryId}::uuid)`.execute(k);
    }
    return {
      horizonMode: value.horizonMode,
      subtractEssentials: value.subtractEssentials,
      essentialCategoryIds: [...value.essentialCategoryIds].sort(),
      version,
    };
  }
}

interface EpisodeRow {
  id: string;
  workspace_id: string;
  currency: string;
  opened_at: string;
  closed_at: string | null;
  first_shortfall_date: string;
  lowest_amount: string;
  lowest_date: string;
  threshold_amount: string;
  below_zero: boolean;
  last_evaluated_at: string;
  last_lowest_amount: string;
}

const iso = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * `reporting.cash_flow_shortfall_episode`: lo escribe SOLO el job del worker (`pf_worker`), por workspace y en su unidad de
 * trabajo. El índice único parcial `(workspace_id, currency) WHERE closed_at IS NULL` garantiza un único episodio abierto
 * por moneda aunque dos réplicas evalúen a la vez: la perdedora recibe `false` y no publica.
 */
export class PgShortfallEpisodeRepository implements ShortfallEpisodeRepository {
  async listOpen(workspaceId: string): Promise<readonly ShortfallEpisode[]> {
    const { rows } = await sql<EpisodeRow>`
      SELECT id::text AS id, workspace_id::text AS workspace_id, currency,
             ${iso('opened_at')} AS opened_at, ${iso('closed_at')} AS closed_at,
             first_shortfall_date::text AS first_shortfall_date, lowest_amount::text AS lowest_amount,
             lowest_date::text AS lowest_date, threshold_amount::text AS threshold_amount, below_zero,
             ${iso('last_evaluated_at')} AS last_evaluated_at, last_lowest_amount::text AS last_lowest_amount
        FROM reporting.cash_flow_shortfall_episode
       WHERE workspace_id = ${workspaceId} AND closed_at IS NULL
       ORDER BY currency`.execute(unitOfWorkKysely());
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      currency: r.currency,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      firstShortfallDate: r.first_shortfall_date,
      lowestAmount: r.lowest_amount,
      lowestDate: r.lowest_date,
      thresholdAmount: r.threshold_amount,
      belowZero: r.below_zero,
      lastEvaluatedAt: r.last_evaluated_at,
      lastLowestAmount: r.last_lowest_amount,
    }));
  }

  async open(e: ShortfallEpisode): Promise<boolean> {
    const { rows } = await sql<{ id: string }>`
      INSERT INTO reporting.cash_flow_shortfall_episode
        (id, workspace_id, currency, opened_at, first_shortfall_date, lowest_amount, lowest_date, threshold_amount,
         below_zero, last_evaluated_at, last_lowest_amount)
      VALUES (${e.id}::uuid, ${e.workspaceId}::uuid, ${e.currency}, ${e.openedAt}::timestamptz,
              ${e.firstShortfallDate}::date, ${e.lowestAmount}::numeric, ${e.lowestDate}::date,
              ${e.thresholdAmount}::numeric, ${e.belowZero}, ${e.lastEvaluatedAt}::timestamptz,
              ${e.lastLowestAmount}::numeric)
      ON CONFLICT (workspace_id, currency) WHERE closed_at IS NULL DO NOTHING
      RETURNING id::text AS id`.execute(unitOfWorkKysely());
    return rows.length > 0;
  }

  async touch(
    id: string,
    input: { readonly evaluatedAt: string; readonly lowestAmount: string },
  ): Promise<void> {
    await sql`
      UPDATE reporting.cash_flow_shortfall_episode
         SET last_evaluated_at = ${input.evaluatedAt}::timestamptz, last_lowest_amount = ${input.lowestAmount}::numeric
       WHERE id = ${id}::uuid AND closed_at IS NULL`.execute(unitOfWorkKysely());
  }

  async close(id: string, closedAt: string): Promise<boolean> {
    const { rows } = await sql<{ id: string }>`
      UPDATE reporting.cash_flow_shortfall_episode SET closed_at = ${closedAt}::timestamptz
       WHERE id = ${id}::uuid AND closed_at IS NULL
      RETURNING id::text AS id`.execute(unitOfWorkKysely());
    return rows.length > 0;
  }

  async purgeClosedBefore(cutoff: string): Promise<number> {
    const { rows } = await sql<{ id: string }>`
      DELETE FROM reporting.cash_flow_shortfall_episode
       WHERE closed_at IS NOT NULL AND closed_at < ${cutoff}::timestamptz
      RETURNING id::text AS id`.execute(unitOfWorkKysely());
    return rows.length;
  }
}
