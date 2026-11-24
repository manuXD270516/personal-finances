import { currency, dec, Money, type Currency, type ExactRate } from '@pf/shared-kernel';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  TREND_TOP_SERIES,
  TrendMatrix,
  type TrendCategory,
  type TrendFact,
  type TrendSeries,
} from './extended-reports.js';
import { ReportConversionPolicy, type ReportAmount } from './report-conversion.js';
import type { ReportPeriod } from './report-periods.js';

/*
 * TC-REPORTING-REPORTS-055 (equivalencia, capa de dominio) y TC-REPORTING-REPORTS-057 (costo lineal) de
 * `fix-trends-report-perf`.
 *
 * `oracleBuild` es la copia LITERAL de `TrendMatrix.build` de `main` 4cdc7689 (filtra la lista completa de hechos por
 * cada serie y periodo): se conserva solo aquí como regresión mientras el test exista.
 */

const byAmountThenName = <T extends { amount: ReportAmount; name: string }>(items: T[]): T[] =>
  items.sort((a, b) => b.amount.exact.comparedTo(a.amount.exact) || a.name.localeCompare(b.name, 'es'));

type BuildInput = Parameters<typeof TrendMatrix.build>[0];

function oracleBuild(input: BuildInput): readonly TrendSeries[] {
  const top = new Map(input.categories.map((c) => [c.categoryId, c.topId]));
  const names = new Map(input.categories.map((c) => [c.categoryId, c.name]));
  const topOf = (id: string) => top.get(id) ?? id;
  const topIds = [...new Set(input.facts.map((f) => topOf(f.categoryId)))];
  const ranked = byAmountThenName(
    topIds.map((categoryId) => ({
      categoryId,
      name: names.get(categoryId) ?? categoryId,
      amount: input.policy.value(
        input.facts
          .filter((f) => topOf(f.categoryId) === categoryId)
          .map((f) => ({ date: f.date, amount: f.amount })),
      ),
    })),
  );
  const kept = ranked.slice(0, TREND_TOP_SERIES);
  const restIds = new Set(ranked.slice(TREND_TOP_SERIES).map((r) => r.categoryId));
  const cellsOf = (pick: (f: TrendFact) => boolean) =>
    input.periods.map((period) => ({
      period,
      amount: input.policy.value(
        input.facts
          .filter((f) => pick(f) && f.date >= period.from && f.date <= period.to)
          .map((f) => ({ date: f.date, amount: f.amount })),
        input.perDay ? period.days : undefined,
      ),
    }));
  const totalOf = (pick: (f: TrendFact) => boolean) =>
    input.policy.value(
      input.facts.filter(pick).map((f) => ({ date: f.date, amount: f.amount })),
      input.perDay ? input.periods.reduce((n, p) => n + p.days, 0) : undefined,
    );
  const series: TrendSeries[] = kept.map((k) => {
    const pick = (f: TrendFact) => topOf(f.categoryId) === k.categoryId;
    return { categoryId: k.categoryId, name: k.name, cells: cellsOf(pick), total: totalOf(pick) };
  });
  if (restIds.size > 0) {
    const pick = (f: TrendFact) => restIds.has(topOf(f.categoryId));
    series.push({ categoryId: null, name: input.othersName, cells: cellsOf(pick), total: totalOf(pick) });
  }
  return series;
}

// ───────────────────────────────────────────── datos generados

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
const BTC = currency('BTC', 8);
const CURRENCIES: readonly Currency[] = [BOB, USD, USDT, BTC];

/** Periodos calendario consecutivos desde 2024-10 (como el reporte de tendencias con `CALENDAR_MONTH`). */
function calendarPeriods(count: number): ReportPeriod[] {
  const out: ReportPeriod[] = [];
  for (let i = 0; i < count; i += 1) {
    const first = new Date(Date.UTC(2024, 9 + i, 1));
    const last = new Date(Date.UTC(2024, 10 + i, 0));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    out.push({
      label: iso(first).slice(0, 7),
      from: iso(first),
      to: iso(last),
      days: last.getUTCDate(),
      partial: false,
    });
  }
  return out;
}

const dayOf = (offset: number): string =>
  new Date(Date.UTC(2024, 9, 1) + offset * 86_400_000).toISOString().slice(0, 10);

/** Hash determinista y barato de un texto (para decidir qué tasas existen y su valor). */
function hash(text: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16_777_619);
  return h >>> 0;
}

