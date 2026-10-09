import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { BulkEditService } from './bulk-edit.service.js';
import { inMemoryTransactionsDeps, type FakeCustomField } from './testing/in-memory.js';
import { TransactionsService, type RecordTransactionCommand } from './transactions.service.js';

const WS = 'ws-1';
const USER = 'user-1';
const BANK = 'bank-a';
const SUPER = 'supermercado';
const HOGAR = 'hogar';
const FAMILIA = 'tag-familia';
const CC = 'field-centro-costo';

const bob = (amount: string) => ({ amount, currency: 'BOB' });

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [{ accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' }],
  });
  const fields: FakeCustomField[] = [
    {
      fieldId: CC,
      key: 'centro_costo',
      dataType: 'SELECT',
      target: 'TRANSACTION',
      options: ['casa', 'oficina'],
    },
  ];
  mem.state.customFields.push(...fields);
  const service = new TransactionsService(mem.deps);
  const bulk = new BulkEditService(mem.deps, service);
  return { ...mem, service, bulk };
}
type Ctx = ReturnType<typeof setup>;

const expense = (over: Partial<RecordTransactionCommand> = {}): RecordTransactionCommand => ({
  workspaceId: WS,
  userId: USER,
  kind: 'EXPENSE',
  transactionDate: '2026-03-15',
  accountId: BANK,
  amount: bob('150.00'),
  description: 'Compra',
  splits: [{ amount: bob(over.amount?.amount ?? '150.00'), categoryId: SUPER }],
  ...over,
});

/** T1 45.90, T2 150.00, T3 200.00 de un split en "Supermercado" (marzo de 2026). */
async function threeExpenses(ctx: Ctx) {
  const out = [];
  for (const amount of ['45.90', '150.00', '200.00']) {
    out.push(
      (
        await ctx.service.recordTransaction(
          expense({ amount: bob(amount), splits: [{ amount: bob(amount), categoryId: SUPER }] }),
        )
      ).transaction,
    );
  }
  return out;
}

const cmd = (ctx: Ctx, txs: readonly { id: string; version: number }[], changes: unknown) => ({
  workspaceId: WS,
  userId: USER,
  items: txs.map((t) => ({ id: t.id, version: t.version })),
  changes,
});

async function failure(p: Promise<unknown>): Promise<DomainError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('expected a DomainError');
}

const snapshotOf = (ctx: Ctx) => ({
  txs: JSON.stringify([...ctx.state.txs.values()].map((s) => [s.id, s.version, s.status])),
  categories: JSON.stringify([...ctx.state.txs.values()].map((s) => s.splits.map((x) => x.categoryId))),
  audit: ctx.state.audit.length,
  outbox: ctx.state.outbox.length,
  lifecycle: ctx.state.lifecycle.length,
});

