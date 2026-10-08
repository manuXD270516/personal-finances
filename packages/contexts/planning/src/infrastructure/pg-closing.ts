import { createHash } from 'node:crypto';
import { unitOfWorkKysely } from '@pf/platform/api';
import { sql, type Kysely } from 'kysely';
import type {
  ClosePendingNoticeRepository,
  ClosingPolicyRepository,
  CloseSnapshotRepository,
  PeriodReopeningRepository,
  PeriodReopeningRow,
  SnapshotHeader,
  StoredSnapshot,
} from '../application/ports/index.js';
import {
  canonicalJson,
  ClosingPolicy,
  type CloseSnapshotContent,
  type MoneyValue,
  type PolicySeverities,
  type PolicySeverity,
  type SnapshotBalance,
  type SnapshotWithoutStatementRow,
} from '../domain/index.js';

const db = (): Kysely<unknown> => unitOfWorkKysely<unknown>();

const instantText = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** SHA-256 hexadecimal del contenido canónico (`content_sha256`, design.md decisión 9). */
export const sha256Hex = (canonical: string): string => createHash('sha256').update(canonical).digest('hex');

const scaleOf = (amount: string): number => amount.split('.')[1]?.length ?? 0;
const jsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

// ───────────────────────────────────────────────────────────────────────── política

