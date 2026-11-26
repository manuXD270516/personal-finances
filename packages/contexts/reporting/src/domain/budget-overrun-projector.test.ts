import { currency as makeCurrency, dec, LocalDate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BudgetOverrunProjector,
  type BudgetRiskLineInput,
  type BudgetRiskPeriodInput,
} from './budget-overrun-projector.js';

const BOB = makeCurrency('BOB', 2);
const NOVEMBER = (today: string, minElapsedDays = 7): BudgetRiskPeriodInput => ({
  currency: BOB,
  today,
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  minElapsedDays,
});
const line = (
  over: Partial<BudgetRiskLineInput> & Pick<BudgetRiskLineInput, 'reference' | 'actual'>,
): BudgetRiskLineInput => ({
  kind: 'MAXIMUM',
  paidByOccurrences: dec('0'),
  knownPending: [],
  forecast: null,
  ...over,
});
const d = (v: string) => dec(v);

describe('BudgetOverrunProjector', () => {
  it('[TC-REPORTING-INSIGHT-001] Restaurantes al ritmo del periodo proyecta 840.00 y riesgo LIKELY', () => {
    const r = BudgetOverrunProjector.project(
      line({ reference: d('600.00'), actual: d('280.00') }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.projected?.toFixed()).toBe('840.00');
    expect(r.level).toBe('LIKELY');
    expect(r.basis).toBe('RUN_RATE');
    expect(r.projectedHigh).toBeNull();
  });

  it('[TC-REPORTING-INSIGHT-002] un ritmo dentro del tope da 1200.00 y riesgo UNLIKELY', () => {
    const r = BudgetOverrunProjector.project(
      line({ reference: d('1500.00'), actual: d('400.00') }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.projected?.toFixed()).toBe('1200.00');
    expect(r.level).toBe('UNLIKELY');
    expect(r.estimatedDate).toBeNull();
  });

  it('[TC-REPORTING-INSIGHT-003] una factura pendiente que vence en el periodo entra: 100.00 + 300.00 + 200.00 = 600.00', () => {
    const r = BudgetOverrunProjector.project(
      line({
        reference: d('500.00'),
        actual: d('100.00'),
        knownPending: [{ dueDate: '2026-11-20', amount: d('300.00') }],
      }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.projected?.toFixed()).toBe('600.00');
    expect(r.knownPending.toFixed()).toBe('300.00');
    expect(r.level).toBe('LIKELY');
  });

  it('[TC-REPORTING-INSIGHT-004] lo pagado por una ocurrencia no se extrapola: 300.00 + 50.00 / 10 x 20 = 400.00', () => {
    const r = BudgetOverrunProjector.project(
      line({ reference: d('600.00'), actual: d('300.00'), paidByOccurrences: d('250.00') }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.variableActual.toFixed()).toBe('50.00');
    expect(r.projected?.toFixed()).toBe('400.00');
    expect(r.level).toBe('UNLIKELY');
  });

  it('[TC-REPORTING-INSIGHT-005] con la banda del pronóstico: proyección 1400.00, alta 1620.00 y riesgo POSSIBLE', () => {
    const r = BudgetOverrunProjector.project(
      line({
        reference: d('1500.00'),
        actual: d('560.00'),
        forecast: { expected: d('1400.00'), upper: d('1620.00') },
      }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.projected?.toFixed()).toBe('1400.00');
    expect(r.projectedHigh?.toFixed()).toBe('1620.00');
    expect(r.basis).toBe('FORECAST');
    expect(r.level).toBe('POSSIBLE');
    expect(r.estimatedDate).not.toBeNull();
  });

  it('[TC-REPORTING-INSIGHT-006] sin pronóstico se usa el ritmo: 1680.00, LIKELY y sin proyección alta', () => {
    const r = BudgetOverrunProjector.project(
      line({ reference: d('1500.00'), actual: d('560.00') }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.projected?.toFixed()).toBe('1680.00');
    expect(r.basis).toBe('RUN_RATE');
    expect(r.level).toBe('LIKELY');
    expect(r.projectedHigh).toBeNull();
  });

  it('[TC-REPORTING-INSIGHT-007] la fecha estimada del exceso de Restaurantes es el 2026-11-22', () => {
    const r = BudgetOverrunProjector.project(
      line({ reference: d('600.00'), actual: d('280.00') }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.estimatedDate).toBe('2026-11-22');
    // 280.00 + 28.00 x 12 = 616.00 supera 600.00; el 2026-11-21 sería 588.00 y no lo supera.
    const at = (reference: string) =>
      BudgetOverrunProjector.estimateDate({
        actual: d('280'),
        reference: d(reference),
        known: [],
        rest: d('560'),
        today: '2026-11-10',
        remaining: 20,
      });
    expect(at('588.00')).toBe('2026-11-22');
    expect(at('587.99')).toBe('2026-11-21');
  });

  it('[TC-REPORTING-INSIGHT-008] la factura pendiente adelanta el exceso al 2026-11-21 (el 20 suma 500.00 sin superar)', () => {
    const r = BudgetOverrunProjector.project(
      line({
        reference: d('500.00'),
        actual: d('100.00'),
        knownPending: [{ dueDate: '2026-11-20', amount: d('300.00') }],
      }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.estimatedDate).toBe('2026-11-21');
  });

  it('[TC-REPORTING-INSIGHT-008] un pago vencido sin pagar se suma desde mañana', () => {
    const r = BudgetOverrunProjector.project(
      line({
        reference: d('500.00'),
        actual: d('300.00'),
        paidByOccurrences: d('300.00'),
        knownPending: [{ dueDate: '2026-11-05', amount: d('250.00') }],
      }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.level).toBe('LIKELY');
    expect(r.estimatedDate).toBe('2026-11-11');
  });

  it('[TC-REPORTING-INSIGHT-009] sin pronóstico y con menos de 7 días no está disponible (TOO_EARLY, sin 900.00)', () => {
    const r = BudgetOverrunProjector.project(
      line({ reference: d('600.00'), actual: d('90.00') }),
      NOVEMBER('2026-11-03'),
    );
    expect(r.level).toBe('NOT_AVAILABLE');
    expect(r.reason).toBe('TOO_EARLY');
    expect(r.projected).toBeNull();
  });

  it('[TC-REPORTING-INSIGHT-009] con menos de 7 días y lo conocido ya sobre la referencia da LIKELY igual, sin extrapolar', () => {
    const r = BudgetOverrunProjector.project(
      line({
        reference: d('500.00'),
        actual: d('90.00'),
        knownPending: [{ dueDate: '2026-11-15', amount: d('450.00') }],
      }),
      NOVEMBER('2026-11-03'),
    );
    expect(r.level).toBe('LIKELY');
    expect(r.projected?.toFixed()).toBe('540.00');
    expect(r.estimatedDate).toBe('2026-11-15');
  });

  it('[TC-REPORTING-INSIGHT-009] con pronóstico no hay TOO_EARLY', () => {
    const r = BudgetOverrunProjector.project(
      line({
        reference: d('600.00'),
        actual: d('90.00'),
        forecast: { expected: d('400.00'), upper: d('500.00') },
      }),
      NOVEMBER('2026-11-03'),
    );
    expect(r.level).toBe('UNLIKELY');
    expect(r.projected?.toFixed()).toBe('400.00');
  });

  it('[TC-REPORTING-INSIGHT-010] una línea fija o de mínimo no tiene riesgo calculable (LINE_TYPE) y sin referencia tampoco', () => {
    const fixed = BudgetOverrunProjector.project(
      line({ kind: 'FIXED', reference: d('2800.00'), actual: d('2800.00') }),
      NOVEMBER('2026-11-10'),
    );
    expect(fixed.level).toBe('NOT_AVAILABLE');
    expect(fixed.reason).toBe('LINE_TYPE');
    const min = BudgetOverrunProjector.project(
      line({ kind: 'MINIMUM', reference: d('100.00'), actual: d('0.00') }),
      NOVEMBER('2026-11-10'),
    );
    expect(min.reason).toBe('LINE_TYPE');
    const zero = BudgetOverrunProjector.project(
      line({ reference: d('0.00'), actual: d('10.00') }),
      NOVEMBER('2026-11-10'),
    );
    expect(zero.reason).toBe('NO_REFERENCE');
  });

  it('[TC-REPORTING-INSIGHT-011] el gastado sobre el tope es EXCEEDED sin fecha estimada', () => {
    const r = BudgetOverrunProjector.project(
      line({ reference: d('600.00'), actual: d('650.00') }),
      NOVEMBER('2026-11-10'),
    );
    expect(r.level).toBe('EXCEEDED');
    expect(r.estimatedDate).toBeNull();
  });

  it('[TC-REPORTING-INSIGHT-001] redondea HALF_EVEN al presentar: 10.00 + 10.00 / 3 x 20 = 76.666... -> 76.67', () => {
    const r = BudgetOverrunProjector.project(line({ reference: d('50.00'), actual: d('10.00') }), {
      ...NOVEMBER('2026-11-03', 1),
      periodEnd: '2026-11-23',
    });
    expect(r.projected?.toFixed()).toBe('76.67');
  });

  it('[TC-REPORTING-INSIGHT-001] el último día del periodo no deja gasto por proyectar ni fecha', () => {
    const r = BudgetOverrunProjector.project(
      line({
        reference: d('500.00'),
        actual: d('400.00'),
        knownPending: [{ dueDate: '2026-11-30', amount: d('200.00') }],
      }),
      NOVEMBER('2026-11-30'),
    );
    expect(r.projected?.toFixed()).toBe('600.00');
    expect(r.level).toBe('LIKELY');
    expect(r.estimatedDate).toBeNull();
  });
});

describe('BudgetOverrunProjector (propiedades)', () => {
  const amount = (max: number) =>
    fc.integer({ min: 0, max: max * 100 }).map((cents) => dec((cents / 100).toFixed(2)));
  const day = fc
    .integer({ min: 0, max: 29 })
    .map((n) => LocalDate.parse('2026-11-01').plusDays(n).toString());

  it('[TC-REPORTING-INSIGHT-005] la proyección esperada nunca supera la alta y la fecha estimada cae dentro del periodo o no existe', () => {
    fc.assert(
      fc.property(
        fc.record({
          reference: amount(3000),
          actual: amount(3000),
          paid: amount(1000),
          expected: amount(2000),
          extra: amount(1000),
          withForecast: fc.boolean(),
          known: fc.array(fc.tuple(day, amount(500)), { maxLength: 5 }),
          today: day,
        }),
        (s) => {
          const forecast = s.withForecast ? { expected: s.expected, upper: s.expected.add(s.extra) } : null;
          const r = BudgetOverrunProjector.project(
            line({
              reference: s.reference,
              actual: s.actual,
              paidByOccurrences: s.paid,
              forecast,
              knownPending: s.known.map(([dueDate, a]) => ({ dueDate, amount: a })),
            }),
            NOVEMBER(s.today, 7),
          );
          if (r.projected && r.projectedHigh) {
            expect(r.projected.compare(r.projectedHigh)).toBeLessThanOrEqual(0);
          }
          if (r.estimatedDate !== null) {
            expect(r.estimatedDate > s.today).toBe(true);
            expect(r.estimatedDate <= '2026-11-30').toBe(true);
            expect(['LIKELY', 'POSSIBLE']).toContain(r.level);
          }
          if (r.level === 'LIKELY' && s.today < '2026-11-30') expect(r.estimatedDate).not.toBeNull();
          if (r.level === 'EXCEEDED') expect(r.estimatedDate).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);

  it('[TC-REPORTING-INSIGHT-001] sin pagos conocidos el ritmo coincide con la proyección lineal del plan G / d x 30', () => {
    fc.assert(
      fc.property(amount(3000), day, (actual, today) => {
        const r = BudgetOverrunProjector.project(
          line({ reference: d('99999.00'), actual }),
          NOVEMBER(today, 1),
        );
        const elapsed = Number(today.slice(8));
        const linear = actual.mul(30).div(elapsed);
        const projected = (r.projected as NonNullable<typeof r.projected>).toDecimal();
        expect(projected.minus(linear).abs().lte(dec('0.005'))).toBe(true);
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});
