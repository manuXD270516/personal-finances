import {
  DomainError,
  Instant,
  Money,
  MoneyDecimal,
  Rate,
  type Currency,
  type Decimal,
} from '@pf/shared-kernel';

/** Tipos de fee (FR-TRANSACTIONS-022 + `TAX` de docs/09 §7; docs/31 D12). */
export const CONVERSION_FEE_TYPES = ['PROVIDER', 'NETWORK', 'BANK', 'TAX', 'OTHER'] as const;
export type ConversionFeeType = (typeof CONVERSION_FEE_TYPES)[number];

/** Tipo de moneda del catálogo FX (solo lo usa la regla de orientación de display). */
export type CurrencyKindLike = 'FIAT' | 'CRYPTO' | 'COMMODITY' | 'CUSTOM';

export interface CurrencyInfo {
  readonly currency: Currency;
  readonly kind: CurrencyKindLike;
}

/** Orientación de display de un par: 1 `base` = x `quote` (docs/09 §7.1). */
export interface PairOrientation {
  readonly base: Currency;
  readonly quote: Currency;
}

const STABLECOINS: ReadonlySet<string> = new Set([
  'USDT',
  'USDC',
  'DAI',
  'BUSD',
  'TUSD',
  'FDUSD',
  'PYUSD',
  'USDP',
]);
/** Convención de forex para fiat "fuertes" (EUR/USD, GBP/USD, USD/CHF, USD/JPY…). */
const MAJOR_FIAT: readonly string[] = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

function tier(c: CurrencyInfo): number {
  if (c.kind === 'CRYPTO') return STABLECOINS.has(c.currency.code) ? 1 : 0;
  if (c.kind === 'FIAT' && MAJOR_FIAT.includes(c.currency.code)) return 2;
  return 3;
}

/**
 * Orientación de display determinista (design.md decisión 2; decisión 15): la moneda "más fuerte"/cripto es la base.
 * Niveles: cripto no estable (BTC, ETH, TRX…) → stablecoin (USDT, USDC…) → fiat mayor en orden forex (EUR, GBP, AUD,
 * NZD, USD, CAD, CHF, JPY) → resto (BOB…); empate dentro del nivel → orden alfabético. Ej.: `USD/BOB`, `USDT/BOB`,
 * `BTC/USDT`, `USDT/USD`.
 */
export function displayOrientation(a: CurrencyInfo, b: CurrencyInfo): PairOrientation {
  const ta = tier(a);
  const tb = tier(b);
  let aFirst: boolean;
  if (ta !== tb) aFirst = ta < tb;
  else if (ta === 2) aFirst = MAJOR_FIAT.indexOf(a.currency.code) < MAJOR_FIAT.indexOf(b.currency.code);
  else aFirst = a.currency.code < b.currency.code;
  return aFirst ? { base: a.currency, quote: b.currency } : { base: b.currency, quote: a.currency };
}

export interface ConversionFeeInput {
  readonly type: ConversionFeeType;
  readonly amount: Money;
  /** Cuenta que paga el fee cuando NO se descuenta del origen ni del destino (fees en tercera moneda). */
  readonly paidFromAccountId: string | null;
}

/** Dónde se paga un fee: descontado del bruto entregado, del bruto recibido o desde una tercera cuenta. */
export type FeeDeduction = 'SOURCE' | 'TARGET' | 'PAID_FROM';

export interface PriceConversionInput {
  /** Monto BRUTO entregado (incluye fees descontados en moneda origen). */
  readonly sourceAmount: Money;
  /** Monto NETO recibido. */
  readonly targetAmount: Money;
  readonly fees: readonly ConversionFeeInput[];
  /** Tasa tal como la dio el proveedor (informativa; los montos mandan). */
  readonly quotedRate: Rate | null;
  /** Versión exacta de la referencia de FX al instante de ejecución (directa o inversa, nunca cruzada). */
  readonly referenceRate: Rate | null;
  readonly display: PairOrientation;
}

export interface ConversionSpread {
  /** (m − q)/m × 100 si se vende la base; (q − m)/m × 100 si se compra; 18 decimales HALF_EVEN. Positivo = desfavorable. */
  readonly percentage: string;
  /** |q − m| × monto convertido de la base, en la moneda quote, HALF_EVEN a su escala. */
  readonly amount: Money;
}

