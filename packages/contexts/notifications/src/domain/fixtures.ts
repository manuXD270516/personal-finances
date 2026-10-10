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

export const SUBSCRIPTION_ID = '01928c4e-0000-7000-8000-0000000a5001';
export const SUBSCRIPTION_DEFINITION_ID = '01928c4e-0000-7000-8000-0000000de002';
export const PROPOSAL_ID = '01928c4e-0000-7000-8000-0000000b0001';

/** `commitments.SubscriptionRenewalUpcoming.v1`: "Streamly" Premium, 10.99 USD, renueva el 2026-11-15 con "Visa USD". */
export const renewalPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  workspaceId: WS,
  subscriptionId: SUBSCRIPTION_ID,
  definitionId: SUBSCRIPTION_DEFINITION_ID,
  providerName: 'Streamly',
  planName: 'Premium',
  renewalDate: '2026-11-15',
  daysBefore: 3,
  expectedPrice: { amount: '10.99', currency: 'USD' },
  expectedCharge: { amount: '10.99', currency: 'USD' },
  paymentAccountId: '01928c4e-0000-7000-8000-0000000acc01',
  paymentAccountName: 'Visa USD',
  requiresApproval: false,
  ...overrides,
});

/** `commitments.SubscriptionTrialEnding.v1`: "CloudDrive", el trial termina el 2026-11-20; primer cobro 99.99 USD. */
export const trialEndingPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  workspaceId: WS,
  subscriptionId: SUBSCRIPTION_ID,
  definitionId: SUBSCRIPTION_DEFINITION_ID,
  providerName: 'CloudDrive',
  trialEndsOn: '2026-11-20',
  daysBefore: 3,
  firstChargePrice: { amount: '99.99', currency: 'USD' },
  paymentAccountId: '01928c4e-0000-7000-8000-0000000acc01',
  paymentAccountName: 'Visa USD',
  ...overrides,
});

/** `commitments.SubscriptionPriceChanged.v1`: "MusicBox" 9.99 → 11.99 USD desde 2026-11-05 (+20.02), detectado. */
export const priceChangedPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  workspaceId: WS,
  subscriptionId: SUBSCRIPTION_ID,
  definitionId: SUBSCRIPTION_DEFINITION_ID,
  counterpartyId: '01928c4e-0000-7000-8000-0000000c0001',
  providerName: 'MusicBox',
  previousPrice: { amount: '9.99', currency: 'USD' },
  newPrice: { amount: '11.99', currency: 'USD' },
  effectiveFrom: '2026-11-05',
  changePercentage: '+20.02',
  origin: 'DETECTED',
  proposalId: PROPOSAL_ID,
  chargeId: '01928c4e-0000-7000-8000-0000000c4001',
  transactionId: '01928c4e-0000-7000-8000-0000000a7001',
  ...overrides,
});
