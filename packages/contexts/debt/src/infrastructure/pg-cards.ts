import { unitOfWorkKysely } from '@pf/platform/api';
import { DomainError, dec } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type {
  CardRepository,
  InstallmentPlanRepository,
  ReminderRepository,
  StatementRecord,
  StatementRepository,
  UtilizationRepository,
} from '../application/card-ports.js';
import {
  CardInstallmentPlan,
  CreditCard,
  type CardAccountState,
  type CardInstallmentPlanState,
  type CardInstallmentState,
  type CardTermsVersion,
  type CreditCardState,
  type MinimumPaymentRuleSpec,
  type ThresholdState,
} from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();
const json = (value: unknown): string => JSON.stringify(value);
const ISO = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
const D = (col: string) => sql.raw(`to_char(${col}, 'YYYY-MM-DD')`);
const money = (value: string | null, scale: number): string => dec(value ?? '0').toFixed(scale);
const pct = (value: string): string => dec(value).toFixed(2);

// ───────────────────────────────────────────────────────────── tarjeta

interface CardRow {
  id: string;
  workspace_id: string;
  name: string;
  limit_mode: 'SEPARATE' | 'SHARED';
  shared_limit_amount: string | null;
  shared_limit_currency: string | null;
  shared_scale: number | null;
  annual_rate: string | null;
  utilization_thresholds: string[];
  reminder_days: number;
  status: 'ACTIVE' | 'ARCHIVED';
  archived_at: string | null;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface AccountRow {
  id: string;
  card_id: string;
  account_id: string;
  currency: string;
  scale: number;
  credit_limit_amount: string | null;
  minimum_rule_type: 'PERCENT' | 'FIXED';
  minimum_percent: string | null;
  minimum_floor_amount: string | null;
  minimum_amount: string | null;
  plan_source_account_id: string | null;
  plan_policy: 'NO_INTEREST' | 'MINIMUM' | null;
  plan_materialization: CardAccountState['paymentPlan'] extends infer P
    ? P extends { materialization: infer M }
      ? M | null
      : null
    : null;
  plan_definition_id: string | null;
  plan_enabled_at: string | null;
}

interface TermsRow {
  card_id: string;
  seq: number;
  effective_from: string;
  statement_day: number;
  due_day: number;
  due_weekend_adjustment: CardTermsVersion['dueWeekendAdjustment'];
}

const CARD_COLUMNS = sql`
  c.id, c.workspace_id, c.name, c.limit_mode, c.shared_limit_amount, c.shared_limit_currency, sc.scale AS shared_scale,
  c.annual_rate, c.utilization_thresholds::text[] AS utilization_thresholds, c.reminder_days, c.status,
  ${ISO('c.archived_at')} AS archived_at, c.version, c.created_by, ${ISO('c.created_at')} AS created_at,
  ${ISO('c.updated_at')} AS updated_at`;

function toAccount(r: AccountRow): CardAccountState {
  const scale = Number(r.scale);
  const minimumRule: MinimumPaymentRuleSpec =
    r.minimum_rule_type === 'PERCENT'
      ? {
          type: 'PERCENT',
          percent: pct(r.minimum_percent as string),
          floor: r.minimum_floor_amount === null ? null : money(r.minimum_floor_amount, scale),
        }
      : { type: 'FIXED', amount: money(r.minimum_amount, scale) };
  return {
    id: r.id,
    accountId: r.account_id,
    currency: r.currency,
    scale,
    creditLimit: r.credit_limit_amount === null ? null : money(r.credit_limit_amount, scale),
    minimumRule,
    paymentPlan:
      r.plan_definition_id === null
        ? null
        : {
            sourceAccountId: r.plan_source_account_id as string,
            policy: r.plan_policy as 'NO_INTEREST' | 'MINIMUM',
            materialization: r.plan_materialization as NonNullable<
              CardAccountState['paymentPlan']
            >['materialization'],
            definitionId: r.plan_definition_id,
            enabledAt: r.plan_enabled_at as string,
          },
  };
}

async function loadCards(rows: readonly CardRow[]): Promise<CreditCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const accounts = await sql<AccountRow>`
    SELECT a.id, a.card_id, a.account_id, a.currency, c.scale, a.credit_limit_amount, a.minimum_rule_type,
           a.minimum_percent, a.minimum_floor_amount, a.minimum_amount, a.plan_source_account_id, a.plan_policy,
           a.plan_materialization, a.plan_definition_id, ${ISO('a.plan_enabled_at')} AS plan_enabled_at
      FROM debt.credit_card_account a JOIN fx.currency c ON c.code = a.currency
     WHERE a.card_id = ANY(${ids}::uuid[]) ORDER BY a.currency, a.id`.execute(db());
  const terms = await sql<TermsRow>`
    SELECT card_id, seq, ${D('effective_from')} AS effective_from, statement_day, due_day, due_weekend_adjustment
      FROM debt.credit_card_terms WHERE card_id = ANY(${ids}::uuid[]) ORDER BY card_id, seq`.execute(db());
  return rows.map((r) => {
    // Misma fecha de vigencia: manda la versión de mayor secuencia.
    const byFrom = new Map<string, CardTermsVersion>();
    for (const t of terms.rows.filter((x) => x.card_id === r.id)) {
      byFrom.set(t.effective_from, {
        statementDay: Number(t.statement_day),
        dueDay: Number(t.due_day),
        dueWeekendAdjustment: t.due_weekend_adjustment,
        effectiveFrom: t.effective_from,
      });
    }
    const versions = [...byFrom.values()].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    const state: CreditCardState = {
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      annualRate: r.annual_rate === null ? null : pct(r.annual_rate),
      limitMode: r.limit_mode,
      sharedLimit:
        r.shared_limit_amount === null
          ? null
          : {
              amount: money(r.shared_limit_amount, Number(r.shared_scale)),
              currency: r.shared_limit_currency as string,
              scale: Number(r.shared_scale),
            },
      utilizationThresholds: r.utilization_thresholds.map(pct),
      reminderDays: Number(r.reminder_days),
      status: r.status,
      terms: versions,
      accounts: accounts.rows.filter((a) => a.card_id === r.id).map(toAccount),
      archivedAt: r.archived_at,
      version: Number(r.version),
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
    return CreditCard.restore(state);
  });
}

export class PgCardRepository implements CardRepository {
  async findById(workspaceId: string, id: string, options?: { lock?: 'update' }): Promise<CreditCard | null> {
    const lock = options?.lock === 'update' ? sql`FOR UPDATE OF c` : sql``;
    const { rows } = await sql<CardRow>`
      SELECT ${CARD_COLUMNS} FROM debt.credit_card c LEFT JOIN fx.currency sc ON sc.code = c.shared_limit_currency
       WHERE c.workspace_id = ${workspaceId} AND c.id = ${id} ${lock}`.execute(db());
    return (await loadCards(rows))[0] ?? null;
  }