export interface ConversionPricing {
  /** Bruto entregado − fees descontados en moneda origen (INV-010). */
  readonly convertedSource: Money;
  /** Neto recibido + fees descontados en moneda destino (INV-010). */
  readonly grossTarget: Money;
  /** neto / bruto en la orientación de display, a precisión completa (se persiste con 18 decimales). */
  readonly effectiveRate: Rate;
  readonly spread: ConversionSpread | null;
  /** Bruto destino − convertido × cotizada, solo si supera una unidad mínima de la moneda destino. */
  readonly quotedRateDeviation: Money | null;
  readonly deductions: readonly FeeDeduction[];
}

export const MAX_CONVERSION_FEES = 10;
const HUNDRED = new MoneyDecimal(100);

const inconsistent = (message: string, pointer: string) =>
  new DomainError('CONVERSION_AMOUNTS_INCONSISTENT', message).at(pointer);

const samePair = (r: { readonly base: Currency; readonly quote: Currency }, a: Currency, b: Currency) =>
  (r.base.code === a.code && r.quote.code === b.code) || (r.base.code === b.code && r.quote.code === a.code);

/** Clasifica cada fee según su moneda y cuenta pagadora (FR-TRANSACTIONS-023). */
export function feeDeductions(
  source: Currency,
  target: Currency,
  fees: readonly ConversionFeeInput[],
): FeeDeduction[] {
  if (fees.length > MAX_CONVERSION_FEES) {
    throw new DomainError('VALIDATION_FAILED', `at most ${MAX_CONVERSION_FEES} fees`).at('/fees');
  }
  return fees.map((f, i) => {
    if (!(CONVERSION_FEE_TYPES as readonly string[]).includes(f.type)) {
      throw new DomainError('VALIDATION_FAILED', `invalid fee type ${String(f.type)}`).at(`/fees/${i}/type`);
    }
    if (!f.amount.isPositive()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', 'fee must be > 0').at(`/fees/${i}/amount/amount`);
    }
    if (f.paidFromAccountId) return 'PAID_FROM';
    if (f.amount.currency.code === source.code) return 'SOURCE';
    if (f.amount.currency.code === target.code) return 'TARGET';
    throw inconsistent(
      `a fee in ${f.amount.currency.code} (neither ${source.code} nor ${target.code}) needs paidFromAccountId`,
      `/fees/${i}/paidFromAccountId`,
    );
  });
}

function sumDeducted(
  currency: Currency,
  fees: readonly ConversionFeeInput[],
  deductions: readonly FeeDeduction[],
  kind: FeeDeduction,
): Money {
  return Money.sum(
    fees.filter((_, i) => deductions[i] === kind).map((f) => f.amount),
    currency,
  );
}

const pct18 = (value: Decimal): string => value.toDecimalPlaces(18, MoneyDecimal.ROUND_HALF_EVEN).toFixed(18);

/**
 * DS `ConversionCalculator` (fx/conversion-pricing; docs/09 §7.1; design.md decisión 2), puro: decimal.js precisión 40,
 * HALF_EVEN solo al materializar.
 *  - convertido = bruto − fees en origen; bruto destino = neto + fees en destino (INV-010). Fees en tercera moneda no
 *    tocan esos montos ni la tasa efectiva.
 *  - efectiva = neto / bruto (source→target), normalizada a la orientación de display.
 *  - spread con cotizada `q` y referencia `m` en la orientación de display: venta de la base (m − q)/m × 100, compra
 *    (q − m)/m × 100; monto |q − m| × convertido de la base en la moneda quote. Sin cotizada o sin referencia: `null`
 *    (no se estima).
 *  - discrepancia: |bruto destino − convertido × cotizada| > 1 unidad mínima ⇒ se registra la diferencia (con signo);
 *    los montos reales prevalecen.
 */
