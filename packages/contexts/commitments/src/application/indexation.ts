import { Money, convertExact, currency as makeCurrency, dec, type Currency } from '@pf/shared-kernel';
import type { AmountSpec, IndexedPrice } from '../domain/index.js';
import type { CommitmentsDeps } from './ports/index.js';

/** Lo que necesita la indexación de un candidato u ocurrencia a (re)escribir. */
export interface Indexable {
  readonly expected: AmountSpec;
  /** Moneda de la cuenta (la del monto esperado). */
  readonly currency: string;
  readonly indexedPrice?: IndexedPrice | undefined;
}

/**
 * Estima el monto esperado de los candidatos con precio indexado (openspec add-subscriptions N3; docs/31 D29, D48):
 * `precio × tasa de valoración vigente al generar` (tipo preferido del par, ventana de REPORTING), HALF_EVEN a la
 * escala de la moneda de la cuenta. Sin tasa el candidato queda como está (`VARIABLE`: el monto se ingresa al
 * confirmar); NUNCA se supone 1:1. Una sola resolución de tasas por par.
 */
export async function indexCandidates<T extends Indexable>(
  deps: CommitmentsDeps,
  workspaceId: string,
  items: readonly T[],
): Promise<T[]> {
  const indexed = items.filter((c) => c.indexedPrice !== undefined);
  if (indexed.length === 0) return [...items];
  const catalog = await deps.rates.workspaceCurrencies(workspaceId);
  const currencyOf = (code: string): Currency => {
    const found = catalog.find((c) => c.code === code);
    if (!found) throw new Error(`currency ${code} is not in the catalog`);
    return makeCurrency(found.code, found.scale);
  };
  const pairs = [
    ...new Set(indexed.map((c) => `${(c.indexedPrice as IndexedPrice).currency}|${c.currency}`)),
  ].sort();
  const at = deps.clock.now().toString();
  const found = await deps.rates.resolveValuationRates({
    workspaceId,
    requests: pairs.map((pair) => {
      const [base, quote] = pair.split('|') as [string, string];
      return { base, quote, at };
    }),
    windowDays: deps.rateValidityWindowDays,
  });
  const rateOf = new Map(pairs.map((pair, i) => [pair, found[i] ?? null] as const));
  return items.map((item) => {
    const price = item.indexedPrice;
    if (price === undefined) return item;
    const rate = rateOf.get(`${price.currency}|${item.currency}`);
    if (!rate) return item;
    const target = currencyOf(item.currency);
    const exact = convertExact(Money.parse(price.amount, currencyOf(price.currency)), target, {
      base: rate.exact.base,
      quote: rate.exact.quote,
      value: dec(rate.exact.value),
    });
    const estimate = Money.roundToScale(exact, target, 'HALF_EVEN');
    // Un redondeo a cero (precio mínimo y tasa ínfima) no es un monto válido: queda sin monto.
    if (!estimate.isPositive()) return item;
    return {
      ...item,
      expected: { type: 'ESTIMATED' as const, amount: estimate.toFixed(), min: null, max: null },
    };
  });
}
