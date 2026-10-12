import { LocalDate, Money, sumByCurrency } from '@pf/shared-kernel';

export interface InterestSource {
  readonly id: string;
  readonly name: string;
  readonly amount: Money;
}

export interface InterestAttributionEntry {
  readonly kind: 'LOAN' | 'CREDIT_CARD' | 'OTHER';
  readonly id: string | null;
  readonly name: string | null;
  readonly byCurrency: readonly Money[];
}

export interface InterestAttributionResult {
  readonly entries: readonly InterestAttributionEntry[];
  /**
   * `false` si "otros intereses" resultó negativo en alguna moneda (datos inconsistentes, p. ej. un reembolso de
   * interés en otra cuenta): se informa tal cual, nunca se ajusta en silencio.
   */
  readonly consistent: boolean;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function perSource(sources: readonly InterestSource[]): Map<string, { name: string; amounts: Money[] }> {
  const out = new Map<string, { name: string; amounts: Money[] }>();
  for (const s of sources) {
    const entry = out.get(s.id) ?? { name: s.name, amounts: [] };
    entry.amounts.push(s.amount);
    out.set(s.id, entry);
  }
  return out;
}

/** Primer día del año del día `today` (año calendario en la zona del workspace; pregunta 4). */
export function interestYearStart(today: LocalDate): LocalDate {
  return LocalDate.of(today.year, 1, 1);
}

/**
 * `InterestAttribution` (design decisión 3): préstamos + tarjetas + "otros" = total por moneda. "Otros" = total −
 * préstamos − tarjetas por moneda.
 */
export const InterestAttribution = {
  attribute(input: {
    readonly total: readonly Money[];
    readonly loans: readonly InterestSource[];
    readonly cards: readonly InterestSource[];
  }): InterestAttributionResult {
    const entries: InterestAttributionEntry[] = [];
    const attributed: Money[] = [];
    for (const [kind, sources] of [
      ['LOAN', input.loans],
      ['CREDIT_CARD', input.cards],
    ] as const) {
      const grouped = [...perSource(sources).entries()]
        .map(([id, g]) => ({
          id,
          name: g.name,
          byCurrency: sumByCurrency(g.amounts).filter((m) => !m.isZero()),
        }))
        .filter((g) => g.byCurrency.length > 0)
        .sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id));
      for (const g of grouped) {
        entries.push({ kind, id: g.id, name: g.name, byCurrency: g.byCurrency });
        attributed.push(...g.byCurrency);
      }
    }
    const attributedByCurrency = new Map(sumByCurrency(attributed).map((m) => [m.currency.code, m] as const));
    const totalByCurrency = new Map(sumByCurrency(input.total).map((m) => [m.currency.code, m] as const));
    const other: Money[] = [];
    for (const code of [...new Set([...totalByCurrency.keys(), ...attributedByCurrency.keys()])].sort()) {
      const total = totalByCurrency.get(code);
      const done = attributedByCurrency.get(code);
      const base = (total ?? done) as Money;
      const rest = (total ?? Money.zero(base.currency)).subtract(done ?? Money.zero(base.currency));
      if (!rest.isZero()) other.push(rest);
    }
    entries.push({ kind: 'OTHER', id: null, name: null, byCurrency: other });
    return { entries, consistent: other.every((m) => !m.isNegative()) };
  },
};