export function priceConversion(input: PriceConversionInput): ConversionPricing {
  const { sourceAmount: source, targetAmount: target, display } = input;
  const src = source.currency;
  const tgt = target.currency;
  if (src.code === tgt.code) {
    throw new DomainError(
      'CONVERSION_SAME_CURRENCY',
      `both sides are in ${src.code}; record a transfer instead`,
    ).at('/targetAmount/currency');
  }
  if (!source.isPositive()) {
    throw new DomainError('AMOUNT_NOT_POSITIVE', 'sourceAmount must be > 0').at('/sourceAmount/amount');
  }
  if (!target.isPositive()) {
    throw new DomainError('AMOUNT_NOT_POSITIVE', 'targetAmount must be > 0').at('/targetAmount/amount');
  }
  if (!samePair(display, src, tgt)) {
    throw new DomainError('CURRENCY_MISMATCH', 'display orientation is not the conversion pair');
  }
  const deductions = feeDeductions(src, tgt, input.fees);
  const sourceFees = sumDeducted(src, input.fees, deductions, 'SOURCE');
  const targetFees = sumDeducted(tgt, input.fees, deductions, 'TARGET');
  const convertedSource = source.subtract(sourceFees);
  if (!convertedSource.isPositive()) {
    throw inconsistent(
      `fees in ${src.code} (${sourceFees.toFixed()}) must be less than the amount delivered (${source.toFixed()})`,
      '/fees',
    );
  }
  const grossTarget = target.add(targetFees);
  const quoted = input.quotedRate;
  if (quoted && !samePair(quoted, src, tgt)) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `quoted rate ${quoted.base.code}/${quoted.quote.code} is not ${src.code}/${tgt.code}`,
    ).at('/quotedRate');
  }
  const reference = input.referenceRate;
  if (reference && !samePair(reference, src, tgt)) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `reference rate ${reference.base.code}/${reference.quote.code} is not ${src.code}/${tgt.code}`,
    ).at('/referenceFxRateId');
  }
  const sellsBase = src.code === display.base.code;
  const effectiveValue = sellsBase
    ? target.toDecimal().div(source.toDecimal())
    : source.toDecimal().div(target.toDecimal());
  const effectiveRate = Rate.derived(display.base, display.quote, effectiveValue);

  let spread: ConversionSpread | null = null;
  if (quoted && reference) {
    const q = quoted.oriented(display.base).value;
    const m = reference.oriented(display.base).value;
    const raw = (sellsBase ? m.minus(q) : q.minus(m)).div(m).times(HUNDRED);
    const baseAmount = sellsBase ? convertedSource : grossTarget;
    spread = {
      percentage: pct18(raw),
      amount: Money.roundToScale(q.minus(m).abs().times(baseAmount.toDecimal()), display.quote, 'HALF_EVEN'),
    };
  }

  let quotedRateDeviation: Money | null = null;
  if (quoted) {
    const expected = quoted.convert(convertedSource);
    const diff = grossTarget.subtract(expected);
    const units = diff.toMinorUnits();
    if (units > 1n || units < -1n) quotedRateDeviation = diff;
  }
  return { convertedSource, grossTarget, effectiveRate, spread, quotedRateDeviation, deductions };
}

export interface DeriveConversionInput {
  readonly sourceCurrency: Currency;
  readonly targetCurrency: Currency;
  readonly sourceAmount: Money | null;
  readonly targetAmount: Money | null;
  readonly quotedRate: Rate | null;
  readonly fees: readonly ConversionFeeInput[];
  readonly display: PairOrientation;
}

/**
 * Vista previa (FR-TRANSACTIONS-025): con exactamente dos de {bruto entregado, neto recibido, cotizada} obtiene el
 * tercero con los mismos cálculos del registro (una cuantización HALF_EVEN por monto, tasa original, INV-032).
 */
