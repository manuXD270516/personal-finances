import type { Currency } from '../money/currency.js';
import { dec, type Decimal } from '../money/decimal.js';
import type { Money } from '../money/money.js';
import { endOfDayInstant } from '../time/end-of-day.js';
import type { Instant } from '../time/instant.js';
import { convertExact, sumByCurrency, type ExactRate } from './exact-rate.js';

/** Resultado de consolidar en la moneda de reporte, SIN redondear. */
export interface Consolidated {
  /** Σ convertida a precisión completa (se redondea solo al presentar). */
  readonly total: Decimal;
  /** `false` si algún monto no nulo quedó sin tasa. */
  readonly complete: boolean;
  /** Montos nativos excluidos por falta de tasa, Σ por moneda, ordenados por código (nunca 1:1). */
  readonly unconverted: readonly Money[];
  /** Monedas distintas de la de reporte que sí se convirtieron (para informar las tasas usadas). */
  readonly convertedCurrencies: readonly string[];
}

/** Flujo fechado (fecha de negocio `YYYY-MM-DD`) para la conversión con la tasa de su fecha (`conv_t`). */
export interface DatedAmount {
  readonly date: string;
  readonly amount: Money;
}

/** Pedido de tasa de valoración de un flujo: 1 `base` en `quote` vigente en `at`. */
export interface FlowRateRequest {
  /** `<moneda>|<fecha>`: clave con la que `consolidate` busca la tasa. */
  readonly key: string;
  readonly base: string;
  readonly quote: string;
  readonly at: string;
}

/** Tasa resuelta por FX: la exacta para convertir y la de presentación `R` (opaca para el kernel). */
export interface FlowResolvedRate<R> {
  readonly exact: { readonly base: string; readonly quote: string; readonly value: string };
  readonly resolved: R;
}

export interface FlowRateResolverInput {
  readonly requests: readonly { readonly base: string; readonly quote: string; readonly at: string }[];
  readonly windowDays: number;
}

export interface FlowRates<R> {
  /** Tasa exacta de `code` al cierre del día `date`; `null` si no hay (nunca 1:1). */
  rateFor(code: string, date: string): ExactRate | null;
  /** Abre un colector: su `rateFor` registra las tasas efectivamente usadas, sin repetir (misma versión y orientación). */
  collector(): { rateFor(code: string, date: string): ExactRate | null; used(): readonly R[] };
}

/**
 * Valoración de FLUJOS compartida por Reporting (resumen del Home) y Planning (presupuesto vs real): docs/14 §5,
 * docs/31 D29/D34/D53 y docs/33 D109. Pura, sin dependencias de I/O: la resolución de tasas la inyecta el llamador.
 *   - agrega los flujos por (moneda, día de negocio) y convierte UNA vez cada agregado con la tasa vigente al cierre de
 *     ese día en la zona del workspace (sin pasar de "ahora");
 *   - sin redondeo intermedio (precisión 40); HALF_EVEN solo al presentar (`present`);
 *   - un agregado sin tasa NO se convierte a 1:1: queda en `unconverted` y el resultado, incompleto.
 */
export const FlowValuation = {
  /**
   * Pedidos de tasa distintos (moneda distinta del destino, día) ordenados por clave. La tasa se pide al cierre del
   * día de negocio en `timeZone`, acotado a `now`.
   */
  rateRequests(
    flows: readonly DatedAmount[],
    target: Currency,
    timeZone: string,
    now: Instant,
  ): FlowRateRequest[] {
    const keys = [
      ...new Set(
        flows
          .filter((f) => f.amount.currency.code !== target.code)
          .map((f) => `${f.amount.currency.code}|${f.date}`),
      ),
    ].sort();
    const nowText = now.toString();
    return keys.map((key) => {
      const [code, date] = key.split('|') as [string, string];
      const close = endOfDayInstant(date, timeZone);
      return {
        key,
        base: code,
        quote: target.code,
        at: close.epochMillis > now.epochMillis ? nowText : close.toString(),
      };
    });
  },

  /** Resuelve (en UNA llamada) las tasas de todos los flujos y devuelve un buscador por (moneda, día). */
  async resolveRates<R>(input: {
    readonly flows: readonly DatedAmount[];
    readonly target: Currency;
    readonly timeZone: string;
    readonly now: Instant;
    readonly windowDays: number;
    readonly resolve: (
      input: FlowRateResolverInput,
    ) => Promise<readonly (FlowResolvedRate<R> | null | undefined)[]>;
    readonly keyOf: (resolved: R) => string;
  }): Promise<FlowRates<R>> {
    const requests = FlowValuation.rateRequests(input.flows, input.target, input.timeZone, input.now);
    const found = requests.length
      ? await input.resolve({
          requests: requests.map(({ base, quote, at }) => ({ base, quote, at })),
          windowDays: input.windowDays,
        })
      : [];
    const byKey = new Map<string, FlowResolvedRate<R>>();
    requests.forEach((req, i) => {
      const rate = found[i];
      if (rate) byKey.set(req.key, rate);
    });
    const exactOf = (r: FlowResolvedRate<R>): ExactRate => ({
      base: r.exact.base,
      quote: r.exact.quote,
      value: dec(r.exact.value),
    });
    return {
      rateFor: (code, date) => {
        const r = byKey.get(`${code}|${date}`);
        return r ? exactOf(r) : null;
      },
      collector: () => {
        const used = new Map<string, R>();
        return {
          rateFor: (code, date) => {
            const r = byKey.get(`${code}|${date}`);
            if (!r) return null;
            const key = input.keyOf(r.resolved);
            if (!used.has(key)) used.set(key, r.resolved);
            return exactOf(r);
          },
          used: () => [...used.values()],
        };
      },
    };
  },

  /**
   * Consolida flujos fechados: Σ por (día, moneda) → UNA conversión por agregado con `rateFor(moneda, día)`. Los
   * agregados sin tasa se excluyen y se informan en su moneda original.
   */
  consolidate(
    rows: readonly DatedAmount[],
    target: Currency,
    rateFor: (currency: string, date: string) => ExactRate | null,
  ): Consolidated {
    const byDay = new Map<string, Money>();
    for (const r of rows) {
      const key = `${r.date}|${r.amount.currency.code}`;
      const prev = byDay.get(key);
      byDay.set(key, prev ? prev.add(r.amount) : r.amount);
    }
    let total = dec('0');
    const missing: Money[] = [];
    const converted = new Set<string>();
    for (const key of [...byDay.keys()].sort()) {
      const sum = byDay.get(key) as Money;
      const date = key.slice(0, key.indexOf('|'));
      if (sum.isZero()) continue;
      if (sum.currency.code === target.code) {
        total = total.plus(sum.amount);
        continue;
      }
      const rate = rateFor(sum.currency.code, date);
      if (!rate) {
        missing.push(sum);
        continue;
      }
      total = total.plus(convertExact(sum, target, rate));
      converted.add(sum.currency.code);
    }
    const unconverted = sumByCurrency(missing).filter((m) => !m.isZero());
    return {
      total,
      complete: missing.length === 0,
      unconverted,
      convertedCurrencies: [...converted].sort(),
    };
  },
} as const;