/** Tabla de tasas: presente en `density`/10 de los (moneda, día); registra el orden de la primera consulta. */
function rateTable(density: number, seen: string[]): (code: string, date: string) => ExactRate | null {
  const known = new Set<string>();
  return (code, date) => {
    const key = `${code}|${date}`;
    if (!known.has(key)) {
      known.add(key);
      seen.push(key);
    }
    const h = hash(key);
    if (h % 10 >= density) return null;
    return { base: code, quote: 'BOB', value: dec(`${1 + (h % 7_000) / 1_000}`) };
  };
}

interface Scenario {
  readonly periodCount: number;
  readonly perDay: boolean;
  readonly cutoff: boolean;
  readonly density: number;
  readonly topCount: number;
  readonly facts: readonly {
    readonly day: number;
    readonly category: number;
    readonly currency: number;
    readonly minor: number;
  }[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  periodCount: fc.constantFrom(6, 12, 24),
  perDay: fc.boolean(),
  cutoff: fc.boolean(),
  density: fc.constantFrom(0, 3, 7, 10, 10),
  topCount: fc.integer({ min: 1, max: 15 }),
  facts: fc.array(
    fc.record({
      // Hasta 6 días antes del primer periodo y 40 después del último (fuera de todo periodo) y los bordes de mes.
      day: fc.oneof(
        fc.integer({ min: -6, max: 24 * 31 + 40 }),
        fc.constantFrom(0, 30, 31, 59, 60, 365, 366, 729, 730),
      ),
      category: fc.integer({ min: 0, max: 40 }),
      currency: fc.constantFrom(0, 0, 0, 1, 1, 2, 3),
      // Montos de una rejilla gruesa (empates entre categorías), con reembolsos negativos.
      minor: fc.oneof(
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: -5, max: 20 }).map((n) => n * 1_000),
      ),
    }),
    { minLength: 0, maxLength: 1_200, size: 'max' },
  ),
});

interface Built {
  readonly input: (seen: string[]) => BuildInput;
}

function build(s: Scenario): Built {
  // Categorías: `topCount` de primer nivel (t0…) y, por cada una, una subcategoría (s…); el id 2k+topCount está fuera
  // del árbol. Los nombres repiten (empates de monto con nombre distinto y con nombre igual).
  const categories: TrendCategory[] = [];
  for (let i = 0; i < s.topCount; i += 1) {
    categories.push({ categoryId: `t${i}`, name: `Cat ${i % 9}`, topId: `t${i}` });
    categories.push({ categoryId: `s${i}`, name: `Sub ${i}`, topId: `t${i}` });
  }
  const idOf = (k: number): string =>
    k >= 2 * s.topCount ? `x${k}` : k % 2 === 0 ? `t${k / 2}` : `s${(k - 1) / 2}`;
  const facts: TrendFact[] = s.facts.map((f) => ({
    date: dayOf(f.day),
    categoryId: idOf(f.category),
    amount: Money.ofMinorUnits(BigInt(f.minor), CURRENCIES[f.currency] as Currency),
  }));
  const periods = calendarPeriods(s.periodCount);
  return {
    input: (seen) => ({
      facts,
      categories,
      periods,
      policy: s.cutoff
        ? ReportConversionPolicy.cutoffDate(BOB, dayOf(24 * 31), rateTable(s.density, seen))
        : ReportConversionPolicy.transactionDate(BOB, rateTable(s.density, seen)),
      perDay: s.perDay,
      othersName: 'Otras categorías',
    }),
  };
}

const amountShape = (a: ReportAmount) => ({
  byCurrency: a.byCurrency.map((m) => `${m.currency.code}:${m.toFixed()}`),
  consolidated: a.consolidated.toFixed(),
  exact: a.exact.toFixed(),
  complete: a.complete,
  unconverted: a.unconverted.map((m) => `${m.currency.code}:${m.toFixed()}`),
});

const seriesShape = (series: readonly TrendSeries[]) =>
  series.map((s) => ({
    categoryId: s.categoryId,
    name: s.name,
    cells: s.cells.map((c) => ({ label: c.period.label, amount: amountShape(c.amount) })),
    total: amountShape(s.total),
  }));

const SEED = 20_261_124;

