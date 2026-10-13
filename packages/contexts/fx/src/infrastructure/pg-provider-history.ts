import type { Pool } from 'pg';
import type { HistoryClose, ProviderHistoryCache } from '../application/ports/index.js';
import type { FxRateProvider } from '../domain/index.js';

interface CloseRow {
  provider: FxRateProvider;
  base_currency: string;
  quote_currency: string;
  history_day: string;
  close_value: string;
  close_at: string;
  fetched_at: string;
  raw_payload: string;
}

const ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const CHUNK = 200;

/**
 * Caché `fx.provider_history_point` de los cierres diarios cripto (tabla de INSTALACIÓN sin `workspace_id` ni datos de
 * usuario, como `fx.provider_run`; add-crypto-rate-providers decisión 6). Va por el pool, fuera de la transacción por
 * workspace. Solo `pf_worker` lee e inserta. El cierre se lee con `trim_scale`: el decimal exacto, sin ceros de
 * relleno (nunca por punto flotante).
 */
export class PgProviderHistoryCache implements ProviderHistoryCache {
  constructor(private readonly pool: Pool) {}

  async insertCloses(closes: readonly HistoryClose[]): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < closes.length; i += CHUNK) {
      const chunk = closes.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((c, k) => {
        const o = k * 8;
        values.push(c.provider, c.base, c.quote, c.day, c.close, c.closeAt, c.fetchedAt, c.rawPayload);
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}::date, $${o + 5}::numeric, $${o + 6}::timestamptz, $${o + 7}::timestamptz, $${o + 8})`;
      });
      if (tuples.length === 0) continue;
      const { rowCount } = await this.pool.query(
        `INSERT INTO fx.provider_history_point
           (provider, base_currency, quote_currency, history_day, close_value, close_at, fetched_at, raw_payload)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (provider, base_currency, quote_currency, history_day) DO NOTHING`,
        values,
      );
      inserted += rowCount ?? 0;
    }
    return inserted;
  }

  async lastDay(provider: FxRateProvider, base: string, quote: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ day: string | null }>(
      `SELECT max(history_day)::text AS day FROM fx.provider_history_point
        WHERE provider = $1 AND base_currency = $2 AND quote_currency = $3`,
      [provider, base, quote],
    );
    return rows[0]?.day ?? null;
  }

  async summary(
    provider: FxRateProvider,
  ): Promise<{ readonly points: number; readonly from: string | null; readonly to: string | null }> {
    const { rows } = await this.pool.query<{
      points: string;
      from_day: string | null;
      to_day: string | null;
    }>(
      `SELECT count(DISTINCT history_day)::text AS points, min(history_day)::text AS from_day,
              max(history_day)::text AS to_day
         FROM fx.provider_history_point WHERE provider = $1`,
      [provider],
    );
    const row = rows[0];
    return { points: Number(row?.points ?? 0), from: row?.from_day ?? null, to: row?.to_day ?? null };
  }

  async closes(
    provider: FxRateProvider,
    filter: {
      readonly bases: readonly string[];
      readonly quote: string;
      readonly from: string;
      readonly to: string;
    },
  ): Promise<HistoryClose[]> {
    if (filter.bases.length === 0) return [];
    const { rows } = await this.pool.query<CloseRow>(
      `SELECT provider, base_currency, quote_currency, history_day::text AS history_day,
              trim_scale(close_value)::text AS close_value, ${ISO('close_at')} AS close_at,
              ${ISO('fetched_at')} AS fetched_at, raw_payload
         FROM fx.provider_history_point
        WHERE provider = $1 AND base_currency = ANY ($2::text[]) AND quote_currency = $3
          AND history_day >= $4::date AND history_day <= $5::date
        ORDER BY history_day`,
      [provider, [...filter.bases], filter.quote, filter.from, filter.to],
    );
    return rows.map((r) => ({
      provider: r.provider,
      base: r.base_currency,
      quote: r.quote_currency,
      day: r.history_day,
      close: r.close_value,
      closeAt: r.close_at,
      fetchedAt: r.fetched_at,
      rawPayload: r.raw_payload,
    }));
  }
}
