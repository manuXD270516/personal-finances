import { dec, LocalDate, Money, type Currency, type Decimal } from '@pf/shared-kernel';

/**
 * DS `PredictedSpendingBand` (openspec add-predicted-cash-flow-band, design.md decisiones 2 y 3; docs/14 §8.1;
 * FR-FORECAST-008, FR-REPORTING-014/015): puro y determinista, sin reloj ni E/S. Reparte por día el gasto variable
 * predicho de cada periodo y arma, por moneda, las tres series de saldo con el gasto esperado, alto y bajo (límites del
 * intervalo del 80 %), más la probabilidad de déficit. NUNCA se suma a la serie principal ni a la del plan: el saldo con
 * gasto predicho es `serie principal − gasto repartido acumulado`. Todo en Decimal; el reparto se cuantiza a la escala de
 * la moneda (HALF_EVEN) y el residuo va al último día del periodo, así la suma del periodo es exacta (INV-001/002/020).
 */

export type ShortfallLikelihood = 'LIKELY' | 'POSSIBLE' | 'UNLIKELY' | 'NOT_AVAILABLE';

/** Gasto variable predicho de un periodo financiero (en la moneda de la banda, sin conversión). */
export interface BandPeriodInput {
  readonly start: string;
  readonly end: string;
  /** Valor esperado. */
  readonly expected: Decimal;
  /** Límite superior del intervalo del 80 % (gasto alto). */
  readonly high: Decimal;
  /** Límite inferior del intervalo del 80 % (gasto bajo). */
  readonly low: Decimal;
}

export interface BandMainDay {
  readonly date: string;
  /** Saldo al cierre del día de la serie principal. */
  readonly balance: Money;
  /** Saldo más bajo del día de la serie principal (egresos antes que ingresos). */
  readonly low: Money;
}

/** Gasto repartido de un día en los tres casos. */
export interface BandDaySpend {
  readonly expected: Decimal;
  readonly high: Decimal;
  readonly low: Decimal;
}

export interface BandDayPoint {
  readonly date: string;
  /** Saldo al cierre del día con el gasto esperado. */
  readonly expected: Money;
  /** Saldo con el gasto alto (límite superior del 80 %): el más bajo de los tres. */
  readonly high: Money;
  /** Saldo con el gasto bajo (límite inferior del 80 %): el más alto de los tres. */
  readonly low: Money;
}

export interface BandLowest {
  readonly amount: Money;
  readonly date: string;
}

export interface PredictedBand {
  readonly series: readonly BandDayPoint[];
  /** Saldo más bajo del día (como el de la serie principal) por caso, con su PRIMERA fecha. */
  readonly lowest: { readonly expected: BandLowest; readonly high: BandLowest };
  readonly shortfallLikelihood: Exclude<ShortfallLikelihood, 'NOT_AVAILABLE'>;
  readonly firstShortfallDate: string | null;
}

const ZERO = dec('0');
const epoch = (date: string) => LocalDate.parse(date).toEpochDay();
const addDays = (date: string, n: number) => LocalDate.parse(date).plusDays(n).toString();

