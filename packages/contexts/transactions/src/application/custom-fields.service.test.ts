import { DomainError } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { inMemoryTransactionsDeps, type FakeCustomField } from './testing/in-memory.js';
import {
  TransactionsService,
  type RecordTransactionCommand,
  type SplitDto,
  type UpdateTransactionCommand,
} from './transactions.service.js';

const WS = 'ws-1';
const USER = 'user-1';
const BANK = 'bank-a';
const CC = 'field-centro-costo';
const FACTURA = 'field-factura';
const LITROS = 'field-litros';
const SUCURSAL = 'field-sucursal';

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
    { fieldId: FACTURA, key: 'factura', dataType: 'TEXT', target: 'TRANSACTION' },
    { fieldId: LITROS, key: 'litros', dataType: 'DECIMAL', target: 'TRANSACTION' },
    { fieldId: SUCURSAL, key: 'sucursal', dataType: 'TEXT', target: 'ACCOUNT' },
  ];
  mem.state.customFields.push(...fields);
  return { ...mem, service: new TransactionsService(mem.deps) };
}

const split = (
  amount: string,
  customFields?: SplitDto['customFields'],
  categoryId = 'groceries',
): SplitDto => ({
  amount: bob(amount),
  categoryId,
  ...(customFields ? { customFields } : {}),
});

const expense = (over: Partial<RecordTransactionCommand> = {}): RecordTransactionCommand => ({
  workspaceId: WS,
  userId: USER,
  kind: 'EXPENSE',
  transactionDate: '2026-03-15',
  accountId: BANK,
  amount: bob('150.00'),
  description: 'Compra',
  ...over,
});

const update = (
  id: string,
  expectedVersion: number,
  over: Partial<UpdateTransactionCommand>,
): UpdateTransactionCommand => ({
  workspaceId: WS,
  userId: USER,
  transactionId: id,
  expectedVersion,
  ...over,
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe('Custom fields por split (tareas 2.3, 3.2)', () => {
  it('[TC-TRANSACTIONS-CUSTOMFIELD-001] ida y vuelta: el split devuelve exactamente sus custom fields', async () => {
    const { transaction } = await ctx.service.recordTransaction(
      expense({
        amount: bob('45.90'),
        splits: [
          split('45.90', [
            { key: 'centro_costo', value: 'casa' },
            { fieldId: FACTURA, value: 'F-001234' },
          ]),
        ],
      }),
    );
    const stored = ctx.state.txs.get(transaction.id);
    expect(stored?.splits[0]?.customFields.map((v) => [v.key, v.value])).toEqual([
      ['centro_costo', 'casa'],
      ['factura', 'F-001234'],
    ]);
    expect(stored?.amount.toFixed()).toBe('45.90');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] un decimal viaja exacto y uno inválido no registra el gasto', async () => {
    const { transaction } = await ctx.service.recordTransaction(
      expense({
        amount: bob('120.00'),
        splits: [split('120.00', [{ key: 'litros', value: '35.1250' }])],
      }),
    );
    expect(transaction.splits[0]?.customFields).toEqual([
      { fieldId: LITROS, key: 'litros', valueType: 'NUMBER', value: '35.125' },
    ]);
    const before = ctx.state.txs.size;
    expect(
      await codeOf(
        ctx.service.recordTransaction(
          expense({ splits: [split('150.00', [{ key: 'litros', value: '3,5' }])] }),
        ),
      ),
    ).toBe('CUSTOM_FIELD_VALUE_INVALID');
    expect(ctx.state.txs.size).toBe(before);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-004] cada split guarda su valor; Σ splits sigue siendo el monto; un campo de cuenta ⇒ TARGET_MISMATCH', async () => {
    const { transaction } = await ctx.service.recordTransaction(
      expense({
        amount: bob('300.00'),
        splits: [
          split('200.00', [{ key: 'centro_costo', value: 'casa' }]),
          split('100.00', [{ key: 'centro_costo', value: 'oficina' }]),
        ],
      }),
    );
    expect(transaction.splits.map((x) => x.customFields[0]?.value)).toEqual(['casa', 'oficina']);
    expect(transaction.splits.map((x) => x.amount.toFixed())).toEqual(['200.00', '100.00']);
    expect(
      await codeOf(
        ctx.service.recordTransaction(
          expense({ amount: bob('45.90'), splits: [split('45.90', [{ key: 'sucursal', value: 'Centro' }])] }),
        ),
      ),
    ).toBe('CUSTOM_FIELD_TARGET_MISMATCH');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-006] obligatorio: se exige en un gasto nuevo (con o sin splits) y no es retroactivo', async () => {
    const { transaction: g0 } = await ctx.service.recordTransaction(expense());
    ctx.state.customFields[0] = { ...(ctx.state.customFields[0] as FakeCustomField), required: true };
    expect(await codeOf(ctx.service.recordTransaction(expense({ amount: bob('45.90') })))).toBe(
      'CUSTOM_FIELD_REQUIRED',
    );
    expect(
      await codeOf(
        ctx.service.recordTransaction(expense({ amount: bob('45.90'), splits: [split('45.90')] })),
      ),
    ).toBe('CUSTOM_FIELD_REQUIRED');
    expect(ctx.state.txs.size).toBe(1);
    // Editar la descripción de G0 (sin centro de costo) se acepta y sigue sin valor.
    const edited = await ctx.service.updateTransaction(
      update(g0.id, g0.version, { description: 'Compra mensual' }),
    );
    expect(edited.description).toBe('Compra mensual');
    expect(edited.splits[0]?.customFields).toEqual([]);
    // Editar la clasificación sin tocar custom fields tampoco lo exige.
    await ctx.service.updateTransaction(
      update(g0.id, edited.version, { splits: [split('150.00', undefined, 'home')] }),
    );
    // Pero al editar sus custom fields sí: quitar el valor de un obligatorio se rechaza.
    expect(
      await codeOf(
        ctx.service.updateTransaction(
          update(g0.id, edited.version + 1, {
            splits: [split('150.00', [{ key: 'factura', value: 'F-1' }])],
          }),
        ),
      ),
    ).toBe('CUSTOM_FIELD_REQUIRED');
    const ok = await ctx.service.updateTransaction(
      update(g0.id, edited.version + 1, {
        splits: [
          split('150.00', [
            { key: 'centro_costo', value: 'casa' },
            { key: 'factura', value: 'F-1' },
          ]),
        ],
      }),
    );
    expect(ok.splits[0]?.customFields.map((v) => v.value)).toEqual(['casa', 'F-1']);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-008] un campo archivado no acepta valores nuevos pero conserva los históricos', async () => {
    const { transaction } = await ctx.service.recordTransaction(
      expense({
        amount: bob('45.90'),
        splits: [split('45.90', [{ key: 'centro_costo', value: 'oficina' }])],
      }),
    );
    ctx.state.customFields[0] = { ...(ctx.state.customFields[0] as FakeCustomField), archived: true };
    expect(
      await codeOf(
        ctx.service.recordTransaction(
          expense({ splits: [split('150.00', [{ key: 'centro_costo', value: 'casa' }])] }),
        ),
      ),
    ).toBe('CUSTOM_FIELD_ARCHIVED');
    // Una edición que no menciona el campo conserva su valor histórico.
    const edited = await ctx.service.updateTransaction(
      update(transaction.id, transaction.version, {
        splits: [split('45.90', [{ key: 'factura', value: 'F-9' }])],
      }),
    );
    expect(edited.splits[0]?.customFields.map((v) => [v.key, v.value])).toEqual([
      ['centro_costo', 'oficina'],
      ['factura', 'F-9'],
    ]);
  });
});