interface PolicyRow {
  workspace_id: string;
  pending_transactions: PolicySeverity;
  unreconciled_accounts: PolicySeverity;
  unresolved_duplicates: PolicySeverity;
  uncategorized: PolicySeverity;
  unresolved_recurring: PolicySeverity;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export class PgClosingPolicyRepository implements ClosingPolicyRepository {
  async find(workspaceId: string): Promise<ClosingPolicy | null> {
    const { rows } = await sql<PolicyRow>`
      SELECT workspace_id, pending_transactions, unreconciled_accounts, unresolved_duplicates, uncategorized,
             unresolved_recurring, version, ${instantText('updated_at')} AS updated_at, updated_by
        FROM planning.closing_policy WHERE workspace_id = ${workspaceId}`.execute(db());
    const r = rows[0];
    if (!r) return null;
    const severities: PolicySeverities = {
      PENDING_TRANSACTIONS: r.pending_transactions,
      UNRECONCILED_ACCOUNTS: r.unreconciled_accounts,
      UNRESOLVED_DUPLICATES: r.unresolved_duplicates,
      UNCATEGORIZED: r.uncategorized,
      UNRESOLVED_RECURRING: r.unresolved_recurring,
    };
    return ClosingPolicy.restore({
      workspaceId: r.workspace_id,
      severities,
      version: Number(r.version),
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    });
  }

  async save(policy: ClosingPolicy): Promise<boolean> {
    const s = policy.snapshot;
    const v = s.severities;
    if (policy.persistedVersion === 0) {
      const res = await sql`
        INSERT INTO planning.closing_policy (workspace_id, pending_transactions, unreconciled_accounts,
          unresolved_duplicates, uncategorized, unresolved_recurring, version, updated_at, updated_by)
        VALUES (${s.workspaceId}, ${v.PENDING_TRANSACTIONS}, ${v.UNRECONCILED_ACCOUNTS}, ${v.UNRESOLVED_DUPLICATES},
          ${v.UNCATEGORIZED}, ${v.UNRESOLVED_RECURRING}, ${s.version}, now(), ${s.updatedBy})
        ON CONFLICT (workspace_id) DO NOTHING`.execute(db());
      return (res.numAffectedRows ?? 0n) > 0n;
    }
    const res = await sql`
      UPDATE planning.closing_policy
         SET pending_transactions = ${v.PENDING_TRANSACTIONS}, unreconciled_accounts = ${v.UNRECONCILED_ACCOUNTS},
             unresolved_duplicates = ${v.UNRESOLVED_DUPLICATES}, uncategorized = ${v.UNCATEGORIZED},
             unresolved_recurring = ${v.UNRESOLVED_RECURRING}, version = ${s.version}, updated_at = now(),
             updated_by = ${s.updatedBy}
       WHERE workspace_id = ${s.workspaceId} AND version = ${policy.persistedVersion}`.execute(db());
    return (res.numAffectedRows ?? 0n) > 0n;
  }
}

// ───────────────────────────────────────────────────────────────────────── snapshots (append-only)

interface HeaderRow {
  id: string;
  workspace_id: string;
  period_id: string;
  close_no: number;
  closed_at: string;
  closed_by: string | null;
  previous_snapshot_id: string | null;
}

const toHeader = (r: HeaderRow): SnapshotHeader => ({
  id: r.id,
  workspaceId: r.workspace_id,
  periodId: r.period_id,
  closeNo: Number(r.close_no),
  closedAt: r.closed_at,
  closedBy: r.closed_by,
  previousSnapshotId: r.previous_snapshot_id,
});

/** Texto exacto a la escala guardada (`numeric(38,18)` se rellena con ceros: se vuelve a la escala original). */
const amountAt = (column: string, scale: string) =>
  sql<string>`round(${sql.ref(column)}, ${sql.ref(scale)})::text`;

export class PgCloseSnapshotRepository implements CloseSnapshotRepository {
  async insert(snapshot: SnapshotHeader & { readonly content: CloseSnapshotContent }): Promise<string> {
    const c = snapshot.content;
    const sha = sha256Hex(canonicalJson(c));
    await sql`
      INSERT INTO planning.close_snapshot (id, workspace_id, period_id, close_no, label, period_start, period_end,
        start_day, base_currency, closed_at, closed_by, previous_snapshot_id, checklist, acknowledged_warnings, flows,
        net_worth, budget_vs_actual, goal_contributions, content_schema_version, content_sha256)
      VALUES (${snapshot.id}, ${snapshot.workspaceId}, ${snapshot.periodId}, ${snapshot.closeNo}, ${c.period.label},
        ${c.period.periodStart}::date, ${c.period.periodEnd}::date, ${c.period.startDay}, ${c.baseCurrency},
        ${snapshot.closedAt}::timestamptz, ${snapshot.closedBy}, ${snapshot.previousSnapshotId},
        ${jsonb(c.checklist)}, ${c.acknowledgedWarnings ? jsonb(c.acknowledgedWarnings) : null}, ${jsonb(c.flows)},
        ${jsonb(c.netWorth)}, ${c.budgetVsActual ? jsonb(c.budgetVsActual) : null}, ${null},
        ${c.schemaVersion}, ${sha})`.execute(db());
    for (const b of c.balances) {
      const scale = Math.max(
        scaleOf(b.balance.amount),
        scaleOf(b.presented.amount),
        b.reconciliation ? scaleOf(b.reconciliation.statementBalance.amount) : 0,
      );
      await sql`
        INSERT INTO planning.close_snapshot_balance (snapshot_id, account_id, workspace_id, ledger_account_id,
          account_name, currency, scale, balance, presented, reconciliation_id, statement_date, statement_balance,
          reconciliation_basis)
        VALUES (${snapshot.id}, ${b.accountId}, ${snapshot.workspaceId}, ${b.ledgerAccountId}, ${b.accountName},
          ${b.currency}, ${scale}, ${b.balance.amount}::numeric, ${b.presented.amount}::numeric,
          ${b.reconciliation?.reconciliationId ?? null}, ${b.reconciliation?.statementDate ?? null}::date,
          ${b.reconciliation?.statementBalance.amount ?? null}::numeric, ${b.reconciliationBasis})`.execute(
        db(),
      );
    }
    for (const w of c.reconciledWithoutStatement) {
      await sql`
        INSERT INTO planning.close_snapshot_without_statement (snapshot_id, transaction_id, workspace_id, account_id,
          business_date, amount, scale, currency)
        VALUES (${snapshot.id}, ${w.transactionId}, ${snapshot.workspaceId}, ${w.accountId}, ${w.businessDate}::date,
          ${w.amount.amount}::numeric, ${scaleOf(w.amount.amount)}, ${w.amount.currency})`.execute(db());
    }
    return sha;
  }

