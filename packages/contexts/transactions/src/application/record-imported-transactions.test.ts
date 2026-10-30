import { currency, DomainError, Money } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ImportedClassificationDto,
  importExternalNamespace,
  IMPORT_ROW_NAMESPACE,
  type ImportedTransactionRowDto,
} from '../contracts/index.js';
import { ConversionsService } from './conversions.service.js';
import type { ImportedRefReader } from './ports/index.js';
import { RecordImportedConversions } from './record-imported-conversions.js';
import { RecordImportedTransactions } from './record-imported-transactions.js';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService } from './transactions.service.js';

const BOB = currency('BOB', 2);
const WS = 'ws-1';
const ACCOUNT = 'bank-a';
const COUNTER = 'bank-b';
const WALLET = 'wallet-usdt';
const ACTOR = 'user-ana';
const OFX = importExternalNamespace('OFX');

const row = (n: number, over: Partial<ImportedTransactionRowDto> = {}): ImportedTransactionRowDto => ({
  rowRef: `row-${n}`,
  date: '2026-10-02',
  direction: 'OUT',
  amount: { amount: '18.00', currency: 'BOB' },
  description: 'PAGO QR CAFE',
  externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: `fp-${n}` },
  ...over,
});

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: ACCOUNT, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: COUNTER, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: WALLET, currency: 'USDT', nature: 'ASSET', status: 'ACTIVE' },
    ],
  });
  mem.addRate({
    id: 'R-usdt',
    base: 'USDT',
    quote: 'BOB',
    value: '6.95',
    rateType: 'P2P',
    asOf: '2026-09-29T19:00:00Z',
  });
  /** Lector de referencias sobre el estado en memoria: transacciones no anuladas de la cuenta. */
  const refs: ImportedRefReader & { locks: number } = {
    locks: 0,
    async lockAccount() {
      this.locks += 1;
    },
    async existingByRefs(input) {
      const found = new Map<string, string>();
      for (const tx of mem.state.txs.values()) {
        if (
          (tx.accountId === input.accountId || tx.legs.some((l) => l.accountId === input.accountId)) &&
          tx.status !== 'VOIDED' &&
          tx.externalRef?.namespace === input.namespace &&
          input.ids.includes(tx.externalRef.id)
        ) {
          found.set(tx.externalRef.id, tx.id);
        }
      }
      return found;
    },
  };
  const single = new TransactionsService(mem.deps);
  const conversions = new ConversionsService(mem.deps);
  return {
    ...mem,
    refs,
    bulk: new RecordImportedTransactions(mem.deps, refs, { transfers: single, conversions }),
    importedConversions: new RecordImportedConversions(mem.deps, refs, conversions),
    single,
    conversions,
  };
}

