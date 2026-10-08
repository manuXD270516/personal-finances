import { DomainError } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccountsService } from './accounts.service.js';
import { InMemoryAccounts } from './testing/in-memory.js';

const W1 = 'w1';
const SUCURSAL = 'field-sucursal';
const EJECUTIVO = 'field-ejecutivo';
const CENTRO_COSTO = 'field-centro-costo';

let mem: InMemoryAccounts;
let svc: AccountsService;

beforeEach(() => {
  mem = new InMemoryAccounts();
  mem.customFieldDefs.push(
    { fieldId: SUCURSAL, key: 'sucursal', dataType: 'TEXT', target: 'ACCOUNT' },
    { fieldId: EJECUTIVO, key: 'ejecutivo', dataType: 'TEXT', target: 'ACCOUNT' },
    { fieldId: CENTRO_COSTO, key: 'centro_costo', dataType: 'TEXT', target: 'TRANSACTION' },
  );
  svc = new AccountsService(mem.deps());
});

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

const bankA = (over: Record<string, unknown> = {}) =>
  svc.openAccount({
    workspaceId: W1,
    name: 'Bank A',
    type: 'BANK',
    currency: 'BOB',
    openingBalance: { amount: { amount: '1000.00', currency: 'BOB' }, date: '2026-01-01' },
    ...over,
  });

describe('Custom fields de cuenta (tarea 2.3)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-005] [TC-CLASSIFICATION-CUSTOMFIELD-007] asignar "sucursal" no cambia el saldo ni crea asientos; se audita y se emite AccountUpdated[customFields]', async () => {
    const view = await bankA();
    const entries = mem.openingEntries.length;
    const updated = await svc.updateAccount(W1, view.account.id, view.account.version, {
      customFields: [{ key: 'sucursal', value: 'Sucursal Centro' }],
    });
    expect(updated.account.customFields).toEqual([
      { fieldId: SUCURSAL, key: 'sucursal', valueType: 'TEXT', value: 'Sucursal Centro' },
    ]);
    expect(updated.balance).toEqual({ amount: '1000.00', currency: 'BOB' });
    expect(mem.openingEntries).toHaveLength(entries);
    expect(mem.audits.at(-1)).toMatchObject({
      action: 'accounts.account.updated',
      changes: [{ field: 'customFields.sucursal', before: null, after: 'Sucursal Centro' }],
    });
    expect(mem.events.at(-1)).toMatchObject({
      eventType: 'accounts.AccountUpdated',
      payload: { changedFields: ['customFields'] },
    });
    // El mismo valor es un no-op: sin versión nueva ni evento.
    const events = mem.events.length;
    const same = await svc.updateAccount(W1, view.account.id, updated.account.version, {
      customFields: [{ fieldId: SUCURSAL, value: 'Sucursal Centro' }],
    });
    expect(same.account.version).toBe(updated.account.version);
    expect(mem.events).toHaveLength(events);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-005] al crear la cuenta se guardan y se auditan; lo no mencionado al editar se conserva; null quita', async () => {
    const view = await bankA({
      customFields: [
        { key: 'sucursal', value: 'Centro' },
        { key: 'ejecutivo', value: 'Ana' },
      ],
    });
    expect(mem.audits.find((a) => a.action === 'accounts.account.opened')?.changes).toEqual(
      expect.arrayContaining([
        { field: 'customFields.sucursal', before: null, after: 'Centro' },
        { field: 'customFields.ejecutivo', before: null, after: 'Ana' },
      ]),
    );
    const edited = await svc.updateAccount(W1, view.account.id, 1, {
      customFields: [{ key: 'ejecutivo', value: null }],
    });
    expect(edited.account.customFields.map((v) => [v.key, v.value])).toEqual([['sucursal', 'Centro']]);
    // Una edición descriptiva no toca los custom fields.
    const renamed = await svc.updateAccount(W1, view.account.id, edited.account.version, { notes: 'x' });
    expect(renamed.account.customFields).toHaveLength(1);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-004] un campo de transacción en una cuenta ⇒ CUSTOM_FIELD_TARGET_MISMATCH y no se crea', async () => {
    expect(await code(bankA({ customFields: [{ key: 'centro_costo', value: 'casa' }] }))).toBe(
      'CUSTOM_FIELD_TARGET_MISMATCH',
    );
    expect(mem.accounts.size).toBe(0);
    expect(mem.openingEntries).toHaveLength(0);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-006] obligatorio: se exige en cuentas nuevas y al editar custom fields, no en ediciones descriptivas', async () => {
    const legacy = await bankA({ name: 'Antigua' });
    mem.customFieldDefs[0] = {
      ...(mem.customFieldDefs[0] as (typeof mem.customFieldDefs)[number]),
      required: true,
    };
    expect(await code(bankA({ name: 'Nueva' }))).toBe('CUSTOM_FIELD_REQUIRED');
    expect(
      await code(bankA({ name: 'Nueva', customFields: [{ key: 'sucursal', value: 'Centro' }] })),
    ).toBeUndefined();
    const edited = await svc.updateAccount(W1, legacy.account.id, 1, { name: 'Antigua renombrada' });
    expect(edited.account.customFields).toEqual([]);
    expect(
      await code(
        svc.updateAccount(W1, legacy.account.id, edited.account.version, {
          customFields: [{ key: 'ejecutivo', value: 'Ana' }],
        }),
      ),
    ).toBe('CUSTOM_FIELD_REQUIRED');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-008] un campo archivado no acepta valores y los históricos se conservan', async () => {
    const view = await bankA({ customFields: [{ key: 'sucursal', value: 'Centro' }] });
    mem.customFieldDefs[0] = {
      ...(mem.customFieldDefs[0] as (typeof mem.customFieldDefs)[number]),
      archived: true,
    };
    expect(
      await code(
        svc.updateAccount(W1, view.account.id, 1, { customFields: [{ key: 'sucursal', value: 'Otra' }] }),
      ),
    ).toBe('CUSTOM_FIELD_ARCHIVED');
    const unchanged = await svc.getAccount(W1, view.account.id);
    expect(unchanged.account.customFields.map((v) => v.value)).toEqual(['Centro']);
  });

  it('un valor inválido hace rollback de la cuenta, su evento y su auditoría', async () => {
    mem.customFieldDefs.push({ fieldId: 'f-bool', key: 'activo', dataType: 'BOOLEAN', target: 'ACCOUNT' });
    expect(await code(bankA({ customFields: [{ key: 'activo', value: 'si' }] }))).toBe(
      'CUSTOM_FIELD_VALUE_INVALID',
    );
    expect(mem.accounts.size).toBe(0);
    expect(mem.events).toHaveLength(0);
    expect(mem.audits).toHaveLength(0);
  });
});