export function deriveConversion(input: DeriveConversionInput): {
  readonly sourceAmount: Money;
  readonly targetAmount: Money;
  readonly quotedRate: Rate | null;
} {
  const { sourceCurrency: src, targetCurrency: tgt } = input;
  if (src.code === tgt.code) {
    throw new DomainError('CONVERSION_SAME_CURRENCY', `both sides are in ${src.code}`).at('/targetCurrency');
  }
  const given = [input.sourceAmount, input.targetAmount, input.quotedRate].filter((x) => x !== null).length;
  if (given !== 2) {
    throw inconsistent('exactly two of sourceAmount, targetAmount and quotedRate are required', '');
  }
  if (input.sourceAmount && input.sourceAmount.currency.code !== src.code) {
    throw new DomainError('CURRENCY_MISMATCH', `sourceAmount must be in ${src.code}`).at(
      '/sourceAmount/currency',
    );
  }
  if (input.targetAmount && input.targetAmount.currency.code !== tgt.code) {
    throw new DomainError('CURRENCY_MISMATCH', `targetAmount must be in ${tgt.code}`).at(
      '/targetAmount/currency',
    );
  }
  const quoted = input.quotedRate;
  if (quoted && !samePair(quoted, src, tgt)) {
    throw new DomainError('CURRENCY_MISMATCH', 'quoted rate is not the conversion pair').at('/quotedRate');
  }
  const deductions = feeDeductions(src, tgt, input.fees);
  const sourceFees = sumDeducted(src, input.fees, deductions, 'SOURCE');
  const targetFees = sumDeducted(tgt, input.fees, deductions, 'TARGET');
  if (input.sourceAmount && input.targetAmount) {
    const converted = input.sourceAmount.subtract(sourceFees);
    if (!converted.isPositive()) throw inconsistent('fees exceed the amount delivered', '/fees');
    const gross = input.targetAmount.add(targetFees);
    const sellsBase = src.code === input.display.base.code;
    const value = sellsBase
      ? gross.toDecimal().div(converted.toDecimal())
      : converted.toDecimal().div(gross.toDecimal());
    return {
      sourceAmount: input.sourceAmount,
      targetAmount: input.targetAmount,
      quotedRate: Rate.derived(input.display.base, input.display.quote, value),
    };
  }
  const rate = quoted as Rate;
  if (input.sourceAmount) {
    const converted = input.sourceAmount.subtract(sourceFees);
    if (!converted.isPositive()) throw inconsistent('fees exceed the amount delivered', '/fees');
    const net = rate.convert(converted).subtract(targetFees);
    if (!net.isPositive()) throw inconsistent('fees exceed the amount received', '/fees');
    return { sourceAmount: input.sourceAmount, targetAmount: net, quotedRate: rate };
  }
  const gross = (input.targetAmount as Money).add(targetFees);
  const converted = rate.convert(gross);
  return {
    sourceAmount: converted.add(sourceFees),
    targetAmount: input.targetAmount as Money,
    quotedRate: rate,
  };
}

/** Versión EXACTA de la referencia registrada (FR-FX-008): nunca cambia aunque la tasa se reemplace después. */
export interface ReferenceRateInfo {
  readonly fxRateId: string;
  readonly rate: Rate;
  readonly rateType: string | null;
  readonly source: string;
  readonly asOf: string | null;
}

export interface ConversionFee {
  readonly feeNo: number;
  readonly type: ConversionFeeType;
  readonly amount: Money;
  readonly paidFromAccountId: string | null;
  /** Split de gasto (categoría de sistema *Fees*) que lo representa en el asiento. */
  readonly splitId: string;
}

/**
 * VO `ConversionDetail` (docs/09 §7; INV-011/INV-012): detalle de precio INMUTABLE de una revisión de la conversión.
 * Nunca se recalcula con tasas nuevas; editar crea una revisión nueva (FR-TRANSACTIONS-024).
 */
export interface ConversionDetail {
  readonly revision: number;
  readonly sourceAccountId: string;
  readonly targetAccountId: string;
  readonly sourceAmount: Money;
  readonly convertedSourceAmount: Money;
  readonly grossTargetAmount: Money;
  readonly targetAmount: Money;
  readonly quotedRate: Rate | null;
  readonly effectiveRate: Rate;
  readonly referenceRate: ReferenceRateInfo | null;
  readonly spread: ConversionSpread | null;
  readonly quotedRateDeviation: Money | null;
  readonly fees: readonly ConversionFee[];
  readonly provider: { readonly counterpartyId: string | null; readonly name: string | null };
  readonly executedAt: string;
  readonly externalRef: string | null;
}

/** Congela el detalle (y sus colecciones) para que ninguna capa pueda mutarlo (INV-011). */
export function freezeDetail(d: ConversionDetail): ConversionDetail {
  return Object.freeze({
    ...d,
    fees: Object.freeze(d.fees.map((f) => Object.freeze({ ...f }))),
    provider: Object.freeze({ ...d.provider }),
    referenceRate: d.referenceRate ? Object.freeze({ ...d.referenceRate }) : null,
    spread: d.spread ? Object.freeze({ ...d.spread }) : null,
  });
}

export const assertInstant = (value: string, pointer: string): string => {
  try {
    return Instant.parse(value).toString();
  } catch (err) {
    throw err instanceof DomainError ? err.at(pointer) : err;
  }
};
