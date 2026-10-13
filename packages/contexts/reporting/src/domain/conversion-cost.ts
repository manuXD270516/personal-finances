import {
  dec,
  present,
  type Currency,
  type Decimal,
  type ExactRate,
  type Money,
  type Rate,
} from '@pf/shared-kernel';

/**
 * Análisis de costo de conversiones (openspec add-conversion-cost-analysis, fx/conversion-pricing; D244–D247).
 * Dominio PURO: agrupa las conversiones por periodo, canal y par, pondera el spread por el monto convertido y excluye
 * (contando aparte, con motivo) lo que no se puede valorar. Todo en precisión 40 sin redondeo intermedio; HALF_EVEN solo
 * al presentar (montos a la escala de la moneda de reporte, porcentajes a 4 decimales). Nunca estima un spread ni usa
 * una tasa 1:1.
 */

export type ChannelKind = 'COUNTERPARTY' | 'NAMED' | 'NONE';

/** Agrupación por periodo financiero del workspace (por defecto) o por mes calendario (D246). */
export type ConversionCostGrouping = 'FINANCIAL_PERIOD' | 'CALENDAR_MONTH';

/** Canal de la conversión (D244): contraparte registrada, nombre libre o "Sin canal" (nunca se infiere uno). */
export interface ConversionChannel {
  readonly kind: ChannelKind;
  readonly counterpartyId: string | null;
  readonly name: string | null;
}