describe('TrendMatrix en una pasada: equivalencia con la implementación anterior (TC-REPORTING-REPORTS-055)', () => {
  const coverage = { series: 0, others: 0, incomplete: 0, empty: 0, negative: 0 };

  it('[TC-REPORTING-REPORTS-055] la matriz y el orden de la primera consulta de tasas son idénticos al oráculo', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const built = build(scenario);
        const seenOracle: string[] = [];
        const seenNew: string[] = [];
        const expected = oracleBuild(built.input(seenOracle));
        const actual = TrendMatrix.build(built.input(seenNew));
        expect(seriesShape(actual)).toEqual(seriesShape(expected));
        // `meta.conversion.ratesUsed` sale del orden de la primera consulta de cada tasa.
        expect(seenNew).toEqual(seenOracle);
        coverage.series += actual.length;
        if (actual.some((s) => s.categoryId === null)) coverage.others += 1;
        if (actual.some((s) => !s.total.complete)) coverage.incomplete += 1;
        if (actual.length === 0) coverage.empty += 1;
        if (actual.some((s) => s.total.exact.isNegative())) coverage.negative += 1;
      }),
      { numRuns: 300, seed: SEED, endOnFailure: false },
    );
  }, 180_000);

  it('[TC-REPORTING-REPORTS-055] el generador cubre «Otras categorías», cifras incompletas, vacías y negativas', () => {
    expect(coverage.series).toBeGreaterThan(300);
    expect(coverage.others).toBeGreaterThan(20);
    expect(coverage.incomplete).toBeGreaterThan(20);
    expect(coverage.empty).toBeGreaterThan(0);
    expect(coverage.negative).toBeGreaterThan(5);
    console.info(`[TC-REPORTING-REPORTS-055] cobertura: ${JSON.stringify(coverage)}`);
  });
});

// ───────────────────────────────────────────── costo lineal (TC-REPORTING-REPORTS-057)

describe('TrendMatrix: cada hecho se lee una cantidad acotada de veces (TC-REPORTING-REPORTS-057)', () => {
  const FACTS = 20_000;

  function bigInput(periodCount: number): { facts: TrendFact[]; categories: TrendCategory[] } {
    const categories: TrendCategory[] = [];
    for (let i = 0; i < 12; i += 1) {
      categories.push({ categoryId: `t${i}`, name: `Cat ${i}`, topId: `t${i}` });
      categories.push({ categoryId: `s${i}`, name: `Sub ${i}`, topId: `t${i}` });
    }
    const facts: TrendFact[] = [];
    for (let i = 0; i < FACTS; i += 1) {
      const cat = (i * 7) % 24;
      facts.push({
        date: dayOf((i * 13) % 730),
        categoryId: cat < 12 ? `t${cat}` : `s${cat - 12}`,
        amount: Money.ofMinorUnits(BigInt(100 + (i % 977)), CURRENCIES[i % 4] as Currency),
      });
    }
    void periodCount;
    return { facts, categories };
  }

  /** Cuenta las lecturas de elementos de la lista (por índice o por iteración). */
  function countingFacts(facts: TrendFact[], counter: { reads: number }): TrendFact[] {
    return new Proxy(facts, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) counter.reads += 1;
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
  }

  /** Política que cuenta las filas que recibe cada valoración. */
  function countingPolicy(inner: ReportConversionPolicy, counter: { rows: number }): ReportConversionPolicy {
    return new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'value') {
          return (rows: Parameters<ReportConversionPolicy['value']>[0], perDays?: number) => {
            counter.rows += rows.length;
            return target.value(rows, perDays);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
  }

  function measure(
    periodCount: number,
    perDay: boolean,
  ): { reads: number; rows: number; aggregates: number } {
    const { facts, categories } = bigInput(periodCount);
    const aggregates = new Set(
      facts.map((f) => `${f.categoryId.slice(1)}|${f.date}|${f.amount.currency.code}`),
    ).size;
    const reads = { reads: 0 };
    const rows = { rows: 0 };
    const policy = countingPolicy(ReportConversionPolicy.transactionDate(BOB, rateTable(10, [])), rows);
    TrendMatrix.build({
      facts: countingFacts(facts, reads),
      categories,
      periods: calendarPeriods(periodCount),
      policy,
      perDay,
      othersName: 'Otras categorías',
    });
    return { reads: reads.reads, rows: rows.rows, aggregates };
  }

  it('[TC-REPORTING-REPORTS-057] 20 000 hechos y 24 periodos: lecturas de hechos ≤ 2 x hechos y filas valoradas ≤ 3 x agregaciones', () => {
    for (const perDay of [false, true]) {
      const r = measure(24, perDay);
      console.info(`[TC-REPORTING-REPORTS-057] perDay=${perDay} ${JSON.stringify(r)}`);
      expect(r.reads).toBeLessThanOrEqual(2 * FACTS);
      expect(r.rows).toBeLessThanOrEqual(3 * r.aggregates);
    }
  }, 300_000);

  it('[TC-REPORTING-REPORTS-057] con 6 periodos las lecturas de hechos son las mismas que con 24', () => {
    expect(measure(6, false).reads).toBe(measure(24, false).reads);
  }, 300_000);
});
