import fc from 'fast-check';
import { Money, MoneyDecimal } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { acct, CCY, convert, rate, type FeeArg } from './conversion.fixtures.test-support.js';
import { toJournalEntryDraft } from './posting-translator.js';
import type { ConversionFeeType } from './conversion.js';

const NUM_RUNS = 100;
const CODES = ['BOB', 'USD', 'USDT', 'BTC', 'ETH'] as const;
type Code = (typeof CODES)[number];
const ccy = (c: string) => (CCY as Record<string, (typeof CCY)['BOB']>)[c] as (typeof CCY)['BOB'];
const FEE_TYPES: readonly ConversionFeeType[] = ['PROVIDER', 'NETWORK', 'BANK', 'TAX', 'OTHER'];

const units = (max: bigint) => fc.bigInt({ min: 1n, max });

/** Conversión arbitraria en las cuatro direcciones con 0..3 fees en origen, destino o tercera moneda. */
const conversionArb = fc
  .tuple(fc.constantFrom(...CODES), fc.constantFrom(...CODES))
  .filter(([a, b]) => a !== b)
  .chain(([src, tgt]) =>
    fc.record({
      src: fc.constant(src as Code),
      tgt: fc.constant(tgt as Code),
      converted: units(10n ** 14n),
      target: units(10n ** 14n),
      fees: fc.array(
        fc.record({
          where: fc.constantFrom('SOURCE', 'TARGET', 'THIRD'),
          units: units(10n ** 9n),
          type: fc.constantFrom(...FEE_TYPES),
        }),
        { maxLength: 3 },
      ),
      quoted: fc.option(fc.bigInt({ min: 1n, max: 10n ** 12n }), { nil: null }),
      reference: fc.option(fc.bigInt({ min: 1n, max: 10n ** 12n }), { nil: null }),
    }),
  )
  .map((g) => {
    // Tercera moneda (nunca es origen ni destino: CODES no incluye TRX).
    const third = 'TRX';
    const fees: FeeArg[] = g.fees.map((f) => {
      const code = f.where === 'SOURCE' ? g.src : f.where === 'TARGET' ? g.tgt : third;
      return {
        type: f.type,
        amount: Money.ofMinorUnits(f.units, ccy(code)),
        paidFrom: f.where === 'THIRD' ? acct(`wallet-${code}`, code) : null,
      };
    });
    const sourceFees = fees
      .filter((f) => f.amount.currency.code === g.src && !f.paidFrom)
      .reduce((acc, f) => acc + f.amount.toMinorUnits(), 0n);
    const r = (u: bigint) => rate(g.src, g.tgt, new MoneyDecimal(u.toString()).div('1000000').toFixed());
    return {
      ...g,
      feesArgs: fees,
      source: Money.ofMinorUnits(g.converted + sourceFees, ccy(g.src)),
      targetMoney: Money.ofMinorUnits(g.target, ccy(g.tgt)),
      quotedRate: g.quoted === null ? null : r(g.quoted),
      referenceRate: g.reference === null ? null : r(g.reference),
    };
  });

describe('Propiedades de conversiones (INV-004, INV-010, INV-024, INV-011)', () => {
  it('[TC-TRANSACTIONS-CONVERSION-004] cualquier conversión produce UN asiento que suma cero por moneda, con legs = postings de usuario e INV-010', () => {
    fc.assert(
      fc.property(conversionArb, (g) => {
        const tx = convert({
          from: acct('src-account', g.src),
          to: acct('tgt-account', g.tgt),
          source: g.source,
          target: g.targetMoney,
          fees: g.feesArgs,
          quoted: g.quotedRate,
          reference: g.referenceRate
            ? { fxRateId: 'ref', rate: g.referenceRate, rateType: 'P2P', source: 'MANUAL', asOf: null }
            : null,
        });
        const s = tx.snapshot;
        const d = s.conversion;
        if (!d) throw new Error('missing detail');
        const entry = toJournalEntryDraft(s);
        // INV-004: Σ por moneda = 0.
        const sums = new Map<string, Money>();
        for (const p of entry.postings) {
          const code = p.amount.currency.code;
          sums.set(code, (sums.get(code) ?? Money.zero(p.amount.currency)).add(p.amount));
          expect(p.amount.isZero()).toBe(false);
        }
        for (const v of sums.values()) expect(v.isZero()).toBe(true);
        // INV-024: los legs son exactamente los postings sobre cuentas del usuario.
        const userPostings = entry.postings
          .filter((p) => p.target.kind === 'USER_ACCOUNT')
          .map((p) => `${p.target.kind === 'USER_ACCOUNT' ? p.target.accountId : ''} ${p.amount.toString()}`)
          .sort();
        expect(userPostings).toEqual(s.legs.map((l) => `${l.accountId} ${l.amount.toString()}`).sort());
        // INV-010: convertido + fees en origen = bruto; neto + fees en destino = bruto destino.
        const deducted = (code: string) =>
          Money.sum(
            d.fees
              .filter((f) => !f.paidFromAccountId && f.amount.currency.code === code)
              .map((f) => f.amount),
            ccy(code),
          );
        expect(d.convertedSourceAmount.add(deducted(g.src)).equals(d.sourceAmount)).toBe(true);
        expect(d.targetAmount.add(deducted(g.tgt)).equals(d.grossTargetAmount)).toBe(true);
        // Los montos del detalle coinciden con los movimientos del asiento.
        expect(s.legs.find((l) => l.role === 'SOURCE')?.amount.equals(d.sourceAmount.negate())).toBe(true);
        expect(s.legs.find((l) => l.role === 'TARGET')?.amount.equals(d.targetAmount)).toBe(true);
        // Spread solo si hay cotizada y referencia (nunca estimado).
        expect(d.spread !== null).toBe(g.quotedRate !== null && g.referenceRate !== null);
        // INV-011: el detalle no se puede mutar.
        expect(Object.isFrozen(d)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('[TC-TRANSACTIONS-CONVERSION-004] la tasa efectiva persistida es neto/bruto en la orientación de display (18 decimales HALF_EVEN)', () => {
    fc.assert(
      fc.property(conversionArb, (g) => {
        const d = convert({
          from: acct('a', g.src),
          to: acct('b', g.tgt),
          source: g.source,
          target: g.targetMoney,
          fees: g.feesArgs,
        }).snapshot.conversion;
        if (!d) throw new Error('missing detail');
        const e = d.effectiveRate;
        const back =
          e.base.code === g.src
            ? g.targetMoney.toDecimal().div(g.source.toDecimal())
            : g.source.toDecimal().div(g.targetMoney.toDecimal());
        expect(e.value.eq(back)).toBe(true);
        expect(e.toPersisted()).toMatch(/^\d+\.\d{18}$/);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
