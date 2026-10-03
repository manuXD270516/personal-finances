import { unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { currency as makeCurrency, Money, Rate, type Currency } from '@pf/shared-kernel';
import { sql, type Kysely } from 'kysely';
import { freezeDetail, type ConversionDetail, type ConversionFeeType } from '../domain/index.js';

/** Tablas `txn.conversion_detail` / `txn.conversion_fee` (WS-RO: solo SELECT e INSERT, INV-011). */
interface ConversionDb {
  'txn.conversion_detail': {
    transaction_id: string;
    revision: number;
    workspace_id: string;
    source_account_id: string;
    target_account_id: string;
    source_amount: string;
    source_currency: string;
    converted_source_amount: string;
    gross_target_amount: string;
    target_amount: string;
    target_currency: string;
    quoted_base: string | null;
    quoted_quote: string | null;
    quoted_rate: string | null;
    effective_base: string;
    effective_quote: string;
    effective_rate: string;
    reference_exchange_rate_id: string | null;
    reference_base: string | null;
    reference_quote: string | null;
    reference_rate: string | null;
    reference_source: string | null;
    reference_rate_type: string | null;
    reference_as_of: string | null;
    spread_pct: string | null;
    spread_amount: string | null;
    spread_currency: string | null;
    quoted_rate_deviation: string | null;
    provider_counterparty_id: string | null;
    provider_name: string | null;
    external_ref: string | null;
    executed_at: string;
  };
  'txn.conversion_fee': {
    id: string;
    workspace_id: string;
    transaction_id: string;
    revision: number;
    fee_no: number;
    fee_type: ConversionFeeType;
    amount: string;
    currency: string;
    paid_from_account_id: string | null;
    split_id: string;
  };
  'fx.currency': { code: string; scale: number };
}

const db = (): Kysely<ConversionDb> => unitOfWorkKysely<ConversionDb>();
const iso = (column: string) =>
  sql<string | null>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Inserta el `ConversionDetail` de la revisión (y sus fees) si aún no existe: el detalle es inmutable, nunca se
 * actualiza ni se borra; una edición inserta la revisión nueva (FR-TRANSACTIONS-024).
 */
export async function insertConversionDetail(
  workspaceId: string,
  transactionId: string,
  d: ConversionDetail,
) {
  const k = db();
  const exists = await k
    .selectFrom('txn.conversion_detail')
    .select('revision')
    .where('workspace_id', '=', workspaceId)
    .where('transaction_id', '=', transactionId)
    .where('revision', '=', d.revision)
    .executeTakeFirst();
  if (exists) return;
  await k
    .insertInto('txn.conversion_detail')
    .values({
      transaction_id: transactionId,
      revision: d.revision,
      workspace_id: workspaceId,
      source_account_id: d.sourceAccountId,
      target_account_id: d.targetAccountId,
      source_amount: d.sourceAmount.toFixed(),
      source_currency: d.sourceAmount.currency.code,
      converted_source_amount: d.convertedSourceAmount.toFixed(),
      gross_target_amount: d.grossTargetAmount.toFixed(),
      target_amount: d.targetAmount.toFixed(),
      target_currency: d.targetAmount.currency.code,
      quoted_base: d.quotedRate?.base.code ?? null,
      quoted_quote: d.quotedRate?.quote.code ?? null,
      quoted_rate: d.quotedRate ? d.quotedRate.value.toFixed() : null,
      effective_base: d.effectiveRate.base.code,
      effective_quote: d.effectiveRate.quote.code,
      effective_rate: d.effectiveRate.toPersisted(),
      reference_exchange_rate_id: d.referenceRate?.fxRateId ?? null,
      reference_base: d.referenceRate?.rate.base.code ?? null,
      reference_quote: d.referenceRate?.rate.quote.code ?? null,
      reference_rate: d.referenceRate ? d.referenceRate.rate.value.toFixed() : null,
      reference_source: d.referenceRate?.source ?? null,
      reference_rate_type: d.referenceRate?.rateType ?? null,
      reference_as_of: d.referenceRate?.asOf ?? null,
      spread_pct: d.spread?.percentage ?? null,
      spread_amount: d.spread ? d.spread.amount.toFixed() : null,
      spread_currency: d.spread?.amount.currency.code ?? null,
      quoted_rate_deviation: d.quotedRateDeviation ? d.quotedRateDeviation.toFixed() : null,
      provider_counterparty_id: d.provider.counterpartyId,
      provider_name: d.provider.name,
      external_ref: d.externalRef,
      executed_at: d.executedAt,
    })
    .execute();
  if (d.fees.length > 0) {
    await k
      .insertInto('txn.conversion_fee')
      .values(
        d.fees.map((f) => ({
          id: uuidv7(),
          workspace_id: workspaceId,
          transaction_id: transactionId,
          revision: d.revision,
          fee_no: f.feeNo,
          fee_type: f.type,
          amount: f.amount.toFixed(),
          currency: f.amount.currency.code,
          paid_from_account_id: f.paidFromAccountId,
          split_id: f.splitId,
        })),
      )
      .execute();
  }
}

/**
 * Detalles de conversión de las transacciones dadas: todas las revisiones (`allRevisions`) o solo la vigente (la mayor
 * revisión ≤ `maxRevision[id]`). Devuelve `createdAt` de cada revisión para el historial.
 */
export async function loadConversionDetails(
  workspaceId: string,
  transactionIds: readonly string[],
  maxRevision?: ReadonlyMap<string, number>,
): Promise<Map<string, { readonly detail: ConversionDetail; readonly createdAt: string | null }[]>> {
  const out = new Map<string, { detail: ConversionDetail; createdAt: string | null }[]>();
  if (transactionIds.length === 0) return out;
  const k = db();
  const rows = await k
    .selectFrom('txn.conversion_detail as d')
    .select([
      'd.transaction_id',
      'd.revision',
      'd.source_account_id',
      'd.target_account_id',
      'd.source_currency',
      'd.target_currency',
      'd.quoted_base',
      'd.quoted_quote',
      'd.effective_base',
      'd.effective_quote',
      'd.reference_exchange_rate_id',
      'd.reference_base',
      'd.reference_quote',
      'd.reference_source',
      'd.reference_rate_type',
      'd.spread_currency',
      'd.provider_counterparty_id',
      'd.provider_name',
      'd.external_ref',
      sql<string>`d.source_amount::text`.as('source_amount'),
      sql<string>`d.converted_source_amount::text`.as('converted_source_amount'),
      sql<string>`d.gross_target_amount::text`.as('gross_target_amount'),
      sql<string>`d.target_amount::text`.as('target_amount'),
      sql<string | null>`trim_scale(d.quoted_rate)::text`.as('quoted_rate'),
      sql<string>`d.effective_rate::text`.as('effective_rate'),
      sql<string | null>`trim_scale(d.reference_rate)::text`.as('reference_rate'),
      sql<string | null>`d.spread_pct::text`.as('spread_pct'),
      sql<string | null>`d.spread_amount::text`.as('spread_amount'),
      sql<string | null>`d.quoted_rate_deviation::text`.as('quoted_rate_deviation'),
      iso('d.reference_as_of').as('reference_as_of'),
      iso('d.executed_at').as('executed_at'),
      iso('d.created_at').as('created_at'),
    ])
    .where('d.workspace_id', '=', workspaceId)
    .where('d.transaction_id', 'in', [...transactionIds])
    .orderBy('d.revision')
    .execute();
  const fees = await k
    .selectFrom('txn.conversion_fee as f')
    .select([
      'f.transaction_id',
      'f.revision',
      'f.fee_no',
      'f.fee_type',
      'f.currency',
      'f.paid_from_account_id',
      'f.split_id',
      sql<string>`f.amount::text`.as('amount'),
    ])
    .where('f.workspace_id', '=', workspaceId)
    .where('f.transaction_id', 'in', [...transactionIds])
    .orderBy('f.fee_no')
    .execute();
  const codes = new Set<string>();
  for (const r of rows) {
    for (const c of [r.source_currency, r.target_currency, r.quoted_base, r.quoted_quote, r.reference_base]) {
      if (c) codes.add(c);
    }
  }
  for (const f of fees) codes.add(f.currency);
  const scales = new Map<string, Currency>();
  if (codes.size > 0) {
    const cur = await k
      .selectFrom('fx.currency')
      .select(['code', 'scale'])
      .where('code', 'in', [...codes])
      .execute();
    for (const c of cur) scales.set(c.code, makeCurrency(c.code, Number(c.scale)));
  }
  const ccy = (code: string): Currency => {
    const c = scales.get(code);
    if (!c) throw new Error(`currency ${code} not in fx.currency`);
    return c;
  };
  for (const r of rows) {
    const limit = maxRevision?.get(r.transaction_id);
    if (limit !== undefined && r.revision > limit) continue;
    const money = (v: string, code: string) => Money.parse(v, ccy(code));
    const detail = freezeDetail({
      revision: r.revision,
      sourceAccountId: r.source_account_id,
      targetAccountId: r.target_account_id,
      sourceAmount: money(r.source_amount, r.source_currency),
      convertedSourceAmount: money(r.converted_source_amount, r.source_currency),
      grossTargetAmount: money(r.gross_target_amount, r.target_currency),
      targetAmount: money(r.target_amount, r.target_currency),
      quotedRate:
        r.quoted_rate && r.quoted_base && r.quoted_quote
          ? Rate.of(ccy(r.quoted_base), ccy(r.quoted_quote), r.quoted_rate)
          : null,
      effectiveRate: Rate.of(ccy(r.effective_base), ccy(r.effective_quote), r.effective_rate),
      referenceRate:
        r.reference_exchange_rate_id && r.reference_rate && r.reference_base && r.reference_quote
          ? {
              fxRateId: r.reference_exchange_rate_id,
              rate: Rate.of(ccy(r.reference_base), ccy(r.reference_quote), r.reference_rate),
              rateType: r.reference_rate_type,
              source: r.reference_source ?? 'MANUAL',
              asOf: r.reference_as_of,
            }
          : null,
      spread:
        r.spread_pct !== null && r.spread_amount !== null && r.spread_currency
          ? { percentage: r.spread_pct, amount: money(r.spread_amount, r.spread_currency) }
          : null,
      quotedRateDeviation:
        r.quoted_rate_deviation !== null ? money(r.quoted_rate_deviation, r.target_currency) : null,
      fees: fees
        .filter((f) => f.transaction_id === r.transaction_id && f.revision === r.revision)
        .map((f) => ({
          feeNo: Number(f.fee_no),
          type: f.fee_type,
          amount: money(f.amount, f.currency),
          paidFromAccountId: f.paid_from_account_id,
          splitId: f.split_id,
        })),
      provider: { counterpartyId: r.provider_counterparty_id, name: r.provider_name },
      executedAt: r.executed_at as string,
      externalRef: r.external_ref,
    });
    const list = out.get(r.transaction_id) ?? [];
    list.push({ detail, createdAt: r.created_at });
    out.set(r.transaction_id, list);
  }
  return out;
}