const batch = (rows: ImportedTransactionRowDto[]) => ({
  workspaceId: WS,
  accountId: ACCOUNT,
  importJobId: 'job-1',
  actorUserId: ACTOR,
  rows,
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return 'OK';
}

/** Clasificación completa (el contrato de add-rule-engine exige todos los campos). */
const classified = (over: Partial<ImportedClassificationDto>): ImportedClassificationDto => ({
  categoryId: null,
  categoryOrigin: 'MANUAL',
  counterpartyId: null,
  tagIds: [],
  customFields: [],
  needsReview: null,
  ruleRefs: [],
  ...over,
});

describe('RecordImportedTransactions.recordBatch', () => {
  it('[TC-IMPORTS-CSV-023] una salida es un gasto POSTED y una entrada un ingreso POSTED, source IMPORT, sin categoría explícita', async () => {
    const { bulk, state } = setup();
    const result = await bulk.recordBatch(
      batch([
        row(1),
        row(2, { direction: 'IN', amount: { amount: '8000.00', currency: 'BOB' }, description: null }),
      ]),
    );
    expect(result.created.map((c) => c.rowRef)).toEqual(['row-1', 'row-2']);
    expect(result.alreadyExisting).toEqual([]);
    const [expense, income] = result.created.map((c) => state.txs.get(c.transactionId)!);
    expect(expense).toMatchObject({
      kind: 'EXPENSE',
      status: 'POSTED',
      businessDate: '2026-10-02',
      accountId: ACCOUNT,
      source: 'IMPORT',
      importJobId: 'job-1',
      externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: 'fp-1' },
      description: 'PAGO QR CAFE',
    });
    expect(expense?.splits.map((s) => s.categoryId)).toEqual(['cat-uncategorized']);
    expect(income).toMatchObject({ kind: 'INCOME', description: null });
    expect(income?.amount.toFixed()).toBe('8000.00');
    expect(income?.splits.map((s) => s.categoryId)).toEqual(['cat-uncategorized-income']);
  });

  it('[TC-IMPORTS-CSV-016] las filas con una transacción no anulada ya vinculada se informan como existentes y no se crean', async () => {
    const { bulk, state } = setup();
    const first = await bulk.recordBatch(batch([row(2)]));
    const result = await bulk.recordBatch(batch([row(1), row(2), row(3)]));
    expect(result.created.map((c) => c.rowRef)).toEqual(['row-1', 'row-3']);
    expect(result.alreadyExisting).toEqual([
      { rowRef: 'row-2', transactionId: first.created[0]?.transactionId },
    ]);
    expect(state.txs.size).toBe(3);
  });

  it('rechaza un espacio de nombres ajeno, una referencia repetida en el lote y lotes enormes', async () => {
    const { bulk, state } = setup();
    expect(
      await codeOf(bulk.recordBatch(batch([row(1, { externalRef: { namespace: 'otro', id: 'x' } })]))),
    ).toBe('VALIDATION_FAILED');
    expect(await codeOf(bulk.recordBatch(batch([row(1), row(1, { rowRef: 'row-dup' })])))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await codeOf(bulk.recordBatch(batch(Array.from({ length: 1001 }, (_, i) => row(i)))))).toBe(
      'VALIDATION_FAILED',
    );
    expect(state.txs.size).toBe(0);
  });

  it('serializa los lotes de la cuenta con el candado antes de leer las referencias', async () => {
    const { bulk, refs } = setup();
    await bulk.recordBatch(batch([row(1)]));
    expect(refs.locks).toBe(1);
  });

  it('[TC-TRANSACTIONS-BULKIMPORT-001] un lote de 200 filas crea 200 transacciones con asientos cuadrados, auditoría y 600 eventos del dominio', async () => {
    const { bulk, state, balanceOf } = setup();
    const rows = [
      ...Array.from({ length: 150 }, (_, i) => row(i, { amount: { amount: '25.00', currency: 'BOB' } })),
      ...Array.from({ length: 50 }, (_, i) =>
        row(150 + i, { direction: 'IN', amount: { amount: '100.00', currency: 'BOB' } }),
      ),
    ];
    const result = await bulk.recordBatch(batch(rows));
    expect(result.created).toHaveLength(200);
    // 4000.00 − 3750.00 + 5000.00 = 5250.00 (el saldo previo de 4000.00 no pasa por este lote).
    expect(balanceOf(ACCOUNT)).toBe('1250.00');
    expect(state.entries).toHaveLength(200);
    for (const e of state.entries) {
      expect(e.postings).toHaveLength(2);
      expect(
        Money.sum(
          e.postings.map((x) => Money.parse(x.amount, 'BOB', 2)),
          BOB,
        ).isZero(),
      ).toBe(true);
    }
    expect([...state.txs.values()].every((t) => t.status === 'POSTED' && t.source === 'IMPORT')).toBe(true);
    const audits = state.audit.filter((a) => a.action === 'transactions.transaction.created');
    expect(audits).toHaveLength(200);
    const count = (type: string) => state.outbox.filter((e) => e.eventType === type).length;
    expect([count('transactions.TransactionCreated'), count('transactions.TransactionPosted')]).toEqual([
      200, 200,
    ]);
    expect(state.lifecycle).toHaveLength(200);
  });

  it('[TC-TRANSACTIONS-BULKIMPORT-002] una fila en periodo cerrado rechaza el lote con PERIOD_CLOSED y no deja nada', async () => {
    const { bulk, state, balanceOf } = setup();
    state.closedMonths.add('2026-08');
    const rows = [...Array.from({ length: 199 }, (_, i) => row(i)), row(199, { date: '2026-08-15' })];
    expect(await codeOf(bulk.recordBatch(batch(rows)))).toBe('PERIOD_CLOSED');
    expect(state.txs.size).toBe(0);
    expect(state.entries).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
    expect(state.audit).toHaveLength(0);
    expect(balanceOf(ACCOUNT)).toBe('0.00');
  });

  it('[TC-TRANSACTIONS-BULKIMPORT-002] una cuenta archivada o un monto inválido rechazan el lote con el código del camino individual', async () => {
    const { bulk, state } = setup();
    state.accounts.set(ACCOUNT, { accountId: ACCOUNT, currency: 'BOB', nature: 'ASSET', status: 'ARCHIVED' });
    expect(await codeOf(bulk.recordBatch(batch([row(1)])))).toBe('ACCOUNT_ARCHIVED');
    state.accounts.set(ACCOUNT, { accountId: ACCOUNT, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' });
    expect(
      await codeOf(
        bulk.recordBatch(batch([row(1), row(2, { amount: { amount: '0.00', currency: 'BOB' } })])),
      ),
    ).toBe('AMOUNT_NOT_POSITIVE');
    expect(
      await codeOf(bulk.recordBatch(batch([row(1, { amount: { amount: '1.234', currency: 'BOB' } })]))),
    ).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(
      await codeOf(bulk.recordBatch(batch([row(1, { amount: { amount: '1.00', currency: 'XXX' } })]))),
    ).toBe('CURRENCY_MISMATCH');
    expect(state.txs.size).toBe(0);
  });

  it('[TC-TRANSACTIONS-BULKIMPORT-003] 20 referencias ya registradas se informan como existentes y se crean 180', async () => {
    const { bulk, state } = setup();
    const rows = Array.from({ length: 200 }, (_, i) => row(i));
    const previous = await bulk.recordBatch(batch(rows.slice(0, 20)));
    const result = await bulk.recordBatch(batch(rows));
    expect(result.created).toHaveLength(180);
    expect(result.alreadyExisting).toEqual(
      previous.created.map((c) => ({ rowRef: c.rowRef, transactionId: c.transactionId })),
    );
    expect(state.txs.size).toBe(200);
    expect(state.entries).toHaveLength(200);
  });

  it('una falla de auditoría revierte el lote entero (INV-029)', async () => {
    const { bulk, state, faults } = setup();
    faults.audit = new Error('audit down');
    await expect(bulk.recordBatch(batch([row(1), row(2)]))).rejects.toThrow('audit down');
    expect(state.txs.size).toBe(0);
    expect(state.entries).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
  });
});

describe('RecordImportedTransactions — add-import-pipeline (tipos, clasificación, deshacer)', () => {
  it('[TC-TRANSACTIONS-DEDUPE-004] acepta el espacio imports.ext:<FORMAT> y el segundo lote ve el identificador del banco como existente', async () => {
    const { bulk, state } = setup();
    const ofx = { namespace: OFX, id: '2026030100017' };
    const first = await bulk.recordBatch(batch([row(1, { externalRef: ofx })]));
    const second = await bulk.recordBatch(batch([row(2, { externalRef: ofx })]));
    expect(second.created).toEqual([]);
    expect(second.alreadyExisting).toEqual([
      { rowRef: 'row-2', transactionId: first.created[0]?.transactionId },
    ]);
    expect([...state.txs.values()].filter((t) => t.externalRef?.namespace === OFX)).toHaveLength(1);
    // Otro formato con el mismo identificador es otra referencia.
    const csv = await bulk.recordBatch(
      batch([row(3, { externalRef: { namespace: importExternalNamespace('CSV'), id: ofx.id } })]),
    );
    expect(csv.created).toHaveLength(1);
    expect(
      await codeOf(
        bulk.recordBatch(batch([row(4, { externalRef: { namespace: 'imports.ext:PDF', id: 'x' } })])),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-TRANSACTIONS-DEDUPE-005] anular la transacción libera la referencia y el reimport la crea de nuevo', async () => {
    const { bulk, state } = setup();
    const ofx = { namespace: OFX, id: '2026030100017' };
    const first = await bulk.recordBatch(batch([row(1, { externalRef: ofx })]));
    const id = first.created[0]?.transactionId as string;
    const voided = await bulk.voidBatch({
      workspaceId: WS,
      importJobId: 'job-1',
      actorUserId: ACTOR,
      transactionIds: [id],
      reason: 'IMPORT_REVERTED',
    });
    expect(voided.voided).toEqual([id]);
    const again = await bulk.recordBatch(batch([row(2, { externalRef: ofx })]));
    expect(again.created).toHaveLength(1);
    expect(again.created[0]?.transactionId).not.toBe(id);
    expect(state.txs.get(id)?.status).toBe('VOIDED');
  });

  it('[TC-IMPORTS-PIPELINE-044] una fila TRANSFER de salida mueve la cuenta del import hacia la contraparte con source IMPORT', async () => {
    const { bulk, state, balanceOf } = setup();
    const result = await bulk.recordBatch(
      batch([
        row(1, {
          kind: 'TRANSFER',
          amount: { amount: '1500.00', currency: 'BOB' },
          description: 'PAGO TARJETA',
          transfer: { counterAccountId: COUNTER },
        }),
      ]),
    );
    const tx = state.txs.get(result.created[0]?.transactionId as string)!;
    expect(tx).toMatchObject({
      kind: 'TRANSFER',
      status: 'POSTED',
      source: 'IMPORT',
      importJobId: 'job-1',
      externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: 'fp-1' },
    });
    expect(tx.legs.map((l) => [l.role, l.accountId, l.amount.toFixed()])).toEqual([
      ['SOURCE', ACCOUNT, '-1500.00'],
      ['TARGET', COUNTER, '1500.00'],
    ]);
    expect(balanceOf(COUNTER)).toBe('1500.00');
    // Reimportar la misma fila no la crea (idempotencia también para la contraparte).
    const again = await bulk.recordBatch(
      batch([
        row(9, {
          kind: 'TRANSFER',
          amount: { amount: '1500.00', currency: 'BOB' },
          transfer: { counterAccountId: COUNTER },
        }),
      ]),
    );
    expect(again.alreadyExisting).toHaveLength(0);
    const same = await bulk.recordBatch(
      batch([
        row(1, {
          kind: 'TRANSFER',
          amount: { amount: '1500.00', currency: 'BOB' },
          transfer: { counterAccountId: COUNTER },
        }),
      ]),
    );
    expect(same.created).toEqual([]);
    expect(same.alreadyExisting).toHaveLength(1);
  });

  it('[TC-IMPORTS-PIPELINE-045] una transferencia a una cuenta de otra moneda se rechaza con TRANSFER_CURRENCY_MISMATCH y no deja nada', async () => {
    const { bulk, state } = setup();
    expect(
      await codeOf(
        bulk.recordBatch(
          batch([row(1), row(2, { kind: 'TRANSFER', transfer: { counterAccountId: WALLET } })]),
        ),
      ),
    ).toBe('TRANSFER_CURRENCY_MISMATCH');
    expect(state.txs.size).toBe(0);
    expect(await codeOf(bulk.recordBatch(batch([row(1, { kind: 'TRANSFER' })])))).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(
        bulk.recordBatch(batch([row(1, { kind: 'TRANSFER', transfer: { counterAccountId: ACCOUNT } })])),
      ),
    ).toBe('TRANSFER_SAME_ACCOUNT');
  });

  it('[TC-IMPORTS-PIPELINE-046] una fila CONVERSION entrante crea la conversión con la referencia de FX y la tasa efectiva exacta', async () => {
    const { bulk, state } = setup();
    // Compra de dólares: la cuenta del import (BOB) entrega 696.00 BOB y la billetera recibe 100.000000 USDT.
    const result = await bulk.recordBatch(
      batch([
        row(1, {
          kind: 'CONVERSION',
          direction: 'OUT',
          amount: { amount: '696.00', currency: 'BOB' },
          description: 'COMPRA USDT',
          conversion: {
            counterAccountId: WALLET,
            counterAmount: { amount: '100.000000', currency: 'USDT' },
            executedAt: '2026-09-30T18:42:00Z',
          },
        }),
      ]),
    );
    const tx = state.txs.get(result.created[0]?.transactionId as string)!;
    expect(tx).toMatchObject({
      kind: 'CONVERSION',
      source: 'IMPORT',
      importJobId: 'job-1',
      externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: 'fp-1' },
    });
    expect(tx.conversion?.effectiveRate.value.toFixed()).toBe('6.96');
    expect(tx.conversion?.referenceRate?.fxRateId).toBe('R-usdt');
    expect(tx.legs.map((l) => [l.role, l.accountId])).toEqual([
      ['SOURCE', ACCOUNT],
      ['TARGET', WALLET],
    ]);
  });

  it('[TC-IMPORTS-PIPELINE-046] ImportedConversionsCommand.recordBatch es idempotente por referencia externa', async () => {
    const { importedConversions, state } = setup();
    const conversionRow = {
      rowRef: 'c-1',
      sourceAccountId: ACCOUNT,
      targetAccountId: WALLET,
      date: '2026-09-30',
      sourceAmount: { amount: '696.00', currency: 'BOB' },
      targetAmount: { amount: '100.000000', currency: 'USDT' },
      executedAt: '2026-09-30T18:42:00Z',
      description: null,
      externalRef: { namespace: OFX, id: 'CONV-1' },
    };
    const input = { workspaceId: WS, importJobId: 'job-2', actorUserId: ACTOR, rows: [conversionRow] };
    const first = await importedConversions.recordBatch(input);
    expect(first.created).toHaveLength(1);
    const second = await importedConversions.recordBatch(input);
    expect(second.created).toEqual([]);
    expect(second.alreadyExisting).toEqual([
      { rowRef: 'c-1', transactionId: first.created[0]?.transactionId },
    ]);
    expect([...state.txs.values()].filter((t) => t.kind === 'CONVERSION')).toHaveLength(1);
  });

  it('[TC-IMPORTS-PIPELINE-038] la clasificación de la fila fija categoría, contraparte y etiquetas del split y se valida una vez por lote', async () => {
    const { bulk, state } = setup();
    const result = await bulk.recordBatch(
      batch([
        row(1, {
          classification: classified({
            categoryId: 'cat-food',
            counterpartyId: 'cp-1',
            tagIds: ['t1', 't1', 't2'],
            notes: 'n',
          }),
        }),
        row(2, { classification: classified({ categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT' }) }),
      ]),
    );
    const [a, b] = result.created.map((c) => state.txs.get(c.transactionId)!);
    expect(a?.splits.map((x) => [x.categoryId, x.counterpartyId, x.tagIds])).toEqual([
      ['cat-food', null, ['t1', 't2']],
    ]);
    expect([a?.counterpartyId, a?.notes]).toEqual(['cp-1', 'n']);
    expect(b?.splits.map((x) => x.categoryId)).toEqual(['cat-uncategorized']);
    expect(
      await codeOf(
        bulk.recordBatch(batch([row(5, { classification: classified({ categoryId: 'archived' }) })])),
      ),
    ).toBe('CATEGORY_ARCHIVED');
    expect(
      await codeOf(
        bulk.recordBatch(batch([row(6, { classification: classified({ categoryId: 'income-sueldo' }) })])),
      ),
    ).toBe('CATEGORY_KIND_MISMATCH');
    expect(
      await codeOf(
        bulk.recordBatch(
          batch([
            row(7, {
              classification: classified({ counterpartyId: 'archived-cp', categoryOrigin: 'SYSTEM_DEFAULT' }),
            }),
          ]),
        ),
      ),
    ).toBe('COUNTERPARTY_ARCHIVED');
  });

  it('[TC-IMPORTS-PIPELINE-059] voidBatch anula por conjunto con reversa exacta, informa las ya anuladas y es idempotente', async () => {
    const { bulk, state, balanceOf } = setup();
    const created = await bulk.recordBatch(batch([row(1), row(2), row(3, { direction: 'IN' })]));
    const ids = created.created.map((c) => c.transactionId);
    const before = balanceOf(ACCOUNT);
    expect(before).toBe('-18.00');
    const first = await bulk.voidBatch({
      workspaceId: WS,
      importJobId: 'job-1',
      actorUserId: ACTOR,
      transactionIds: ids,
      reason: 'IMPORT_REVERTED',
    });
    expect(first.voided).toEqual(ids);
    expect(first.blocked).toEqual([]);
    expect(balanceOf(ACCOUNT)).toBe('0.00');
    expect(state.entries.filter((e) => e.reverses !== null)).toHaveLength(3);
    expect(state.audit.filter((a) => a.action === 'transactions.transaction.voided')).toHaveLength(3);
    expect(state.outbox.filter((e) => e.eventType === 'transactions.TransactionVoided')).toHaveLength(3);
    const again = await bulk.voidBatch({
      workspaceId: WS,
      importJobId: 'job-1',
      actorUserId: ACTOR,
      transactionIds: ids,
      reason: 'IMPORT_REVERTED',
    });
    expect(again).toEqual({ voided: [], alreadyVoided: ids, blocked: [] });
    expect(state.entries.filter((e) => e.reverses !== null)).toHaveLength(3);
  });

  it('[TC-IMPORTS-PIPELINE-060] un periodo cerrado bloquea: con allowBlocked se informa y se anula el resto; sin él se rechaza todo', async () => {
    const { bulk, state } = setup();
    const created = await bulk.recordBatch(batch([row(1), row(2, { date: '2026-08-15' })]));
    const ids = created.created.map((c) => c.transactionId);
    state.closedMonths.add('2026-08');
    const base = {
      workspaceId: WS,
      importJobId: 'job-1',
      actorUserId: ACTOR,
      transactionIds: ids,
      reason: 'x',
    };
    expect(await codeOf(bulk.voidBatch(base))).toBe('PERIOD_CLOSED');
    expect([...state.txs.values()].every((t) => t.status === 'POSTED')).toBe(true);
    const partial = await bulk.voidBatch({ ...base, allowBlocked: true });
    expect(partial.voided).toEqual([ids[0]]);
    expect(partial.blocked).toEqual([{ transactionId: ids[1], code: 'PERIOD_CLOSED' }]);
    expect(state.txs.get(ids[1] as string)?.status).toBe('POSTED');
  });

  it('[TC-IMPORTS-PIPELINE-060] una transacción reconciliada se informa bloqueada y una ajena al import se rechaza', async () => {
    const { bulk, state } = setup();
    const created = await bulk.recordBatch(batch([row(1), row(2)]));
    const ids = created.created.map((c) => c.transactionId);
    const reconciled = state.txs.get(ids[0] as string)!;
    state.txs.set(reconciled.id, { ...reconciled, status: 'RECONCILED', reconciliationMode: 'STATEMENT' });
    const base = {
      workspaceId: WS,
      importJobId: 'job-1',
      actorUserId: ACTOR,
      transactionIds: ids,
      reason: 'x',
    };
    expect(await codeOf(bulk.voidBatch(base))).toBe('TRANSACTION_RECONCILED');
    const partial = await bulk.voidBatch({ ...base, allowBlocked: true });
    expect(partial.blocked).toEqual([{ transactionId: ids[0], code: 'TRANSACTION_RECONCILED' }]);
    expect(partial.voided).toEqual([ids[1]]);
    expect(await codeOf(bulk.voidBatch({ ...base, importJobId: 'otro-job' }))).toBe('REFERENCE_NOT_FOUND');
  });
});

// ------------------------------------------------------------------ equivalencia (TC-TRANSACTIONS-BULKIMPORT-005)

/** Estado observable normalizado: los identificadores se reemplazan por su orden de aparición. */
function observable(s: ReturnType<typeof setup>['state']) {
  const raw = JSON.stringify({
    txs: [...s.txs.values()].map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      businessDate: t.businessDate,
      accountId: t.accountId,
      amount: t.amount.toJSON(),
      description: t.description,
      source: t.source,
      externalRef: t.externalRef,
      importJobId: t.importJobId,
      entry: t.activeEntryId,
      version: t.version,
      revision: t.revision,
      splits: t.splits.map((x) => ({
        id: x.id,
        amount: x.amount.toJSON(),
        categoryId: x.categoryId,
        tagIds: x.tagIds,
      })),
      legs: t.legs.map((l) => ({ role: l.role, accountId: l.accountId, amount: l.amount.toJSON() })),
    })),
    links: s.links,
    entries: s.entries.map((e) => ({ id: e.id, command: e.command })),
    outbox: s.outbox,
    audit: s.audit,
    lifecycle: s.lifecycle,
  });
  const tokens = new Map<string, string>();
  return raw.replace(/0192f3c4-0000-7000-9000-[0-9a-f]{12}/g, (id) => {
    if (!tokens.has(id)) tokens.set(id, `#${tokens.size}`);
    return tokens.get(id) as string;
  });
}

const rowArb = fc
  .record({
    cents: fc.integer({ min: 1, max: 99_999_999_99 }),
    day: fc.integer({ min: 1, max: 28 }),
    direction: fc.constantFrom<'IN' | 'OUT'>('IN', 'OUT'),
    description: fc.option(
      fc.oneof(
        fc.string({ maxLength: 60 }),
        fc.constantFrom(
          'PAGO QR CAFÉ',
          'ABONO "SUELDO" \\ ñ',
          "O'BRIEN & SONS <ref>",
          '  espacios  ',
          '日本語',
        ),
      ),
      { nil: null },
    ),
  })
  .map(({ cents, day, direction, description }) => {
    const text = String(cents).padStart(3, '0');
    return {
      date: `2026-10-${String(day).padStart(2, '0')}`,
      direction,
      amount: { amount: `${text.slice(0, -2)}.${text.slice(-2)}`, currency: 'BOB' },
      description,
    };
  });

describe('RecordImportedTransactions — equivalencia con el registro individual', () => {
  it('[TC-TRANSACTIONS-BULKIMPORT-005] tres filas (dos idénticas) dan el mismo resultado por el lote y de a una', async () => {
    const rows = [
      row(1, { description: 'PAGO QR CAFÉ' }),
      row(2, { description: 'PAGO QR CAFÉ' }),
      row(3, {
        date: '2026-10-05',
        direction: 'IN',
        amount: { amount: '8000.00', currency: 'BOB' },
        description: 'ABONO SUELDO',
      }),
    ];
    const a = setup();
    await a.bulk.recordBatch(batch(rows));
    const b = setup();
    for (const r of rows) await recordOne(b, r);
    expect(observable(a.state)).toBe(observable(b.state));
    const expenses = [...a.state.txs.values()].filter((t) => t.kind === 'EXPENSE');
    expect(expenses.map((t) => t.amount.toFixed())).toEqual(['18.00', '18.00']);
    expect(a.balanceOf(ACCOUNT)).toBe('7964.00');
  });

  it('[TC-TRANSACTIONS-BULKIMPORT-005] (PBT) cualquier lote válido da el mismo resultado observable por ambos caminos', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(rowArb, { minLength: 1, maxLength: 25 }), async (generated) => {
        const rows = generated.map((g, i) => row(i, g));
        const a = setup();
        const b = setup();
        const created = await a.bulk.recordBatch(batch(rows));
        for (const r of rows) await recordOne(b, r);
        expect(created.created).toHaveLength(rows.length);
        expect(observable(a.state)).toBe(observable(b.state));
        expect(a.balanceOf(ACCOUNT)).toBe(b.balanceOf(ACCOUNT));
      }),
      { numRuns: 60 },
    );
  }, 60_000);
});