/** Periodo de agrupación (financiero o mes calendario): etiqueta y rango inclusivo de fechas de negocio. */
export interface CostPeriod {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export type ExclusionReason = 'NO_REFERENCE' | 'NO_QUOTED_RATE' | 'NO_REPORTING_RATE';

/** Una conversión (revisión vigente) lista para agregar. */
export interface CostConversion {
  readonly id: string;
  readonly period: CostPeriod;
  /** Instante de ejecución (RFC 3339 UTC): la tasa de valoración se resuelve a este instante. */
  readonly executedAt: string;
  readonly channel: ConversionChannel;
  readonly sourceAccountId: string;
  readonly sourceAccountName: string;
  readonly targetAccountId: string;
  readonly targetAccountName: string;
  /** Par en la orientación de visualización de la conversión. */
  readonly pair: { readonly base: Currency; readonly quote: Currency };
  /** `SELL`: entrega la moneda base del par; `BUY`: la recibe. */
  readonly side: 'SELL' | 'BUY';
  /** Cantidad convertida de la moneda base (la vendida: bruto − fees en origen; la comprada: bruto antes de fees). */
  readonly baseQty: Money;
  /** Referencia registrada en su orientación almacenada; `null` si no se registró una. */
  readonly reference: Rate | null;
  /** Spread registrado: porcentaje con signo (positivo = desfavorable) y monto absoluto; `null` sin tasa cotizada. */
  readonly spread: { readonly pct: Decimal; readonly amount: Money } | null;
  readonly fees: readonly Money[];
  /**
   * Solo con el spread alternativo pedido (Could): tasa cotizada y tasa paralela del lado de la conversión vigente a su
   * instante en la orientación de su par (`null` si no la hay: queda fuera del alternativo y se cuenta aparte).
   */
  readonly alternative?: {
    readonly quoted: Rate | null;
    readonly parallel: Rate | null;
  };
}

/** Valoración a la moneda de reporte con la tasa vigente al instante de cada conversión. */
export interface CostValuation {
  readonly reporting: Currency;
  /** Tasa exacta `code` → moneda de reporte vigente a `at`; `null` si no hay (nunca 1:1). */
  rateFor(code: string, at: string): ExactRate | null;
}

export interface ExcludedBucket {
  readonly reason: ExclusionReason;
  readonly count: number;
  /** Cantidad convertida de la moneda base en su moneda original, Σ por moneda. */
  readonly amounts: readonly Money[];
}

export interface CostGroup {
  readonly period: CostPeriod;
  readonly channel: ConversionChannel;
  readonly sourceAccountId: string;
  readonly sourceAccountName: string;
  readonly targetAccountId: string;
  readonly targetAccountName: string;
  readonly pair: { readonly base: string; readonly quote: string };
  /** Conversiones contadas (las excluidas no entran). */
  readonly conversions: number;
  readonly converted: Money;
  /** Σ spread / Σ convertido × 100 (promedio ponderado por el monto convertido), 4 decimales; `null` sin conversiones contadas. */
  readonly spreadPct: string | null;
  readonly spreadAmount: Money;
  readonly fees: Money;
  readonly costTotal: Money;
  /** `false` si algún fee no pudo valorarse en la moneda de reporte (listado en `unvaluedFees`, nunca 1:1). */
  readonly costComplete: boolean;
  readonly unvaluedFees: readonly Money[];
  readonly excluded: readonly ExcludedBucket[];
  /** Spread contra la compra/venta paralela del día (solo si se pidió); `null` si no se pidió. */
  readonly alternative: { readonly spreadPct: string | null; readonly excludedCount: number } | null;
}

export interface CostTotals {
  readonly conversions: number;
  readonly converted: Money;
  readonly spreadAmount: Money;
  readonly fees: Money;
  readonly costTotal: Money;
  readonly excludedCount: number;
  readonly costComplete: boolean;
}

export interface CostAnalysis {
  readonly groups: readonly CostGroup[];
  readonly totals: CostTotals;
}

const ZERO = dec('0');
const HUNDRED = dec('100');
/** `Decimal.ROUND_HALF_EVEN` del clon aislado. */
const HALF_EVEN = 6;

/** Porcentaje `num / den × 100` a 4 decimales HALF_EVEN; `null` si `den` es cero. */
export function percentage(num: Decimal, den: Decimal): string | null {
  if (den.isZero()) return null;
  return num.div(den).times(HUNDRED).toDecimalPlaces(4, HALF_EVEN).toFixed(4);
}

/** Clave de agrupación del canal (D244): contraparte, nombre libre normalizado o "Sin canal". */
export function channelKey(channel: ConversionChannel): string {
  if (channel.kind === 'COUNTERPARTY') return `C:${channel.counterpartyId ?? ''}`;
  if (channel.kind === 'NAMED') return `N:${(channel.name ?? '').trim().toLocaleLowerCase('es')}`;
  return 'NONE';
}

/** Canal de una conversión según su contraparte registrada o, sin ella, el nombre libre (D244). */
export function channelOf(counterparty: {
  readonly counterpartyId: string | null;
  readonly name: string | null;
}): ConversionChannel {
  if (counterparty.counterpartyId) {
    return { kind: 'COUNTERPARTY', counterpartyId: counterparty.counterpartyId, name: counterparty.name };
  }
  const name = counterparty.name?.trim() ?? '';
  return name.length > 0
    ? { kind: 'NAMED', counterpartyId: null, name }
    : { kind: 'NONE', counterpartyId: null, name: null };
}

interface Accumulator {
  readonly first: CostConversion;
  conversions: number;
  converted: Decimal;
  spread: Decimal;
  fees: Decimal;
  unvalued: Money[];
  excluded: Map<ExclusionReason, { count: number; amounts: Money[] }>;
  altSpread: Decimal;
  altConverted: Decimal;
  altExcluded: number;
}

const groupKey = (c: CostConversion): string =>
  [
    c.period.label,
    channelKey(c.channel),
    c.sourceAccountId,
    c.targetAccountId,
    c.pair.base.code,
    c.pair.quote.code,
  ].join('|');

const exactOf = (r: Rate): ExactRate => ({ base: r.base.code, quote: r.quote.code, value: r.value });

/** Valor exacto de `amount` (en `from`) en `to` con `rate`; `null` si la tasa no es de ese par. */
function convertDecimal(amount: Decimal, from: string, to: string, rate: ExactRate | null): Decimal | null {
  if (from === to) return amount;
  if (!rate) return null;
  if (rate.base === from && rate.quote === to) return amount.times(rate.value);
  if (rate.quote === from && rate.base === to) return amount.div(rate.value);
  return null;
}

/** Suma `m` al total por moneda (orden estable por código). */
function addMoney(list: Money[], m: Money): void {
  const i = list.findIndex((x) => x.currency.code === m.currency.code);
  if (i === -1) list.push(m);
  else list[i] = (list[i] as Money).add(m);
}

const REASON_ORDER: readonly ExclusionReason[] = ['NO_REFERENCE', 'NO_QUOTED_RATE', 'NO_REPORTING_RATE'];

/**
 * DS `ConversionCostAggregator` (fx/conversion-pricing, D244–D247). Por conversión (revisión vigente):
 *   - `converted` = cantidad convertida de la moneda base × referencia registrada, valorada en la moneda de reporte con
 *     la tasa vigente al instante de la conversión si la quote no es la moneda de reporte;
 *   - `spread` = el registrado (|cotizada − referencia| × cantidad, con el signo de su porcentaje) valorado igual;
 *   - `fees` = Σ fees valorados con la referencia de la conversión (si es del par fee/reporte) o con la tasa vigente.
 * Por grupo: `spreadPct = Σ spread / Σ convertido × 100` (equivale al promedio ponderado por el monto convertido) y
 * `costTotal = Σ spread + Σ fees`, cuantizados UNA vez al presentar. Excluidas (contadas aparte, nunca estimadas): sin
 * referencia, sin tasa cotizada, o sin tasa de valoración a la moneda de reporte.
 */
export const ConversionCostAggregator = {
  aggregate(conversions: readonly CostConversion[], valuation: CostValuation): CostAnalysis {
    const { reporting } = valuation;
    const accs = new Map<string, Accumulator>();
    for (const c of conversions) {
      const key = groupKey(c);
      let acc = accs.get(key);
      if (!acc) {
        acc = {
          first: c,
          conversions: 0,
          converted: ZERO,
          spread: ZERO,
          fees: ZERO,
          unvalued: [],
          excluded: new Map(),
          altSpread: ZERO,
          altConverted: ZERO,
          altExcluded: 0,
        };
        accs.set(key, acc);
      }
      accumulate(acc, c, valuation);
    }
    const groups = [...accs.values()].map((a) => toGroup(a, reporting)).sort(compareGroups);
    const sum = (pick: (a: Accumulator) => Decimal) =>
      [...accs.values()].reduce((s, a) => s.plus(pick(a)), ZERO);
    const spread = sum((a) => a.spread);
    const fees = sum((a) => a.fees);
    return {
      groups,
      totals: {
        conversions: [...accs.values()].reduce((n, a) => n + a.conversions, 0),
        converted: present(
          sum((a) => a.converted),
          reporting,
        ),
        spreadAmount: present(spread, reporting),
        fees: present(fees, reporting),
        costTotal: present(spread.plus(fees), reporting),
        excludedCount: groups.reduce((n, g) => n + g.excluded.reduce((m, b) => m + b.count, 0), 0),
        costComplete: [...accs.values()].every((a) => a.unvalued.length === 0),
      },
    };
  },
};

function exclude(acc: Accumulator, reason: ExclusionReason, c: CostConversion): void {
  const bucket = acc.excluded.get(reason) ?? { count: 0, amounts: [] };
  bucket.count += 1;
  addMoney(bucket.amounts, c.baseQty);
  acc.excluded.set(reason, bucket);
}

function accumulate(acc: Accumulator, c: CostConversion, valuation: CostValuation): void {
  const reporting = valuation.reporting;
  if (c.alternative) accumulateAlternative(acc, c, valuation);
  if (!c.reference) return exclude(acc, 'NO_REFERENCE', c);
  if (!c.spread) return exclude(acc, 'NO_QUOTED_RATE', c);
  const convertedQuote = convertDecimal(
    c.baseQty.toDecimal(),
    c.pair.base.code,
    c.pair.quote.code,
    exactOf(c.reference),
  );
  if (convertedQuote === null) return exclude(acc, 'NO_REFERENCE', c);
  const quoteCode = c.pair.quote.code;
  const quoteRate = quoteCode === reporting.code ? null : valuation.rateFor(quoteCode, c.executedAt);
  const convertedRep = convertDecimal(convertedQuote, quoteCode, reporting.code, quoteRate);
  const spreadSigned = c.spread.pct.isNegative()
    ? c.spread.amount.toDecimal().neg()
    : c.spread.amount.toDecimal();
  const spreadCode = c.spread.amount.currency.code;
  const spreadRep = convertDecimal(
    spreadSigned,
    spreadCode,
    reporting.code,
    spreadCode === quoteCode ? quoteRate : valuation.rateFor(spreadCode, c.executedAt),
  );
  if (convertedRep === null || spreadRep === null) return exclude(acc, 'NO_REPORTING_RATE', c);
  let feesRep = ZERO;
  for (const fee of c.fees) {
    const code = fee.currency.code;
    const own =
      c.reference &&
      ((c.reference.base.code === code && c.reference.quote.code === reporting.code) ||
        (c.reference.quote.code === code && c.reference.base.code === reporting.code))
        ? exactOf(c.reference)
        : valuation.rateFor(code, c.executedAt);
    const value = convertDecimal(fee.toDecimal(), code, reporting.code, own);
    if (value === null) addMoney(acc.unvalued, fee);
    else feesRep = feesRep.plus(value);
  }
  acc.conversions += 1;
  acc.converted = acc.converted.plus(convertedRep);
  acc.spread = acc.spread.plus(spreadRep);
  acc.fees = acc.fees.plus(feesRep);
}

/**
 * Spread alternativo contra la compra/venta paralela del día (Could, D247): con `m` la paralela, `q` la cotizada y `Q`
 * la cantidad base, vendiendo la base `(m − q)/m` y comprándola `(q − m)/m` (positivo = desfavorable); monto
 * `|q − m| × Q` con ese signo y ponderación por `m × Q`. Una conversión sin cotizada, sin paralela del lado o sin tasa
 * de valoración queda fuera del alternativo y se cuenta aparte; el spread contra la referencia no cambia.
 */
function accumulateAlternative(acc: Accumulator, c: CostConversion, valuation: CostValuation): void {
  const alt = c.alternative;
  if (!alt) return;
  const { reporting } = valuation;
  if (!alt.quoted || !alt.parallel) {
    acc.altExcluded += 1;
    return;
  }
  const quote = c.pair.quote.code;
  const q = orient(alt.quoted, c.pair.base.code, quote);
  const m = orient(alt.parallel, c.pair.base.code, quote);
  if (q === null || m === null || m.isZero()) {
    acc.altExcluded += 1;
    return;
  }
  const qty = c.baseQty.toDecimal();
  const diff = c.side === 'SELL' ? m.minus(q) : q.minus(m);
  const spreadQuote = diff.times(qty);
  const convertedQuote = m.times(qty);
  const rate = quote === reporting.code ? null : valuation.rateFor(quote, c.executedAt);
  const spreadRep = convertDecimal(spreadQuote, quote, reporting.code, rate);
  const convertedRep = convertDecimal(convertedQuote, quote, reporting.code, rate);
  if (spreadRep === null || convertedRep === null) {
    acc.altExcluded += 1;
    return;
  }
  acc.altSpread = acc.altSpread.plus(spreadRep);
  acc.altConverted = acc.altConverted.plus(convertedRep);
}

/** Valor de la tasa en la orientación `1 base = x quote` (la inversa exacta si está al revés); `null` si es de otro par. */
function orient(rate: Rate, base: string, quote: string): Decimal | null {
  if (rate.base.code === base && rate.quote.code === quote) return rate.value;
  if (rate.base.code === quote && rate.quote.code === base) return dec('1').div(rate.value);
  return null;
}

function toGroup(a: Accumulator, reporting: Currency): CostGroup {
  const c = a.first;
  const excluded: ExcludedBucket[] = REASON_ORDER.flatMap((reason) => {
    const bucket = a.excluded.get(reason);
    return bucket
      ? [
          {
            reason,
            count: bucket.count,
            amounts: [...bucket.amounts].sort((x, y) => (x.currency.code < y.currency.code ? -1 : 1)),
          },
        ]
      : [];
  });
  return {
    period: c.period,
    channel: c.channel,
    sourceAccountId: c.sourceAccountId,
    sourceAccountName: c.sourceAccountName,
    targetAccountId: c.targetAccountId,
    targetAccountName: c.targetAccountName,
    pair: { base: c.pair.base.code, quote: c.pair.quote.code },
    conversions: a.conversions,
    converted: present(a.converted, reporting),
    spreadPct: percentage(a.spread, a.converted),
    spreadAmount: present(a.spread, reporting),
    fees: present(a.fees, reporting),
    costTotal: present(a.spread.plus(a.fees), reporting),
    costComplete: a.unvalued.length === 0,
    unvaluedFees: [...a.unvalued].sort((x, y) => (x.currency.code < y.currency.code ? -1 : 1)),
    excluded,
    alternative: c.alternative
      ? { spreadPct: percentage(a.altSpread, a.altConverted), excludedCount: a.altExcluded }
      : null,
  };
}

const channelSortName = (g: CostGroup): string =>
  g.channel.kind === 'NONE' ? '￿' : (g.channel.name ?? '').toLocaleLowerCase('es');

function compareGroups(a: CostGroup, b: CostGroup): number {
  return (
    a.period.from.localeCompare(b.period.from) ||
    channelSortName(a).localeCompare(channelSortName(b), 'es') ||
    a.sourceAccountName.localeCompare(b.sourceAccountName, 'es') ||
    a.targetAccountName.localeCompare(b.targetAccountName, 'es') ||
    `${a.pair.base}/${a.pair.quote}`.localeCompare(`${b.pair.base}/${b.pair.quote}`) ||
    a.sourceAccountId.localeCompare(b.sourceAccountId) ||
    a.targetAccountId.localeCompare(b.targetAccountId)
  );
}
