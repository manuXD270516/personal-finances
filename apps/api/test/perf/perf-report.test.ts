import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bootstrapMedianCi,
  buildReport,
  dataAccessSignature,
  latencyResult,
  median,
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

  it('[TC-PLATFORM-PIPELINE-015] planes iguales salvo los nodos de las tablas de la política (iam.workspace, iam.workspace_membership) no son "plan distinto"', () => {
    // Falso positivo observado (run 39390841971): el plan con RLS añade los Index Scan de la política, inherentes a RLS.
    const r = rlsResult({
      id: 'rls-getBalance',
      title: 'saldo',
      plans: {
        withoutRls: ['Index Only Scan on ledger.posting (posting_balance_ix)'],
        withRls: [
          'Index Only Scan on ledger.posting (posting_balance_ix) → Index Scan on iam.workspace (workspace_pkey) → Index Scan on iam.workspace_membership (workspace_membership_user_active_idx)',
        ],
      },
      ...pairsOf(1.02, 0.04, 0.2),
    });
    expect(r.verdict).toBe('OK');
    expect(r.passed).toBe(true);
    expect(r.notes).toContain('plan: Index Only Scan on ledger.posting (posting_balance_ix)');
    expect(r.notes).not.toContain('workspace_pkey');
  });

  it('[TC-PLATFORM-PIPELINE-015] el filtro reconoce las tablas de la política con y sin esquema (EXPLAIN JSON sin VERBOSE no trae Schema)', () => {
    expect(
      dataAccessSignature('Index Scan on workspace (workspace_pkey) → Seq Scan on iam.workspace_membership'),
    ).toBe('');
    // Planes reales de PgBalanceQuery (run 39401809245): nombres sin esquema; `workspace` también lo lee la sentencia misma.
    const r = rlsResult({
      id: 'rls-getBalance',
      title: 'getBalance',
      plans: {
        withoutRls: [
          'Seq Scan on workspace → Seq Scan on balance_snapshot → Index Only Scan on posting (posting_balance_ix)',
        ],
        withRls: [
          'Index Scan on workspace (workspace_pkey) → Index Scan on workspace_membership (workspace_membership_user_active_idx) → Seq Scan on balance_snapshot → Index Only Scan on posting (posting_balance_ix)',
        ],
      },
      ...pairsOf(1.02, 0.04, 0.2),
    });
    expect(r.verdict).toBe('OK');
    expect(r.passed).toBe(true);
  });

  it('[TC-PLATFORM-PIPELINE-017] sin esquema, un cambio sobre una tabla de datos (posting, journal_entry, balance_snapshot, ledger_account) sigue siendo "plan distinto"', () => {
    const policy = 'Index Scan on workspace (workspace_pkey)';
    for (const table of ['posting', 'journal_entry', 'balance_snapshot', 'ledger_account']) {
      const r = rlsResult({
        id: 'q',
        title: 't',
        plans: {
          withoutRls: [`Seq Scan on workspace → Index Scan on ${table} (a_ix)`],
          withRls: [`${policy} → Seq Scan on ${table}`],
        },
        ...pairsOf(2, 0.01, 0.05),
      });
      expect(r.verdict).toBe('plan distinto');
    }
  });

  it('[TC-PLATFORM-PIPELINE-017] un cambio de índice o de método sobre una tabla de datos sigue siendo "plan distinto" aunque haya nodos de la política', () => {
    const policy = 'Index Scan on iam.workspace (workspace_pkey)';
    const changedIndex = rlsResult({
      id: 'q',
      title: 't',
      plans: {
        withoutRls: ['Index Only Scan on ledger.posting (posting_balance_ix)'],
        withRls: [`Index Only Scan on ledger.posting (otro_ix) → ${policy}`],
      },
      ...pairsOf(2, 0.01, 0.05),
    });
    expect(changedIndex.verdict).toBe('plan distinto');
    const seq = rlsResult({
      id: 'q',
      title: 't',
      plans: {
        withoutRls: ['Index Only Scan on ledger.posting (posting_balance_ix)'],
        withRls: [`Seq Scan on ledger.posting → ${policy}`],
      },
      ...pairsOf(2, 0.01, 0.05),
    });
    expect(seq.verdict).toBe('plan distinto');
    expect(seq.notes).toContain('Seq Scan on ledger.posting');
    expect(seq.notes).not.toContain('workspace_pkey');
  });

  it('una tabla de datos que aparece o desaparece del plan también es "plan distinto"', () => {
    const r = rlsResult({
      id: 'q',
      title: 't',
      plans: {
        withoutRls: ['Index Scan on ledger.posting (a_ix)'],
        withRls: ['Index Scan on ledger.posting (a_ix) → Seq Scan on ledger.ledger_account'],
      },
      ...pairsOf(2, 0.01, 0.05),
    });
    expect(r.verdict).toBe('plan distinto');
  });

  it('[TC-PLATFORM-PIPELINE-015] el diagnóstico de RLS (EXPLAIN con y sin política) se incluye en perf-summary.md, que es lo que pega el aviso por issue', () => {
    const r = rlsResult({ id: 'q', title: 't', ...pairsOf(2, 0.01, 0.05) });
    const report = buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [r] });
    const diagnostics =
      '## saldo por cuenta (índice INCLUDE)\n\n### Con RLS (pf_app)\n\nIndex Only Scan on posting';
    const md = renderMarkdown(report, diagnostics);
    expect(md).toContain('## Diagnóstico de RLS (EXPLAIN ANALYZE con y sin política)');
    expect(md).toContain('Index Only Scan on posting');
    expect(md.indexOf('## Entorno')).toBeLessThan(md.indexOf('## Diagnóstico de RLS'));
    expect(renderMarkdown(report)).not.toContain('Diagnóstico de RLS');
    expect(renderMarkdown(report, '')).not.toContain('Diagnóstico de RLS');
    const long = renderMarkdown(report, 'x'.repeat(100_000));
    expect(long.length).toBeLessThan(40_000);
    expect(long).toContain('[recortado');
  });

  // Declaración de las consultas de RLS de `nightly.perf.ts` (las filas informativas y las bloqueantes, D298).
  const NIGHTLY_SRC = readFileSync(new URL('./nightly.perf.ts', import.meta.url), 'utf8');
  const declaredQueries = [
    ...NIGHTLY_SRC.slice(
      NIGHTLY_SRC.indexOf('const queries: Record<string, { sql: string; gate: boolean }>'),
      NIGHTLY_SRC.indexOf('for (const [name, q] of Object.entries(queries))'),
    ).matchAll(/^\s{6}'([^']+)': \{[\s\S]*?gate: (true|false),/gmu),
  ].map((m) => ({ name: m[1]!, gate: m[2] === 'true' }));
  const realBlock = NIGHTLY_SRC.slice(
    NIGHTLY_SRC.indexOf('const real: Record<string, CapturedSql[]>'),
    NIGHTLY_SRC.indexOf('for (const [name, statements] of Object.entries(real))'),
  );

  it('[TC-SECURITY-RLS-010] la fila INCLUDE con 200 pares (1.99 / 2.80 ms, IC95 [0.800, 0.811]) y gate falso es brecha demostrada informativa que no falla el reporte', () => {
    const r = rlsResult({
      id: 'rls-saldo por cuenta (índice INCLUDE)',
      title: 'Overhead RLS: saldo por cuenta (índice INCLUDE)',
      plans: SAME_PLAN,
      gate: false,
      ...pairsOf(1.99, 0.81, 0.011),
    });
    expect(r.verdict).toBe('brecha demostrada');
    expect(r.gate).toBe(false);
    expect(r.pairs).toBe(200);
    expect(r.notes).toContain('mediana con RLS 2.8 ms vs sin RLS 1.99 ms');
    expect(r.notes).toMatch(/IC95 \[0\.80\d, 0\.81\d\] ms/);
    const report = buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [r] });
    expect(report.breaches).toEqual([]);
    const md = renderMarkdown(report);
    expect(md).toContain('OK — sin umbrales superados');
    expect(md).toMatch(/Overhead RLS: saldo por cuenta \(índice INCLUDE\).*\| informativo \|/u);
  });

  it('[TC-SECURITY-RLS-010] política: las únicas consultas de RLS con gate false en nightly.perf.ts son la INCLUDE y el agregado sintético', () => {
    expect(declaredQueries.filter((q) => !q.gate).map((q) => q.name)).toEqual([
      'saldo por cuenta (índice INCLUDE)',
      'agregado sintético de todo el workspace (informativo)',
    ]);
  });

  it('[TC-SECURITY-RLS-012] política: las consultas reales de saldos y la página de transacciones siguen bloqueantes', () => {
    expect(declaredQueries.find((q) => q.name === 'página de transacciones (1 mes)')?.gate).toBe(true);
    expect(realBlock).toContain('consulta real de saldos en lote (PgBalanceQuery.getAccountBalances)');
    expect(realBlock).toContain('consulta real de saldo por cuenta (PgBalanceQuery.getBalance)');
    // Las consultas reales no pasan `gate`: rlsResult las toma como bloqueantes por defecto.
    expect(realBlock).not.toMatch(/\bgate\b/u);
  });

  it('[TC-SECURITY-RLS-012] una consulta real bloqueante con +46.8 % y plan distinto falla el reporte mostrando ambos métodos de acceso', () => {
    const r = rlsResult({
      id: 'rls-consulta real de saldos en lote (PgBalanceQuery.getAccountBalances)',
      title: 'Overhead RLS: consulta real de saldos en lote',
      plans: {
        withoutRls: ['Bitmap Heap Scan on ledger.journal_entry'],
        withRls: ['Index Scan on ledger.journal_entry'],
      },
      ...pairsOf(10, 4.68, 0.5),
    });
    expect(r.gate).toBe(true);
    expect(r.verdict).toBe('plan distinto');
    expect(r.value).toBe(0.468);
    const report = buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [r] });
    expect(report.breaches).toHaveLength(1);
    expect(report.breaches[0]).toContain('getAccountBalances');
    expect(report.breaches[0]).toContain('Bitmap Heap Scan on ledger.journal_entry');
    expect(report.breaches[0]).toContain('Index Scan on ledger.journal_entry');
    expect(renderMarkdown(report)).toContain('FALLA — 1 umbral(es) superado(s)');
  });

  it('el IC95 por bootstrap tiene el ancho teórico de la mediana (≈ 1.96 · 1.2533 · σ/√n) y no es artificialmente estrecho', () => {
    // Diferencias normales (Box-Muller con PRNG fijo): σ = 0.3 ms, n = 200 ⇒ semiancho esperado ≈ 0.052 ms.
    let seed = 12345;
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed + 1) / 4294967297;
    };
    const normal = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
    const diffs = Array.from({ length: 200 }, () => 0.6 + 0.3 * normal());
    const [inf, sup] = bootstrapMedianCi(diffs);
    const half = (sup - inf) / 2;
    expect(half).toBeGreaterThan(0.035);
    expect(half).toBeLessThan(0.075);
    expect(inf).toBeLessThan(median(diffs));
    expect(sup).toBeGreaterThan(median(diffs));
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