  async insert(card: CreditCard, by: string): Promise<void> {
    const s = card.snapshot;
    try {
      await sql`
        INSERT INTO debt.credit_card (
          id, workspace_id, name, limit_mode, shared_limit_amount, shared_limit_currency, annual_rate,
          utilization_thresholds, reminder_days, status, archived_at, version, created_by, created_at, updated_at)
        VALUES (${s.id}, ${s.workspaceId}, ${s.name}, ${s.limitMode}, ${s.sharedLimit?.amount ?? null},
                ${s.sharedLimit?.currency ?? null}, ${s.annualRate}, ${s.utilizationThresholds}::numeric[],
                ${s.reminderDays}, ${s.status}, ${s.archivedAt}::timestamptz, ${s.version}, ${s.createdBy},
                ${s.createdAt}::timestamptz, ${s.updatedAt}::timestamptz)`.execute(db());
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new DomainError('VALIDATION_FAILED', 'a credit card with that name already exists').at('/name');
      }
      throw err;
    }
    for (const a of s.accounts) await this.insertAccount(s, a);
    await this.insertTerms(s.workspaceId, s.id, s.terms, 0, by, s.createdAt);
  }

  private async insertAccount(s: CreditCardState, a: CardAccountState): Promise<void> {
    const rule = a.minimumRule;
    try {
      await sql`
        INSERT INTO debt.credit_card_account (
          id, workspace_id, card_id, account_id, currency, credit_limit_amount, minimum_rule_type, minimum_percent,
          minimum_floor_amount, minimum_amount, card_status)
        VALUES (${a.id}, ${s.workspaceId}, ${s.id}, ${a.accountId}, ${a.currency}, ${a.creditLimit},
                ${rule.type}, ${rule.type === 'PERCENT' ? rule.percent : null},
                ${rule.type === 'PERCENT' ? rule.floor : null}, ${rule.type === 'FIXED' ? rule.amount : null},
                ${s.status})`.execute(db());
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new DomainError(
          'CREDIT_CARD_ACCOUNT_IN_USE',
          'the account already belongs to another credit card',
        ).at('/accounts');
      }
      throw err;
    }
  }

  private async insertTerms(
    workspaceId: string,
    cardId: string,
    versions: readonly CardTermsVersion[],
    startSeq: number,
    by: string,
    at: string,
  ): Promise<void> {
    let seq = startSeq;
    for (const v of versions) {
      seq += 1;
      await sql`
        INSERT INTO debt.credit_card_terms
          (workspace_id, card_id, seq, effective_from, statement_day, due_day, due_weekend_adjustment, recorded_at, recorded_by)
        VALUES (${workspaceId}, ${cardId}, ${seq}, ${v.effectiveFrom}::date, ${v.statementDay}, ${v.dueDay},
                ${v.dueWeekendAdjustment}, ${at}::timestamptz, ${by})`.execute(db());
    }
  }

  async save(card: CreditCard, by: string): Promise<boolean> {
    const s = card.snapshot;
    const result = await sql`
      UPDATE debt.credit_card SET
        name = ${s.name}, limit_mode = ${s.limitMode}, shared_limit_amount = ${s.sharedLimit?.amount ?? null},
        shared_limit_currency = ${s.sharedLimit?.currency ?? null}, annual_rate = ${s.annualRate},
        utilization_thresholds = ${s.utilizationThresholds}::numeric[], reminder_days = ${s.reminderDays},
        status = ${s.status}, archived_at = ${s.archivedAt}::timestamptz, updated_at = ${s.updatedAt}::timestamptz,
        version = ${s.version}
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id} AND version = ${card.persistedVersion}`.execute(
      db(),
    );
    if (Number(result.numAffectedRows ?? 0) !== 1) return false;
    for (const a of s.accounts) {
      const rule = a.minimumRule;
      const plan = a.paymentPlan;
      await sql`
        UPDATE debt.credit_card_account SET
          credit_limit_amount = ${a.creditLimit}, minimum_rule_type = ${rule.type},
          minimum_percent = ${rule.type === 'PERCENT' ? rule.percent : null},
          minimum_floor_amount = ${rule.type === 'PERCENT' ? rule.floor : null},
          minimum_amount = ${rule.type === 'FIXED' ? rule.amount : null},
          plan_source_account_id = ${plan?.sourceAccountId ?? null}, plan_policy = ${plan?.policy ?? null},
          plan_materialization = ${plan ? json(plan.materialization) : null}::jsonb,
          plan_definition_id = ${plan?.definitionId ?? null}, plan_enabled_at = ${plan?.enabledAt ?? null}::timestamptz,
          card_status = ${s.status}, version = version + 1
         WHERE workspace_id = ${s.workspaceId} AND id = ${a.id}`.execute(db());
    }
    // Versiones de términos nuevas (append-only): las que no coinciden con la última fila de su fecha de vigencia.
    const existing = await sql<TermsRow>`
      SELECT card_id, seq, ${D('effective_from')} AS effective_from, statement_day, due_day, due_weekend_adjustment
        FROM debt.credit_card_terms WHERE card_id = ${s.id} ORDER BY seq`.execute(db());
    const latest = new Map<string, TermsRow>();
    for (const t of existing.rows) latest.set(t.effective_from, t);
    const missing = s.terms.filter((v) => {
      const row = latest.get(v.effectiveFrom);
      return (
        !row ||
        Number(row.statement_day) !== v.statementDay ||
        Number(row.due_day) !== v.dueDay ||
        row.due_weekend_adjustment !== v.dueWeekendAdjustment
      );
    });
    const maxSeq = existing.rows.reduce((m, t) => Math.max(m, Number(t.seq)), 0);
    await this.insertTerms(s.workspaceId, s.id, missing, maxSeq, by, s.updatedAt);
    return true;
  }

  async list(
    workspaceId: string,
    filter: { status?: string; accountId?: string },
  ): Promise<readonly CreditCard[]> {
    const status = filter.status ?? null;
    const accountId = filter.accountId ?? null;
    const { rows } = await sql<CardRow>`
      SELECT ${CARD_COLUMNS} FROM debt.credit_card c LEFT JOIN fx.currency sc ON sc.code = c.shared_limit_currency
       WHERE c.workspace_id = ${workspaceId}
         AND (${status}::text IS NULL OR c.status = ${status}::text)
         AND (${accountId}::uuid IS NULL OR EXISTS (
               SELECT 1 FROM debt.credit_card_account a WHERE a.card_id = c.id AND a.account_id = ${accountId}::uuid))
       ORDER BY c.status, lower(c.name), c.id`.execute(db());
    return loadCards(rows);
  }

  async activeCardsOfAccounts(workspaceId: string, accountIds: readonly string[]) {
    if (accountIds.length === 0) return [];
    const { rows } = await sql<{ account_id: string; card_id: string }>`
      SELECT account_id, card_id FROM debt.credit_card_account
       WHERE workspace_id = ${workspaceId} AND card_status = 'ACTIVE' AND account_id = ANY(${[...accountIds]}::uuid[])`.execute(
      db(),
    );
    return rows.map((r) => ({ accountId: r.account_id, cardId: r.card_id }));
  }

  async activeAccountIndex(workspaceId: string): Promise<ReadonlyMap<string, string>> {
    const { rows } = await sql<{ account_id: string; card_id: string }>`
      SELECT account_id, card_id FROM debt.credit_card_account
       WHERE workspace_id = ${workspaceId} AND card_status = 'ACTIVE'`.execute(db());
    return new Map(rows.map((r) => [r.account_id, r.card_id] as const));
  }

  async cardIdOfCardAccount(workspaceId: string, cardAccountId: string): Promise<string | null> {
    const { rows } = await sql<{ card_id: string }>`
      SELECT card_id FROM debt.credit_card_account WHERE workspace_id = ${workspaceId} AND id = ${cardAccountId}`.execute(
      db(),
    );
    return rows[0]?.card_id ?? null;
  }

  async activeCardIds(workspaceId: string): Promise<readonly string[]> {
    const { rows } = await sql<{ id: string }>`
      SELECT id FROM debt.credit_card WHERE workspace_id = ${workspaceId} AND status = 'ACTIVE' ORDER BY created_at, id`.execute(
      db(),
    );
    return rows.map((r) => r.id);
  }
}