describe('BulkEditService — edición masiva de clasificación', () => {
  it('[TC-TRANSACTIONS-BULK-001] recategoriza y etiqueta tres gastos: versiones +1 y los totales por categoría se mueven', async () => {
    const ctx = setup();
    const txs = await threeExpenses(ctx);
    const res = await ctx.bulk.bulkEdit(cmd(ctx, txs, { categoryId: HOGAR, addTagIds: [FAMILIA] }));
    expect(res.data.map((t) => t.version)).toEqual([2, 2, 2]);
    expect(res.data.every((t) => t.splits[0]?.categoryId === HOGAR)).toBe(true);
    expect(res.data.every((t) => t.splits[0]?.tagIds.join() === FAMILIA)).toBe(true);
    const total = (cat: string) =>
      [...ctx.state.txs.values()]
        .flatMap((s) => s.splits.filter((x) => x.categoryId === cat))
        .reduce((acc, x) => acc + Number(x.amount.toFixed()) * 100, 0);
    expect(total(HOGAR)).toBe(39590);
    expect(total(SUPER)).toBe(0);
    // Un TransactionCategorized por transacción con el bulkOperationId común (consumidores idempotentes).
    const categorized = ctx.state.outbox.filter((o) => o.eventType === 'transactions.TransactionCategorized');
    expect(categorized).toHaveLength(3);
    expect(categorized.every((o) => o.payload['bulkOperationId'] === res.bulkOperationId)).toBe(true);
    // La recategorización no emite TransactionUpdated (docs/11): 500 ítems ⇒ 500 hechos, no 1 000.
    expect(ctx.state.outbox.filter((o) => o.eventType === 'transactions.TransactionUpdated')).toHaveLength(0);
    // La correlación del evento es la de la operación.
    expect(categorized.every((o) => o.correlationId === res.bulkOperationId)).toBe(true);
  });

  it('[TC-TRANSACTIONS-BULK-001] categoría archivada ⇒ CATEGORY_ARCHIVED, de ingreso sobre gastos ⇒ CATEGORY_KIND_MISMATCH; nada cambia', async () => {
    const ctx = setup();
    const txs = await threeExpenses(ctx);
    const before = snapshotOf(ctx);
    const archived = await failure(ctx.bulk.bulkEdit(cmd(ctx, txs.slice(0, 2), { categoryId: 'archived' })));
    expect(archived.code).toBe('CATEGORY_ARCHIVED');
    const kind = await failure(ctx.bulk.bulkEdit(cmd(ctx, txs.slice(0, 2), { categoryId: 'income-sueldo' })));
    expect(kind.code).toBe('CATEGORY_KIND_MISMATCH');
    expect(kind.violations.map((v) => v.pointer)).toEqual(['/items/0', '/items/1']);
    const tag = await failure(ctx.bulk.bulkEdit(cmd(ctx, txs, { addTagIds: ['archived-tag'] })));
    expect(tag.code).toBe('TAG_ARCHIVED');
    expect(snapshotOf(ctx)).toEqual(before);
  });

  it('[TC-TRANSACTIONS-BULK-003] versión obsoleta ⇒ PRECONDITION_FAILED con un error por ítem y nada cambia', async () => {
    const ctx = setup();
    const txs = await threeExpenses(ctx);
    // T2 se editó antes y está en la versión 2.
    await ctx.service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: (txs[1] as { id: string }).id,
      expectedVersion: 1,
      notes: 'editada',
    });
    const before = snapshotOf(ctx);
    const err = await failure(ctx.bulk.bulkEdit(cmd(ctx, txs, { categoryId: HOGAR })));
    expect(err.code).toBe('PRECONDITION_FAILED');
    expect(err.violations.map((v) => [v.pointer, v.code])).toEqual([
      ['/items/1/version', 'PRECONDITION_FAILED'],
    ]);
    expect(snapshotOf(ctx)).toEqual(before);
  });

  it('[TC-TRANSACTIONS-BULK-003] un ítem inexistente ⇒ RESOURCE_NOT_FOUND (prioridad sobre las demás) y nada cambia', async () => {
    const ctx = setup();
    const txs = await threeExpenses(ctx);
    const before = snapshotOf(ctx);
    const err = await failure(
      ctx.bulk.bulkEdit(
        cmd(
          ctx,
          [
            { id: (txs[0] as { id: string }).id, version: 9 },
            { id: 'inexistente', version: 1 },
          ],
          {
            categoryId: HOGAR,
          },
        ),
      ),
    );
    expect(err.code).toBe('RESOURCE_NOT_FOUND');
    expect(err.violations.map((v) => [v.pointer, v.code])).toEqual([
      ['/items/0/version', 'PRECONDITION_FAILED'],
      ['/items/1/id', 'RESOURCE_NOT_FOUND'],
    ]);
    expect(snapshotOf(ctx)).toEqual(before);
  });

  it('[TC-TRANSACTIONS-BULK-004] no cambia saldos ni asientos; monto, cuenta, fecha, moneda o systemFlags ⇒ VALIDATION_FAILED', async () => {
    const ctx = setup();
    const txs = await threeExpenses(ctx);
    const entries = ctx.state.entries.length;
    const balance = ctx.balanceOf(BANK);
    await ctx.bulk.bulkEdit(cmd(ctx, txs, { categoryId: HOGAR }));
    expect(ctx.state.entries.length).toBe(entries);
    expect(ctx.balanceOf(BANK)).toBe(balance);
    const fresh = [...ctx.state.txs.values()].map((s) => ({ id: s.id, version: s.version }));
    const before = snapshotOf(ctx);
    for (const bad of [
      { amount: '100.00' },
      { accountId: 'caja' },
      { businessDate: '2026-03-01' },
      { currency: 'USD' },
      { systemFlags: ['RECONCILED_WITHOUT_STATEMENT'] },
    ]) {
      expect((await failure(ctx.bulk.bulkEdit(cmd(ctx, fresh, bad)))).code).toBe('VALIDATION_FAILED');
    }
    expect(snapshotOf(ctx)).toEqual(before);
    expect(ctx.state.entries.length).toBe(entries);
  });

  it('[TC-TRANSACTIONS-BULK-005] categoría sobre un gasto de dos splits o una transferencia ⇒ BULK_EDIT_NOT_APPLICABLE; el tag sí aplica a todos los splits', async () => {
    const ctx = setup();
    const [t1] = await threeExpenses(ctx);
    const t4 = (
      await ctx.service.recordTransaction(
        expense({
          amount: bob('300.00'),
          splits: [
            { amount: bob('200.00'), categoryId: SUPER },
            { amount: bob('100.00'), categoryId: SUPER },
          ],
        }),
      )
    ).transaction;
    ctx.state.accounts.set('bank-b', {
      accountId: 'bank-b',
      currency: 'BOB',
      nature: 'ASSET',
      status: 'ACTIVE',
    });
    const tr = await ctx.service.recordTransfer({
      workspaceId: WS,
      userId: USER,
      transactionDate: '2026-03-15',
      fromAccountId: BANK,
      toAccountId: 'bank-b',
      amount: bob('100.00'),
    });
    const before = snapshotOf(ctx);
    const err = await failure(ctx.bulk.bulkEdit(cmd(ctx, [t1 as never, t4], { categoryId: HOGAR })));
    expect(err.code).toBe('BULK_EDIT_NOT_APPLICABLE');
    expect(err.violations.map((v) => v.pointer)).toEqual(['/items/1']);
    expect((await failure(ctx.bulk.bulkEdit(cmd(ctx, [tr], { categoryId: HOGAR })))).code).toBe(
      'BULK_EDIT_NOT_APPLICABLE',
    );
    expect(snapshotOf(ctx)).toEqual(before);
    const ok = await ctx.bulk.bulkEdit(cmd(ctx, [t1 as never, t4], { addTagIds: ['tag-viaje'] }));
    expect(ok.data.flatMap((t) => t.splits.map((x) => x.tagIds))).toEqual([
      ['tag-viaje'],
      ['tag-viaje'],
      ['tag-viaje'],
    ]);
    expect(ok.data[1]?.splits.map((x) => x.amount.toFixed())).toEqual(['200.00', '100.00']);
  });

  it('contraparte y notas se aplican a la cabecera y se pueden quitar', async () => {
    const ctx = setup();
    const txs = await threeExpenses(ctx);
    const set = await ctx.bulk.bulkEdit(cmd(ctx, txs, { counterpartyId: 'cp-1', notes: 'Compra del mes' }));
    expect(set.data.every((t) => t.counterpartyId === 'cp-1' && t.notes === 'Compra del mes')).toBe(true);
    const updated = ctx.state.outbox.filter((o) => o.eventType === 'transactions.TransactionUpdated');
    expect(updated).toHaveLength(3);
    expect(
      updated.every((o) => (o.payload['changedFields'] as string[]).sort().join() === 'counterpartyId,notes'),
    ).toBe(true);
    expect(
      ctx.state.outbox.filter((o) => o.eventType === 'transactions.TransactionCategorized'),
    ).toHaveLength(0);
    const cleared = await ctx.bulk.bulkEdit(cmd(ctx, set.data, { counterpartyId: null, notes: null }));
    expect(cleared.data.every((t) => t.counterpartyId === null && t.notes === null)).toBe(true);
    expect(
      (await failure(ctx.bulk.bulkEdit(cmd(ctx, cleared.data, { counterpartyId: 'archived-cp' })))).code,
    ).toBe('COUNTERPARTY_ARCHIVED');
  });
});

