import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { buildAmountSpec, projectedAmount, resolveApprovalAmount } from './amount-spec.js';
import { assertKindAvailable, buildDefinitionVersion } from './definition-version.js';
import { RECURRING_DEFINITION_LIFECYCLE } from './lifecycle.js';
import type { TemplateInput } from './definition-version.js';
import { BANK, BOB, SAVINGS, definition, template, type TemplateOverrides } from './test-fixtures.js';
import { currency } from '@pf/shared-kernel';

const bob = currency('BOB', 2);
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

describe('Definición recurrente: tipo, plantilla y montos', () => {
  it('[TC-COMMITMENTS-RECUR-001] una definición mensual nace ACTIVE en versión 1 con transición CREATE', () => {
    const def = definition('def-1');
    expect(def.status).toBe('ACTIVE');
    expect(def.snapshot.currentVersionNo).toBe(1);
    expect(def.current.amount).toEqual({ type: 'FIXED', amount: '3500.00', min: null, max: null });
    expect(def.lastTransition).toEqual({ transition: 'CREATE', from: null, to: 'ACTIVE' });
    expect(def.persistedVersion).toBe(0);
  });

  it('[TC-COMMITMENTS-RECUR-003] LOAN_PAYMENT y CARD_PAYMENT se rechazan como reservados hasta Phase 4', () => {
    expect(codeOf(() => assertKindAvailable('LOAN_PAYMENT'))).toBe('RECURRING_KIND_NOT_AVAILABLE');
    expect(codeOf(() => assertKindAvailable('CARD_PAYMENT'))).toBe('RECURRING_KIND_NOT_AVAILABLE');
    expect(codeOf(() => assertKindAvailable('SOMETHING'))).toBe('VALIDATION_FAILED');
    expect(assertKindAvailable('TRANSFER')).toBe('TRANSFER');
  });

  it('[TC-COMMITMENTS-RECUR-004] una transferencia necesita destino distinto; el resto de tipos no lo admite', () => {
    const ok = buildDefinitionVersion({
      kind: 'TRANSFER',
      versionNo: 1,
      effectiveFrom: '2026-11-01',
      currency: BOB,
      template: template({
        categoryId: null,
        toAccountId: SAVINGS,
        amount: { type: 'FIXED', amount: '500.00' },
      }),
    });
    expect(ok.toAccountId).toBe(SAVINGS);
    const build = (kind: 'TRANSFER' | 'EXPENSE', over: TemplateOverrides) => () =>
      buildDefinitionVersion({
        kind,
        versionNo: 1,
        effectiveFrom: '2026-11-01',
        currency: BOB,
        template: template(over),
      });
    expect(codeOf(build('TRANSFER', { categoryId: null }))).toBe('VALIDATION_FAILED');
    expect(codeOf(build('TRANSFER', { categoryId: null, toAccountId: BANK }))).toBe('TRANSFER_SAME_ACCOUNT');
    expect(codeOf(build('TRANSFER', { toAccountId: SAVINGS }))).toBe('VALIDATION_FAILED');
    expect(codeOf(build('EXPENSE', { toAccountId: SAVINGS }))).toBe('VALIDATION_FAILED');
  });

  it('[TC-COMMITMENTS-RECUR-010] un gasto MIN_MAX informa el rango y proyecta el máximo; VARIABLE no tiene monto', () => {
    const range = buildAmountSpec({ type: 'MIN_MAX', min: '100.00', max: '180.00' }, bob);
    expect(range).toEqual({ type: 'MIN_MAX', amount: null, min: '100.00', max: '180.00' });
    expect(projectedAmount(range)).toBe('180.00');
    const variable = buildAmountSpec({ type: 'VARIABLE' }, bob);
    expect(projectedAmount(variable)).toBeNull();
    expect(projectedAmount(buildAmountSpec({ type: 'ESTIMATED', amount: '150' }, bob))).toBe('150.00');
  });

  it('[TC-COMMITMENTS-RECUR-011] montos inconsistentes con el tipo o con escala excedida ⇒ RECURRING_INVALID_AMOUNT', () => {
    for (const bad of [
      { type: 'MIN_MAX', min: '200.00', max: '150.00' },
      { type: 'FIXED' },
      { type: 'FIXED', amount: '10.005' },
      { type: 'FIXED', amount: '-5.00' },
      { type: 'FIXED', amount: '0.00' },
      { type: 'FIXED', amount: 'abc' },
      { type: 'FIXED', amount: '5.00', min: '1.00' },
      { type: 'MIN_MAX', min: '1.00' },
      { type: 'VARIABLE', amount: '1.00' },
      { type: 'RANGE' },
    ]) {
      expect(
        codeOf(() => buildAmountSpec(bad, bob)),
        JSON.stringify(bad),
      ).toBe('RECURRING_INVALID_AMOUNT');
    }
  });

  it('[TC-COMMITMENTS-RECUR-020] la creación automática se rechaza para montos VARIABLE o MIN_MAX', () => {
    const build = (amount: TemplateInput['amount']) => () =>
      buildDefinitionVersion({
        kind: 'EXPENSE',
        versionNo: 1,
        effectiveFrom: '2026-10-05',
        currency: BOB,
        template: template({ amount, materialization: { mode: 'AUTO_CREATE' } }),
      });
    expect(codeOf(build({ type: 'VARIABLE' }))).toBe('RECURRING_MODE_NOT_ALLOWED');
    expect(codeOf(build({ type: 'MIN_MAX', min: '100.00', max: '180.00' }))).toBe(
      'RECURRING_MODE_NOT_ALLOWED',
    );
    expect(build({ type: 'FIXED', amount: '199.00' })).not.toThrow();
  });

  it('el modo AUTO_CREATE usa PENDING por omisión; autoCreateStatus solo aplica a AUTO_CREATE', () => {
    const v = buildDefinitionVersion({
      kind: 'EXPENSE',
      versionNo: 1,
      effectiveFrom: '2026-10-05',
      currency: BOB,
      template: template({ materialization: { mode: 'AUTO_CREATE' } }),
    });
    expect(v.materialization).toEqual({ mode: 'AUTO_CREATE', autoCreateStatus: 'PENDING', leadDays: 3 });
    expect(
      codeOf(() =>
        buildDefinitionVersion({
          kind: 'EXPENSE',
          versionNo: 1,
          effectiveFrom: '2026-10-05',
          currency: BOB,
          template: template({ materialization: { mode: 'NOTIFY_ONLY', autoCreateStatus: 'POSTED' } }),
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-COMMITMENTS-RECUR-033] fecha de fin y máximo juntos ⇒ RECURRING_INVALID_SCHEDULE', () => {
    expect(
      codeOf(() =>
        buildDefinitionVersion({
          kind: 'EXPENSE',
          versionNo: 1,
          effectiveFrom: '2026-10-15',
          currency: BOB,
          template: template({
            schedule: { startDate: '2026-10-15', endDate: '2027-10-01', maxOccurrences: 12 },
          }),
        }),
      ),
    ).toBe('RECURRING_INVALID_SCHEDULE');
  });

  it('una cadencia CUSTOM exige RRULE válida (INVALID_RRULE) y absorbe COUNT/UNTIL de la regla', () => {
    const custom = (rrule: string | null) => () =>
      buildDefinitionVersion({
        kind: 'EXPENSE',
        versionNo: 1,
        effectiveFrom: '2026-10-01',
        currency: BOB,
        template: template({ schedule: { cadence: 'CUSTOM', startDate: '2026-10-01', rrule } }),
      });
    expect(codeOf(custom(null))).toBe('INVALID_RRULE');
    expect(codeOf(custom('FREQ=HOURLY'))).toBe('INVALID_RRULE');
    expect(custom('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1;COUNT=6')).not.toThrow();
    const v = custom('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1;COUNT=6')();
    expect(v.schedule).toMatchObject({ cadence: 'CUSTOM', maxOccurrences: 6, endDate: null });
    expect(v.schedule.rrule).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=-1');
  });

  it('la máquina de la definición solo permite las transiciones declaradas', () => {
    const def = definition('def-2');
    def.pause('2026-10-10T12:00:00.000Z', 'u');
    expect(def.status).toBe('PAUSED');
    expect(codeOf(() => def.pause('2026-10-10T12:00:00.000Z', 'u'))).toBe('INVALID_STATUS_TRANSITION');
    def.resume('2026-10-12T12:00:00.000Z', 'u');
    def.end({ endDate: '2026-11-30', at: '2026-10-13T12:00:00.000Z', by: 'u' });
    expect(def.status).toBe('ENDED');
    expect(codeOf(() => def.resume('2026-10-14T12:00:00.000Z', 'u'))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => def.scheduleEnd('2026-12-01', '2026-10-14T12:00:00.000Z', 'u'))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    expect(RECURRING_DEFINITION_LIFECYCLE.isTerminal('ENDED')).toBe(true);
  });

  it('[TC-COMMITMENTS-RECUR-024] aprobar: VARIABLE exige monto; MIN_MAX fuera de rango se rechaza', () => {
    const variable = buildAmountSpec({ type: 'VARIABLE' }, bob);
    expect(codeOf(() => resolveApprovalAmount(variable, null, bob))).toBe('OCCURRENCE_AMOUNT_REQUIRED');
    expect(resolveApprovalAmount(variable, '85.50', bob)).toBe('85.50');
    const range = buildAmountSpec({ type: 'MIN_MAX', min: '100.00', max: '180.00' }, bob);
    expect(codeOf(() => resolveApprovalAmount(range, '200.00', bob))).toBe('RECURRING_INVALID_AMOUNT');
    expect(resolveApprovalAmount(range, null, bob)).toBe('180.00');
    expect(resolveApprovalAmount(range, '150.00', bob)).toBe('150.00');
    const estimated = buildAmountSpec({ type: 'ESTIMATED', amount: '150.00' }, bob);
    expect(resolveApprovalAmount(estimated, '163.40', bob)).toBe('163.40');
    expect(resolveApprovalAmount(estimated, null, bob)).toBe('150.00');
  });
});