// ───────────────────────────────────────────────────────────── estados de cuenta

interface StatementRow {
  id: string;
  workspace_id: string;
  card_account_id: string;
  cycle_start: string;
  closing_date: string;
  due_date: string;
  nominal_due_date: string;
  currency: string;
  scale: number;
  previous_balance: string;
  purchases: string;
  refunds: string;
  payments: string;
  other_net: string;
  closing_balance: string;
  unbilled_installments: string;
  billed_balance: string;
  minimum_due: string;
  reported_billed_balance: string | null;
  reported_minimum_due: string | null;
  status: StatementRecord['status'];
  issued_at: string;
  event_id: string | null;
  version: number;
}

const STATEMENT_COLUMNS = sql`
  s.id, s.workspace_id, s.card_account_id, ${D('s.cycle_start')} AS cycle_start, ${D('s.closing_date')} AS closing_date,
  ${D('s.due_date')} AS due_date, ${D('s.nominal_due_date')} AS nominal_due_date, s.currency, c.scale,
  s.previous_balance, s.purchases, s.refunds, s.payments, s.other_net, s.closing_balance, s.unbilled_installments,
  s.billed_balance, s.minimum_due, s.reported_billed_balance, s.reported_minimum_due, s.status,
  ${ISO('s.issued_at')} AS issued_at, s.event_id, s.version`;