describe('BulkEditService — vista previa', () => {
  it('[TC-TRANSACTIONS-BULK-002] por filtro informa 4 transacciones con su versión, 3 aplicables y 1 no aplicable; no escribe nada', async () => {
    const ctx = setup();
    await threeExpenses(ctx);
    await ctx.service.recordTransaction(
      expense({
        amount: bob('300.00'),
        splits: [
          { amount: bob('200.00'), categoryId: SUPER },
          { amount: bob('100.00'), categoryId: SUPER },
        ],
      }),
    );
    const before = snapshotOf(ctx);
    const preview = await ctx.bulk.preview({
      workspaceId: WS,
      userId: USER,
      selection: { filter: { accountIds: [BANK], kinds: ['EXPENSE'], sort: '-transactionDate' } },
      changes: { categoryId: HOGAR },
    });
    expect(preview.count).toBe(4);
    expect(preview.truncated).toBe(false);
    expect(preview.items.map((i) => i.applicable)).toEqual([true, true, true, false]);
    expect(preview.items.every((i) => i.version === 1)).toBe(true);
    expect(preview.items[3]?.reasons).toEqual(['BULK_EDIT_NOT_APPLICABLE']);
    expect(snapshotOf(ctx)).toEqual(before);
  });

  it('[TC-TRANSACTIONS-BULK-002] por selección marca inexistentes y periodos cerrados sin modificar nada', async () => {
    const ctx = setup();
    const [t1, t2] = await threeExpenses(ctx);
    ctx.state.closedMonths.add('2026-03');
    const before = snapshotOf(ctx);
    const preview = await ctx.bulk.preview({
      workspaceId: WS,
      userId: USER,
      selection: {
        items: [{ id: (t1 as { id: string }).id }, { id: 'nope' }, { id: (t2 as { id: string }).id }],
      },
      changes: { categoryId: HOGAR },
    });
    expect(preview.items.map((i) => [i.applicable, i.reasons])).toEqual([
      [false, ['PERIOD_CLOSED']],
      [false, ['RESOURCE_NOT_FOUND']],
      [false, ['PERIOD_CLOSED']],
    ]);
    expect(preview.items[1]?.version).toBeNull();
    expect(snapshotOf(ctx)).toEqual(before);
  });
});

