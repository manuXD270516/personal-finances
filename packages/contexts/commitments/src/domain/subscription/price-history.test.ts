import { DomainError, Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PriceHistory } from './price-history.js';
import { Subscription } from './subscription.js';

const USD = currency('USD', 2);
const BOB = currency('BOB', 2);
const usd = (amount: string) => Money.parse(amount, USD);
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

function streamly(): PriceHistory {
  return PriceHistory.initial({ id: 'p1', effectiveFrom: '2026-11-15', price: usd('10.99') }).history;
}

describe('Historial de precios', () => {
  it('[TC-COMMITMENTS-SUBS-012] el precio vigente por fecha es el de la última entrada con vigencia ≤ fecha', () => {
    const { history } = streamly().append({
      id: 'p2',
      effectiveFrom: '2027-03-15',
      price: usd('12.99'),
      origin: 'MANUAL',
    });
    expect(history.at('2027-02-28')?.price.toJSON()).toEqual({ amount: '10.99', currency: 'USD' });
    expect(history.at('2027-03-15')?.price.toJSON()).toEqual({ amount: '12.99', currency: 'USD' });
    expect(history.at('2026-11-14')).toBeNull();
    expect(history.latest?.id).toBe('p2');
  });

  it('[TC-COMMITMENTS-SUBS-012] el historial es un valor inmutable: agregar devuelve otro y no toca el original', () => {
    const base = streamly();
    const { history } = base.append({
      id: 'p2',
      effectiveFrom: '2027-03-15',
      price: usd('12.99'),
      origin: 'MANUAL',
    });
    expect(base.entries).toHaveLength(1);
    expect(history.entries).toHaveLength(2);
    expect(base.latest?.id).toBe('p1');
  });

  it('[TC-COMMITMENTS-SUBS-014] un precio con vigencia anterior o igual a la última se rechaza', () => {
    const { history } = streamly().append({
      id: 'p2',
      effectiveFrom: '2027-03-15',
      price: usd('12.99'),
      origin: 'MANUAL',
    });
    const add = (effectiveFrom: string) => () =>
      history.append({ id: 'p3', effectiveFrom, price: usd('11.99'), origin: 'MANUAL' });
    expect(codeOf(add('2027-01-15'))).toBe('SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL');
    expect(codeOf(add('2027-03-15'))).toBe('SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL');
    expect(add('2027-03-16')).not.toThrow();
  });

  it('[TC-COMMITMENTS-SUBS-014] todas las entradas están en la moneda del precio y son positivas', () => {
    const base = streamly();
    expect(
      codeOf(() =>
        base.append({
          id: 'p',
          effectiveFrom: '2027-01-01',
          price: Money.parse('100.00', BOB),
          origin: 'MANUAL',
        }),
      ),
    ).toBe('CURRENCY_MISMATCH');
    expect(
      codeOf(() =>
        base.append({ id: 'p', effectiveFrom: '2027-01-01', price: usd('0.00'), origin: 'MANUAL' }),
      ),
    ).toBe('AMOUNT_NOT_POSITIVE');
  });

  it('[TC-COMMITMENTS-SUBS-018] corregir reemplaza con la misma vigencia y conserva la original marcada', () => {
    const { history: withTypo } = streamly().append({
      id: 'p2',
      effectiveFrom: '2027-03-15',
      price: usd('129.90'),
      origin: 'MANUAL',
    });
    const { history, entry, superseded } = withTypo.supersede({
      id: 'p3',
      entryId: 'p2',
      price: usd('12.99'),
    });
    expect(entry).toMatchObject({ origin: 'CORRECTION', supersedesId: 'p2', effectiveFrom: '2027-03-15' });
    expect(superseded.id).toBe('p2');
    expect(history.isSuperseded('p2')).toBe(true);
    expect(history.at('2027-03-15')?.price.toJSON()).toEqual({ amount: '12.99', currency: 'USD' });
    expect(history.entries.map((e) => e.id)).toEqual(['p1', 'p2', 'p3']);
    expect(history.active.map((e) => e.id)).toEqual(['p1', 'p3']);
  });

  it('[TC-COMMITMENTS-SUBS-018] una entrada ya reemplazada no admite otro reemplazo', () => {
    const { history: h1 } = streamly().append({
      id: 'p2',
      effectiveFrom: '2027-03-15',
      price: usd('129.90'),
      origin: 'MANUAL',
    });
    const { history } = h1.supersede({ id: 'p3', entryId: 'p2', price: usd('12.99') });
    expect(codeOf(() => history.supersede({ id: 'p4', entryId: 'p2', price: usd('13.00') }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    expect(codeOf(() => history.supersede({ id: 'p4', entryId: 'zzz', price: usd('13.00') }))).toBe(
      'RESOURCE_NOT_FOUND',
    );
    // la corrección sí puede corregirse a su vez (cadena de reemplazos)
    expect(codeOf(() => history.supersede({ id: 'p4', entryId: 'p3', price: usd('13.00') }))).toBeUndefined();
  });

  it('[TC-COMMITMENTS-SUBS-013] el aggregate agrega la entrada manual y sube la versión', () => {
    const sub = Subscription.create({
      id: 's',
      workspaceId: 'w',
      definitionId: 'd',
      counterpartyId: 'c',
      name: 'Streamly',
      price: usd('10.99'),
      priceEntryId: 'p1',
      firstRenewalOn: '2026-11-15',
      at: '2026-10-10T00:00:00.000Z',
      by: null,
    });
    const entry = sub.changePrice(
      { entryId: 'p2', effectiveFrom: '2027-03-15', price: usd('12.99'), origin: 'MANUAL' },
      '2026-10-11T00:00:00.000Z',
      'u',
    );
    expect(entry.origin).toBe('MANUAL');
    expect(sub.version).toBe(2);
    expect(sub.addedPrices.map((e) => e.id)).toEqual(['p1', 'p2']);
    expect(
      codeOf(() =>
        sub.changePrice(
          { entryId: 'p3', effectiveFrom: '2027-01-01', price: usd('11.99'), origin: 'MANUAL' },
          '2026-10-11T00:00:00.000Z',
          'u',
        ),
      ),
    ).toBe('SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL');
    expect(
      codeOf(() =>
        sub.changePrice(
          { entryId: 'p3', effectiveFrom: '2027-05-01', price: Money.parse('5.00', BOB), origin: 'MANUAL' },
          '2026-10-11T00:00:00.000Z',
          'u',
        ),
      ),
    ).toBe('CURRENCY_MISMATCH');
  });

  it('[TC-COMMITMENTS-SUBS-012] PBT: para todo historial válido el precio vigente es una función escalonada no ambigua', () => {
    const day = fc.integer({ min: 0, max: 400 });
    fc.assert(
      fc.property(
        fc.uniqueArray(day, { minLength: 1, maxLength: 8 }),
        fc.array(fc.integer({ min: 1, max: 99_999 }), { minLength: 8, maxLength: 8 }),
        fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        (days, cents, corrections) => {
          const date = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
          const sorted = [...days].sort((a, b) => a - b);
          const price = (i: number) => usd((cents[i]! / 100).toFixed(2));
          let { history } = PriceHistory.initial({
            id: 'e0',
            effectiveFrom: date(sorted[0]!),
            price: price(0),
          });
          for (let i = 1; i < sorted.length; i += 1) {
            history = history.append({
              id: `e${i}`,
              effectiveFrom: date(sorted[i]!),
              price: price(i),
              origin: 'MANUAL',
            }).history;
          }
          sorted.forEach((_, i) => {
            if (corrections[i]) {
              history = history.supersede({
                id: `c${i}`,
                entryId: `e${i}`,
                price: price((i + 1) % 8),
              }).history;
            }
          });
          let previous = '';
          for (let d = -1; d <= 401; d += 1) {
            const found = history.at(date(d));
            if (found === null) continue;
            expect(history.isSuperseded(found.id)).toBe(false);
            expect(found.effectiveFrom <= date(d)).toBe(true);
            // escalonada: el vigente sólo cambia hacia adelante en el tiempo
            expect(found.effectiveFrom >= previous).toBe(true);
            previous = found.effectiveFrom;
            // no ambiguo: ninguna otra entrada activa tiene la misma vigencia
            expect(history.active.filter((e) => e.effectiveFrom === found.effectiveFrom)).toHaveLength(1);
          }
        },
      ),
      { numRuns: process.env['NIGHTLY'] ? 10_000 : 100 },
    );
  });
});