const toStatement = (r: StatementRow): StatementRecord => {
  const scale = Number(r.scale);
  const m = (v: string) => money(v, scale);
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    cardAccountId: r.card_account_id,
    cycleStart: r.cycle_start,
    closingDate: r.closing_date,
    dueDate: r.due_date,
    nominalDueDate: r.nominal_due_date,
    currency: r.currency,
    previousBalance: m(r.previous_balance),
    purchases: m(r.purchases),
    refunds: m(r.refunds),
    payments: m(r.payments),
    otherNet: m(r.other_net),
    closingBalance: m(r.closing_balance),
    unbilledInstallments: m(r.unbilled_installments),
    billedBalance: m(r.billed_balance),
    minimumDue: m(r.minimum_due),
    reportedBilledBalance: r.reported_billed_balance === null ? null : m(r.reported_billed_balance),
    reportedMinimumDue: r.reported_minimum_due === null ? null : m(r.reported_minimum_due),
    status: r.status,
    issuedAt: r.issued_at,
    eventId: r.event_id,
    version: Number(r.version),
  };
};

export class PgStatementRepository implements StatementRepository {
  async insertIfAbsent(r: StatementRecord): Promise<boolean> {
    const result = await sql`
      INSERT INTO debt.card_statement (
        id, workspace_id, card_account_id, cycle_start, closing_date, due_date, nominal_due_date, currency,
        previous_balance, purchases, refunds, payments, other_net, closing_balance, unbilled_installments,
        billed_balance, minimum_due, status, issued_at, event_id, version)
      VALUES (${r.id}, ${r.workspaceId}, ${r.cardAccountId}, ${r.cycleStart}::date, ${r.closingDate}::date,
              ${r.dueDate}::date, ${r.nominalDueDate}::date, ${r.currency}, ${r.previousBalance}, ${r.purchases},
              ${r.refunds}, ${r.payments}, ${r.otherNet}, ${r.closingBalance}, ${r.unbilledInstallments},
              ${r.billedBalance}, ${r.minimumDue}, ${r.status}, ${r.issuedAt}::timestamptz, ${r.eventId}, ${r.version})
      ON CONFLICT (card_account_id, closing_date) DO NOTHING`.execute(db());
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async listForAccounts(workspaceId: string, cardAccountIds: readonly string[]) {
    if (cardAccountIds.length === 0) return [];
    const { rows } = await sql<StatementRow>`
      SELECT ${STATEMENT_COLUMNS} FROM debt.card_statement s JOIN fx.currency c ON c.code = s.currency
       WHERE s.workspace_id = ${workspaceId} AND s.card_account_id = ANY(${[...cardAccountIds]}::uuid[])
       ORDER BY s.closing_date, s.id`.execute(db());
    return rows.map(toStatement);
  }

  async find(workspaceId: string, statementId: string) {
    const { rows } = await sql<StatementRow>`
      SELECT ${STATEMENT_COLUMNS} FROM debt.card_statement s JOIN fx.currency c ON c.code = s.currency
       WHERE s.workspace_id = ${workspaceId} AND s.id = ${statementId}`.execute(db());
    return rows[0] ? toStatement(rows[0]) : null;
  }

  async updateStatus(workspaceId: string, statementId: string, status: StatementRecord['status']) {
    await sql`
      UPDATE debt.card_statement SET status = ${status}
       WHERE workspace_id = ${workspaceId} AND id = ${statementId} AND status <> ${status}`.execute(db());
  }

  async setReported(
    workspaceId: string,
    statementId: string,
    input: { billed: string | null; minimum: string | null; expectedVersion: number },
  ): Promise<boolean> {
    const result = await sql`
      UPDATE debt.card_statement SET reported_billed_balance = ${input.billed},
             reported_minimum_due = ${input.minimum}, version = version + 1
       WHERE workspace_id = ${workspaceId} AND id = ${statementId} AND version = ${input.expectedVersion}`.execute(
      db(),
    );
    return Number(result.numAffectedRows ?? 0) === 1;
  }
}

// ───────────────────────────────────────────────────────────── planes de cuotas

interface PlanRow {
  id: string;
  workspace_id: string;
  card_account_id: string;
  purchase_transaction_id: string;
  purchase_date: string;
  principal: string;
  currency: string;
  scale: number;
  installment_count: number;
  annual_rate: string;
  start_cycle: 'PURCHASE' | 'NEXT';
  status: CardInstallmentPlanState['status'];
  cancel_reason: CardInstallmentPlanState['cancelReason'];
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

interface InstallmentRow {
  plan_id: string;
  n: number;
  billing_closing_date: string;
  due_date: string;
  nominal_due_date: string;
  principal: string;
  interest: string;
  total: string;
}

const PLAN_COLUMNS = sql`
  p.id, p.workspace_id, p.card_account_id, p.purchase_transaction_id, ${D('p.purchase_date')} AS purchase_date,
  p.principal, p.currency, c.scale, p.installment_count, p.annual_rate, p.start_cycle, p.status, p.cancel_reason,
  p.created_by, ${ISO('p.created_at')} AS created_at, ${ISO('p.updated_at')} AS updated_at, p.version`;

async function loadPlans(rows: readonly PlanRow[]): Promise<CardInstallmentPlan[]> {
  if (rows.length === 0) return [];
  const { rows: items } = await sql<InstallmentRow>`
    SELECT plan_id, n, ${D('billing_closing_date')} AS billing_closing_date, ${D('due_date')} AS due_date,
           ${D('nominal_due_date')} AS nominal_due_date, principal, interest, total
      FROM debt.card_installment WHERE plan_id = ANY(${rows.map((r) => r.id)}::uuid[]) ORDER BY plan_id, n`.execute(
    db(),
  );
  return rows.map((r) => {
    const scale = Number(r.scale);
    const installments: CardInstallmentState[] = items
      .filter((i) => i.plan_id === r.id)
      .map((i) => ({
        n: Number(i.n),
        billingClosingDate: i.billing_closing_date,
        dueDate: i.due_date,
        nominalDueDate: i.nominal_due_date,
        principal: money(i.principal, scale),
        interest: money(i.interest, scale),
        total: money(i.total, scale),
      }));
    return CardInstallmentPlan.restore({
      id: r.id,
      workspaceId: r.workspace_id,
      cardAccountId: r.card_account_id,
      purchaseTransactionId: r.purchase_transaction_id,
      purchaseDate: r.purchase_date,
      principal: money(r.principal, scale),
      currency: r.currency,
      scale,
      installmentCount: Number(r.installment_count),
      annualRate: pct(r.annual_rate),
      startCycle: r.start_cycle,
      status: r.status,
      cancelReason: r.cancel_reason,
      installments,
      version: Number(r.version),
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  });
}

export class PgInstallmentPlanRepository implements InstallmentPlanRepository {
  async insert(plan: CardInstallmentPlan, _by: string): Promise<void> {
    const s = plan.snapshot;
    try {
      await sql`
        INSERT INTO debt.card_installment_plan (
          id, workspace_id, card_account_id, purchase_transaction_id, purchase_date, principal, currency,
          installment_count, annual_rate, start_cycle, status, cancel_reason, created_by, created_at, updated_at, version)
        VALUES (${s.id}, ${s.workspaceId}, ${s.cardAccountId}, ${s.purchaseTransactionId}, ${s.purchaseDate}::date,
                ${s.principal}, ${s.currency}, ${s.installmentCount}, ${s.annualRate}, ${s.startCycle}, ${s.status},
                ${s.cancelReason}, ${s.createdBy}, ${s.createdAt}::timestamptz, ${s.updatedAt}::timestamptz, ${s.version})`.execute(
        db(),
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new DomainError('INSTALLMENT_PLAN_INVALID', 'the purchase already has an installment plan').at(
          '/purchaseTransactionId',
        );
      }
      throw err;
    }
    await this.writeInstallments(s);
    plan.markPersisted();
  }

  private async writeInstallments(s: CardInstallmentPlanState): Promise<void> {
    await sql`
      INSERT INTO debt.card_installment
        (workspace_id, plan_id, n, billing_closing_date, due_date, nominal_due_date, principal, interest, total)
      SELECT ${s.workspaceId}::uuid, ${s.id}::uuid, (e->>'n')::int, (e->>'billingClosingDate')::date,
             (e->>'dueDate')::date, (e->>'nominalDueDate')::date, (e->>'principal')::numeric,
             (e->>'interest')::numeric, (e->>'total')::numeric
        FROM jsonb_array_elements(${json(s.installments)}::jsonb) e
      ON CONFLICT (plan_id, n) DO UPDATE SET billing_closing_date = EXCLUDED.billing_closing_date,
             due_date = EXCLUDED.due_date, nominal_due_date = EXCLUDED.nominal_due_date,
             principal = EXCLUDED.principal, interest = EXCLUDED.interest, total = EXCLUDED.total`.execute(
      db(),
    );
  }

  async save(plan: CardInstallmentPlan): Promise<boolean> {
    const s = plan.snapshot;
    const result = await sql`
      UPDATE debt.card_installment_plan SET status = ${s.status}, cancel_reason = ${s.cancelReason},
             updated_at = ${s.updatedAt}::timestamptz, version = ${s.version}
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id} AND version = ${plan.persistedVersion}`.execute(
      db(),
    );
    if (Number(result.numAffectedRows ?? 0) !== 1) return false;
    await this.writeInstallments(s);
    plan.markPersisted();
    return true;
  }

  async findById(workspaceId: string, id: string, options?: { lock?: 'update' }) {
    const lock = options?.lock === 'update' ? sql`FOR UPDATE OF p` : sql``;
    const { rows } = await sql<PlanRow>`
      SELECT ${PLAN_COLUMNS} FROM debt.card_installment_plan p JOIN fx.currency c ON c.code = p.currency
       WHERE p.workspace_id = ${workspaceId} AND p.id = ${id} ${lock}`.execute(db());
    return (await loadPlans(rows))[0] ?? null;
  }

  async findByPurchase(workspaceId: string, purchaseTransactionId: string) {
    const { rows } = await sql<PlanRow>`
      SELECT ${PLAN_COLUMNS} FROM debt.card_installment_plan p JOIN fx.currency c ON c.code = p.currency
       WHERE p.workspace_id = ${workspaceId} AND p.purchase_transaction_id = ${purchaseTransactionId}
         AND p.status <> 'CANCELLED'`.execute(db());
    return (await loadPlans(rows))[0] ?? null;
  }

  async listForCardAccounts(workspaceId: string, cardAccountIds: readonly string[]) {
    if (cardAccountIds.length === 0) return [];
    const { rows } = await sql<PlanRow>`
      SELECT ${PLAN_COLUMNS} FROM debt.card_installment_plan p JOIN fx.currency c ON c.code = p.currency
       WHERE p.workspace_id = ${workspaceId} AND p.card_account_id = ANY(${[...cardAccountIds]}::uuid[])
       ORDER BY p.created_at, p.id`.execute(db());
    return loadPlans(rows);
  }
}

// ───────────────────────────────────────────────────────────── umbrales y recordatorios

export class PgUtilizationRepository implements UtilizationRepository {
  async states(cardId: string): Promise<readonly (ThresholdState & { scopeKey: string })[]> {
    const { rows } = await sql<{ scope_key: string; threshold: string; armed: boolean; crossing_no: number }>`
      SELECT scope_key, threshold, armed, crossing_no FROM debt.card_utilization_state WHERE card_id = ${cardId}`.execute(
      db(),
    );
    return rows.map((r) => ({
      scopeKey: r.scope_key,
      threshold: pct(r.threshold),
      armed: r.armed,
      crossingNo: Number(r.crossing_no),
    }));
  }

  async upsert(workspaceId: string, cardId: string, scopeKey: string, states: readonly ThresholdState[]) {
    for (const s of states) {
      await sql`
        INSERT INTO debt.card_utilization_state (workspace_id, card_id, scope_key, threshold, armed, crossing_no)
        VALUES (${workspaceId}, ${cardId}, ${scopeKey}, ${s.threshold}, ${s.armed}, ${s.crossingNo})
        ON CONFLICT (card_id, scope_key, threshold) DO UPDATE
          SET armed = EXCLUDED.armed, crossing_no = EXCLUDED.crossing_no, updated_at = now()
          WHERE (debt.card_utilization_state.armed, debt.card_utilization_state.crossing_no)
                IS DISTINCT FROM (EXCLUDED.armed, EXCLUDED.crossing_no)`.execute(db());
    }
  }

  async prune(workspaceId: string, cardId: string, keep: readonly { scopeKey: string; threshold: string }[]) {
    const keys = keep.map((k) => `${k.scopeKey}|${dec(k.threshold).toFixed(2)}`);
    await sql`
      DELETE FROM debt.card_utilization_state
       WHERE workspace_id = ${workspaceId} AND card_id = ${cardId}
         AND NOT (scope_key || '|' || to_char(threshold, 'FM990.00') = ANY(${keys}::text[]))`.execute(db());
  }

  async insertCrossing(i: {
    workspaceId: string;
    cardId: string;
    scopeKey: string;
    threshold: string;
    crossingNo: number;
    utilization: string;
    crossedAt: string;
    eventId: string | null;
  }) {
    await sql`
      INSERT INTO debt.card_utilization_crossing
        (workspace_id, card_id, scope_key, threshold, crossing_no, utilization, crossed_at, event_id)
      VALUES (${i.workspaceId}, ${i.cardId}, ${i.scopeKey}, ${i.threshold}, ${i.crossingNo}, ${i.utilization},
              ${i.crossedAt}::timestamptz, ${i.eventId})`.execute(db());
  }
}

export class PgReminderRepository implements ReminderRepository {
  async insertIfAbsent(i: {
    workspaceId: string;
    cardAccountId: string;
    closingDate: string;
    dueDate: string;
    emittedAt: string;
    eventId: string;
  }): Promise<boolean> {
    const result = await sql`
      INSERT INTO debt.card_reminder (workspace_id, card_account_id, closing_date, due_date, emitted_at, event_id)
      VALUES (${i.workspaceId}, ${i.cardAccountId}, ${i.closingDate}::date, ${i.dueDate}::date,
              ${i.emittedAt}::timestamptz, ${i.eventId})
      ON CONFLICT (workspace_id, card_account_id, closing_date) DO NOTHING`.execute(db());
    return Number(result.numAffectedRows ?? 0) === 1;
  }
}