describe('RecordImportedTransactions — equivalencia ampliada (add-import-pipeline decisión 6)', () => {
  it('[TC-TRANSACTIONS-BULKIMPORT-005] una fila clasificada da el mismo resultado por el lote y por recordTransaction con splits', async () => {
    const r = row(1, {
      description: 'SUPERMERCADO',
      classification: classified({
        categoryId: 'cat-food',
        counterpartyId: 'cp-1',
        tagIds: ['t1'],
        notes: 'nota',
      }),
    });
    const a = setup();
    await a.bulk.recordBatch(batch([r]));
    const b = setup();
    await b.single.recordTransaction({
      workspaceId: WS,
      userId: ACTOR,
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: r.date,
      accountId: ACCOUNT,
      amount: r.amount,
      description: r.description,
      notes: 'nota',
      counterpartyId: 'cp-1',
      source: 'IMPORT',
      externalRef: r.externalRef,
      importJobId: 'job-1',
      splits: [{ amount: r.amount, categoryId: 'cat-food', counterpartyId: 'cp-1', tagIds: ['t1'] }],
    });
    expect(observable(a.state)).toBe(observable(b.state));
  });

  it('[TC-IMPORTS-PIPELINE-044] una fila transferencia da el mismo resultado observable que recordTransfer', async () => {
    const r = row(1, {
      kind: 'TRANSFER',
      amount: { amount: '300.00', currency: 'BOB' },
      transfer: { counterAccountId: COUNTER },
    });
    const a = setup();
    await a.bulk.recordBatch(batch([r]));
    const b = setup();
    await b.single.recordTransfer({
      workspaceId: WS,
      userId: ACTOR,
      status: 'POSTED',
      transactionDate: r.date,
      fromAccountId: ACCOUNT,
      toAccountId: COUNTER,
      amount: r.amount,
      description: r.description,
      source: 'IMPORT',
      externalRef: r.externalRef,
      importJobId: 'job-1',
    });
    expect(observable(a.state)).toBe(observable(b.state));
  });
});

/** Registro individual de una fila: el camino de referencia (`recordTransaction`). */
async function recordOne(ctx: ReturnType<typeof setup>, r: ImportedTransactionRowDto): Promise<void> {
  await ctx.single.recordTransaction({
    workspaceId: WS,
    userId: ACTOR,
    kind: r.direction === 'OUT' ? 'EXPENSE' : 'INCOME',
    status: 'POSTED',
    transactionDate: r.date,
    accountId: ACCOUNT,
    amount: r.amount,
    description: r.description,
    source: 'IMPORT',
    externalRef: r.externalRef,
    importJobId: 'job-1',
  });
}
