/** Hechos de ejemplo de los contratos `planning.BudgetThresholdReached.v1` y `planning.MonthClosePending.v1`. */
export const WS = '01928c4e-0000-7000-8000-00000000a001';
export const PERIOD_ID = '01928c4e-0000-7000-8000-0000000fa011';
export const BUDGET_ID = '01928c4e-0000-7000-8000-0000000fb001';
export const LINE_ID = '01928c4e-0000-7000-8000-0000000fb101';
export const RESTAURANTS_ID = '01928c4e-0000-7000-8000-0000000ca003';

/** "Restaurantes", 2026-11, umbral 90 % (también 50 y 75 %), 550.00 de 600.00 BOB. */
export const thresholdPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  budgetId: BUDGET_ID,
  budgetLineId: LINE_ID,
  periodId: PERIOD_ID,
  periodLabel: '2026-11',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  target: { kind: 'CATEGORY', id: RESTAURANTS_ID },
  threshold: '90',
  alsoCrossed: ['50', '75'],
  reference: { amount: '600.00', currency: 'BOB' },
  actual: { amount: '550.00', currency: 'BOB' },
  utilization: '91.7',
  actualComplete: true,
  crossedAt: '2026-11-12T15:20:00.000Z',
  ...overrides,
});

/** Octubre 2026 sin cerrar, publicado 3 días después de su fin. */
export const closePendingPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  workspaceId: WS,
  periodId: PERIOD_ID,
  periodLabel: '2026-10',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  pendingSince: '2026-11-01',
  delayDays: 3,
  ...overrides,
});

export const OCCURRENCE_ID = '01928c4e-0000-7000-8000-0000000cc001';
export const DEFINITION_ID = '01928c4e-0000-7000-8000-0000000de001';

/** `commitments.RecurringOccurrenceDue.v1`: "Alquiler" 3500.00 BOB, vence el 2026-11-05, en aprobación pendiente. */
export const occurrenceDuePayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  workspaceId: WS,
  occurrenceId: OCCURRENCE_ID,
  definitionId: DEFINITION_ID,
  name: 'Alquiler',
  kind: 'EXPENSE',
  occurrenceDate: '2026-11-05',
  dueDate: '2026-11-05',
  expected: { type: 'FIXED', amount: '3500.00', min: null, max: null },
  currency: 'BOB',
  requiresApproval: true,
  mode: 'PENDING_APPROVAL',
  managedBy: 'USER',
  periodId: '01928c4e-0000-7000-8000-0000000fa011',
  ...overrides,
});
