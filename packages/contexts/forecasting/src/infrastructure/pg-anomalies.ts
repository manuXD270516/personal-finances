import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';
import {
  SpendingAnomaly,
  type AnomalyReason,
  type DismissReason,
  type SpendingAnomalyStatus,
} from '../domain/index.js';
import type {
  AnomalyMaintenancePort,
  AnomalyRepository,
  AnomalyScanRepository,
  ListAnomaliesFilter,
} from '../application/anomaly-ports.js';
import type { PgForecastingUnitOfWork } from './pg-forecasting.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const db = () => unitOfWorkKysely<Record<string, never>>();
const isoText = (col: string): string =>
  `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

interface AnomalyRow {
  id: string;
  workspace_id: string;
  transaction_id: string;
  transaction_version: number;
  transaction_date: string;
  amount: string;
  currency: string;
  reporting_amount: string;
  reporting_currency: string;
  category_ids: string[];
  counterparty_id: string | null;
  reasons: readonly AnomalyReason[] | string;
  status: SpendingAnomalyStatus;
  dismiss_reason: DismissReason | null;
  dismiss_note: string | null;
  detected_at: string;
  decided_at: string | null;
  decided_by: string | null;
  version: number;
}

const COLUMNS =
  sql.raw(`id::text AS id, workspace_id::text AS workspace_id, transaction_id::text AS transaction_id,
  transaction_version, transaction_date::text AS transaction_date, amount::text AS amount, currency,
  reporting_amount::text AS reporting_amount, reporting_currency,
  ARRAY(SELECT c::text FROM unnest(category_ids) AS c) AS category_ids, counterparty_id::text AS counterparty_id,
  reasons, status, dismiss_reason, dismiss_note, ${isoText('detected_at')} AS detected_at,
  ${isoText('decided_at')} AS decided_at, decided_by::text AS decided_by, version`);

/** Monto a la escala con que se guardó: `numeric` sin tipo conserva los ceros finales al insertar un texto. */
const toAnomaly = (r: AnomalyRow): SpendingAnomaly =>
  SpendingAnomaly.restore({
    id: r.id,
    workspaceId: r.workspace_id,
    transactionId: r.transaction_id,
    transactionVersion: Number(r.transaction_version),
    transactionDate: r.transaction_date,
    amount: { amount: r.amount, currency: r.currency },
    reportingAmount: { amount: r.reporting_amount, currency: r.reporting_currency },
    categoryIds: r.category_ids,
    counterpartyId: r.counterparty_id,
    reasons: typeof r.reasons === 'string' ? (JSON.parse(r.reasons) as AnomalyReason[]) : r.reasons,
    status: r.status,
    dismissReason: r.dismiss_reason,
    dismissNote: r.dismiss_note,
    detectedAt: r.detected_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    version: Number(r.version),
  });

/** Gastos atípicos sobre PostgreSQL: en la unidad de trabajo del llamador (RLS del workspace). */
export class PgAnomalyRepository implements AnomalyRepository {
  async insert(anomaly: SpendingAnomaly): Promise<boolean> {
    const s = anomaly.snapshot;
    const { rows } = await sql<{ id: string }>`
      INSERT INTO forecasting.spending_anomaly
        (id, workspace_id, transaction_id, transaction_version, transaction_date, amount, currency, reporting_amount,
         reporting_currency, category_ids, counterparty_id, reasons, status, detected_at, version)
      VALUES (${s.id}, ${s.workspaceId}, ${s.transactionId}, ${s.transactionVersion}, ${s.transactionDate}::date,
              ${s.amount.amount}::numeric, ${s.amount.currency}, ${s.reportingAmount.amount}::numeric,
              ${s.reportingAmount.currency}, ${[...s.categoryIds]}::uuid[], ${s.counterpartyId}::uuid,
              ${JSON.stringify(s.reasons)}::jsonb, ${s.status}, ${s.detectedAt}::timestamptz, ${s.version})
      ON CONFLICT (workspace_id, transaction_id, transaction_version) DO NOTHING
      RETURNING id`.execute(db());
    return rows.length === 1;
  }

  async findById(workspaceId: string, id: string): Promise<SpendingAnomaly | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await sql<AnomalyRow>`
      SELECT ${COLUMNS} FROM forecasting.spending_anomaly
       WHERE workspace_id = ${workspaceId} AND id = ${id}::uuid AND status <> 'SUPERSEDED'`.execute(db());
    return rows[0] ? toAnomaly(rows[0]) : null;
  }

  async save(anomaly: SpendingAnomaly, expectedVersion: number): Promise<boolean> {
    const s = anomaly.snapshot;
    const { rows } = await sql<{ id: string }>`
      UPDATE forecasting.spending_anomaly
         SET status = ${s.status}, dismiss_reason = ${s.dismissReason}, dismiss_note = ${s.dismissNote},
             decided_at = ${s.decidedAt}::timestamptz, decided_by = ${s.decidedBy}::uuid, version = ${s.version}
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id}::uuid AND version = ${expectedVersion}
         AND status <> 'SUPERSEDED'
      RETURNING id`.execute(db());
    return rows.length === 1;
  }

  async supersedeOlder(workspaceId: string, transactionId: string, currentVersion: number): Promise<number> {
    const { rows } = await sql<{ id: string }>`
      UPDATE forecasting.spending_anomaly SET status = 'SUPERSEDED', version = version + 1
       WHERE workspace_id = ${workspaceId} AND transaction_id = ${transactionId}::uuid
         AND transaction_version < ${currentVersion} AND status <> 'SUPERSEDED'
      RETURNING id`.execute(db());
    return rows.length;
  }

  async list(workspaceId: string, filter: ListAnomaliesFilter): Promise<readonly SpendingAnomaly[]> {
    const status =
      filter.status === 'ALL' ? sql`AND status <> 'SUPERSEDED'` : sql`AND status = ${filter.status}`;
    const from = filter.from ? sql`AND transaction_date >= ${filter.from}::date` : sql``;
    const to = filter.to ? sql`AND transaction_date <= ${filter.to}::date` : sql``;
    const cursor = filter.cursor
      ? sql`AND (transaction_date, id) < (${filter.cursor.date}::date, ${filter.cursor.id}::uuid)`
      : sql``;
    const { rows } = await sql<AnomalyRow>`
      SELECT ${COLUMNS} FROM forecasting.spending_anomaly
       WHERE workspace_id = ${workspaceId} ${status} ${from} ${to} ${cursor}
       ORDER BY transaction_date DESC, id DESC
       LIMIT ${filter.limit + 1}`.execute(db());
    return rows.map(toAnomaly);
  }

  async byTransactionIds(
    workspaceId: string,
    transactionIds: readonly string[],
  ): Promise<readonly SpendingAnomaly[]> {
    if (transactionIds.length === 0) return [];
    const { rows } = await sql<AnomalyRow>`
      SELECT ${COLUMNS} FROM forecasting.spending_anomaly
       WHERE workspace_id = ${workspaceId} AND transaction_id = ANY(${[...transactionIds]}::uuid[])
         AND status <> 'SUPERSEDED'
       ORDER BY transaction_date DESC, id DESC`.execute(db());
    return rows.map(toAnomaly);
  }

  async countByStatus(workspaceId: string, status: SpendingAnomalyStatus): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM forecasting.spending_anomaly
       WHERE workspace_id = ${workspaceId} AND status = ${status}`.execute(db());
    return Number(rows[0]?.n ?? 0);
  }
}