describe('Asignar custom fields no toca el ledger (INV-033, tarea 3.3)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-007] cambiar casa → oficina: mismos asientos y saldo, auditoría antes/después y TransactionUpdated[customFields]', async () => {
    const { service, state, balanceOf } = ctx;
    const { transaction } = await service.recordTransaction(
      expense({ splits: [split('150.00', [{ key: 'centro_costo', value: 'casa' }])] }),
    );
    const entries = state.entries.length;
    const balance = balanceOf(BANK);
    const updated = await service.updateTransaction(
      update(transaction.id, transaction.version, {
        splits: [split('150.00', [{ key: 'centro_costo', value: 'oficina' }])],
      }),
    );
    expect(updated.splits[0]?.customFields[0]?.value).toBe('oficina');
    expect(updated).toMatchObject({ revision: 1, activeEntryId: transaction.activeEntryId });
    expect(state.entries).toHaveLength(entries);
    expect(balanceOf(BANK)).toBe(balance);
    expect(state.audit.at(-1)).toMatchObject({
      action: 'transactions.transaction.updated',
      changes: [{ field: 'customFields.centro_costo', before: 'casa', after: 'oficina' }],
    });
    expect(state.outbox.at(-1)).toMatchObject({
      eventType: 'transactions.TransactionUpdated',
      payload: { changedFields: ['customFields'], ledgerImpact: false },
    });
    expect(state.outbox.filter((e) => e.eventType === 'transactions.TransactionPosted')).toHaveLength(1);
    // Repetir el mismo valor es un no-op: ni versión ni evento.
    const outbox = state.outbox.length;
    const same = await service.updateTransaction(
      update(transaction.id, updated.version, {
        splits: [split('150.00', [{ key: 'centro_costo', value: 'oficina' }])],
      }),
    );
    expect(same.version).toBe(updated.version);
    expect(state.outbox).toHaveLength(outbox);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-007] la creación audita cada custom field; un valor `null` lo quita', async () => {
    const { service, state } = ctx;
    const { transaction } = await service.recordTransaction(
      expense({
        splits: [
          split('150.00', [
            { key: 'centro_costo', value: 'casa' },
            { key: 'factura', value: 'F-1' },
          ]),
        ],
      }),
    );
    expect(state.audit.at(-1)?.changes).toEqual(
      expect.arrayContaining([
        { field: 'customFields.centro_costo', before: null, after: 'casa' },
        { field: 'customFields.factura', before: null, after: 'F-1' },
      ]),
    );
    const updated = await service.updateTransaction(
      update(transaction.id, transaction.version, {
        splits: [split('150.00', [{ key: 'factura', value: null }])],
      }),
    );
    expect(updated.splits[0]?.customFields.map((v) => v.key)).toEqual(['centro_costo']);
    expect(state.audit.at(-1)?.changes).toEqual([
      { field: 'customFields.factura', before: 'F-1', after: null },
    ]);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-007] varios splits: la auditoría lleva el valor de cada split como texto JSON', async () => {
    const { service, state } = ctx;
    const { transaction } = await service.recordTransaction(
      expense({
        splits: [
          split('100.00', [{ key: 'centro_costo', value: 'casa' }]),
          split('50.00', [{ key: 'centro_costo', value: 'oficina' }], 'home'),
        ],
      }),
    );
    await service.updateTransaction(
      update(transaction.id, transaction.version, {
        splits: [
          split('100.00', [{ key: 'centro_costo', value: 'oficina' }]),
          split('50.00', undefined, 'home'),
        ],
      }),
    );
    expect(state.audit.at(-1)?.changes).toEqual([
      { field: 'customFields.centro_costo', before: '["casa","oficina"]', after: '["oficina","oficina"]' },
    ]);
  });
});

