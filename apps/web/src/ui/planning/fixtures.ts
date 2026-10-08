import type { FinancialPeriod } from './logic';

/** Periodos de ejemplo de los tests de componentes (día de inicio 1; "2026-12" de transición). */
export const id = (n: number) => `0190a000-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
export const period = (label: string, over: Partial<FinancialPeriod> = {}): FinancialPeriod => {
  const [y, m] = label.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    id: id(m),
    label,
    periodStart: `${label}-01`,
    periodEnd: `${label}-${String(last).padStart(2, '0')}`,
    status: 'DRAFT',
    startDay: 1,
    isTransition: false,
    pendingClosure: false,
    closeCount: 0,
    reopenCount: 0,
    latestCloseNo: null,
    version: 1,
    createdAt: '2026-10-05T14:00:00.000Z',
    activatedAt: null,
    ...over,
  };
};

export const PERIODS: FinancialPeriod[] = [
  period('2026-10', { status: 'ACTIVE', pendingClosure: true, activatedAt: '2026-10-05T14:00:00.000Z' }),
  period('2026-11', { status: 'DRAFT' }),
  period('2026-12', {
    status: 'DRAFT',
    periodStart: '2026-12-01',
    periodEnd: '2027-01-24',
    isTransition: true,
    startDay: 25,
  }),
];
