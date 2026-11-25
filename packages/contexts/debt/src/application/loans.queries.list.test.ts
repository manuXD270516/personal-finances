import { describe, expect, it } from 'vitest';
import { LoansQueries } from './loans.queries.js';
import type { DebtDeps } from './ports/index.js';

const WS = '0190a000-0000-7000-8000-00000000a001';
const ids = [
  '0190a000-0000-7000-8000-00000000d001',
  '0190a000-0000-7000-8000-00000000d002',
  '0190a000-0000-7000-8000-00000000d003',
];

const component = (principal: string) => ({
  principal,
  interest: '0.00',
  fees: '0.00',
  insurance: '0.00',
  taxes: '0.00',
});

const inst = (loanId: string, n: number, dueDate: string) => ({
  id: `${loanId}-i${n}`,
  loanId,
  scheduleVersion: 1,
  n,
  dueDate,
  periodStart: dueDate,
  periodEnd: dueDate,
  principal: '100.00',
  interest: '0.00',
  fees: '0.00',
  insurance: '0.00',
  taxes: '0.00',
  total: '100.00',
  openingBalance: '200.00',
  closingBalance: '100.00',
});

/** Cuenta cada consulta al repositorio: la lista no debe hacer una por préstamo. */
function world() {
  const calls = { installments: 0, paidByInstallment: 0, installmentsForLoans: 0, paidForLoans: 0 };
  const loans = ids.map((id, i) => ({
    id,
    snapshot: {
      id,
      name: `Préstamo ${i + 1}`,
      currency: 'BOB',
      status: i === 2 ? 'DRAFT' : 'ACTIVE',
      accountId: `acct-${i}`,
      lenderCounterpartyId: null,
      currentScheduleVersion: i === 2 ? null : 1,
    },
  }));
  const deps = {
    uow: { run: <T>(_ws: string, fn: () => Promise<T>) => fn() },
    currencies: { scaleOf: async () => 2 },
    calendar: { timeZoneOf: async () => 'America/La_Paz' },
    clock: {
      now: () => ({
        toDate: () => new Date('2026-12-16T14:00:00Z'),
        toString: () => '2026-12-16T14:00:00.000Z',
      }),
    },
    counterparties: { names: async () => new Map() },
    balances: { presentedBalances: async () => new Map(ids.map((_, i) => [`acct-${i}`, '100.00'])) },
    loans: { list: async () => loans },
    schedules: {
      installments: async () => {
        calls.installments++;
        return [];
      },
      installmentsForLoans: async () => {
        calls.installmentsForLoans++;
        return new Map([
          [
            ids[0] as string,
            [inst(ids[0] as string, 1, '2026-11-15'), inst(ids[0] as string, 2, '2026-12-15')],
          ],
          [ids[1] as string, [inst(ids[1] as string, 1, '2027-01-15')]],
        ]);
      },
    },
    payments: {
      paidByInstallment: async () => {
        calls.paidByInstallment++;
        return new Map();
      },
      paidByInstallmentForLoans: async () => {
        calls.paidForLoans++;
        return new Map([[ids[0] as string, new Map([[`${ids[0]}-i1`, component('100.00')]])]]);
      },
    },
  } as unknown as DebtDeps;
  return { calls, queries: new LoansQueries(deps) };
}

describe('lista de préstamos sin consultas por préstamo (fix-debt-cards-loans-gaps)', () => {
  it('[TC-DEBT-LOAN-055] la lista lee cronogramas y pagos de todos los préstamos en una consulta cada uno y conserva las cifras', async () => {
    const { calls, queries } = world();
    const rows = await queries.list(WS);
    expect(rows).toHaveLength(3);
    expect(calls).toEqual({
      installments: 0,
      paidByInstallment: 0,
      installmentsForLoans: 1,
      paidForLoans: 1,
    });
    // Préstamo 1: la cuota 1 está pagada; la próxima es la 2 (atrasada al 2026-12-16).
    expect(rows[0]?.nextInstallment).toMatchObject({ n: 2, dueDate: '2026-12-15' });
    expect(rows[0]?.nextInstallment?.overdueDays).toBe(1);
    // Préstamo 2: sin pagos, la próxima es la 1 y no está atrasada.
    expect(rows[1]?.nextInstallment).toMatchObject({ n: 1, dueDate: '2027-01-15', overdueDays: 0 });
    // Borrador: sin cronograma vigente no hay principal pendiente ni próxima cuota.
    expect(rows[2]?.outstandingPrincipal).toBeNull();
    expect(rows[2]?.nextInstallment).toBeNull();
  });
});