export class PgAnomalyScanRepository implements AnomalyScanRepository {
  async evaluated(workspaceId: string, sinceIso: string): Promise<ReadonlySet<string>> {
    const { rows } = await sql<{ transaction_id: string; transaction_version: number }>`
      SELECT transaction_id::text AS transaction_id, transaction_version
        FROM forecasting.spending_anomaly_scan
       WHERE workspace_id = ${workspaceId} AND evaluated_at >= ${sinceIso}::timestamptz`.execute(db());
    return new Set(rows.map((r) => `${r.transaction_id}:${Number(r.transaction_version)}`));
  }

  async record(
    workspaceId: string,
    rows: readonly { readonly transactionId: string; readonly version: number }[],
    atIso: string,
  ): Promise<void> {
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.transactionId);
    const versions = rows.map((r) => r.version);
    await sql`
      INSERT INTO forecasting.spending_anomaly_scan (workspace_id, transaction_id, transaction_version, evaluated_at)
      SELECT ${workspaceId}::uuid, t.id, t.version, ${atIso}::timestamptz
        FROM unnest(${ids}::uuid[], ${versions}::int[]) AS t(id, version)
      ON CONFLICT (workspace_id, transaction_id, transaction_version) DO NOTHING`.execute(db());
  }
}

/** Barrido de retención como `pf_maintenance` (solo fechas) y borrado en la unidad de trabajo de cada workspace. */
export class PgAnomalyMaintenance implements AnomalyMaintenancePort {
  constructor(private readonly uow: PgForecastingUnitOfWork) {}

  purgeCandidates(input: { readonly transactionBefore: string; readonly scanBeforeIso: string }) {
    return this.uow.runSystem(async () => {
      await sql`SET LOCAL ROLE pf_maintenance`.execute(db());
      const { rows } = await sql<{ workspace_id: string }>`
        SELECT workspace_id::text AS workspace_id FROM forecasting.spending_anomaly
         WHERE transaction_date < ${input.transactionBefore}::date
        UNION
        SELECT workspace_id::text FROM forecasting.spending_anomaly_scan
         WHERE evaluated_at < ${input.scanBeforeIso}::timestamptz`.execute(db());
      return rows.map((r) => r.workspace_id).sort();
    });
  }

  async purge(
    workspaceId: string,
    input: { readonly transactionBefore: string; readonly scanBeforeIso: string },
  ) {
    const anomalies = await sql<{ id: string }>`
      DELETE FROM forecasting.spending_anomaly
       WHERE workspace_id = ${workspaceId} AND transaction_date < ${input.transactionBefore}::date
      RETURNING id`.execute(db());
    const scans = await sql<{ transaction_id: string }>`
      DELETE FROM forecasting.spending_anomaly_scan
       WHERE workspace_id = ${workspaceId} AND evaluated_at < ${input.scanBeforeIso}::timestamptz
      RETURNING transaction_id`.execute(db());
    return { anomalies: anomalies.rows.length, scans: scans.rows.length };
  }
}