  async list(workspaceId: string, periodId: string): Promise<readonly SnapshotHeader[]> {
    const { rows } = await sql<HeaderRow>`
      SELECT id, workspace_id, period_id, close_no, ${instantText('closed_at')} AS closed_at, closed_by,
             previous_snapshot_id
        FROM planning.close_snapshot WHERE workspace_id = ${workspaceId} AND period_id = ${periodId}
       ORDER BY close_no ASC`.execute(db());
    return rows.map(toHeader);
  }

  async find(workspaceId: string, periodId: string, closeNo: number): Promise<StoredSnapshot | null> {
    return (await this.load(workspaceId, sql`period_id = ${periodId} AND close_no = ${closeNo}`))[0] ?? null;
  }

  async listCurrent(workspaceId: string, periodIds: readonly string[]): Promise<readonly StoredSnapshot[]> {
    if (periodIds.length === 0) return [];
    return this.load(
      workspaceId,
      sql`period_id IN (${sql.join(periodIds.map((p) => sql`${p}`))}) AND close_no = (
        SELECT max(x.close_no) FROM planning.close_snapshot x
         WHERE x.workspace_id = s.workspace_id AND x.period_id = s.period_id)`,
    );
  }

  async listAllCurrent(workspaceId: string): Promise<readonly StoredSnapshot[]> {
    return this.load(
      workspaceId,
      sql`close_no = (SELECT max(x.close_no) FROM planning.close_snapshot x
                       WHERE x.workspace_id = s.workspace_id AND x.period_id = s.period_id)`,
    );
  }

  private async load(workspaceId: string, where: ReturnType<typeof sql>): Promise<StoredSnapshot[]> {
    const { rows } = await sql<
      HeaderRow & {
        label: string;
        period_start: string;
        period_end: string;
        start_day: number;
        base_currency: string;
        checklist: CloseSnapshotContent['checklist'];
        acknowledged_warnings: CloseSnapshotContent['acknowledgedWarnings'];
        flows: CloseSnapshotContent['flows'];
        net_worth: CloseSnapshotContent['netWorth'];
        budget_vs_actual: CloseSnapshotContent['budgetVsActual'];
        content_schema_version: number;
        content_sha256: string;
      }
    >`
      SELECT s.id, s.workspace_id, s.period_id, s.close_no, ${instantText('s.closed_at')} AS closed_at, s.closed_by,
             s.previous_snapshot_id, s.label, s.period_start::text AS period_start, s.period_end::text AS period_end,
             s.start_day, s.base_currency, s.checklist, s.acknowledged_warnings, s.flows, s.net_worth,
             s.budget_vs_actual, s.content_schema_version, s.content_sha256
        FROM planning.close_snapshot s
       WHERE s.workspace_id = ${workspaceId} AND ${where}
       ORDER BY s.period_start, s.close_no`.execute(db());
    const out: StoredSnapshot[] = [];
    for (const r of rows) {
      const balances = await this.balances(r.id);
      const withoutStatement = await this.withoutStatement(r.id);
      const byAccount = new Map<string, string[]>();
      for (const w of withoutStatement)
        byAccount.set(w.accountId, [...(byAccount.get(w.accountId) ?? []), w.transactionId]);
      const content: CloseSnapshotContent = {
        schemaVersion: Number(r.content_schema_version),
        period: {
          periodId: r.period_id,
          label: r.label,
          periodStart: r.period_start,
          periodEnd: r.period_end,
          startDay: Number(r.start_day),
        },
        baseCurrency: r.base_currency,
        balances: balances.map((b) => ({
          ...b,
          reconciledWithoutStatementTransactionIds:
            b.reconciliationBasis === 'WITHOUT_STATEMENT'
              ? [...(byAccount.get(b.accountId) ?? [])].sort()
              : [],
        })),
        reconciledWithoutStatement: withoutStatement,
        flows: r.flows,
        netWorth: r.net_worth,
        budgetVsActual: r.budget_vs_actual,
        goalContributions: null,
        checklist: r.checklist,
        acknowledgedWarnings: r.acknowledged_warnings,
      };
      out.push({ ...toHeader(r), contentSha256: r.content_sha256, content });
    }
    return out;
  }

