import type {
  Budget,
  BudgetLine,
  BudgetLineKind,
  BudgetLineProgress,
  BudgetLineStatus,
  BudgetNature,
} from './budget-logic';

/** Plan de noviembre de ejemplo de los tests de componentes (BOB, escala 2). */
const bob = (amount: string) => ({ amount, currency: 'BOB' });
export const uuid = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const CAT = {
  super: uuid(1),
  rest: uuid(3),
  alquiler: uuid(4),
  educ: uuid(5),
  salario: uuid(7),
} as const;

export function line(
  over: Omit<Partial<BudgetLine>, 'progress'> & {
    id: string;
    kind: BudgetLineKind;
    progress: Partial<BudgetLineProgress>;
  },
): BudgetLine {
  const nature: BudgetNature = over.nature ?? 'EXPENSE';
  const { progress, ...rest } = over;
  return {
    target: { kind: 'CATEGORY', id: CAT.rest },
    nature,
    planned: null,
    min: null,
    max: null,
    percent: null,
    incomeBasis: null,
    rolloverPolicy: 'NONE',
    rolloverCap: null,
    thresholds: nature === 'INCOME' || over.kind === 'MINIMUM' ? [] : ['50', '75', '90', '100'],
    source: 'MANUAL',
    overridden: false,
    version: 1,
    ...rest,
    progress: {
      reference: bob('600.00'),
      effectivePlanned: bob('600.00'),
      minimum: null,
      rolloverIn: null,
      rolloverStatus: 'NONE',
      actual: bob('0.00'),
      actualComplete: true,
      unconverted: [],
      remaining: bob('600.00'),
      difference: bob('-600.00'),
      utilization: '0.0',
      projection: null,
      status: 'WITHIN' as BudgetLineStatus,
      crossedThresholds: [],
      ...progress,
    },
  };
}

export const RESTAURANTES_EXCEDIDO = line({
  id: uuid(101),
  kind: 'MAXIMUM',
  target: { kind: 'CATEGORY', id: CAT.rest },
  planned: bob('600.00'),
  progress: {
    reference: bob('600.00'),
    effectivePlanned: bob('600.00'),
    actual: bob('650.00'),
    remaining: bob('-50.00'),
    difference: bob('50.00'),
    utilization: '108.3',
    projection: bob('1950.00'),
    status: 'OVER',
    crossedThresholds: ['50', '75', '90', '100'],
  },
});

export const ALQUILER_FIJO = line({
  id: uuid(102),
  kind: 'FIXED',
  target: { kind: 'CATEGORY', id: CAT.alquiler },
  planned: bob('2800.00'),
  progress: {
    reference: bob('2800.00'),
    effectivePlanned: bob('2800.00'),
    actual: bob('2800.00'),
    remaining: bob('0.00'),
    difference: bob('0.00'),
    utilization: '100.0',
    projection: null,
    status: 'ON_TARGET',
    crossedThresholds: ['50', '75', '90', '100'],
  },
});

export const EDUCACION_MINIMO = line({
  id: uuid(103),
  kind: 'MINIMUM',
  target: { kind: 'CATEGORY', id: CAT.educ },
  min: bob('500.00'),
  progress: {
    reference: bob('500.00'),
    effectivePlanned: bob('500.00'),
    minimum: bob('500.00'),
    actual: bob('200.00'),
    remaining: bob('300.00'),
    difference: bob('-300.00'),
    utilization: '40.0',
    projection: null,
    status: 'PENDING',
  },
});

export const SUPERMERCADO_MAXIMO = line({
  id: uuid(104),
  kind: 'MAXIMUM',
  target: { kind: 'CATEGORY', id: CAT.super },
  planned: bob('1500.00'),
  progress: {
    reference: bob('1500.00'),
    effectivePlanned: bob('1500.00'),
    actual: bob('550.00'),
    remaining: bob('950.00'),
    difference: bob('-950.00'),
    utilization: '36.7',
    projection: bob('1650.00'),
    status: 'WITHIN',
    crossedThresholds: ['50'],
  },
});

export const SALARIO_ESPERADO = line({
  id: uuid(105),
  kind: 'FIXED',
  nature: 'INCOME',
  target: { kind: 'CATEGORY', id: CAT.salario },
  planned: bob('8000.00'),
  progress: {
    reference: bob('8000.00'),
    effectivePlanned: bob('8000.00'),
    actual: bob('6500.00'),
    remaining: bob('1500.00'),
    difference: bob('-1500.00'),
    utilization: '81.3',
    projection: null,
    status: 'UNDER',
  },
});

export const RESTAURANTES_ROLLOVER = line({
  id: uuid(106),
  kind: 'MAXIMUM',
  target: { kind: 'CATEGORY', id: CAT.rest },
  planned: bob('600.00'),
  rolloverPolicy: 'CARRY_POSITIVE',
  progress: {
    reference: bob('680.00'),
    effectivePlanned: bob('680.00'),
    rolloverIn: bob('80.00'),
    rolloverStatus: 'PROVISIONAL',
    actual: bob('341.00'),
    actualComplete: false,
    unconverted: [{ amount: '5.00', currency: 'EUR' }],
    remaining: bob('339.00'),
    utilization: '50.1',
    projection: bob('1023.00'),
    status: 'WITHIN',
    crossedThresholds: ['50'],
  },
});

export function plan(lines: readonly BudgetLine[], over: Partial<Budget> = {}): Budget {
  return {
    id: uuid(900),
    periodId: uuid(11),
    periodLabel: '2026-11',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    periodStatus: 'ACTIVE',
    currency: 'BOB',
    origin: 'EMPTY',
    zeroBased: false,
    lines,
    totals: {
      planned: bob('5000.00'),
      actual: bob('4000.00'),
      remaining: bob('1000.00'),
      availableToSpend: bob('3750.00'),
      expectedIncome: bob('8000.00'),
      actualIncome: bob('6500.00'),
      toAssign: null,
      complete: true,
      unconverted: [],
    },
    meta: {
      generatedAt: '2026-11-10T15:00:00.000Z',
      timeZone: 'America/La_Paz',
      rateWindowDays: 7,
      ratesUsed: [],
      attributions: [],
    },
    version: 3,
    ...over,
  };
}