export const PredictedSpendingBand = {
  /** Lo que falta del periodo en curso: el predicho menos lo ya gastado, nunca menos de cero (la banda no «devuelve» dinero). */
  remaining(predicted: Decimal, spent: Decimal): Decimal {
    const left = predicted.minus(spent);
    return left.isNegative() ? ZERO : left;
  },

  /**
   * Reparte `total` en `days` partes iguales cuantizadas a la escala de la moneda (HALF_EVEN); el último día lleva el
   * residuo para que la suma sea exacta.
   */
  split(total: Decimal, days: number, currency: Currency): Decimal[] {
    if (!Number.isInteger(days) || days < 1) throw new RangeError('days must be a positive integer');
    const exact = Money.roundToScale(total, currency, 'HALF_EVEN').toDecimal();
    const share = Money.roundToScale(exact.div(days), currency, 'HALF_EVEN').toDecimal();
    const out = Array.from({ length: days - 1 }, () => share);
    out.push(exact.minus(share.times(days - 1)));
    return out;
  },

  /**
   * Gasto repartido por día desde `today` hasta `horizonEnd`. En el periodo en curso se reparte lo que falta
   * (`remaining`) entre los días desde hoy hasta el fin del periodo, ambos incluidos; en los siguientes, el valor del
   * periodo entre todos sus días. Los días sin periodo pronosticado no gastan.
   */
  dailySpend(input: {
    readonly today: string;
    readonly horizonEnd: string;
    readonly periods: readonly BandPeriodInput[];
    /** Gasto variable líquido ya hecho en el periodo en curso, hasta hoy. */
    readonly spent: Decimal;
    readonly currency: Currency;
  }): Map<string, BandDaySpend> {
    const out = new Map<string, BandDaySpend>();
    for (const p of [...input.periods].sort((a, b) => (a.start < b.start ? -1 : 1))) {
      if (p.end < input.today || p.start > input.horizonEnd) continue;
      const current = p.start <= input.today;
      const first = current ? input.today : p.start;
      const days = epoch(p.end) - epoch(first) + 1;
      const q = (v: Decimal) => (current ? PredictedSpendingBand.remaining(v, input.spent) : v);
      const expected = PredictedSpendingBand.split(q(p.expected), days, input.currency);
      const high = PredictedSpendingBand.split(q(p.high), days, input.currency);
      const low = PredictedSpendingBand.split(q(p.low), days, input.currency);
      for (let i = 0; i < days; i += 1) {
        out.set(addDays(first, i), {
          expected: expected[i] as Decimal,
          high: high[i] as Decimal,
          low: low[i] as Decimal,
        });
      }
    }
    return out;
  },

  /**
   * Probabilidad de déficit con el gasto predicho: `LIKELY` si el saldo más bajo con gasto esperado queda por debajo del
   * umbral; `POSSIBLE` si solo queda por debajo el de gasto alto; `UNLIKELY` en otro caso. La fecha es el primer día
   * bajo el umbral de la serie que lo determina. Con un intervalo del 80 %: «posible» ≈ 1 de cada 10 o más; «probable»
   * ≈ 1 de cada 2 o más. Independiente del nivel de riesgo (que usa solo la serie principal).
   */
  likelihood(input: {
    readonly threshold: Money;
    readonly expected: readonly { readonly date: string; readonly low: Money }[];
    readonly high: readonly { readonly date: string; readonly low: Money }[];
  }): {
    readonly likelihood: Exclude<ShortfallLikelihood, 'NOT_AVAILABLE'>;
    readonly firstShortfallDate: string | null;
  } {
    const first = (series: readonly { date: string; low: Money }[]) =>
      series.find((p) => p.low.compare(input.threshold) < 0)?.date ?? null;
    const expectedDate = first(input.expected);
    if (expectedDate !== null) return { likelihood: 'LIKELY', firstShortfallDate: expectedDate };
    const highDate = first(input.high);
    if (highDate !== null) return { likelihood: 'POSSIBLE', firstShortfallDate: highDate };
    return { likelihood: 'UNLIKELY', firstShortfallDate: null };
  },

  /** Las tres series de saldo, el mínimo de cada una y la probabilidad de déficit sobre la serie principal ya calculada. */
  compute(input: {
    readonly currency: Currency;
    /** Umbral del riesgo: la reserva mínima de la moneda o cero. */
    readonly threshold: Money;
    readonly main: readonly BandMainDay[];
    readonly periods: readonly BandPeriodInput[];
    readonly spent: Decimal;
  }): PredictedBand {
    const { currency } = input;
    const first = input.main[0];
    const last = input.main.at(-1);
    if (!first || !last) throw new RangeError('main series must not be empty');
    const spend = PredictedSpendingBand.dailySpend({
      today: first.date,
      horizonEnd: last.date,
      periods: input.periods,
      spent: input.spent,
      currency,
    });
    let cumExpected = ZERO;
    let cumHigh = ZERO;
    let cumLow = ZERO;
    const present = (v: Decimal) => Money.roundToScale(v, currency, 'HALF_EVEN');
    const series: BandDayPoint[] = [];
    const lowsExpected: { date: string; low: Money }[] = [];
    const lowsHigh: { date: string; low: Money }[] = [];
    for (const day of input.main) {
      const s = spend.get(day.date);
      if (s) {
        cumExpected = cumExpected.plus(s.expected);
        cumHigh = cumHigh.plus(s.high);
        cumLow = cumLow.plus(s.low);
      }
      const balance = day.balance.toDecimal();
      const trough = day.low.toDecimal();
      series.push({
        date: day.date,
        expected: present(balance.minus(cumExpected)),
        high: present(balance.minus(cumHigh)),
        low: present(balance.minus(cumLow)),
      });
      lowsExpected.push({ date: day.date, low: present(trough.minus(cumExpected)) });
      lowsHigh.push({ date: day.date, low: present(trough.minus(cumHigh)) });
    }
    const lowestOf = (lows: readonly { date: string; low: Money }[]): BandLowest => {
      let best = lows[0] as { date: string; low: Money };
      for (const p of lows) if (p.low.compare(best.low) < 0) best = p;
      return { amount: best.low, date: best.date };
    };
    const verdict = PredictedSpendingBand.likelihood({
      threshold: input.threshold,
      expected: lowsExpected,
      high: lowsHigh,
    });
    return {
      series,
      lowest: { expected: lowestOf(lowsExpected), high: lowestOf(lowsHigh) },
      shortfallLikelihood: verdict.likelihood,
      firstShortfallDate: verdict.firstShortfallDate,
    };
  },
} as const;