  private async balances(
    snapshotId: string,
  ): Promise<Omit<SnapshotBalance, 'reconciledWithoutStatementTransactionIds'>[]> {
    const { rows } = await sql<{
      account_id: string;
      ledger_account_id: string | null;
      account_name: string;
      currency: string;
      balance: string;
      presented: string;
      reconciliation_id: string | null;
      statement_date: string | null;
      statement_balance: string | null;
      reconciliation_basis: 'STATEMENT' | 'WITHOUT_STATEMENT' | null;
    }>`
      SELECT account_id, ledger_account_id, account_name, currency, ${amountAt('balance', 'scale')} AS balance,
             ${amountAt('presented', 'scale')} AS presented, reconciliation_id, statement_date::text AS statement_date,
             CASE WHEN statement_balance IS NULL THEN NULL ELSE ${amountAt('statement_balance', 'scale')} END AS statement_balance,
             reconciliation_basis
        FROM planning.close_snapshot_balance WHERE snapshot_id = ${snapshotId}`.execute(db());
    return rows
      .map((r) => ({
        accountId: r.account_id,
        accountName: r.account_name,
        ledgerAccountId: r.ledger_account_id,
        currency: r.currency,
        balance: { amount: r.balance, currency: r.currency },
        presented: { amount: r.presented, currency: r.currency },
        reconciliation:
          r.reconciliation_id && r.statement_date && r.statement_balance
            ? {
                reconciliationId: r.reconciliation_id,
                statementDate: r.statement_date,
                statementBalance: { amount: r.statement_balance, currency: r.currency } as MoneyValue,
              }
            : null,
        reconciliationBasis: r.reconciliation_basis,
      }))
      .sort((a, b) =>
        a.accountName === b.accountName
          ? a.accountId.localeCompare(b.accountId)
          : a.accountName.localeCompare(b.accountName),
      );
  }

  private async withoutStatement(snapshotId: string): Promise<SnapshotWithoutStatementRow[]> {
    const { rows } = await sql<{
      transaction_id: string;
      account_id: string;
      business_date: string;
      amount: string;
      currency: string;
    }>`
      SELECT transaction_id, account_id, business_date::text AS business_date, ${amountAt('amount', 'scale')} AS amount,
             currency
        FROM planning.close_snapshot_without_statement WHERE snapshot_id = ${snapshotId}`.execute(db());
    return rows
      .map((r) => ({
        transactionId: r.transaction_id,
        accountId: r.account_id,
        businessDate: r.business_date,
        amount: { amount: r.amount, currency: r.currency },
      }))
      .sort((a, b) =>
        a.businessDate === b.businessDate
          ? a.transactionId.localeCompare(b.transactionId)
          : a.businessDate.localeCompare(b.businessDate),
      );
  }
}

// ───────────────────────────────────────────────────────────────────────── reaperturas y avisos

export class PgPeriodReopeningRepository implements PeriodReopeningRepository {
  async insert(row: PeriodReopeningRow): Promise<void> {
    await sql`
      INSERT INTO planning.period_reopening (id, workspace_id, period_id, reopen_no, reason, reopened_by, reopened_at,
        closed_snapshot_id)
      VALUES (${row.id}, ${row.workspaceId}, ${row.periodId}, ${row.reopenNo}, ${row.reason}, ${row.reopenedBy},
        ${row.reopenedAt}::timestamptz, ${row.closedSnapshotId})`.execute(db());
  }
}

export class PgClosePendingNoticeRepository implements ClosePendingNoticeRepository {
  async insertIfAbsent(input: { workspaceId: string; periodId: string; eventId: string }): Promise<boolean> {
    const res = await sql`
      INSERT INTO planning.close_pending_notice (workspace_id, period_id, event_id)
      VALUES (${input.workspaceId}, ${input.periodId}, ${input.eventId})
      ON CONFLICT (workspace_id, period_id) DO NOTHING`.execute(db());
    return (res.numAffectedRows ?? 0n) > 0n;
  }
}
