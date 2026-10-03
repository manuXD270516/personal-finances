import type { ClassificationLookup } from '@pf/classification/contracts';
import { currentRequestContext, PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { currency as makeCurrency, Money, type Currency } from '@pf/shared-kernel';
import { sql, type Generated, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type {
  CategoryLookupPort,
  CurrencyCatalog,
  IdGenerator,
  TransactionListFilter,
  TransactionRepository,
  UnitOfWork,
} from '../application/ports/index.js';
import {
  normalizeText,
  Transaction,
  type AccountNature,
  type ConversionDetail,
  type AdjustmentDirection,
  type LegRole,
  type PaymentMethod,
  type TransactionKind,
  type TransactionSource,
  type TransactionState,
  type TransactionStatus,
} from '../domain/index.js';
import { insertConversionDetail, loadConversionDetails } from './pg-conversion-details.js';

/** Orden estable de legs al rehidratar (`SOURCE` antes que `TARGET`, `FEE` al final). */
const LEG_ORDER: readonly LegRole[] = ['MAIN', 'SOURCE', 'TARGET', 'FEE'];

/** Clave de comparación de un leg (rol, cuenta, monto exacto, moneda). */
const legKey = (role: string, accountId: string, amount: Money) =>
  `${role}|${accountId}|${amount.toFixed()}|${amount.currency.code}`;

/** Tablas del schema `txn` (fechas como texto, montos NUMERIC como string). */
interface TxnDb {
  'txn.transaction': {
    id: string;
    workspace_id: string;
    kind: TransactionKind;
    status: TransactionStatus;
    transaction_date: string;
    posting_date: string | null;
    account_id: string;
    amount: string;
    currency: string;
    adjustment_direction: AdjustmentDirection | null;
    description: string | null;
    notes: string | null;
    counterparty_id: string | null;
    payment_method: PaymentMethod | null;
    source: TransactionSource;
    external_ref_namespace: string | null;
    external_ref_id: string | null;
    refund_of_transaction_id: string | null;
    adjustment_reason: string | null;
    confirmed_refund_excess: boolean;
    revision: number;
    active_entry_id: string | null;
    voided_at: string | null;
    void_reason: string | null;
    search_text: string;
    version: number;
    created_at: Generated<string>;
    updated_at: Generated<string>;
  };
  'txn.transaction_leg': {
    id: string;
    workspace_id: string;
    transaction_id: string;
    account_id: string;
    account_nature: AccountNature;
    role: LegRole;
    amount: string;
    currency: string;
    transaction_date: string;
    revision: number;
    superseded_in_revision: number | null;
  };
  'txn.transaction_split': {
    id: string;
    workspace_id: string;
    transaction_id: string;
    position: number;
    amount: string;
    currency: string;
    category_id: string;
    counterparty_id: string | null;
    memo: string | null;
    revision: number;
    superseded_in_revision: number | null;
  };
  'txn.split_tag': { workspace_id: string; split_id: string; tag_id: string };
  'txn.transaction_journal_link': {
    workspace_id: string;
    transaction_id: string;
    revision: number;
    journal_entry_id: string;
    link_type: 'POSTED' | 'REVERSAL';
  };
  'fx.currency': { code: string; scale: number; is_active: boolean };
}

type TxRow = Omit<TxnDb['txn.transaction'], 'created_at' | 'updated_at'> & {
  scale: number;
  created_at: string | null;
  updated_at: string | null;
};

const db = (): Kysely<TxnDb> => unitOfWorkKysely<TxnDb>();
const iso = (column: string) =>
  sql<string | null>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const txColumns = [
  't.id',
  't.workspace_id',
  't.kind',
  't.status',
  't.account_id',
  't.currency',
  't.adjustment_direction',
  't.description',
  't.notes',
  't.counterparty_id',
  't.payment_method',
  't.source',
  't.external_ref_namespace',
  't.external_ref_id',
  't.refund_of_transaction_id',
  't.adjustment_reason',
  't.confirmed_refund_excess',
  't.revision',
  't.active_entry_id',
  't.void_reason',
  't.search_text',
  't.version',
  sql<string>`t.amount::text`.as('amount'),
  sql<string>`t.transaction_date::text`.as('transaction_date'),
  sql<string | null>`t.posting_date::text`.as('posting_date'),
  iso('t.voided_at').as('voided_at'),
  iso('t.created_at').as('created_at'),
  iso('t.updated_at').as('updated_at'),
  'c.scale',
] as const;

const searchText = (s: TransactionState): string => normalizeText(`${s.description ?? ''} ${s.notes ?? ''}`);

function txRow(s: TransactionState): Omit<TxnDb['txn.transaction'], 'created_at' | 'updated_at'> {
  return {
    id: s.id,
    workspace_id: s.workspaceId,
    kind: s.kind,
    status: s.status,
    transaction_date: s.businessDate,
    posting_date: s.postingDate,
    account_id: s.accountId,
    amount: s.amount.toFixed(),
    currency: s.amount.currency.code,
    adjustment_direction: s.direction,
    description: s.description,
    notes: s.notes,
    counterparty_id: s.counterpartyId,
    payment_method: s.paymentMethod,
    source: s.source,
    external_ref_namespace: s.externalRef?.namespace ?? null,
    external_ref_id: s.externalRef?.id ?? null,
    refund_of_transaction_id: s.refundOfTransactionId,
    adjustment_reason: s.adjustmentReason,
    confirmed_refund_excess: s.confirmedRefundExcess,
    revision: s.revision,
    active_entry_id: s.activeEntryId,
    voided_at: s.voidedAt,
    void_reason: s.voidReason,
    search_text: searchText(s),
    version: s.version,
  };
}

/**
 * Repositorio Kysely de `txn.*` (tareas 4.1–4.2). Splits y legs vigentes tienen `superseded_in_revision IS NULL`; al
 * reemplazar la lista (o repostear) los anteriores se marcan con la revisión que los supersede, nunca se borran.
 * Optimistic locking con `UPDATE … WHERE version = :persisted`.
 */
export class PgTransactionRepository implements TransactionRepository {
  async insert(tx: Transaction): Promise<void> {
    await db().insertInto('txn.transaction').values(txRow(tx.snapshot)).execute();
    await this.writeChildren(tx);
    await this.writeConversion(tx);
  }

  /** `ConversionDetail` de la revisión vigente (inmutable; una revisión nueva inserta una fila nueva). */
  private async writeConversion(tx: Transaction): Promise<void> {
    const s = tx.snapshot;
    if (s.conversion) await insertConversionDetail(s.workspaceId, s.id, s.conversion);
  }

  async update(tx: Transaction): Promise<boolean> {
    const s = tx.snapshot;
    const result = await db()
      .updateTable('txn.transaction')
      .set({ ...txRow(s), updated_at: sql<string>`now()` })
      .where('workspace_id', '=', s.workspaceId)
      .where('id', '=', s.id)
      .where('version', '=', tx.persistedVersion ?? -1)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) return false;
    await this.writeChildren(tx);
    await this.writeConversion(tx);
    return true;
  }

  private async writeChildren(tx: Transaction): Promise<void> {
    const s = tx.snapshot;
    const k = db();
    const currentIds = s.splits.map((x) => x.id);
    // Splits que ya no están en la lista vigente quedan supersedidos por la revisión actual.
    let supersede = k
      .updateTable('txn.transaction_split')
      .set({ superseded_in_revision: s.revision })
      .where('workspace_id', '=', s.workspaceId)
      .where('transaction_id', '=', s.id)
      .where('superseded_in_revision', 'is', null);
    if (currentIds.length > 0) supersede = supersede.where('id', 'not in', currentIds);
    await supersede.execute();
    for (const [position, split] of s.splits.entries()) {
      await k
        .insertInto('txn.transaction_split')
        .values({
          id: split.id,
          workspace_id: s.workspaceId,
          transaction_id: s.id,
          position,
          amount: split.amount.toFixed(),
          currency: split.amount.currency.code,
          category_id: split.categoryId,
          counterparty_id: split.counterpartyId,
          memo: split.memo,
          revision: s.revision,
          superseded_in_revision: null,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            position,
            amount: split.amount.toFixed(),
            category_id: split.categoryId,
            counterparty_id: split.counterpartyId,
            memo: split.memo,
          }),
        )
        .execute();
      await k
        .deleteFrom('txn.split_tag')
        .where('workspace_id', '=', s.workspaceId)
        .where('split_id', '=', split.id)
        .execute();
      if (split.tagIds.length > 0) {
        await k
          .insertInto('txn.split_tag')
          .values(split.tagIds.map((tag_id) => ({ workspace_id: s.workspaceId, split_id: split.id, tag_id })))
          .execute();
      }
    }
    // Legs: si cambió la revisión (o es nueva), se supersede la anterior y se inserta la vigente. Una transferencia
    // tiene dos legs (`SOURCE`/`TARGET`, add-transfers); se emparejan por `role`.
    const existing = await k
      .selectFrom('txn.transaction_leg')
      .select([
        'id',
        'revision',
        'role',
        'account_id',
        'currency',
        sql<string>`amount::text`.as('amount'),
        sql<string>`transaction_date::text`.as('transaction_date'),
      ])
      .where('workspace_id', '=', s.workspaceId)
      .where('transaction_id', '=', s.id)
      .where('superseded_in_revision', 'is', null)
      .execute();
    if (s.legs.length === 0) return;
    // Multiconjunto de legs (una conversión puede tener varios `FEE`): mismos rol, cuenta, monto, moneda y fecha.
    const wanted = s.legs.map((l) => legKey(l.role, l.accountId, l.amount)).sort();
    const current = existing
      .map((e) => {
        const leg = s.legs.find((l) => l.amount.currency.code === e.currency);
        return leg ? legKey(e.role, e.account_id, Money.parse(e.amount, leg.amount.currency)) : `?${e.id}`;
      })
      .sort();
    const same =
      existing.length === s.legs.length &&
      existing.every((e) => e.transaction_date === s.businessDate) &&
      wanted.every((w, i) => w === current[i]);
    if (same) return;
    if (existing.length > 0) {
      await k
        .updateTable('txn.transaction_leg')
        .set({ superseded_in_revision: s.revision })
        .where('workspace_id', '=', s.workspaceId)
        .where('transaction_id', '=', s.id)
        .where('superseded_in_revision', 'is', null)
        .where('revision', '<', s.revision)
        .execute();
      // Edición de un PENDING (sin repostear): misma revisión ⇒ se actualiza en su lugar (una conversión siempre
      // incrementa la revisión: sus legs nunca se actualizan in situ).
      for (const leg of s.kind === 'CONVERSION' ? [] : s.legs) {
        await k
          .updateTable('txn.transaction_leg')
          .set({
            account_id: leg.accountId,
            account_nature: leg.nature,
            amount: leg.amount.toFixed(),
            transaction_date: s.businessDate,
          })
          .where('workspace_id', '=', s.workspaceId)
          .where('transaction_id', '=', s.id)
          .where('role', '=', leg.role)
          .where('superseded_in_revision', 'is', null)
          .where('revision', '=', s.revision)
          .execute();
      }
      if (existing.some((e) => e.revision === s.revision)) return;
    }
    await k
      .insertInto('txn.transaction_leg')
      .values(
        s.legs.map((leg) => ({
          id: uuidv7(),
          workspace_id: s.workspaceId,
          transaction_id: s.id,
          account_id: leg.accountId,
          account_nature: leg.nature,
          role: leg.role,
          amount: leg.amount.toFixed(),
          currency: leg.amount.currency.code,
          transaction_date: s.businessDate,
          revision: s.revision,
          superseded_in_revision: null,
        })),
      )
      .execute();
  }

  async findById(
    workspaceId: string,
    id: string,
    options: { readonly forUpdate?: boolean } = {},
  ): Promise<Transaction | null> {
    let q = db()
      .selectFrom('txn.transaction as t')
      .innerJoin('fx.currency as c', 'c.code', 't.currency')
      .select(txColumns)
      .where('t.workspace_id', '=', workspaceId)
      .where('t.id', '=', id);
    if (options.forUpdate) q = q.forUpdate('t');
    const row = await q.executeTakeFirst();
    if (!row) return null;
    return (await this.hydrate(workspaceId, [row as TxRow]))[0] ?? null;
  }

  async list(
    workspaceId: string,
    filter: TransactionListFilter,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<Transaction[]> {
    let q = db()
      .selectFrom('txn.transaction as t')
      .innerJoin('fx.currency as c', 'c.code', 't.currency')
      .select(txColumns)
      .where('t.workspace_id', '=', workspaceId);
    if (filter.accountIds?.length) {
      // Una transferencia aparece en ambas cuentas (add-transfers decisión 8): se busca también por legs vigentes.
      const accountIds = [...filter.accountIds];
      q = q.where((eb) =>
        eb.or([
          eb('t.account_id', 'in', accountIds),
          eb.exists(
            eb
              .selectFrom('txn.transaction_leg as fl')
              .select('fl.id')
              .whereRef('fl.workspace_id', '=', 't.workspace_id')
              .whereRef('fl.transaction_id', '=', 't.id')
              .where('fl.superseded_in_revision', 'is', null)
              .where('fl.account_id', 'in', accountIds),
          ),
        ]),
      );
    }
    if (filter.kinds?.length) q = q.where('t.kind', 'in', [...filter.kinds]);
    if (filter.statuses?.length) q = q.where('t.status', 'in', [...filter.statuses]);
    if (filter.sources?.length) q = q.where('t.source', 'in', [...filter.sources]);
    if (filter.paymentMethods?.length) q = q.where('t.payment_method', 'in', [...filter.paymentMethods]);
    if (filter.currency) q = q.where('t.currency', '=', filter.currency);
    if (filter.targetCurrency) {
      const target = filter.targetCurrency;
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('txn.transaction_leg as tl')
            .select('tl.id')
            .whereRef('tl.workspace_id', '=', 't.workspace_id')
            .whereRef('tl.transaction_id', '=', 't.id')
            .where('tl.superseded_in_revision', 'is', null)
            .where('tl.role', '=', 'TARGET')
            .where('tl.currency', '=', target),
        ),
      );
    }
    if (filter.dateFrom) q = q.where(sql`t.transaction_date`, '>=', sql`${filter.dateFrom}::date`);
    if (filter.dateTo) q = q.where(sql`t.transaction_date`, '<=', sql`${filter.dateTo}::date`);
    if (filter.amountMin) q = q.where(sql`t.amount`, '>=', sql`${filter.amountMin}::numeric`);
    if (filter.amountMax) q = q.where(sql`t.amount`, '<=', sql`${filter.amountMax}::numeric`);
    if (filter.q) q = q.where('t.search_text', 'like', `%${filter.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    if (filter.counterpartyIds?.length) {
      const ids = [...filter.counterpartyIds];
      q = q.where((eb) =>
        eb.or([
          eb('t.counterparty_id', 'in', ids),
          eb.exists(
            eb
              .selectFrom('txn.transaction_split as s')
              .select('s.id')
              .whereRef('s.transaction_id', '=', 't.id')
              .whereRef('s.workspace_id', '=', 't.workspace_id')
              .where('s.superseded_in_revision', 'is', null)
              .where('s.counterparty_id', 'in', ids),
          ),
        ]),
      );
    }
    if (filter.categoryIds?.length) {
      const ids = [...filter.categoryIds];
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('txn.transaction_split as s')
            .select('s.id')
            .whereRef('s.transaction_id', '=', 't.id')
            .whereRef('s.workspace_id', '=', 't.workspace_id')
            .where('s.superseded_in_revision', 'is', null)
            .where('s.category_id', 'in', ids),
        ),
      );
    }
    if (filter.tagIds?.length) {
      const ids = [...filter.tagIds];
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('txn.transaction_split as s')
            .innerJoin('txn.split_tag as st', (j) =>
              j.onRef('st.split_id', '=', 's.id').onRef('st.workspace_id', '=', 's.workspace_id'),
            )
            .select('s.id')
            .whereRef('s.transaction_id', '=', 't.id')
            .whereRef('s.workspace_id', '=', 't.workspace_id')
            .where('s.superseded_in_revision', 'is', null)
            .where('st.tag_id', 'in', ids),
        ),
      );
    }
    const desc = filter.sort.startsWith('-');
    const dir = desc ? 'desc' : 'asc';
    const column = filter.sort.endsWith('amount')
      ? 't.amount'
      : filter.sort.endsWith('createdAt')
        ? 't.created_at'
        : 't.transaction_date';
    const rows = await q
      .orderBy(column, dir)
      .orderBy('t.id', dir)
      .offset(page.offset)
      .limit(page.limit)
      .execute();
    return this.hydrate(workspaceId, rows as TxRow[]);
  }

  async duplicateCandidates(
    workspaceId: string,
    probe: { readonly accountId: string; readonly amount: Money; readonly from: string; readonly to: string },
  ): Promise<TransactionState[]> {
    const rows = await db()
      .selectFrom('txn.transaction as t')
      .innerJoin('fx.currency as c', 'c.code', 't.currency')
      .select(txColumns)
      .where('t.workspace_id', '=', workspaceId)
      .where('t.account_id', '=', probe.accountId)
      .where('t.currency', '=', probe.amount.currency.code)
      .where(sql`t.amount`, '=', sql`${probe.amount.toFixed()}::numeric`)
      .where('t.status', '<>', 'VOIDED')
      .where(sql`t.transaction_date`, '>=', sql`${probe.from}::date`)
      .where(sql`t.transaction_date`, '<=', sql`${probe.to}::date`)
      .limit(50)
      .execute();
    return (await this.hydrate(workspaceId, rows as TxRow[])).map((t) => t.snapshot);
  }

  async refundedTotal(workspaceId: string, originalId: string): Promise<string> {
    const row = await db()
      .selectFrom('txn.transaction')
      .select(sql<string>`COALESCE(sum(amount), 0)::text`.as('total'))
      .where('workspace_id', '=', workspaceId)
      .where('refund_of_transaction_id', '=', originalId)
      .where('status', '<>', 'VOIDED')
      .executeTakeFirstOrThrow();
    return row.total;
  }

  async linkEntry(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly revision: number;
    readonly journalEntryId: string;
    readonly linkType: 'POSTED' | 'REVERSAL';
  }): Promise<void> {
    await db()
      .insertInto('txn.transaction_journal_link')
      .values({
        workspace_id: input.workspaceId,
        transaction_id: input.transactionId,
        revision: input.revision,
        journal_entry_id: input.journalEntryId,
        link_type: input.linkType,
      })
      .execute();
  }

  async postedEntriesByRevision(workspaceId: string, transactionId: string): Promise<Map<number, string>> {
    const rows = await db()
      .selectFrom('txn.transaction_journal_link')
      .select(['revision', 'journal_entry_id'])
      .where('workspace_id', '=', workspaceId)
      .where('transaction_id', '=', transactionId)
      .where('link_type', '=', 'POSTED')
      .execute();
    return new Map(rows.map((r) => [Number(r.revision), r.journal_entry_id]));
  }

  async conversionRevisions(
    workspaceId: string,
    transactionId: string,
  ): Promise<{ readonly detail: ConversionDetail; readonly createdAt: string | null }[]> {
    return (await loadConversionDetails(workspaceId, [transactionId])).get(transactionId) ?? [];
  }

  async linkedEntries(workspaceId: string, transactionId: string): Promise<string[]> {
    const rows = await db()
      .selectFrom('txn.transaction_journal_link')
      .select('journal_entry_id')
      .where('workspace_id', '=', workspaceId)
      .where('transaction_id', '=', transactionId)
      .orderBy('revision')
      .execute();
    return rows.map((r) => r.journal_entry_id);
  }

  private async hydrate(workspaceId: string, rows: readonly TxRow[]): Promise<Transaction[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const k = db();
    const splits = await k
      .selectFrom('txn.transaction_split as s')
      .select([
        's.id',
        's.transaction_id',
        's.position',
        's.category_id',
        's.counterparty_id',
        's.memo',
        's.currency',
        sql<number>`(SELECT c.scale FROM fx.currency c WHERE c.code = s.currency)`.as('scale'),
        sql<string>`s.amount::text`.as('amount'),
        sql<string[]>`COALESCE((SELECT array_agg(st.tag_id::text ORDER BY st.tag_id) FROM txn.split_tag st
           WHERE st.workspace_id = s.workspace_id AND st.split_id = s.id), '{}')`.as('tag_ids'),
      ])
      .where('s.workspace_id', '=', workspaceId)
      .where('s.transaction_id', 'in', ids)
      .where('s.superseded_in_revision', 'is', null)
      .orderBy('s.position')
      .execute();
    const legs = await k
      .selectFrom('txn.transaction_leg as l')
      .select([
        'l.transaction_id',
        'l.account_id',
        'l.account_nature',
        'l.role',
        'l.currency',
        sql<number>`(SELECT c.scale FROM fx.currency c WHERE c.code = l.currency)`.as('scale'),
        sql<string>`l.amount::text`.as('amount'),
      ])
      .where('l.workspace_id', '=', workspaceId)
      .where('l.transaction_id', 'in', ids)
      .where('l.superseded_in_revision', 'is', null)
      .execute();
    const conversions = await loadConversionDetails(
      workspaceId,
      rows.filter((r) => r.kind === 'CONVERSION').map((r) => r.id),
      new Map(rows.map((r) => [r.id, r.revision])),
    );
    const parseIn = (v: string, code: string, scale: number) =>
      Money.parse(v, makeCurrency(code, Number(scale)));
    return rows.map((r) => {
      const ccy: Currency = makeCurrency(r.currency, Number(r.scale));
      const money = (v: string) => Money.parse(v, ccy);
      return Transaction.rehydrate({
        id: r.id,
        workspaceId: r.workspace_id,
        kind: r.kind,
        status: r.status,
        businessDate: r.transaction_date,
        postingDate: r.posting_date,
        accountId: r.account_id,
        amount: money(r.amount),
        direction: r.adjustment_direction,
        description: r.description,
        notes: r.notes,
        counterpartyId: r.counterparty_id,
        paymentMethod: r.payment_method,
        source: r.source,
        externalRef:
          r.external_ref_namespace && r.external_ref_id
            ? { namespace: r.external_ref_namespace, id: r.external_ref_id }
            : null,
        refundOfTransactionId: r.refund_of_transaction_id,
        adjustmentReason: r.adjustment_reason,
        confirmedRefundExcess: r.confirmed_refund_excess,
        legs: legs
          .filter((l) => l.transaction_id === r.id)
          .map((l) => ({
            accountId: l.account_id,
            nature: l.account_nature,
            amount: parseIn(l.amount, l.currency, l.scale),
            role: l.role,
          }))
          .sort((a, b) => LEG_ORDER.indexOf(a.role) - LEG_ORDER.indexOf(b.role)),
        splits: splits
          .filter((s) => s.transaction_id === r.id)
          .map((s) => ({
            id: s.id,
            amount: parseIn(s.amount, s.currency, s.scale),
            categoryId: s.category_id,
            counterpartyId: s.counterparty_id,
            tagIds: s.tag_ids,
            memo: s.memo,
          })),
        revision: r.revision,
        version: r.version,
        activeEntryId: r.active_entry_id,
        voidedAt: r.voided_at,
        voidReason: r.void_reason,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        conversion: conversions.get(r.id)?.at(-1)?.detail ?? null,
      });
    });
  }
}

export const pgCurrencyCatalog: CurrencyCatalog = {
  async scaleOf(code) {
    const row = await db()
      .selectFrom('fx.currency')
      .select(['scale', 'is_active'])
      .where('code', '=', code)
      .executeTakeFirst();
    return row && row.is_active ? Number(row.scale) : null;
  },
};

const actorUserId = (): string => {
  const actor = currentRequestContext()?.actor;
  return actor && actor.type === 'USER' ? actor.userId : '';
};

/** Adaptador sobre la API pública de CLASSIFICATION (misma transacción del comando). */
export class ClassificationCategoryLookup implements CategoryLookupPort {
  constructor(private readonly lookup: ClassificationLookup) {}

  uncategorized(workspaceId: string, kind: 'EXPENSE' | 'INCOME'): Promise<string | null> {
    return this.lookup.systemCategoryId({
      userId: actorUserId(),
      workspaceId,
      systemCode: kind === 'INCOME' ? 'UNCATEGORIZED_INCOME' : 'UNCATEGORIZED',
    });
  }

  fees(workspaceId: string): Promise<string | null> {
    return this.lookup.systemCategoryId({ userId: actorUserId(), workspaceId, systemCode: 'FEES' });
  }

  withDescendants(workspaceId: string, categoryIds: readonly string[]): Promise<string[]> {
    return this.lookup.categoryIdsWithDescendants({ userId: actorUserId(), workspaceId, categoryIds });
  }
}

/** Unidad de trabajo: reutiliza la transacción en curso (idempotencia/orquestación) o abre una con RLS del workspace. */
export class PgTransactionsUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const actor = currentRequestContext()?.actor;
    const userId = actor && actor.type === 'USER' ? actor.userId : null;
    return this.uow.run({ userId, workspaceId }, fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };
