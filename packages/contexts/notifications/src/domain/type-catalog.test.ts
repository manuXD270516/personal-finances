import { describe, expect, it } from 'vitest';
import {
  closePendingPayload,
  OCCURRENCE_ID,
  occurrenceDuePayload,
  PERIOD_ID,
  RESTAURANTS_ID,
  thresholdPayload,
} from './fixtures.js';
import {
  definitionForConsumer,
  definitionOf,
  NOTIFICATION_TYPE_CATALOG,
  severityOfThreshold,
} from './type-catalog.js';

const threshold = definitionOf('BUDGET_THRESHOLD');
const closePending = definitionOf('MONTH_CLOSE_PENDING');

describe('NotificationTypeCatalog: umbral de presupuesto', () => {
  it('[TC-NOTIFICATIONS-INAPP-001] traduce el hecho a clave de deduplicación, severidad, params y enlace', () => {
    const plan = threshold.plan(thresholdPayload());
    expect(plan.type).toBe('BUDGET_THRESHOLD');
    expect(plan.dedupeKey).toBe(`budget-threshold:${PERIOD_ID}:CATEGORY:${RESTAURANTS_ID}:90`);
    expect(plan.severity).toBe('INFO');
    expect(plan.params).toMatchObject({
      periodLabel: '2026-11',
      threshold: '90',
      alsoCrossed: ['50', '75'],
      reference: { amount: '600.00', currency: 'BOB' },
      actual: { amount: '550.00', currency: 'BOB' },
    });
    expect(plan.link).toMatchObject({ kind: 'BUDGET_LINE', periodLabel: '2026-11', targetKind: 'CATEGORY' });
  });

  it('recibe todo miembro activo: OWNER, EDITOR y VIEWER (docs/33 D89)', () => {
    expect(threshold.recipients).toEqual(['OWNER', 'EDITOR', 'VIEWER']);
    expect(threshold.event).toEqual({ type: 'planning.BudgetThresholdReached', version: 1 });
  });

  it('un umbral de 100 % o más es WARNING y por debajo INFO', () => {
    expect(severityOfThreshold('100')).toBe('WARNING');
    expect(severityOfThreshold('125.5')).toBe('WARNING');
    expect(severityOfThreshold('99.99')).toBe('INFO');
    expect(severityOfThreshold('90')).toBe('INFO');
    expect(threshold.plan(thresholdPayload({ threshold: '100', alsoCrossed: [] })).severity).toBe('WARNING');
  });

  it('[TC-NOTIFICATIONS-DEDUP-002] la clave no depende del evento: mismo objetivo, periodo y umbral ⇒ misma clave', () => {
    const a = threshold.plan(thresholdPayload());
    const b = threshold.plan(
      thresholdPayload({ crossedAt: '2026-11-13T10:00:00.000Z', utilization: '92.0' }),
    );
    expect(b.dedupeKey).toBe(a.dedupeKey);
    expect(threshold.plan(thresholdPayload({ threshold: '75', alsoCrossed: [] })).dedupeKey).not.toBe(
      a.dedupeKey,
    );
  });

  it('rechaza un payload mal formado (el consumidor falla y el evento termina en dead-letter)', () => {
    expect(() => threshold.plan(thresholdPayload({ periodLabel: '2026-13' }))).toThrow(/periodLabel/);
    expect(() =>
      threshold.plan(thresholdPayload({ target: { kind: 'ACCOUNT', id: RESTAURANTS_ID } })),
    ).toThrow(/target.kind/);
    expect(() => threshold.plan(thresholdPayload({ actual: { amount: '55a', currency: 'BOB' } }))).toThrow(
      /amount/,
    );
    expect(() => threshold.plan('x')).toThrow(/payload/);
  });
});

describe('NotificationTypeCatalog: cierre de mes pendiente', () => {
  it('[TC-NOTIFICATIONS-INAPP-007] solo OWNER y EDITOR; una notificación por periodo con enlace al cierre', () => {
    expect(closePending.recipients).toEqual(['OWNER', 'EDITOR']);
    const plan = closePending.plan(closePendingPayload());
    expect(plan.dedupeKey).toBe(`month-close-pending:${PERIOD_ID}`);
    expect(plan.severity).toBe('WARNING');
    expect(plan.link).toEqual({ kind: 'PERIOD_CLOSE', periodId: PERIOD_ID, periodLabel: '2026-10' });
    expect(plan.params).toMatchObject({ periodLabel: '2026-10', periodEnd: '2026-10-31' });
  });

  it('cada consumidor resuelve su tipo', () => {
    expect(definitionForConsumer('notifications.month-close-pending')?.type).toBe('MONTH_CLOSE_PENDING');
    expect(definitionForConsumer('notifications.budget-threshold')?.type).toBe('BUDGET_THRESHOLD');
    expect(definitionForConsumer('otro')).toBeUndefined();
    expect(new Set(NOTIFICATION_TYPE_CATALOG.map((d) => d.consumer)).size).toBe(6);
    expect(definitionForConsumer('notifications.occurrence-due')?.type).toBe('RECURRING_PAYMENT_UPCOMING');
  });
});

describe('NotificationTypeCatalog: ocurrencia recurrente próxima', () => {
  const due = definitionOf('RECURRING_PAYMENT_UPCOMING');

  it('[TC-COMMITMENTS-RECUR-043] por aprobar => RECURRING_APPROVAL_REQUIRED, solo OWNER y EDITOR, enlace a la ocurrencia', () => {
    expect(due.recipients).toEqual(['OWNER', 'EDITOR']);
    expect(due.event).toEqual({ type: 'commitments.RecurringOccurrenceDue', version: 1 });
    expect(definitionOf('RECURRING_APPROVAL_REQUIRED')).toBe(due);
    const plan = due.plan(occurrenceDuePayload());
    expect(plan.type).toBe('RECURRING_APPROVAL_REQUIRED');
    expect(plan.link).toEqual({
      kind: 'RECURRING_OCCURRENCE',
      occurrenceId: OCCURRENCE_ID,
      periodId: '01928c4e-0000-7000-8000-0000000fa011',
      periodLabel: '2026-11',
    });
    expect(plan.params).toMatchObject({
      name: 'Alquiler',
      dueDate: '2026-11-05',
      expected: { type: 'FIXED', amount: '3500.00', min: null, max: null },
      currency: 'BOB',
    });
  });

  it('sin aprobación => RECURRING_PAYMENT_UPCOMING', () => {
    const plan = due.plan(occurrenceDuePayload({ requiresApproval: false, mode: 'NOTIFY_ONLY' }));
    expect(plan.type).toBe('RECURRING_PAYMENT_UPCOMING');
    expect(plan.severity).toBe('INFO');
  });

  it('[TC-COMMITMENTS-RECUR-044] la clave de deduplicación es la ocurrencia, no el evento', () => {
    expect(due.plan(occurrenceDuePayload()).dedupeKey).toBe(`occurrence-due:${OCCURRENCE_ID}`);
    expect(due.plan(occurrenceDuePayload({ requiresApproval: false, mode: 'AUTO_CREATE' })).dedupeKey).toBe(
      `occurrence-due:${OCCURRENCE_ID}`,
    );
  });

  it('D119: suprime el aviso solo si lo gestiona una suscripción y no requiere aprobación', () => {
    const suppressed = (o: Record<string, unknown>) => due.suppressed?.(occurrenceDuePayload(o));
    expect(suppressed({ managedBy: 'SUBSCRIPTION', requiresApproval: false })).toBe(true);
    expect(suppressed({ managedBy: 'SUBSCRIPTION', requiresApproval: true })).toBe(false);
    expect(suppressed({ managedBy: 'USER', requiresApproval: false })).toBe(false);
    expect(suppressed({ managedBy: 'DEBT', requiresApproval: false })).toBe(false);
  });

  it('rechaza un payload mal formado', () => {
    expect(() => due.plan(occurrenceDuePayload({ occurrenceId: 'x' }))).toThrow(/occurrenceId/);
    expect(() => due.plan(occurrenceDuePayload({ dueDate: '05/11/2026' }))).toThrow(/dueDate/);
    expect(() => due.plan(occurrenceDuePayload({ managedBy: 'OTHER' }))).toThrow(/managedBy/);
    expect(() =>
      due.plan(occurrenceDuePayload({ expected: { type: 'FIXED', amount: '3x', min: null, max: null } })),
    ).toThrow(/amount/);
  });
});