describe('BulkEditService — estado cleared', () => {
  it('[TC-TRANSACTIONS-BULK-006] confirmar y etiquetar en una operación publica un TransactionCleared por transacción con bulkOperationId', async () => {
    const ctx = setup();
    const txs = (await threeExpenses(ctx)).slice(0, 2);
    const res = await ctx.bulk.bulkEdit(cmd(ctx, txs, { cleared: true, addTagIds: ['tag-revisado'] }));
    expect(res.data.map((t) => [t.status, t.version, t.splits[0]?.tagIds])).toEqual([
      ['CLEARED', 2, ['tag-revisado']],
      ['CLEARED', 2, ['tag-revisado']],
    ]);
    const cleared = ctx.state.outbox.filter((o) => o.eventType === 'transactions.TransactionCleared');
    expect(cleared).toHaveLength(2);
    expect(cleared.every((o) => o.payload['bulkOperationId'] === res.bulkOperationId)).toBe(true);
    // Recorrido: una transición CLEAR por transacción.
    expect(
      ctx.state.lifecycle.filter((l) => l.kind === 'TRANSITION' && l.transition === 'CLEAR'),
    ).toHaveLength(2);
  });

  it('[TC-TRANSACTIONS-BULK-006] desconfirmar un gasto reconciliado ⇒ TRANSACTION_RECONCILED y el confirmado sigue cleared', async () => {
    const ctx = setup();
    const r = (await ctx.service.recordTransaction(expense({ status: 'CLEARED' }))).transaction;
    const reconciled = await ctx.service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: r.id,
      expectedVersion: 1,
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    const c = (
      await ctx.service.recordTransaction(
        expense({
          status: 'CLEARED',
          amount: bob('45.90'),
          splits: [{ amount: bob('45.90'), categoryId: SUPER }],
        }),
      )
    ).transaction;
    const err = await failure(ctx.bulk.bulkEdit(cmd(ctx, [reconciled, c], { cleared: false })));
    expect(err.code).toBe('TRANSACTION_RECONCILED');
    expect(err.violations.map((v) => v.pointer)).toEqual(['/items/0']);
    expect(ctx.state.txs.get(c.id)?.status).toBe('CLEARED');
    // Una posted no se puede desconfirmar.
    const posted = (await threeExpenses(ctx))[0] as { id: string; version: number };
    expect((await failure(ctx.bulk.bulkEdit(cmd(ctx, [posted], { cleared: false })))).code).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });
});