describe('Periodos cerrados y reversión de splits (tareas 2.3, 3.2)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-010] marzo cerrado ⇒ PERIOD_CLOSED: el valor no cambia y no se escribe auditoría ni evento', async () => {
    const { service, state } = ctx;
    const { transaction } = await service.recordTransaction(
      expense({ splits: [split('150.00', [{ key: 'centro_costo', value: 'casa' }])] }),
    );
    state.closedMonths.add('2026-03');
    const before = { outbox: state.outbox.length, audit: state.audit.length, entries: state.entries.length };
    expect(
      await codeOf(
        service.updateTransaction(
          update(transaction.id, transaction.version, {
            splits: [split('150.00', [{ key: 'centro_costo', value: 'oficina' }])],
          }),
        ),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(state.txs.get(transaction.id)?.splits[0]?.customFields[0]?.value).toBe('casa');
    expect({ outbox: state.outbox.length, audit: state.audit.length, entries: state.entries.length }).toEqual(
      before,
    );
    // En un mes abierto sí; y una edición descriptiva en el mes cerrado sigue permitida (D65).
    const described = await service.updateTransaction(
      update(transaction.id, transaction.version, { notes: 'con factura' }),
    );
    expect(described.notes).toBe('con factura');
    state.closedMonths.delete('2026-03');
    const changed = await service.updateTransaction(
      update(transaction.id, described.version, {
        splits: [split('150.00', [{ key: 'centro_costo', value: 'oficina' }])],
      }),
    );
    expect(changed.splits[0]?.customFields[0]?.value).toBe('oficina');
  });

  it('al cambiar los montos de los splits los valores se copian por posición; el valor puede reemplazarse a la vez', async () => {
    const { service } = ctx;
    const { transaction } = await service.recordTransaction(
      expense({
        amount: bob('300.00'),
        splits: [
          split('200.00', [{ key: 'centro_costo', value: 'casa' }]),
          split('100.00', [{ key: 'centro_costo', value: 'oficina' }], 'home'),
        ],
      }),
    );
    const revised = await service.updateTransaction(
      update(transaction.id, transaction.version, {
        splits: [split('180.00'), split('120.00', [{ key: 'factura', value: 'F-2' }], 'home')],
      }),
    );
    expect(revised.revision).toBe(2);
    expect(revised.splits.map((x) => x.id)).not.toEqual(transaction.splits.map((x) => x.id));
    expect(revised.splits.map((x) => x.customFields.map((v) => [v.key, v.value]))).toEqual([
      [['centro_costo', 'casa']],
      [
        ['centro_costo', 'oficina'],
        ['factura', 'F-2'],
      ],
    ]);
  });

  it('D97: transferencias y conversiones no admiten custom fields', async () => {
    const { service } = ctx;
    const { transaction } = await service.recordTransaction(expense());
    // Un ajuste no tiene splits nominales: custom fields en sus splits ⇒ rechazo.
    expect(
      await codeOf(
        service.recordTransaction({
          ...expense({ kind: 'ADJUSTMENT', direction: 'INCREASE', reason: 'conteo' }),
          splits: [split('150.00', [{ key: 'factura', value: 'F-1' }])],
        }),
      ),
    ).toBe('CUSTOM_FIELD_TARGET_MISMATCH');
    expect(transaction.splits[0]?.customFields).toEqual([]);
  });
});
