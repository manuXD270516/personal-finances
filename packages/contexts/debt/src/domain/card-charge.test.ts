import { DomainError, LocalDate, Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CARD_CHARGE_COMPONENT_KEYS,
  CardCharge,
  assertCardChargeDate,
  parseCardChargeComponents,
  proposeChargeFromDifference,
} from './card-charge.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
const bob = (v: string) => Money.parse(v, BOB);

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

const newCharge = (components = parseCardChargeComponents({ interest: '4.00', insurance: '0.80' }, BOB)) =>
  CardCharge.create({
    id: 'c1',
    workspaceId: 'w1',
    cardId: 'card1',
    cardAccountId: 'ca1',
    accountId: 'acc1',
    transactionId: 'tx1',
    businessDate: '2026-10-25',
    currency: BOB,
    components,
    origin: 'RECORDED',
    createdAt: '2026-10-28T16:00:00.000Z',
    createdBy: 'u1',
  });

describe('CardCharge (add-card-interest-ledger-portions)', () => {
  it('[TC-DEBT-CARD-043] interés 4.00 y seguro 0.80 suman 4.80 BOB, con comisiones e impuestos en cero', () => {
    const c = newCharge();
    expect(c.total().toFixed()).toBe('4.80');
    expect(c.snapshot).toMatchObject({ status: 'ACTIVE', origin: 'RECORDED', version: 1 });
    expect(c.snapshot.fees.toFixed()).toBe('0.00');
    expect(c.snapshot.taxes.toFixed()).toBe('0.00');
  });

  it('[TC-DEBT-CARD-044] un cargo en dólares: 1.25 USD de interés', () => {
    const c = parseCardChargeComponents({ interest: '1.25' }, USD);
    expect(c.interest.toFixed()).toBe('1.25');
    expect(c.interest.currency.code).toBe('USD');
  });

  it('[TC-DEBT-CARD-045] todos los componentes en cero ⇒ CARD_CHARGE_INVALID', () => {
    expect(codeOf(() => parseCardChargeComponents({ interest: '0.00', fees: '0.00' }, BOB))).toBe(
      'CARD_CHARGE_INVALID',
    );
    expect(codeOf(() => parseCardChargeComponents({}, BOB))).toBe('CARD_CHARGE_INVALID');
  });

  it('[TC-DEBT-CARD-045] un componente negativo ⇒ AMOUNT_NOT_POSITIVE', () => {
    expect(codeOf(() => parseCardChargeComponents({ interest: '4.00', fees: '-0.01' }, BOB))).toBe(
      'AMOUNT_NOT_POSITIVE',
    );
  });

  it('[TC-DEBT-CARD-045] una fecha posterior a hoy o anterior a la apertura ⇒ CARD_CHARGE_INVALID', () => {
    const today = LocalDate.parse('2026-10-28');
    expect(codeOf(() => assertCardChargeDate('2026-10-30', today, null))).toBe('CARD_CHARGE_INVALID');
    expect(codeOf(() => assertCardChargeDate('2026-08-31', today, '2026-09-01'))).toBe('CARD_CHARGE_INVALID');
    expect(codeOf(() => assertCardChargeDate('2026-10-28', today, '2026-09-01'))).toBeUndefined();
    expect(codeOf(() => assertCardChargeDate('2026-13-45', today, null))).toBe('VALIDATION_FAILED');
  });

  it('[TC-DEBT-CARD-046] 1.255 USD de interés (más decimales que la moneda) ⇒ AMOUNT_SCALE_EXCEEDED', () => {
    expect(codeOf(() => parseCardChargeComponents({ interest: '1.255' }, USD))).toBe('AMOUNT_SCALE_EXCEEDED');
  });

  it('[TC-DEBT-CARD-049] anular marca el cargo, guarda el motivo y es idempotente', () => {
    const c = newCharge();
    expect(c.void('  monto equivocado ', 'u2', '2026-10-29T10:00:00.000Z')).toBe(true);
    expect(c.snapshot).toMatchObject({
      status: 'VOIDED',
      voidReason: 'monto equivocado',
      voidedBy: 'u2',
      version: 2,
    });
    expect(c.void('otra vez', 'u2', '2026-10-29T11:00:00.000Z')).toBe(false);
    expect(c.snapshot.version).toBe(2);
    expect(codeOf(() => newCharge().void('   ', 'u2', 'x'))).toBe('VALIDATION_FAILED');
  });

  it('[TC-DEBT-CARD-048] propone la diferencia con el banco solo si es positiva', () => {
    const proposal = proposeChargeFromDifference({
      reportedBilledBalance: bob('1125.30'),
      currentBilledBalance: bob('1120.50'),
      closingDate: '2026-10-25',
    });
    expect(proposal?.businessDate).toBe('2026-10-25');
    expect(proposal?.total.toFixed()).toBe('4.80');
    for (const [reported, current] of [
      ['1120.50', '1120.50'],
      ['1100.00', '1120.50'],
    ] as const) {
      expect(
        proposeChargeFromDifference({
          reportedBilledBalance: bob(reported),
          currentBilledBalance: bob(current),
          closingDate: '2026-10-25',
        }),
      ).toBeNull();
    }
    expect(
      proposeChargeFromDifference({
        reportedBilledBalance: null,
        currentBilledBalance: bob('1.00'),
        closingDate: '2026-10-25',
      }),
    ).toBeNull();
  });

  it('[TC-DEBT-CARD-043] PBT: el total es Σ de los componentes para montos aleatorios a la escala de BOB, USD y USDT', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(BOB, USD, USDT),
        fc.array(fc.integer({ min: 0, max: 100_000_000 }), { minLength: 4, maxLength: 4 }),
        (cur, units) => {
          fc.pre(units.some((u) => u > 0));
          const text = (u: number) => {
            const scaleFactor = 10 ** cur.scale;
            const whole = Math.floor(u / scaleFactor);
            const frac = String(u % scaleFactor).padStart(cur.scale, '0');
            return `${whole}.${frac}`;
          };
          const input = Object.fromEntries(
            CARD_CHARGE_COMPONENT_KEYS.map((k, i) => [k, text(units[i] as number)]),
          );
          const parsed = parseCardChargeComponents(input, cur);
          const charge = CardCharge.create({
            id: 'c',
            workspaceId: 'w',
            cardId: 'k',
            cardAccountId: 'a',
            accountId: 'b',
            transactionId: 't',
            businessDate: '2026-10-25',
            currency: cur,
            components: parsed,
            origin: 'RECORDED',
            createdAt: 'x',
            createdBy: 'u',
          });
          const sum = Money.sum(
            CARD_CHARGE_COMPONENT_KEYS.map((k) => parsed[k]),
            cur,
          );
          expect(charge.total().equals(sum)).toBe(true);
          expect(charge.total().isPositive()).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});
