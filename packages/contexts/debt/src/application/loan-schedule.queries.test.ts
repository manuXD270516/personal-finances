import { describe, expect, it } from 'vitest';
import { LoansQueries } from './loans.queries.js';
import type { DebtDeps } from './ports/index.js';

const WS = '0190a000-0000-7000-8000-00000000a001';
const AUTO = '0190a000-0000-7000-8000-00000000d001';

const installment = (
  n: number,
  dueDate: string,
  parts: { principal: string; interest: string; fees?: string; insurance?: string; taxes?: string },
) => {
  const fees = parts.fees ?? '0.00';
  const insurance = parts.insurance ?? '0.00';
  const taxes = parts.taxes ?? '0.00';
  return {
    id: `inst-${n}`,
    loanId: AUTO,
    scheduleVersion: 1,
    n,
    dueDate,
    principal: parts.principal,
    interest: parts.interest,
    fees,
    insurance,
    taxes,
    total: [parts.principal, parts.interest, fees, insurance, taxes]
      .reduce((a, b) => a + Number(b) * 100, 0)
      .toString(),
  };
};

/** Solo lo que usa `listUpcomingInstallments`: la lista de préstamos, la escala, el cronograma y lo pagado. */
function queriesWith(
  installments: ReturnType<typeof installment>[],
  paid: Map<string, Record<string, string>> = new Map(),
) {
  const deps = {
    uow: { run: <T>(_ws: string, fn: () => Promise<T>) => fn() },
    currencies: { scaleOf: async () => 2 },
    loans: {
      list: async () => [
        { id: AUTO, snapshot: { name: 'Auto', currency: 'BOB', currentScheduleVersion: 1 } },
      ],
    },
    schedules: { installments: async () => installments },
    payments: { paidByInstallment: async () => paid },
  } as unknown as DebtDeps;
  return new LoansQueries(deps);
}

describe('LoanScheduleQuery.listUpcomingInstallments (add-expense-forecasts, S3)', () => {
  it('[TC-FORECAST-EXPENSE-007] la cuota de 2026-12 informa capital 1064.65, interés 420.35 y seguro 15.00 por separado', async () => {
    const q = queriesWith([
      installment(4, '2026-11-15', { principal: '1050.00', interest: '435.00' }),
      installment(5, '2026-12-15', { principal: '1064.65', interest: '420.35', insurance: '15.00' }),
      installment(6, '2027-01-15', { principal: '1080.00', interest: '405.00' }),
    ]);
    const rows = await q.listUpcomingInstallments({ workspaceId: WS, from: '2026-12-01', to: '2026-12-31' });
    expect(rows).toEqual([
      {
        loanId: AUTO,
        label: 'Auto — cuota 5',
        dueDate: '2026-12-15',
        currency: 'BOB',
        principal: '1064.65',
        interest: '420.35',
        charges: '0.00',
        insurance: '15.00',
        taxes: '0.00',
      },
    ]);
  });

  it('[TC-FORECAST-EXPENSE-007] las cuotas ya pagadas no aportan y una pago parcial deja solo lo pendiente', async () => {
    const q = queriesWith(
      [
        installment(1, '2026-12-01', { principal: '1000.00', interest: '400.00' }),
        installment(2, '2026-12-20', { principal: '1000.00', interest: '400.00' }),
      ],
      new Map([
        [
          'inst-1',
          { principal: '1000.00', interest: '400.00', fees: '0.00', insurance: '0.00', taxes: '0.00' },
        ],
        [
          'inst-2',
          { principal: '300.00', interest: '100.00', fees: '0.00', insurance: '0.00', taxes: '0.00' },
        ],
      ]),
    );
    const rows = await q.listUpcomingInstallments({ workspaceId: WS, from: '2026-12-01', to: '2026-12-31' });
    expect(rows.map((r) => [r.label, r.principal, r.interest])).toEqual([
      ['Auto — cuota 2', '700.00', '300.00'],
    ]);
  });

  it('[TC-FORECAST-EXPENSE-007] rechaza fechas mal formadas', async () => {
    await expect(
      queriesWith([]).listUpcomingInstallments({ workspaceId: WS, from: 'ayer', to: '2026-12-31' }),
    ).rejects.toThrow();
  });
});