describe('BulkEditService — auditoría', () => {
  it('[TC-TRANSACTIONS-BULK-007] un registro por transacción (categoría antes/después y bulkOperationId) más uno agregado, todos con la misma correlación', async () => {
    const ctx = setup();
    const txs = await threeExpenses(ctx);
    const baseline = ctx.state.audit.length;
    const res = await ctx.bulk.bulkEdit(cmd(ctx, txs, { categoryId: HOGAR }));
    const records = ctx.state.audit.slice(baseline);
    const perTx = records.filter((a) => a.action === 'transactions.transaction.updated');
    expect(perTx).toHaveLength(3);
    for (const a of perTx) {
      expect(a.correlationId).toBe(res.bulkOperationId);
      expect(a.changes?.find((c) => c.field === 'bulkOperationId')?.after).toBe(res.bulkOperationId);
      const splits = a.changes?.find((c) => c.field === 'splits');
      expect(JSON.parse(splits?.before as string)[0].categoryId).toBe(SUPER);
      expect(JSON.parse(splits?.after as string)[0].categoryId).toBe(HOGAR);
    }
    const aggregate = records.filter((a) => a.action === 'transactions.transaction.bulk_edited');
    expect(aggregate).toHaveLength(1);
    expect(aggregate[0]).toMatchObject({
      aggregateType: 'TransactionBulkOperation',
      aggregateId: res.bulkOperationId,
      correlationId: res.bulkOperationId,
    });
    expect(aggregate[0]?.changes?.find((c) => c.field === 'count')?.after).toBe(3);
    // Eventos y recorrido con el mismo identificador.
    expect(
      ctx.state.outbox.every(
        (o) =>
          o.payload['bulkOperationId'] === undefined || o.payload['bulkOperationId'] === res.bulkOperationId,
      ),
    ).toBe(true);
  });

  it('[TC-TRANSACTIONS-BULK-007] si falla la escritura del registro agregado ninguna transacción cambia', async () => {
    const ctx = setup();
    const txs = await threeExpenses(ctx);
    const before = snapshotOf(ctx);
    ctx.faults.auditAction = 'transactions.transaction.bulk_edited';
    await expect(ctx.bulk.bulkEdit(cmd(ctx, txs, { categoryId: HOGAR }))).rejects.toThrow(
      /injected audit fault/,
    );
    expect(snapshotOf(ctx)).toEqual(before);
  });

  it('un cambio que no modifica nada no versiona ni audita las transacciones', async () => {
    const ctx = setup();
    const txs = await threeExpenses(ctx);
    const baseline = ctx.state.audit.length;
    const res = await ctx.bulk.bulkEdit(cmd(ctx, txs, { categoryId: SUPER }));
    expect(res.data.map((t) => t.version)).toEqual([1, 1, 1]);
    expect(ctx.state.audit.slice(baseline).map((a) => a.action)).toEqual([
      'transactions.transaction.bulk_edited',
    ]);
  });
});

describe('BulkEditService — periodos cerrados (D65)', () => {
  async function marchAndApril(ctx: Ctx) {
    const march = (await ctx.service.recordTransaction(expense({ transactionDate: '2026-03-15' })))
      .transaction;
    const april = (
      await ctx.service.recordTransaction(
        expense({
          transactionDate: '2026-04-02',
          amount: bob('45.90'),
          splits: [{ amount: bob('45.90'), categoryId: SUPER }],
        }),
      )
    ).transaction;
    ctx.state.closedMonths.add('2026-03');
    return { march, april };
  }

  it('[TC-TRANSACTIONS-BULK-008] recategorizar incluyendo un gasto de un mes cerrado ⇒ PERIOD_CLOSED por ese gasto, sin cambios, auditoría ni eventos', async () => {
    const ctx = setup();
    const { march, april } = await marchAndApril(ctx);
    const before = snapshotOf(ctx);
    const err = await failure(ctx.bulk.bulkEdit(cmd(ctx, [march, april], { categoryId: HOGAR })));
    expect(err.code).toBe('PERIOD_CLOSED');
    expect(err.violations.map((v) => [v.pointer, v.code])).toEqual([['/items/0', 'PERIOD_CLOSED']]);
    expect(snapshotOf(ctx)).toEqual(before);
  });

  it('[TC-PLANNING-LOCK-004] tags, contraparte, custom fields y cleared en periodo cerrado ⇒ PERIOD_CLOSED; las notas se permiten', async () => {
    const ctx = setup();
    const { march, april } = await marchAndApril(ctx);
    for (const changes of [
      { addTagIds: ['tag-viaje'] },
      { counterpartyId: 'cp-2' },
      { customFields: [{ key: 'centro_costo', value: 'oficina' }] },
      { cleared: true },
    ]) {
      const err = await failure(ctx.bulk.bulkEdit(cmd(ctx, [march, april], changes)));
      expect(err.code, JSON.stringify(changes)).toBe('PERIOD_CLOSED');
      expect(err.violations.map((v) => v.pointer)).toEqual(['/items/0']);
    }
    const notes = await ctx.bulk.bulkEdit(cmd(ctx, [march, april], { notes: 'Revisado' }));
    expect(notes.data.map((t) => [t.notes, t.version, t.amount.toFixed()])).toEqual([
      ['Revisado', 2, '150.00'],
      ['Revisado', 2, '45.90'],
    ]);
  });
});

