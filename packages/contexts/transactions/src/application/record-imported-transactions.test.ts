import { DomainError } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IMPORT_ROW_NAMESPACE, type ImportedTransactionRowDto } from '../contracts/index.js';
import type { ImportedRefReader } from './ports/index.js';
import { RecordImportedTransactions } from './record-imported-transactions.js';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService } from './transactions.service.js';

const WS = 'ws-1';
const ACCOUNT = 'bank-a';
const ACTOR = 'user-ana';

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
    accounts: [{ accountId: ACCOUNT, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' }],
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
          tx.accountId === input.accountId &&
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
  return {
    ...mem,
    refs,
    bulk: new RecordImportedTransactions(mem.deps, refs),
    single: new TransactionsService(mem.deps),
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
      expect(Number(e.postings[0]!.amount) + Number(e.postings[1]!.amount)).toBe(0);
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
