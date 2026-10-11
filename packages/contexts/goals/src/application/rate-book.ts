import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import { dec, endOfDayInstant, type ExactRate, type Instant } from '@pf/shared-kernel';
import type { ValuationPort } from './ports/index.js';

const rateKey = (r: ResolvedRateDto): string => JSON.stringify(r);

export interface RateNeeds {
  /** Stock: 1 `from` en `to` con la tasa vigente al consultar. */
  readonly stock: readonly { readonly from: string; readonly to: string }[];
  /** Flujo: 1 `from` en `to` con la tasa vigente al cierre del día de negocio `date`. */
  readonly flows: readonly { readonly from: string; readonly to: string; readonly date: string }[];
}

/**
 * Libro de tasas de una petición (openspec add-savings-goals, decisiones 11 y 13): UNA sola resolución de tasas por
 * petición (NFR-PERF-004) para el stock (saldo acumulado a la tasa vigente) y los flujos (ritmo a la tasa del cierre de
 * su fecha, `FlowValuation`, docs/33 D109). Sin tasa ⇒ `null` (nunca 1:1). Registra las tasas efectivamente usadas.
 */
export class RateBook {
  private readonly used = new Map<string, ResolvedRateDto>();

  private constructor(
    private readonly found: ReadonlyMap<string, ValuationRateDto>,
    readonly windowDays: number,
    readonly asOf: string,
  ) {}

  static async resolve(input: {
    readonly valuation: ValuationPort;
    readonly workspaceId: string;
    readonly needs: RateNeeds;
    readonly timeZone: string;
    readonly now: Instant;
    readonly windowDays: number;
  }): Promise<RateBook> {
    const asOf = input.now.toString();
    const requests = new Map<string, { base: string; quote: string; at: string }>();
    for (const s of input.needs.stock) {
      if (s.from === s.to) continue;
      requests.set(`S|${s.from}|${s.to}`, { base: s.from, quote: s.to, at: asOf });
    }
    for (const f of input.needs.flows) {
      if (f.from === f.to) continue;
      const close = endOfDayInstant(f.date, input.timeZone);
      const at = close.epochMillis > input.now.epochMillis ? asOf : close.toString();
      requests.set(`F|${f.from}|${f.to}|${f.date}`, { base: f.from, quote: f.to, at });
    }
    const keys = [...requests.keys()].sort();
    const found = new Map<string, ValuationRateDto>();
    if (keys.length > 0) {
      const result = await input.valuation.resolve({
        workspaceId: input.workspaceId,
        requests: keys.map((k) => requests.get(k) as { base: string; quote: string; at: string }),
        windowDays: input.windowDays,
      });
      keys.forEach((key, i) => {
        const rate = result[i];
        if (rate) found.set(key, rate);
      });
    }
    return new RateBook(found, input.windowDays, asOf);
  }

  private take(key: string): ExactRate | null {
    const rate = this.found.get(key);
    if (!rate) return null;
    this.used.set(rateKey(rate.resolved), rate.resolved);
    return { base: rate.exact.base, quote: rate.exact.quote, value: dec(rate.exact.value) };
  }

  /** Tasa de valoración vigente al consultar; `null` si no hay una dentro de la ventana. */
  stock(from: string, to: string): ExactRate | null {
    return this.take(`S|${from}|${to}`);
  }

  /** Tasa al cierre del día `date`; `null` si no hay una dentro de la ventana. */
  flow(from: string, to: string, date: string): ExactRate | null {
    return this.take(`F|${from}|${to}|${date}`);
  }

  ratesUsed(): readonly ResolvedRateDto[] {
    return [...this.used.values()];
  }
}