describe('BulkEditService — custom fields', () => {
  it('[TC-TRANSACTIONS-BULK-010] fija un valor válido en todos los splits; una opción inexistente ⇒ CUSTOM_FIELD_VALUE_INVALID', async () => {
    const ctx = setup();
    const txs = (await threeExpenses(ctx)).slice(0, 2);
    const balance = ctx.balanceOf(BANK);
    const ok = await ctx.bulk.bulkEdit(
      cmd(ctx, txs, { customFields: [{ key: 'centro_costo', value: 'oficina' }] }),
    );
    expect(ok.data.map((t) => t.splits[0]?.customFields.map((v) => [v.key, v.value]))).toEqual([
      [['centro_costo', 'oficina']],
      [['centro_costo', 'oficina']],
    ]);
    expect(ctx.balanceOf(BANK)).toBe(balance);
    const before = snapshotOf(ctx);
    const err = await failure(
      ctx.bulk.bulkEdit(cmd(ctx, ok.data, { customFields: [{ key: 'centro_costo', value: 'taller' }] })),
    );
    expect(err.code).toBe('CUSTOM_FIELD_VALUE_INVALID');
    expect(snapshotOf(ctx)).toEqual(before);
    // Quitar el valor.
    const removed = await ctx.bulk.bulkEdit(
      cmd(ctx, ok.data, { customFields: [{ key: 'centro_costo', value: null }] }),
    );
    expect(removed.data.every((t) => t.splits[0]?.customFields.length === 0)).toBe(true);
  });
});

describe('BulkEditService — límites', () => {
  it('[TC-TRANSACTIONS-BULK-009] 0 o 501 ítems o ids repetidos ⇒ VALIDATION_FAILED', async () => {
    const ctx = setup();
    const [t1] = await threeExpenses(ctx);
    const one = { id: (t1 as { id: string }).id, version: 1 };
    expect((await failure(ctx.bulk.bulkEdit(cmd(ctx, [], { categoryId: HOGAR })))).code).toBe(
      'VALIDATION_FAILED',
    );
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `t-${i}`, version: 1 }));
    expect((await failure(ctx.bulk.bulkEdit(cmd(ctx, many, { categoryId: HOGAR })))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await failure(ctx.bulk.bulkEdit(cmd(ctx, [one, one], { categoryId: HOGAR })))).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('500 ítems en una operación: todo o nada, un TransactionCategorized por transacción', async () => {
    const ctx = setup();
    const txs = [];
    for (let i = 0; i < 500; i++) {
      txs.push(
        (
          await ctx.service.recordTransaction(
            expense({ amount: bob('10.00'), splits: [{ amount: bob('10.00'), categoryId: SUPER }] }),
          )
        ).transaction,
      );
    }
    const res = await ctx.bulk.bulkEdit(cmd(ctx, txs, { categoryId: HOGAR }));
    expect(res.data).toHaveLength(500);
    expect(
      ctx.state.outbox.filter(
        (o) =>
          o.eventType === 'transactions.TransactionCategorized' &&
          o.payload['bulkOperationId'] === res.bulkOperationId,
      ),
    ).toHaveLength(500);
  });
});
