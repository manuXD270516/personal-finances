import { DomainError, LocalDate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countsAsCommittedOutflow } from './committed-calculator.js';
import { assertKindAvailable } from './definition-version.js';
import { candidates } from './occurrence-generator.js';
import { BANK, SAVINGS, d, definition, version, type TemplateOverrides } from './test-fixtures.js';

const CARD = '0190a000-0000-7000-8000-0000000acc09';
const card = (over: TemplateOverrides = {}): TemplateOverrides => ({
  toAccountId: CARD,
  categoryId: null,
  amount: { type: 'VARIABLE' },
  ...over,
  schedule: { cadence: 'MONTHLY', monthDays: [15], startDate: '2026-11-15', ...over.schedule },
});
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

describe('CARD_PAYMENT en el dominio (add-credit-cards)', () => {
  it('[TC-DEBT-CARD-029] solo se admite con managedBy = DEBT; para el usuario sigue reservado', () => {
    expect(assertKindAvailable('CARD_PAYMENT', 'DEBT')).toBe('CARD_PAYMENT');
    for (const managedBy of [undefined, 'USER', 'SUBSCRIPTION'] as const) {
      expect(code(() => assertKindAvailable('CARD_PAYMENT', managedBy))).toBe('RECURRING_KIND_NOT_AVAILABLE');
    }
  });

  it('[TC-DEBT-CARD-029] exige cuenta destino distinta, sin categoría y con regla mensual', () => {
    expect(version(1, '2026-11-15', card(), 'CARD_PAYMENT')).toMatchObject({
      accountId: BANK,
      toAccountId: CARD,
      amount: { type: 'VARIABLE' },
    });
    expect(code(() => version(1, '2026-11-15', card({ toAccountId: null }), 'CARD_PAYMENT'))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(() => version(1, '2026-11-15', card({ toAccountId: BANK }), 'CARD_PAYMENT'))).toBe(
      'TRANSFER_SAME_ACCOUNT',
    );
    expect(code(() => version(1, '2026-11-15', card({ categoryId: SAVINGS }), 'CARD_PAYMENT'))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      code(() =>
        version(1, '2026-11-15', card({ schedule: { cadence: 'WEEKLY', monthDays: [] } }), 'CARD_PAYMENT'),
      ),
    ).toBe('RECURRING_INVALID_SCHEDULE');
    expect(
      code(() =>
        version(1, '2026-11-15', card({ schedule: { cadence: 'MONTHLY', monthDays: [] } }), 'CARD_PAYMENT'),
      ),
    ).toBe('RECURRING_INVALID_SCHEDULE');
  });

  it('[TC-DEBT-CARD-029] AUTO_CREATE se admite con monto VARIABLE solo en el pago de tarjeta', () => {
    const auto = { mode: 'AUTO_CREATE', autoCreateStatus: 'POSTED' } as const;
    expect(
      version(1, '2026-11-15', card({ materialization: auto }), 'CARD_PAYMENT').materialization,
    ).toMatchObject({ mode: 'AUTO_CREATE', autoCreateStatus: 'POSTED' });
    expect(
      code(() =>
        version(
          1,
          '2026-11-15',
          { amount: { type: 'VARIABLE' }, categoryId: null, materialization: auto },
          'EXPENSE',
        ),
      ),
    ).toBe('RECURRING_MODE_NOT_ALLOWED');
  });

  it('[TC-DEBT-CARD-031] D127: cuenta como comprometido solo de una cuenta líquida a una no líquida', () => {
    const liquid = { nature: 'ASSET', liquidity: 'LIQUID' } as const;
    const savings = { nature: 'ASSET', liquidity: 'SEMI_LIQUID' } as const;
    const liability = { nature: 'LIABILITY', liquidity: 'ILLIQUID' } as const;
    expect(countsAsCommittedOutflow({ kind: 'CARD_PAYMENT', from: liquid, to: liability })).toBe(true);
    expect(countsAsCommittedOutflow({ kind: 'CARD_PAYMENT', from: savings, to: liability })).toBe(false);
    expect(countsAsCommittedOutflow({ kind: 'CARD_PAYMENT', from: liquid, to: liquid })).toBe(false);
    expect(countsAsCommittedOutflow({ kind: 'CARD_PAYMENT', from: liquid, to: undefined })).toBe(false);
  });

  it('[TC-DEBT-CARD-029] propiedad: la regla mensual produce una fecha nominal única por mes y respeta el fin de mes', () => {
    const monthLength = (y: number, m: number) => LocalDate.daysInMonth(y, m);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 31 }),
        fc.constantFrom('NONE', 'PREVIOUS', 'NEXT'),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 30, max: 900 }),
        (day, weekendAdjustment, offset, length) => {
          const start = LocalDate.ofEpochDay(LocalDate.of(2026, 1, 1).toEpochDay() + offset);
          const def = definition(
            'card',
            card({ schedule: { monthDays: [day], startDate: start.toString(), weekendAdjustment } }),
            'CARD_PAYMENT',
          );
          const to = start.plusDays(length);
          const out = candidates(def, { from: start, to });
          const months = new Set<string>();
          for (const c of out) {
            const date = c.occurrenceDate;
            const month = `${date.year}-${date.month}`;
            // una sola fecha nominal por mes, nunca antes del inicio ni después del fin de la ventana
            expect(months.has(month)).toBe(false);
            months.add(month);
            expect(date.compare(start) >= 0 && date.compare(to) <= 0).toBe(true);
            // el día pedido o, en meses cortos, el último día del mes
            expect(date.day).toBe(Math.min(day, monthLength(date.year, date.month)));
            // el ajuste de fin de semana solo mueve el vencimiento, nunca la fecha nominal
            expect(Math.abs(c.dueDate.toEpochDay() - date.toEpochDay())).toBeLessThanOrEqual(2);
            if (weekendAdjustment === 'NONE') expect(c.dueDate.toString()).toBe(date.toString());
          }
          // sin huecos: todo mes con su día dentro de la ventana aparece
          const expected = new Set<string>();
          for (let e = start.toEpochDay(); e <= to.toEpochDay(); e += 1) {
            const date = LocalDate.ofEpochDay(e);
            if (date.day === Math.min(day, monthLength(date.year, date.month))) {
              expected.add(`${date.year}-${date.month}`);
            }
          }
          expect(months).toEqual(expected);
        },
      ),
      { numRuns: process.env['NIGHTLY'] ? 5_000 : 100 },
    );
  }, 30_000);

  it('el día 31 desde el 2027-01-31 cae el 28 de febrero y el 30 de abril', () => {
    const def = definition(
      'c31',
      card({ schedule: { monthDays: [31], startDate: '2027-01-31' } }),
      'CARD_PAYMENT',
    );
    expect(
      candidates(def, { from: d('2027-01-01'), to: d('2027-05-31') }).map((c) => c.occurrenceDate.toString()),
    ).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });
});
