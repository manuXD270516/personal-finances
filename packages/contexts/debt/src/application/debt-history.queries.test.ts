import { describe, expect, it } from 'vitest';
import { LoansQueries } from './loans.queries.js';
import type { DebtDeps } from './ports/index.js';

const WS = '0190a000-0000-7000-8000-00000000a001';
const AUTO = '0190a000-0000-7000-8000-00000000d001';

/** `LoansQueries.monthly` solo usa la unidad de trabajo y el puerto de pagos por fecha. */
function queriesWith(
  rows: Awaited<ReturnType<DebtDeps['payments']['paidByDate']>>,
  calls: { from: string; to: string }[] = [],
) {
  const deps = {
    uow: { run: <T>(_ws: string, fn: () => Promise<T>) => fn() },
    payments: {
      paidByDate: async (_ws: string, range: { from: string; to: string }) => {
        calls.push(range);
        return rows;
      },
    },
  } as unknown as DebtDeps;
  return new LoansQueries(deps);
}

const pay = (
  date: string,
  principal: string,
  interest: string,
  fees = '0.00',
  insurance = '0.00',
  taxes = '0.00',
) => ({
  loanId: AUTO,
  date,
  currency: 'BOB',
  principal,
  interest,
  fees,
  insurance,
  taxes,
});

describe('DebtHistoryQuery.monthly (TC-REPORTING-REPORTS-044)', () => {
  it('[TC-REPORTING-REPORTS-044] agrupa por préstamo y mes: principal, interés y cargos con cada pago y su fecha', async () => {
    const q = queriesWith([
      pay('2026-09-15', '1100.00', '320.00', '50.00', '20.00', '10.00'),
      pay('2026-10-05', '500.00', '150.00'),
      pay('2026-10-20', '610.00', '160.00', '80.00'),
    ]);
    const rows = await q.monthly({ workspaceId: WS, from: '2026-09-01', to: '2026-10-31' });
    expect(rows.map((r) => [r.month, r.principal, r.interest, r.charges])).toEqual([
      ['2026-09', '1100.00', '320.00', '80.00'],
      ['2026-10', '1110.00', '310.00', '80.00'],
    ]);
    expect(rows[1]?.payments.map((p) => p.date)).toEqual(['2026-10-05', '2026-10-20']);
    expect(rows[0]?.payments[0]).toEqual({
      date: '2026-09-15',
      principal: '1100.00',
      interest: '320.00',
      charges: '80.00',
    });
  });

  it('[TC-REPORTING-REPORTS-044] consulta solo el rango pedido y rechaza una fecha malformada', async () => {
    const calls: { from: string; to: string }[] = [];
    const q = queriesWith([], calls);
    expect(await q.monthly({ workspaceId: WS, from: '2026-09-01', to: '2026-10-31' })).toEqual([]);
    expect(calls).toEqual([{ from: '2026-09-01', to: '2026-10-31' }]);
    await expect(q.monthly({ workspaceId: WS, from: 'ayer', to: '2026-10-31' })).rejects.toThrow();
  });
});
