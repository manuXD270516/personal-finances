import { describe, expect, it, vi } from 'vitest';
import { IMPORT_ROW_NAMESPACE, type ImportedTransactionRowDto } from '../contracts/index.js';
import { ImportedTransactionsAdapter } from './imported-transactions.adapter.js';
import type { ImportedRefReader, UnitOfWork } from './ports/index.js';

const WS = 'ws-1';
const ACCOUNT = 'acc-1';

const row = (n: number, over: Partial<ImportedTransactionRowDto> = {}): ImportedTransactionRowDto => ({
  rowRef: `row-${n}`,
  date: '2026-10-02',
  direction: 'OUT',
  amount: { amount: '18.00', currency: 'BOB' },
  description: 'PAGO QR CAFE',
  externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: `fp-${n}` },
  ...over,
});

function setup(existing: Record<string, string> = {}) {
  const recorded: unknown[] = [];
  let seq = 0;
  const service = {
    recordTransaction: vi.fn(async (cmd: { externalRef: { id: string } }) => {
      recorded.push(cmd);
      seq += 1;
      return { transaction: { id: `txn-${seq}` }, warnings: [] };
    }),
  };
  const refs: ImportedRefReader = {
    existingByRefs: vi.fn(
      async (input: { readonly ids: readonly string[] }): Promise<ReadonlyMap<string, string>> =>
        new Map<string, string>(
          input.ids
            .filter((id: string) => id in existing)
            .map((id: string): [string, string] => [id, existing[id] as string]),
        ),
    ),
  };
  const uow: UnitOfWork = { run: (_ws, fn) => fn() };
  const adapter = new ImportedTransactionsAdapter(service as never, refs, uow);
  return { adapter, service, refs, recorded };
}

const batch = (rows: ImportedTransactionRowDto[]) => ({
  workspaceId: WS,
  accountId: ACCOUNT,
  importJobId: 'job-1',
  actorUserId: 'user-ana',
  rows,
});

describe('ImportedTransactionsAdapter.recordBatch', () => {
  it('[TC-IMPORTS-CSV-023] una salida es un gasto POSTED y una entrada un ingreso POSTED, source IMPORT, sin categoría explícita', async () => {
    const { adapter, recorded } = setup();
    const result = await adapter.recordBatch(
      batch([
        row(1),
        row(2, { direction: 'IN', amount: { amount: '8000.00', currency: 'BOB' }, description: null }),
      ]),
    );
    expect(result.created).toEqual([
      { rowRef: 'row-1', transactionId: 'txn-1' },
      { rowRef: 'row-2', transactionId: 'txn-2' },
    ]);
    expect(result.alreadyExisting).toEqual([]);
    expect(recorded).toMatchObject([
      {
        workspaceId: WS,
        userId: 'user-ana',
        kind: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-10-02',
        accountId: ACCOUNT,
        source: 'IMPORT',
        importJobId: 'job-1',
        externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: 'fp-1' },
        description: 'PAGO QR CAFE',
      },
      { kind: 'INCOME', amount: { amount: '8000.00', currency: 'BOB' }, description: null },
    ]);
    // Sin split explícito: Transactions aplica la categoría de sistema "sin categoría" (D9).
    for (const cmd of recorded) expect(cmd).not.toHaveProperty('splits');
  });

  it('[TC-IMPORTS-CSV-016] las filas con una transacción no anulada ya vinculada se informan como existentes y no se crean', async () => {
    const { adapter, service } = setup({ 'fp-2': 'txn-old' });
    const result = await adapter.recordBatch(batch([row(1), row(2), row(3)]));
    expect(result.created.map((c) => c.rowRef)).toEqual(['row-1', 'row-3']);
    expect(result.alreadyExisting).toEqual([{ rowRef: 'row-2', transactionId: 'txn-old' }]);
    expect(service.recordTransaction).toHaveBeenCalledTimes(2);
  });

  it('consulta las referencias del lote en una sola lectura set-based', async () => {
    const { adapter, refs } = setup();
    await adapter.recordBatch(batch([row(1), row(2)]));
    expect(refs.existingByRefs).toHaveBeenCalledTimes(1);
    expect(refs.existingByRefs).toHaveBeenCalledWith({
      workspaceId: WS,
      accountId: ACCOUNT,
      namespace: IMPORT_ROW_NAMESPACE,
      ids: ['fp-1', 'fp-2'],
    });
  });

  it('rechaza un espacio de nombres ajeno, una referencia repetida en el lote y lotes enormes', async () => {
    const { adapter } = setup();
    const code = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (e) {
        return (e as { code: string }).code;
      }
      return 'OK';
    };
    expect(
      await code(adapter.recordBatch(batch([row(1, { externalRef: { namespace: 'otro', id: 'x' } })]))),
    ).toBe('VALIDATION_FAILED');
    expect(await code(adapter.recordBatch(batch([row(1), row(1, { rowRef: 'row-dup' })])))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await code(adapter.recordBatch(batch(Array.from({ length: 1001 }, (_, i) => row(i)))))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('un error de dominio de la fila se propaga y no se traga (el lote entero se revierte en el llamador)', async () => {
    const { adapter, service } = setup();
    service.recordTransaction.mockRejectedValueOnce(
      Object.assign(new Error('closed'), { code: 'PERIOD_CLOSED' }),
    );
    await expect(adapter.recordBatch(batch([row(1), row(2)]))).rejects.toMatchObject({
      code: 'PERIOD_CLOSED',
    });
    expect(service.recordTransaction).toHaveBeenCalledTimes(1);
  });
});
