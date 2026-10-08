import { currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { Budget } from './budget.js';
import type { BudgetLineInput } from './budget-line.js';
import type { BudgetTarget } from './budget-types.js';
import type { TargetTree } from './target-overlap-policy.js';

const BOB = currency('BOB', 2);
const W = '0190a000-0000-7000-8000-00000000a001';
const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// Grupo "Alimentación" (gasto): Supermercado (subcategoría Carnes), Restaurantes. Grupo "Vivienda": Alquiler,
// Servicios básicos (subcategoría Luz). Ingreso: Salario. Gimnasio archivada.
const G_ALIM = id(100);
const G_VIV = id(101);
const G_ING = id(102);
const SUPER = id(1);
const CARNES = id(2);
const REST = id(3);
const ALQ = id(4);
const SERV = id(5);
const LUZ = id(6);
const SALARIO = id(7);
const GIM = id(8);
const TAG_VIAJE = id(200);

const tree: TargetTree = {
  groups: new Map([
    [G_ALIM, { kind: 'EXPENSE', archived: false }],
    [G_VIV, { kind: 'EXPENSE', archived: false }],
    [G_ING, { kind: 'INCOME', archived: false }],
  ]),
  categories: new Map([
    [SUPER, { kind: 'EXPENSE', groupId: G_ALIM, parentId: null, archived: false }],
    [CARNES, { kind: 'EXPENSE', groupId: G_ALIM, parentId: SUPER, archived: false }],
    [REST, { kind: 'EXPENSE', groupId: G_ALIM, parentId: null, archived: false }],
    [ALQ, { kind: 'EXPENSE', groupId: G_VIV, parentId: null, archived: false }],
    [SERV, { kind: 'EXPENSE', groupId: G_VIV, parentId: null, archived: false }],
    [LUZ, { kind: 'EXPENSE', groupId: G_VIV, parentId: SERV, archived: false }],
    [SALARIO, { kind: 'INCOME', groupId: G_ING, parentId: null, archived: false }],
    [GIM, { kind: 'EXPENSE', groupId: G_VIV, parentId: null, archived: true }],
  ]),
  tags: new Map([[TAG_VIAJE, { archived: false }]]),
};

const money = (amount: string, ccy = 'BOB') => ({ amount, currency: ccy });
const category = (cid: string): BudgetTarget => ({ kind: 'CATEGORY', id: cid });

function newBudget(): Budget {
  return Budget.create({
    id: id(900),
    workspaceId: W,
    periodId: id(901),
    currency: BOB,
    at: '2026-10-08T12:00:00.000Z',
  });
}
let seq = 1000;
const add = (b: Budget, target: BudgetTarget, spec: BudgetLineInput) =>
  b.addLine({ lineId: id((seq += 1)), target, spec, currency: BOB, tree });
const max = (amount: string): BudgetLineInput => ({ kind: 'MAXIMUM', planned: money(amount) });

const rejects = (fn: () => unknown, code: string) =>
  expect(fn).toThrowError(expect.objectContaining({ code }));

describe('Budget (plan mensual por periodo)', () => {
  it('[TC-PLANNING-BUDGET-001] un plan vacío nace en la moneda base, sin líneas y con origen EMPTY', () => {
    const b = newBudget();
    expect(b.snapshot).toMatchObject({ currency: 'BOB', origin: 'EMPTY', zeroBased: false, version: 1 });
    expect(b.lines).toHaveLength(0);
  });

  it('[TC-PLANNING-THRESHOLD-001] una línea de gasto sin umbrales recibe 50, 75, 90 y 100', () => {
    const b = newBudget();
    const line = add(b, category(REST), max('600.00'));
    expect(line.snapshot.thresholds).toEqual(['50', '75', '90', '100']);
    expect(line.snapshot.nature).toBe('EXPENSE');
    expect(b.version).toBe(2);
  });

  it('[TC-PLANNING-THRESHOLD-002] umbrales personalizados 80 y 110; inválidos se rechazan sin cambiar la línea', () => {
    const b = newBudget();
    const line = add(b, category(REST), { ...max('600.00'), thresholds: ['110', '80'] });
    expect(line.snapshot.thresholds).toEqual(['80', '110']);
    for (const thresholds of [['0'], ['1001'], ['80', '80'], ['75.555']]) {
      rejects(
        () => b.updateLine({ lineId: line.id, expectedVersion: 1, patch: { thresholds }, currency: BOB }),
        'BUDGET_THRESHOLD_INVALID',
      );
    }
    expect(b.line(line.id)?.snapshot.thresholds).toEqual(['80', '110']);
  });

  it('[TC-PLANNING-BUDGET-004] ingreso esperado solo FIXED: un máximo, umbrales o rollover se rechazan con BUDGET_INVALID_LINE_KIND', () => {
    const b = newBudget();
    const ok = add(b, category(SALARIO), { kind: 'FIXED', planned: money('8000.00') });
    expect(ok.snapshot).toMatchObject({ nature: 'INCOME', thresholds: [] });
    const other = newBudget();
    rejects(() => add(other, category(SALARIO), max('8000.00')), 'BUDGET_INVALID_LINE_KIND');
    rejects(
      () => add(other, category(SALARIO), { kind: 'FIXED', planned: money('8000.00'), thresholds: ['50'] }),
      'BUDGET_INVALID_LINE_KIND',
    );
    rejects(
      () =>
        add(other, category(SALARIO), {
          kind: 'FIXED',
          planned: money('8000.00'),
          rolloverPolicy: 'CARRY_ALL',
        }),
      'BUDGET_INVALID_LINE_KIND',
    );
  });

  it('[TC-PLANNING-BUDGET-015] el mínimo no admite umbrales', () => {
    const b = newBudget();
    const line = add(b, category(REST), { kind: 'MINIMUM', min: money('400.00') });
    expect(line.snapshot.thresholds).toEqual([]);
    rejects(
      () => add(b, category(SUPER), { kind: 'MINIMUM', min: money('400.00'), thresholds: ['50'] }),
      'BUDGET_INVALID_LINE_KIND',
    );
  });

  it('[TC-PLANNING-BUDGET-007] montos, moneda, escala, objetivo archivado y repetido se rechazan sin cambiar el plan', () => {
    const b = newBudget();
    add(b, category(SUPER), max('1500.00'));
    const before = b.version;
    rejects(() => add(b, category(REST), max('-100.00')), 'BUDGET_INVALID_AMOUNTS');
    rejects(
      () => add(b, category(REST), { kind: 'RANGE', min: money('700.00'), max: money('600.00') }),
      'BUDGET_INVALID_AMOUNTS',
    );
    rejects(
      () => add(b, category(REST), { kind: 'MAXIMUM', planned: money('100.00', 'USD') }),
      'CURRENCY_MISMATCH',
    );
    rejects(() => add(b, category(REST), max('100.005')), 'AMOUNT_SCALE_EXCEEDED');
    rejects(() => add(b, category(GIM), max('200.00')), 'CATEGORY_ARCHIVED');
    rejects(() => add(b, category(SUPER), max('900.00')), 'BUDGET_LINE_DUPLICATE_TARGET');
    rejects(() => add(b, category(id(999)), max('10.00')), 'REFERENCE_NOT_FOUND');
    expect(b.version).toBe(before);
    expect(b.lines).toHaveLength(1);
  });

  it('[TC-PLANNING-BUDGET-008] sin objetivos solapados: subcategoría de una categoría y categoría de un grupo', () => {
    const a = newBudget();
    add(a, category(SUPER), max('1500.00'));
    rejects(() => add(a, category(CARNES), max('300.00')), 'BUDGET_TARGET_OVERLAP');
    const reverse = newBudget();
    add(reverse, category(CARNES), max('300.00'));
    rejects(() => add(reverse, category(SUPER), max('1500.00')), 'BUDGET_TARGET_OVERLAP');
    const g = newBudget();
    add(g, { kind: 'GROUP', id: G_ALIM }, max('2500.00'));
    rejects(() => add(g, category(REST), max('600.00')), 'BUDGET_TARGET_OVERLAP');
    rejects(() => add(g, category(CARNES), max('100.00')), 'BUDGET_TARGET_OVERLAP');
    // Otro grupo sí; un tag es transversal y nunca se solapa.
    add(g, category(ALQ), { kind: 'FIXED', planned: money('2800.00') });
    add(g, { kind: 'TAG', id: TAG_VIAJE }, max('2000.00'));
    expect(g.lines).toHaveLength(3);
  });

  it('[TC-PLANNING-BUDGET-014] un grupo de gasto es de naturaleza gasto y un tag también', () => {
    const b = newBudget();
    expect(add(b, { kind: 'GROUP', id: G_VIV }, max('3200.00')).snapshot.nature).toBe('EXPENSE');
    expect(add(b, { kind: 'TAG', id: TAG_VIAJE }, max('2000.00')).snapshot.nature).toBe('EXPENSE');
  });

  it('[TC-PLANNING-BUDGET-019] porcentaje de ingresos: base EXPECTED por defecto, porcentaje en (0, 100]', () => {
    const b = newBudget();
    const line = add(b, category(REST), { kind: 'PERCENT_OF_INCOME', percent: '12.5' });
    expect(line.snapshot).toMatchObject({ percent: '12.5', incomeBasis: 'EXPECTED' });
    rejects(
      () => add(b, category(SUPER), { kind: 'PERCENT_OF_INCOME', percent: '0' }),
      'BUDGET_INVALID_AMOUNTS',
    );
    rejects(
      () => add(b, category(SUPER), { kind: 'PERCENT_OF_INCOME', percent: '101' }),
      'BUDGET_INVALID_AMOUNTS',
    );
  });

  it('un parche cambia el máximo y sube la versión de la línea y del plan; con versión vieja se rechaza', () => {
    const b = newBudget();
    const line = add(b, category(SUPER), max('1500.00'));
    const { before, after } = b.updateLine({
      lineId: line.id,
      expectedVersion: 1,
      patch: { planned: money('1400.00') },
      currency: BOB,
    });
    expect(before.snapshot.planned).toBe('1500.00');
    expect(after.snapshot.planned).toBe('1400.00');
    expect(after.version).toBe(2);
    rejects(
      () =>
        b.updateLine({
          lineId: line.id,
          expectedVersion: 1,
          patch: { planned: money('1.00') },
          currency: BOB,
        }),
      'PRECONDITION_FAILED',
    );
  });

  it('cambiar el tipo de MAXIMUM a RANGE exige min y max y no hereda el planificado anterior', () => {
    const b = newBudget();
    const line = add(b, category(SUPER), max('1500.00'));
    rejects(
      () => b.updateLine({ lineId: line.id, expectedVersion: 1, patch: { kind: 'RANGE' }, currency: BOB }),
      'VALIDATION_FAILED',
    );
    const { after } = b.updateLine({
      lineId: line.id,
      expectedVersion: 1,
      patch: { kind: 'RANGE', min: money('1200.00'), max: money('1500.00') },
      currency: BOB,
    });
    expect(after.snapshot).toMatchObject({ kind: 'RANGE', planned: null, min: '1200.00', max: '1500.00' });
  });

  it('quitar una línea y volver a agregarla es válido; el modo base cero es un atributo del plan', () => {
    const b = newBudget();
    const line = add(b, category(REST), max('600.00'));
    b.removeLine(line.id);
    expect(b.lines).toHaveLength(0);
    add(b, category(REST), max('600.00'));
    expect(b.setZeroBased(true)).toBe(true);
    expect(b.setZeroBased(true)).toBe(false);
    expect(b.zeroBased).toBe(true);
  });
});
