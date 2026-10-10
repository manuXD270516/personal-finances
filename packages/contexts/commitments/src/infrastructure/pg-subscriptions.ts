import { unitOfWorkKysely } from '@pf/platform/api';
import { Money, currency as makeCurrency, dec } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type {
  ChargeRepository,
  ProposalRepository,
  ReminderRepository,
  SubscriptionFilter,
  SubscriptionListRow,
  SubscriptionRepository,
} from '../application/ports/subscriptions.js';
import {
  Subscription,
  type ChargeOutcome,
  type PriceChangeProposal,
  type PriceEntry,
  type PriceOrigin,
  type ProposalStatus,
  type SubscriptionCharge,
  type SubscriptionState,
  type SubscriptionStatus,
} from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();

const ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Decimal de la base a la escala canónica de la moneda (`numeric(38,18)` devuelve 18 decimales). */
const canon = (value: string, scale: number): string => dec(value).toFixed(scale);
const moneyOf = (value: string, code: string, scale: number): Money =>
  Money.parse(canon(value, scale), makeCurrency(code, scale));

// ───────────────────────────────────────────────────────────── suscripciones

interface SubscriptionRow {
  id: string;
  workspace_id: string;
  definition_id: string;
  counterparty_id: string;
  name: string;
  plan_name: string | null;
  price_currency: string;
  status: SubscriptionStatus;
  trial_ends_on: string | null;
  scheduled_cancellation_on: string | null;
  cancelled_on: string | null;
  cancellation_reason: string | null;
  cancellation_url: string | null;
  reminders_enabled: boolean;
  reminder_days: number;
  price_tolerance_percent: string;
  next_renewal_on: string | null;
  version: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

const SUBSCRIPTION_COLUMNS = sql`
  s.id, s.workspace_id, s.definition_id, s.counterparty_id, s.name, s.plan_name, s.price_currency, s.status,
  s.trial_ends_on::text AS trial_ends_on, s.scheduled_cancellation_on::text AS scheduled_cancellation_on,
  s.cancelled_on::text AS cancelled_on, s.cancellation_reason, s.cancellation_url, s.reminders_enabled,
  s.reminder_days, s.price_tolerance_percent::text AS price_tolerance_percent,
  s.next_renewal_on::text AS next_renewal_on, s.version,
  ${sql.raw(ISO('s.created_at'))} AS created_at, s.created_by,
  ${sql.raw(ISO('s.updated_at'))} AS updated_at, s.updated_by`;

const toState = (r: SubscriptionRow): SubscriptionState => ({
  id: r.id,
  workspaceId: r.workspace_id,
  definitionId: r.definition_id,
  counterpartyId: r.counterparty_id,
  name: r.name,
  planName: r.plan_name,
  priceCurrency: r.price_currency,
  status: r.status,
  trialEndsOn: r.trial_ends_on,
  scheduledCancellationOn: r.scheduled_cancellation_on,
  cancelledOn: r.cancelled_on,
  cancellationReason: r.cancellation_reason,
  cancellationUrl: r.cancellation_url,
  reminder: { enabled: r.reminders_enabled, daysBefore: Number(r.reminder_days) },
  tolerancePercent: r.price_tolerance_percent,
  nextRenewalOn: r.next_renewal_on,
  version: Number(r.version),
  createdAt: r.created_at,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

interface PriceRow {
  id: string;
  subscription_id: string;
  effective_from: string;
  amount: string;
  currency: string;
  scale: number;
  origin: PriceOrigin;
  supersedes_id: string | null;
  proposal_id: string | null;
}

const toPrice = (r: PriceRow): PriceEntry => ({
  id: r.id,
  effectiveFrom: r.effective_from,
  price: moneyOf(r.amount, r.currency, Number(r.scale)),
  origin: r.origin,
  supersedesId: r.supersedes_id,
  proposalId: r.proposal_id,
});

async function insertPrices(sub: Subscription): Promise<void> {
  const s = sub.snapshot;
  for (const p of sub.addedPrices) {
    await sql`
      INSERT INTO commitments.subscription_price
        (id, workspace_id, subscription_id, effective_from, amount, currency, origin, supersedes_id, proposal_id,
         recorded_at, recorded_by)
      VALUES (${p.id}::uuid, ${s.workspaceId}, ${s.id}::uuid, ${p.effectiveFrom}::date, ${p.price.toFixed()}::numeric,
              ${p.price.currency.code}, ${p.origin}, ${p.supersedesId}::uuid, ${p.proposalId}::uuid,
              ${s.updatedAt}::timestamptz, ${s.updatedBy}::uuid)`.execute(db());
  }
}

async function pricesOf(ids: readonly string[]): Promise<Map<string, PriceEntry[]>> {
  const out = new Map<string, PriceEntry[]>();
  if (ids.length === 0) return out;
  const { rows } = await sql<PriceRow>`
    SELECT p.id, p.subscription_id, p.effective_from::text AS effective_from, p.amount::text AS amount, p.currency,
           c.scale, p.origin, p.supersedes_id, p.proposal_id
      FROM commitments.subscription_price p
      JOIN fx.currency c ON c.code = p.currency
     WHERE p.subscription_id = ANY(${[...ids]}::uuid[])
     ORDER BY p.effective_from, p.recorded_at, p.id`.execute(db());
  for (const r of rows) {
    const list = out.get(r.subscription_id) ?? [];
    list.push(toPrice(r));
    out.set(r.subscription_id, list);
  }
  return out;
}

export class PgSubscriptionRepository implements SubscriptionRepository {
  async insert(sub: Subscription): Promise<void> {
    const s = sub.snapshot;
    await sql`
      INSERT INTO commitments.subscription
        (id, workspace_id, definition_id, counterparty_id, name, plan_name, price_currency, status, trial_ends_on,
         scheduled_cancellation_on, cancelled_on, cancellation_reason, cancellation_url, reminders_enabled,
         reminder_days, price_tolerance_percent, next_renewal_on, version, created_at, created_by, updated_at,
         updated_by)
      VALUES (${s.id}::uuid, ${s.workspaceId}, ${s.definitionId}::uuid, ${s.counterpartyId}::uuid, ${s.name},
              ${s.planName}, ${s.priceCurrency}, ${s.status}, ${s.trialEndsOn}::date,
              ${s.scheduledCancellationOn}::date, ${s.cancelledOn}::date, ${s.cancellationReason},
              ${s.cancellationUrl}, ${s.reminder.enabled}, ${s.reminder.daysBefore}, ${s.tolerancePercent}::numeric,
              ${s.nextRenewalOn}::date, ${s.version}, ${s.createdAt}::timestamptz, ${s.createdBy}::uuid,
              ${s.updatedAt}::timestamptz, ${s.updatedBy}::uuid)`.execute(db());
    await insertPrices(sub);
    sub.markPersisted();
  }

  async findById(
    workspaceId: string,
    id: string,
    options: { readonly lock?: 'update' } = {},
  ): Promise<Subscription | null> {
    const { rows } = await sql<SubscriptionRow>`
      SELECT ${SUBSCRIPTION_COLUMNS}
        FROM commitments.subscription s
       WHERE s.workspace_id = ${workspaceId} AND s.id = ${id}::uuid
       ${options.lock === 'update' ? sql`FOR UPDATE` : sql``}`.execute(db());
    return this.hydrate(rows[0]);
  }

  async findByDefinition(
    workspaceId: string,
    definitionId: string,
    options: { readonly lock?: 'update' } = {},
  ): Promise<Subscription | null> {
    const { rows } = await sql<SubscriptionRow>`
      SELECT ${SUBSCRIPTION_COLUMNS}
        FROM commitments.subscription s
       WHERE s.workspace_id = ${workspaceId} AND s.definition_id = ${definitionId}::uuid
       ${options.lock === 'update' ? sql`FOR UPDATE` : sql``}`.execute(db());
    return this.hydrate(rows[0]);
  }

  private async hydrate(row: SubscriptionRow | undefined): Promise<Subscription | null> {
    if (!row) return null;
    const prices = await pricesOf([row.id]);
    return Subscription.restore(toState(row), prices.get(row.id) ?? []);
  }

  async save(sub: Subscription): Promise<boolean> {
    const s = sub.snapshot;
    const res = await sql`
      UPDATE commitments.subscription
         SET name = ${s.name}, plan_name = ${s.planName}, status = ${s.status}, trial_ends_on = ${s.trialEndsOn}::date,
             scheduled_cancellation_on = ${s.scheduledCancellationOn}::date, cancelled_on = ${s.cancelledOn}::date,
             cancellation_reason = ${s.cancellationReason}, cancellation_url = ${s.cancellationUrl},
             reminders_enabled = ${s.reminder.enabled}, reminder_days = ${s.reminder.daysBefore},
             price_tolerance_percent = ${s.tolerancePercent}::numeric, next_renewal_on = ${s.nextRenewalOn}::date,
             version = ${s.version}, updated_at = ${s.updatedAt}::timestamptz, updated_by = ${s.updatedBy}::uuid
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id}::uuid AND version = ${sub.persistedVersion}`.execute(
      db(),
    );
    if (Number(res.numAffectedRows ?? 0) === 0) return false;
    await insertPrices(sub);
    sub.markPersisted();
    return true;
  }

  async updateNextRenewal(workspaceId: string, id: string, on: string | null): Promise<void> {
    await sql`
      UPDATE commitments.subscription SET next_renewal_on = ${on}::date
       WHERE workspace_id = ${workspaceId} AND id = ${id}::uuid AND next_renewal_on IS DISTINCT FROM ${on}::date`.execute(
      db(),
    );
  }

  async list(workspaceId: string, filter: SubscriptionFilter): Promise<SubscriptionListRow[]> {
    const statuses = filter.statuses ? [...filter.statuses] : null;
    const after = filter.after ?? null;
    const { rows } = await sql<
      SubscriptionRow & {
        v_account_id: string;
        v_currency: string;
        v_cadence: string;
        v_interval: number;
        v_month_days: number[];
        v_rrule: string | null;
      }
    >`
      SELECT ${SUBSCRIPTION_COLUMNS}, v.account_id AS v_account_id, v.currency AS v_currency, v.cadence AS v_cadence,
             v.interval AS v_interval, v.month_days AS v_month_days, v.rrule AS v_rrule
        FROM commitments.subscription s
        JOIN commitments.recurring_definition d ON d.workspace_id = s.workspace_id AND d.id = s.definition_id
        JOIN commitments.recurring_definition_version v
          ON v.definition_id = d.id AND v.version_no = d.current_version_no
       WHERE s.workspace_id = ${workspaceId}
         AND (${statuses}::text[] IS NULL AND s.status <> 'CANCELLED' OR s.status = ANY(${statuses}::text[]))
         AND (${filter.counterpartyId ?? null}::uuid IS NULL OR s.counterparty_id = ${filter.counterpartyId ?? null}::uuid)
         AND (${filter.paymentAccountId ?? null}::uuid IS NULL OR v.account_id = ${filter.paymentAccountId ?? null}::uuid)
         AND (${after?.[0] ?? null}::date IS NULL
              OR (COALESCE(s.next_renewal_on, DATE '9999-12-31'), s.id) > (${after?.[0] ?? null}::date, ${after?.[1] ?? null}::uuid))
       ORDER BY COALESCE(s.next_renewal_on, DATE '9999-12-31'), s.id
       ${filter.limit ? sql`LIMIT ${filter.limit}` : sql``}`.execute(db());
    const prices = await pricesOf(rows.map((r) => r.id));
    return rows.map((r) => ({
      subscription: Subscription.restore(toState(r), prices.get(r.id) ?? []),
      paymentAccountId: r.v_account_id,
      accountCurrency: r.v_currency,
      cadence: r.v_cadence,
      interval: Number(r.v_interval),
      monthDays: (r.v_month_days ?? []).map(Number),
      rrule: r.v_rrule,
    }));
  }

  async idsOpen(workspaceId: string): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      SELECT s.id FROM commitments.subscription s
       WHERE s.workspace_id = ${workspaceId} AND s.status <> 'CANCELLED'
       ORDER BY s.id`.execute(db());
    return rows.map((r) => r.id);
  }
}

// ───────────────────────────────────────────────────────────── propuestas

interface ProposalRow {
  id: string;
  subscription_id: string;
  charge_id: string;
  effective_from: string;
  previous_amount: string;
  proposed_amount: string;
  currency: string;
  scale: number;
  change_percent: string;
  status: ProposalStatus;
  decided_at: string | null;
  decided_by: string | null;
  event_id: string | null;
}

const PROPOSAL_COLUMNS = sql`
  p.id, p.subscription_id, p.charge_id, p.effective_from::text AS effective_from,
  p.previous_amount::text AS previous_amount, p.proposed_amount::text AS proposed_amount, p.currency, c.scale,
  p.change_percent::text AS change_percent, p.status,
  CASE WHEN p.decided_at IS NULL THEN NULL ELSE ${sql.raw(ISO('p.decided_at'))} END AS decided_at,
  p.decided_by, p.event_id`;

const toProposal = (r: ProposalRow): PriceChangeProposal => {
  const scale = Number(r.scale);
  const percent = dec(r.change_percent);
  return {
    id: r.id,
    subscriptionId: r.subscription_id,
    chargeId: r.charge_id,
    effectiveFrom: r.effective_from,
    previousPrice: moneyOf(r.previous_amount, r.currency, scale),
    proposedPrice: moneyOf(r.proposed_amount, r.currency, scale),
    changePercent: `${percent.isNeg() && !percent.isZero() ? '-' : '+'}${percent.abs().toFixed(2)}`,
    status: r.status,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    eventId: r.event_id,
  };
};

const percentValue = (signed: string): string => signed.replace(/^\+/, '');

export class PgProposalRepository implements ProposalRepository {
  async insert(p: PriceChangeProposal): Promise<void> {
    await sql`
      INSERT INTO commitments.subscription_price_proposal
        (id, workspace_id, subscription_id, charge_id, effective_from, previous_amount, proposed_amount, currency,
         change_percent, status, decided_at, decided_by, event_id)
      SELECT ${p.id}::uuid, s.workspace_id, s.id, ${p.chargeId}::uuid, ${p.effectiveFrom}::date,
             ${p.previousPrice.toFixed()}::numeric, ${p.proposedPrice.toFixed()}::numeric,
             ${p.proposedPrice.currency.code}, ${percentValue(p.changePercent)}::numeric, ${p.status},
             ${p.decidedAt}::timestamptz, ${p.decidedBy}::uuid, ${p.eventId}::uuid
        FROM commitments.subscription s WHERE s.id = ${p.subscriptionId}::uuid`.execute(db());
  }

  async findById(
    workspaceId: string,
    subscriptionId: string,
    id: string,
    options: { readonly lock?: 'update' } = {},
  ): Promise<PriceChangeProposal | null> {
    const { rows } = await sql<ProposalRow>`
      SELECT ${PROPOSAL_COLUMNS}
        FROM commitments.subscription_price_proposal p
        JOIN fx.currency c ON c.code = p.currency
       WHERE p.workspace_id = ${workspaceId} AND p.subscription_id = ${subscriptionId}::uuid AND p.id = ${id}::uuid
       ${options.lock === 'update' ? sql`FOR UPDATE OF p` : sql``}`.execute(db());
    return rows[0] ? toProposal(rows[0]) : null;
  }

  async listForSubscription(workspaceId: string, subscriptionId: string): Promise<PriceChangeProposal[]> {
    const { rows } = await sql<ProposalRow>`
      SELECT ${PROPOSAL_COLUMNS}
        FROM commitments.subscription_price_proposal p
        JOIN fx.currency c ON c.code = p.currency
       WHERE p.workspace_id = ${workspaceId} AND p.subscription_id = ${subscriptionId}::uuid
       ORDER BY p.effective_from DESC, p.id`.execute(db());
    return rows.map(toProposal);
  }

  async update(workspaceId: string, p: PriceChangeProposal): Promise<void> {
    await sql`
      UPDATE commitments.subscription_price_proposal
         SET charge_id = ${p.chargeId}::uuid, previous_amount = ${p.previousPrice.toFixed()}::numeric,
             proposed_amount = ${p.proposedPrice.toFixed()}::numeric, change_percent = ${percentValue(p.changePercent)}::numeric,
             status = ${p.status}, decided_at = ${p.decidedAt}::timestamptz, decided_by = ${p.decidedBy}::uuid,
             event_id = ${p.eventId}::uuid
       WHERE workspace_id = ${workspaceId} AND id = ${p.id}::uuid`.execute(db());
  }
}

// ───────────────────────────────────────────────────────────── cargos

interface ChargeRow {
  id: string;
  subscription_id: string;
  occurrence_id: string;
  occurrence_date: string;
  transaction_id: string;
  charged_amount: string;
  charged_currency: string;
  charged_scale: number;
  price_currency_amount: string | null;
  expected_amount: string;
  expected_currency: string;
  expected_scale: number;
  implied_rate: string | null;
  deviation_percent: string | null;
  outcome: ChargeOutcome;
}

const CHARGE_COLUMNS = sql`
  g.id, g.subscription_id, g.occurrence_id, g.occurrence_date::text AS occurrence_date, g.transaction_id,
  g.charged_amount::text AS charged_amount, g.charged_currency, cc.scale AS charged_scale,
  g.price_currency_amount::text AS price_currency_amount, g.expected_amount::text AS expected_amount,
  g.expected_currency, ce.scale AS expected_scale, g.implied_rate::text AS implied_rate,
  g.deviation_percent::text AS deviation_percent, g.outcome`;

const CHARGE_FROM = sql`
  FROM commitments.subscription_charge g
  JOIN fx.currency cc ON cc.code = g.charged_currency
  JOIN fx.currency ce ON ce.code = g.expected_currency`;

/** Tasa implícita a 18 decimales sin ceros finales. */
const trimRate = (value: string): string => dec(value).toFixed();

function toCharge(r: ChargeRow): SubscriptionCharge {
  const deviation = r.deviation_percent === null ? null : dec(r.deviation_percent);
  return {
    id: r.id,
    subscriptionId: r.subscription_id,
    occurrenceId: r.occurrence_id,
    occurrenceDate: r.occurrence_date,
    transactionId: r.transaction_id,
    charged: moneyOf(r.charged_amount, r.charged_currency, Number(r.charged_scale)),
    // El monto del extracto está en la moneda del precio (= la del precio esperado).
    priceCurrencyAmount:
      r.price_currency_amount === null
        ? null
        : moneyOf(r.price_currency_amount, r.expected_currency, Number(r.expected_scale)),
    expectedPrice: moneyOf(r.expected_amount, r.expected_currency, Number(r.expected_scale)),
    impliedRate: r.implied_rate === null ? null : trimRate(r.implied_rate),
    deviationPercent:
      deviation === null
        ? null
        : `${deviation.isNeg() && !deviation.isZero() ? '-' : '+'}${deviation.abs().toFixed(2)}`,
    outcome: r.outcome,
  };
}

const deviationValue = (signed: string | null): string | null =>
  signed === null ? null : signed.replace(/^\+/, '');

export class PgChargeRepository implements ChargeRepository {
  async insertIfAbsent(c: SubscriptionCharge): Promise<boolean> {
    const res = await sql`
      INSERT INTO commitments.subscription_charge
        (id, workspace_id, subscription_id, occurrence_id, occurrence_date, transaction_id, charged_amount,
         charged_currency, price_currency_amount, expected_amount, expected_currency, implied_rate,
         deviation_percent, outcome)
      SELECT ${c.id}::uuid, s.workspace_id, s.id, ${c.occurrenceId}::uuid, ${c.occurrenceDate}::date,
             ${c.transactionId}::uuid, ${c.charged.toFixed()}::numeric, ${c.charged.currency.code},
             ${c.priceCurrencyAmount?.toFixed() ?? null}::numeric, ${c.expectedPrice.toFixed()}::numeric,
             ${c.expectedPrice.currency.code}, ${c.impliedRate}::numeric, ${deviationValue(c.deviationPercent)}::numeric,
             ${c.outcome}
        FROM commitments.subscription s WHERE s.id = ${c.subscriptionId}::uuid
      ON CONFLICT (subscription_id, occurrence_id) WHERE outcome <> 'VOIDED' DO NOTHING`.execute(db());
    return Number(res.numAffectedRows ?? 0) > 0;
  }

  async findById(
    workspaceId: string,
    subscriptionId: string,
    id: string,
  ): Promise<SubscriptionCharge | null> {
    const { rows } = await sql<ChargeRow>`
      SELECT ${CHARGE_COLUMNS} ${CHARGE_FROM}
       WHERE g.workspace_id = ${workspaceId} AND g.subscription_id = ${subscriptionId}::uuid AND g.id = ${id}::uuid`.execute(
      db(),
    );
    return rows[0] ? toCharge(rows[0]) : null;
  }

  async findActiveByOccurrence(
    workspaceId: string,
    subscriptionId: string,
    occurrenceId: string,
  ): Promise<SubscriptionCharge | null> {
    const { rows } = await sql<ChargeRow>`
      SELECT ${CHARGE_COLUMNS} ${CHARGE_FROM}
       WHERE g.workspace_id = ${workspaceId} AND g.subscription_id = ${subscriptionId}::uuid
         AND g.occurrence_id = ${occurrenceId}::uuid AND g.outcome <> 'VOIDED'`.execute(db());
    return rows[0] ? toCharge(rows[0]) : null;
  }

  async list(
    workspaceId: string,
    subscriptionId: string,
    limit: number,
    after?: readonly [string, string],
  ): Promise<SubscriptionCharge[]> {
    const { rows } = await sql<ChargeRow>`
      SELECT ${CHARGE_COLUMNS} ${CHARGE_FROM}
       WHERE g.workspace_id = ${workspaceId} AND g.subscription_id = ${subscriptionId}::uuid
         AND g.outcome <> 'VOIDED'
         AND (${after?.[0] ?? null}::date IS NULL
              OR (g.occurrence_date, g.id) < (${after?.[0] ?? null}::date, ${after?.[1] ?? null}::uuid))
       ORDER BY g.occurrence_date DESC, g.id DESC
       LIMIT ${limit}`.execute(db());
    return rows.map(toCharge);
  }

  async update(workspaceId: string, c: SubscriptionCharge): Promise<void> {
    await sql`
      UPDATE commitments.subscription_charge
         SET price_currency_amount = ${c.priceCurrencyAmount?.toFixed() ?? null}::numeric,
             implied_rate = ${c.impliedRate}::numeric, deviation_percent = ${deviationValue(c.deviationPercent)}::numeric,
             outcome = ${c.outcome}, updated_at = now()
       WHERE workspace_id = ${workspaceId} AND id = ${c.id}::uuid`.execute(db());
  }
}

// ───────────────────────────────────────────────────────────── recordatorios

export class PgReminderRepository implements ReminderRepository {
  async insertIfAbsent(input: {
    readonly workspaceId: string;
    readonly subscriptionId: string;
    readonly kind: 'RENEWAL' | 'TRIAL_END';
    readonly targetDate: string;
    readonly eventId: string;
    readonly emittedAt: string;
  }): Promise<boolean> {
    const res = await sql`
      INSERT INTO commitments.subscription_reminder
        (workspace_id, subscription_id, kind, target_date, emitted_at, event_id)
      VALUES (${input.workspaceId}, ${input.subscriptionId}::uuid, ${input.kind}, ${input.targetDate}::date,
              ${input.emittedAt}::timestamptz, ${input.eventId}::uuid)
      ON CONFLICT (workspace_id, subscription_id, kind, target_date) DO NOTHING`.execute(db());
    return Number(res.numAffectedRows ?? 0) > 0;
  }
}
