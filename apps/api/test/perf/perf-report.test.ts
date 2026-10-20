import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildReport,
  latencyResult,
  percentile,
  PERF_THRESHOLDS,
  PERF_THROUGHPUT,
  renderMarkdown,
  RLS_OVERHEAD,
  rlsResult,
  stats,
  throughputResult,
} from './perf-report.js';

// Los umbrales del benchmark nightly se leen de docs/02 (§PERF): si el NFR cambia, este test obliga a actualizar
// `PERF_THRESHOLDS` en el mismo PR.
const NFR_DOC = readFileSync(
  new URL('../../../../docs/02-non-functional-requirements.md', import.meta.url),
  'utf8',
);
const rowOf = (id: string) => NFR_DOC.split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';

describe('benchmarks nightly: umbrales y estadísticas', () => {
  it.each(Object.entries(PERF_THRESHOLDS))('%s coincide con docs/02', (id, t) => {
    expect(rowOf(id)).toContain(t.docText);
  });

  it('[TC-PLATFORM-PIPELINE-008] NFR-PERF-002 (búsqueda de texto) tiene umbral p95 de 400 ms bloqueante y un p95 de 450 ms es brecha', () => {
    expect(PERF_THRESHOLDS['NFR-PERF-002']).toMatchObject({ metric: 'p95', limitMs: 400 });
    const search = latencyResult({
      id: 'transactions-search',
      nfr: 'NFR-PERF-002',
      title: 'Búsqueda de texto',
      samples: Array.from({ length: 100 }, () => 450),
      limitMs: PERF_THRESHOLDS['NFR-PERF-002'].limitMs,
    });
    expect([search.value, search.limit, search.gate, search.passed]).toEqual([450, 400, true, false]);
    const report = buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [search] });
    expect(report.breaches).toEqual(['NFR-PERF-002 transactions-search: 450 ms > 400 ms']);
    expect(renderMarkdown(report)).toMatch(/NFR-PERF-002/);
  });

  it('[TC-PLATFORM-EVENTS-014] el umbral de throughput por consumidor coincide con docs/02 (NFR-PERF-008)', () => {
    expect(rowOf('NFR-PERF-008')).toContain(PERF_THROUGHPUT.docText);
  });

  it('el throughput bajo el mínimo es informativo por defecto y brecha solo si es gate', () => {
    const slow = throughputResult({
      id: 't',
      title: 'consumidor',
      perSecond: [30, 32],
      events: 62,
      seconds: 2,
      minEventsPerSecond: 42,
    });
    expect([slow.value, slow.passed, slow.gate]).toEqual([31, false, false]);
    expect(buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [slow] }).breaches).toEqual(
      [],
    );
    const gated = { ...slow, gate: true };
    expect(
      buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [gated] }).breaches,
    ).toEqual(['NFR-PERF-008 t: 31 ev/s < 42 ev/s']);
    expect(
      renderMarkdown(buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [slow] })),
    ).toContain('| 31 ev/s | ≥ 42 ev/s | informativo | FALLA |');
  });

  it('percentiles por rango más cercano', () => {
    const sample = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sample, 50)).toBe(50);
    expect(percentile(sample, 95)).toBe(95);
    expect(percentile(sample, 99)).toBe(99);
    expect(stats([3, 1, 2])).toMatchObject({ n: 3, min: 1, p50: 2, max: 3, mean: 2 });
  });

  it('un p95 sobre el umbral es una brecha y el reporte lo marca como FALLA', () => {
    const ok = latencyResult({ id: 'a', nfr: 'NFR-PERF-004', title: 'ok', samples: [10, 20], limitMs: 300 });
    const bad = latencyResult({
      id: 'b',
      nfr: 'NFR-PERF-003',
      title: 'lento',
      samples: [200, 400],
      limitMs: 150,
    });
    const info = latencyResult({
      id: 'c',
      nfr: 'NFR-PERF-001',
      title: 'informativo',
      samples: [999],
      limitMs: 200,
      gate: false,
    });
    const report = buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [ok, bad, info] });
    expect(report.breaches).toEqual(['NFR-PERF-003 b: 400 ms > 150 ms']);
    expect(renderMarkdown(report)).toContain('FALLA — 1 umbral(es) superado(s)');
  });

  it('overhead de RLS: < 10 % o diferencia bajo el piso de ruido', () => {
    expect(rlsResult({ id: 'r', title: 't', withRls: [10.5], withoutRls: [10] }).passed).toBe(true);
    expect(rlsResult({ id: 'r', title: 't', withRls: [15], withoutRls: [10] }).passed).toBe(false);
    expect(rlsResult({ id: 'r', title: 't', withRls: [0.4], withoutRls: [0.2] }).passed).toBe(true);
  });

  it('docs/31 D43: el agregado sintético de RLS es informativo (no es brecha); la consulta real sí es gate', () => {
    const synthetic = rlsResult({
      id: 's',
      title: 'agregado',
      withRls: [21.5],
      withoutRls: [18.2],
      gate: false,
    });
    const real = rlsResult({ id: 'q', title: 'PgBalanceQuery', withRls: [4.0], withoutRls: [3.1] });
    expect([synthetic.gate, synthetic.passed, real.gate, real.passed]).toEqual([false, false, true, false]);
    const report = buildReport({
      generatedAt: 'x',
      environment: {},
      dataset: {},
      results: [synthetic, real],
    });
    expect(report.breaches).toEqual(['RLS-OVERHEAD q: 0.29 > 0.1']);
    expect(renderMarkdown(report)).toContain('| informativo | FALLA |');
  });

  // Muestras sintéticas deterministas: 200 pares donde la diferencia por par se reparte de forma uniforme alrededor de
  // `centre` con ancho `spread` (la mediana es `centre`) y el lado sin RLS es constante.
  const pairsOf = (without: number, centre: number, spread: number, n = 200) => {
    const diffs = Array.from({ length: n }, (_, i) => centre + ((i + 0.5) / n - 0.5) * spread);
    return {
      withoutRls: diffs.map(() => without),
      withRls: diffs.map((d) => Math.round((without + d) * 1e6) / 1e6),
    };
  };
  const SAME_PLAN = {
    withRls: ['Index Only Scan (posting_balance_ix)'],
    withoutRls: ['Index Only Scan (posting_balance_ix)'],
  };

  it('[TC-PLATFORM-PIPELINE-015] una diferencia de 0.56 ms cuyo IC95 no alcanza el piso de 0.5 ms no es brecha (no demostrada sobre el piso absoluto)', () => {
    const r = rlsResult({
      id: 'rls-saldo',
      title: 'saldo por cuenta',
      plans: SAME_PLAN,
      ...pairsOf(1.02, 0.56, 3),
    });
    expect(r.verdict).toBe('no demostrada sobre el piso absoluto');
    expect(r.passed).toBe(true);
    expect(r.pairs).toBe(200);
    const [inf, sup] = r.ci95Ms!;
    // El límite inferior supera el 10 % de 1.02 ms (0.102) pero no el piso de 0.5 ms; la mediana (0.56) sí lo supera.
    expect(inf).toBeGreaterThan(0.102);
    expect(inf).toBeLessThan(RLS_OVERHEAD.noiseFloorMs);
    expect(sup).toBeGreaterThan(0.56);
    expect(r.notes).toContain('mediana con RLS 1.58 ms vs sin RLS 1.02 ms');
    expect(r.notes).toContain('diferencia 0.56 ms');
    expect(r.notes).toMatch(/IC95 \[0\.\d+, 0\.\d+\] ms/);
    expect(r.notes).toContain('no demostrada sobre el piso absoluto');
    expect(buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [r] }).breaches).toEqual(
      [],
    );
  });

  it('[TC-PLATFORM-PIPELINE-016] un sobrecosto de 3 ms sobre 10 ms con IC95 estrecho es brecha demostrada y falla el reporte', () => {
    const r = rlsResult({
      id: 'rls-saldo',
      title: 'saldo por cuenta',
      plans: SAME_PLAN,
      ...pairsOf(10, 3, 1.2),
    });
    expect(r.verdict).toBe('brecha demostrada');
    expect(r.passed).toBe(false);
    const [inf, sup] = r.ci95Ms!;
    expect(inf).toBeGreaterThan(2.7);
    expect(sup).toBeLessThan(3.3);
    expect(r.value).toBe(0.3);
    expect(r.notes).toContain('mediana con RLS 13 ms vs sin RLS 10 ms');
    expect(r.notes).toContain('brecha demostrada');
    const report = buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [r] });
    expect(report.breaches).toEqual(['RLS-OVERHEAD rls-saldo: 0.3 > 0.1']);
    expect(renderMarkdown(report)).toMatch(/FALLA — 1 umbral/);
  });

  it('[TC-PLATFORM-PIPELINE-017] si la política cambia el método de acceso del plan es brecha aunque el tiempo no se demuestre', () => {
    const r = rlsResult({
      id: 'rls-saldo',
      title: 'saldo por cuenta',
      plans: { withoutRls: ['Index Only Scan (posting_balance_ix)'], withRls: ['Seq Scan'] },
      ...pairsOf(1.02, 0.2, 0.7),
    });
    expect(r.verdict).toBe('plan distinto');
    expect(r.passed).toBe(false);
    expect(r.ci95Ms![0]).toBeLessThan(RLS_OVERHEAD.noiseFloorMs);
    expect(r.notes).toContain('Index Only Scan (posting_balance_ix)');
    expect(r.notes).toContain('Seq Scan');
    const report = buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [r] });
    expect(report.breaches).toEqual([
      'RLS-OVERHEAD rls-saldo: plan distinto (Index Only Scan (posting_balance_ix) → Seq Scan)',
    ]);
  });

  it('cambiar solo el índice del mismo método de acceso también es un plan distinto; sin planes no se compara', () => {
    const base = { id: 'q', title: 't', ...pairsOf(2, 0.01, 0.05) };
    expect(
      rlsResult({ ...base, plans: { withoutRls: ['Index Scan (a_ix)'], withRls: ['Index Scan (b_ix)'] } })
        .verdict,
    ).toBe('plan distinto');
    expect(
      rlsResult({ ...base, plans: { withoutRls: ['Index Scan (a_ix)'], withRls: ['Index Scan (a_ix)'] } })
        .verdict,
    ).toBe('OK');
    expect(rlsResult(base).verdict).toBe('OK');
  });

  it('una diferencia observada sobre el piso pero bajo el 10 % de una consulta lenta es "no demostrada sobre el 10 %"', () => {
    // 100 ms sin RLS: el 10 % son 10 ms; una mediana de 0.9 ms con IC por debajo.
    const r = rlsResult({ id: 'q', title: 't', ...pairsOf(100, 0.9, 1.2) });
    expect(r.verdict).toBe('OK');
    const wide = rlsResult({ id: 'q', title: 't', ...pairsOf(4, 0.5, 4) });
    expect(wide.verdict).toBe('no demostrada sobre el 10 %');
    expect(wide.passed).toBe(true);
  });

  it('el IC es reproducible (semilla fija), el orden de los pares no lo cambia y las muestras desiguales se rechazan', () => {
    const { withRls, withoutRls } = pairsOf(5, 0.4, 2);
    const a = rlsResult({ id: 'q', title: 't', withRls, withoutRls });
    const b = rlsResult({ id: 'q', title: 't', withRls, withoutRls });
    expect(b.ci95Ms).toEqual(a.ci95Ms);
    const reversed = rlsResult({
      id: 'q',
      title: 't',
      withRls: [...withRls].reverse(),
      withoutRls: [...withoutRls].reverse(),
    });
    expect(reversed.ci95Ms).toEqual(a.ci95Ms);
    expect(() => rlsResult({ id: 'q', title: 't', withRls: [1, 2], withoutRls: [1] })).toThrow(RangeError);
    expect(() => rlsResult({ id: 'q', title: 't', withRls: [], withoutRls: [] })).toThrow(RangeError);
  });

  it('el JSON del reporte conserva los campos de siempre y agrega ci95Ms, pairs y verdict (aditivo)', () => {
    const r = rlsResult({ id: 'q', title: 't', ...pairsOf(2, 0.01, 0.05) });
    expect(Object.keys(r)).toEqual(
      expect.arrayContaining([
        'id',
        'nfr',
        'title',
        'stats',
        'value',
        'limit',
        'unit',
        'gate',
        'passed',
        'notes',
      ]),
    );
    expect(Object.keys(r)).toEqual(expect.arrayContaining(['ci95Ms', 'pairs', 'verdict']));
    expect(r.unit).toBe('ratio');
  });
});
