import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aggregateBackgroundLoad,
  applyInterference,
  BACKGROUND_LOAD_END,
  BACKGROUND_LOAD_START,
  bootstrapMedianCi,
  buildReport,
  burstWindow,
  dataAccessSignature,
  isolationOf,
  jobsOfQueue,
  latencyResult,
  median,
  percentile,
  PERF_THRESHOLDS,
  PERF_THROUGHPUT,
  renderMarkdown,
  replaceBackgroundLoadSection,
  RLS_OVERHEAD,
  rlsResult,
  stats,
  summarizeSnapshot,
  throughputResult,
  importsVerdict,
  renderImportsSection,
  writeImportsReport,
  writeReport,
  type ConnectionsReport,
  type ConsumerDrain,
  type ImportsReport,
  type PerfReport,
  type BackgroundLoadEntry,
  type BackgroundLoadSnapshot,
  type IsolationPreparation,
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

// investigate-perf-under-load, decisión 2 (tareas 2.1 y 2.4): foto de la carga de fondo por suite y por benchmark.
const MATCHER_QUEUE = 'events.commitments.occurrence-matcher';

/** Foto sintética: base limpia salvo lo que pida el caso. */
function snap(overrides: Partial<BackgroundLoadSnapshot> = {}): BackgroundLoadSnapshot {
  return {
    takenAt: '2026-10-23T06:00:00.000Z',
    outboxPending: 0,
    eventJobs: [],
    connections: [{ role: 'pf_app', application: 'finance-api', state: 'idle', count: 3 }],
    ungrantedLocks: 0,
    tables: [
      {
        table: 'platform.outbox',
        liveTuples: 100,
        deadTuples: 2,
        lastAutovacuum: null,
        lastAutoanalyze: '2026-10-23T05:59:00.000Z',
      },
    ],
    loadAvg: [0.5, 0.4, 0.3],
    processCpuMs: 1200,
    ...overrides,
  };
}

const entry = (
  suite: string,
  phase: BackgroundLoadEntry['phase'],
  snapshot: BackgroundLoadSnapshot,
  rest: Partial<BackgroundLoadEntry> = {},
): BackgroundLoadEntry => ({ runId: 'run-1', suite, phase, snapshot, ...rest });

const emptyBase = { generatedAt: 'x', environment: {}, dataset: {} } as const;

describe('carga de fondo del benchmark (investigate-perf-under-load, decisión 2)', () => {
  it('[TC-PLATFORM-PIPELINE-024] una foto sin eventos ni trabajos pendientes es "limpia" y el reporte publica la carga junto al p95 frente a 300 ms', () => {
    expect(isolationOf(snap())).toMatchObject({
      verdict: 'limpia',
      outboxPending: 0,
      eventJobs: 0,
    });
    const suites = aggregateBackgroundLoad([
      entry('spendable.perf.ts', 'start', snap({ connections: [] })),
      entry('spendable.perf.ts', 'benchmark', snap(), { benchmark: 'getSpendable' }),
      entry('spendable.perf.ts', 'end', snap({ outboxPending: 800 })),
    ]);
    const result = latencyResult({
      id: 'spendable',
      nfr: 'NFR-PERF-004',
      title: 'getSpendable',
      samples: [120, 140, 352.2],
      limitMs: PERF_THRESHOLDS['NFR-PERF-004'].limitMs,
    });
    const report = buildReport({ ...emptyBase, results: [result], backgroundLoad: suites });
    const md = renderMarkdown(report);
    expect(md).toContain('## Carga de fondo por suite');
    // # | suite | eventos pendientes | trabajos events.* | conexiones | locks | carga del host | aislamiento
    expect(md).toMatch(
      /\| 1 \| spendable\.perf\.ts \| 0 \| 0 \| 0 \| 0 \| 0\.5 \/ 0\.4 \/ 0\.3 \| limpia \|/u,
    );
    expect(md).toMatch(/\| spendable\.perf\.ts \| getSpendable \| 0 \| 0 \| 3 \|/u);
    expect(md).toMatch(/\| spendable\.perf\.ts \| 800 \|/u); // foto al terminar la suite
    expect(md).toContain('| 352.2 ms | ≤ 300 ms |');
    expect(report.breaches).toEqual(['NFR-PERF-004 spendable: 352.2 ms > 300 ms']);
  });

  it('[TC-PLATFORM-PIPELINE-026] 12000 eventos pendientes al empezar es "interferencia" con la cantidad medida en el mensaje', () => {
    const iso = isolationOf(snap({ outboxPending: 12_000 }));
    expect(iso.verdict).toBe('interferencia');
    expect(iso.outboxPending).toBe(12_000);
    expect(iso.message).toMatch(/interferencia/u);
    expect(iso.message).toMatch(/\b12000\b/u);
  });

  it('[TC-PLATFORM-PIPELINE-026] los trabajos pendientes de colas events.* también son interferencia y el mensaje nombra la cola', () => {
    const iso = isolationOf(
      snap({
        eventJobs: [
          { queue: MATCHER_QUEUE, state: 'created', count: 340 },
          { queue: MATCHER_QUEUE, state: 'retry', count: 10 },
          { queue: 'events.reporting.data-version', state: 'active', count: 5 },
        ],
      }),
    );
    expect(iso).toMatchObject({ verdict: 'interferencia', outboxPending: 0, eventJobs: 355 });
    expect(iso.message).toMatch(/\b355\b/u);
    expect(iso.message).toContain(MATCHER_QUEUE);
    expect(
      jobsOfQueue(
        snap({ eventJobs: [{ queue: MATCHER_QUEUE, state: 'created', count: 340 }] }),
        MATCHER_QUEUE,
      ),
    ).toBe(340);
    expect(jobsOfQueue(snap(), MATCHER_QUEUE)).toBe(0);
  });

  it('[TC-PLATFORM-PIPELINE-026] una medición con interferencia no es válida: no se compara con 300 ms, falla el reporte y lo dice', () => {
    const measured = latencyResult({
      id: 'spendable-summary',
      nfr: 'NFR-PERF-004',
      title: 'summary',
      samples: [100, 120, 130],
      limitMs: PERF_THRESHOLDS['NFR-PERF-004'].limitMs,
    });
    expect(measured.passed).toBe(true);
    const iso = isolationOf(snap({ outboxPending: 12_000 }));
    const invalid = applyInterference(measured, iso);
    expect(invalid).toMatchObject({ valid: false, passed: false, id: 'spendable-summary' });
    expect(invalid.notes).toMatch(/\b12000\b/u);
    const report = buildReport({ ...emptyBase, results: [invalid] });
    expect(report.breaches).toHaveLength(1);
    expect(report.breaches[0]).toMatch(/^NFR-PERF-004 spendable-summary: interferencia .*\b12000\b/u);
    const md = renderMarkdown(report);
    expect(md).toMatch(/\| INTERFERENCIA \|/u);
    expect(md).toContain('no válida');
    // Una medición limpia no se toca.
    expect(applyInterference(measured, isolationOf(snap()))).toBe(measured);
  });

  it('[TC-PLATFORM-PIPELINE-024] aggregateBackgroundLoad ordena las suites por el orden real de arranque y descarta corridas anteriores', () => {
    const at = (s: number) => snap({ takenAt: `2026-10-23T06:00:${String(s).padStart(2, '0')}.000Z` });
    const bl = aggregateBackgroundLoad([
      { ...entry('viejo.perf.ts', 'start', at(1)), runId: 'run-0' },
      entry('nightly.perf.ts', 'start', at(10)),
      entry('nightly.perf.ts', 'benchmark', at(11), { benchmark: 'NFR-PERF-001' }),
      entry('nightly.perf.ts', 'end', at(30)),
      entry('commitments.perf.ts', 'start', at(40), { extra: {} }),
      entry('commitments.perf.ts', 'benchmark', at(41), {
        benchmark: 'ráfaga',
        extra: { 'cola del matcher antes de la ráfaga': 0 },
      }),
    ]);
    expect(bl.runId).toBe('run-1');
    expect(bl.fileOrder).toEqual(['nightly.perf.ts', 'commitments.perf.ts']);
    expect(bl.suites.map((s) => [s.suite, s.order])).toEqual([
      ['nightly.perf.ts', 1],
      ['commitments.perf.ts', 2],
    ]);
    expect(bl.suites[0]!.benchmarks.map((b) => b.benchmark)).toEqual(['NFR-PERF-001']);
    expect(bl.suites[0]!.end?.takenAt).toBe(at(30).takenAt);
    expect(bl.suites[1]!.end).toBeUndefined();
    expect(bl.suites[1]!.benchmarks[0]!.extra).toEqual({ 'cola del matcher antes de la ráfaga': 0 });
    expect(aggregateBackgroundLoad([])).toMatchObject({ fileOrder: [], suites: [] });
  });

  it('[TC-PLATFORM-PIPELINE-024] una suite que empieza con backlog ajeno se marca "interferencia" en la tabla por suite', () => {
    const bl = aggregateBackgroundLoad([
      entry(
        'spendable.perf.ts',
        'start',
        snap({ outboxPending: 12_000, takenAt: '2026-10-23T06:10:00.000Z' }),
      ),
    ]);
    expect(bl.suites[0]!.isolation.verdict).toBe('interferencia');
    const md = renderMarkdown(buildReport({ ...emptyBase, results: [], backgroundLoad: bl }));
    expect(md).toMatch(/\| 1 \| spendable\.perf\.ts \| 12000 \| 0 \| 3 \| 0 \|.*\| interferencia \|/u);
  });

  it('[TC-PLATFORM-PIPELINE-024] el JSON agrega backgroundLoad como campo aditivo (por reporte y por resultado) y no cambia los campos de siempre', () => {
    const base = latencyResult({ id: 'a', nfr: 'NFR-PERF-004', title: 't', samples: [10], limitMs: 300 });
    const plain = buildReport({ ...emptyBase, results: [base] });
    expect(Object.keys(plain).sort()).toEqual([
      'breaches',
      'dataset',
      'environment',
      'generatedAt',
      'results',
      'version',
    ]);
    expect(renderMarkdown(plain)).not.toContain('Carga de fondo');
    const withLoad = { ...base, backgroundLoad: summarizeSnapshot(snap({ outboxPending: 7 })) };
    const bl = aggregateBackgroundLoad([entry('a.perf.ts', 'start', snap())]);
    const report = buildReport({ ...emptyBase, results: [withLoad], backgroundLoad: bl });
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining(['version', 'results', 'breaches', 'backgroundLoad']),
    );
    expect(report.results[0]!.backgroundLoad).toMatchObject({
      outboxPending: 7,
      eventJobs: 0,
      connections: 3,
      ungrantedLocks: 0,
      loadAvg1m: 0.5,
    });
    const roundTrip = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(roundTrip.backgroundLoad?.fileOrder).toEqual(['a.perf.ts']);
  });

  it('[TC-PLATFORM-PIPELINE-024] el detalle por cola y el estado de las tablas citadas se publican en el resumen', () => {
    const start = snap({
      eventJobs: [
        { queue: MATCHER_QUEUE, state: 'created', count: 9 },
        { queue: MATCHER_QUEUE, state: 'active', count: 2 },
      ],
      connections: [
        { role: 'pf_app', application: 'finance-api', state: 'idle', count: 3 },
        { role: 'pf_worker', application: 'finance-worker', state: 'active', count: 4 },
      ],
      ungrantedLocks: 1,
    });
    const md = renderMarkdown(
      buildReport({
        ...emptyBase,
        results: [],
        backgroundLoad: aggregateBackgroundLoad([entry('c.perf.ts', 'start', start)]),
      }),
    );
    expect(md).toContain(`${MATCHER_QUEUE} (created 9, active 2)`);
    expect(md).toContain('pf_worker/finance-worker/active 4');
    expect(md).toMatch(/\| c\.perf\.ts \| platform\.outbox \| 100 \| 2 \|/u);
  });

  it('[TC-PLATFORM-PIPELINE-024] la sección va entre marcadores y se reemplaza sin tocar el resto del resumen (las suites posteriores a nightly la actualizan)', () => {
    const first = buildReport({
      ...emptyBase,
      results: [],
      backgroundLoad: aggregateBackgroundLoad([entry('a.perf.ts', 'start', snap())]),
    });
    const md = renderMarkdown(first, 'diag');
    expect(md).toContain(BACKGROUND_LOAD_START);
    expect(md).toContain(BACKGROUND_LOAD_END);
    const next = aggregateBackgroundLoad([
      entry('a.perf.ts', 'start', snap({ takenAt: '2026-10-23T06:00:00.000Z' })),
      entry('b.perf.ts', 'start', snap({ takenAt: '2026-10-23T06:05:00.000Z' })),
    ]);
    const replaced = replaceBackgroundLoadSection(md, next);
    expect(replaced).toMatch(/\| 2 \| b\.perf\.ts \|/u);
    expect(replaced.replace(/<!-- background-load:start -->[\s\S]*<!-- background-load:end -->/u, '')).toBe(
      md.replace(/<!-- background-load:start -->[\s\S]*<!-- background-load:end -->/u, ''),
    );
    // Sin marcadores (reporte de otra versión) se agrega al final en lugar de perder la sección.
    expect(replaceBackgroundLoadSection('# x\n', next)).toMatch(/# x[\s\S]*Carga de fondo por suite/u);
  });

  it('[TC-PLATFORM-PIPELINE-024] la sección recorta el detalle si excede el límite del aviso por issue', () => {
    const entries: BackgroundLoadEntry[] = [entry('a.perf.ts', 'start', snap())];
    for (let i = 0; i < 2000; i += 1) {
      entries.push(entry('a.perf.ts', 'benchmark', snap(), { benchmark: `benchmark-${i}` }));
    }
    const md = renderMarkdown(
      buildReport({ ...emptyBase, results: [], backgroundLoad: aggregateBackgroundLoad(entries) }),
    );
    expect(md.length).toBeLessThan(40_000);
    expect(md).toContain('[recortado');
    expect(md).toContain(BACKGROUND_LOAD_END);
  }, 30_000);

  it('[TC-PLATFORM-PIPELINE-025] la ráfaga del matcher se mide solo con sus eventos: ventana del primer al último evento de la ráfaga', () => {
    // 1 050 eventos entre el primer y el último procesado (25 s): 42 ev/s; el tiempo de espera del backlog ajeno no cuenta.
    expect(
      burstWindow({
        events: 1050,
        firstProcessedAt: new Date('2026-10-23T06:00:30.000Z'),
        lastProcessedAt: new Date('2026-10-23T06:00:55.000Z'),
      }),
    ).toEqual({ seconds: 25, eventsPerSecond: 42 });
    // Todos en el mismo instante: nunca divide por cero (mínimo 1 s, como throughputResult).
    expect(
      burstWindow({ events: 12, firstProcessedAt: new Date(1000), lastProcessedAt: new Date(1000) }),
    ).toEqual({ seconds: 1, eventsPerSecond: 12 });
  });
});

describe('aislamiento con preparación: purga y quietud del host (investigate-perf-under-load 5.1, D291)', () => {
  const prep = (overrides: Partial<IsolationPreparation> = {}): IsolationPreparation => ({
    purgedOutbox: 470_165,
    purgedJobs: 1_390_000,
    quiet: true,
    waitedMs: 60_000,
    hostLoad1m: 1.2,
    hostLoadLimit: 3,
    foreignActiveQueries: 0,
    ...overrides,
  });

  it('[TC-PLATFORM-PIPELINE-024] tras la purga, sin eventos ni trabajos y con el host en quietud, la suite mide normalmente y el reporte publica la purga y la espera', () => {
    const iso = isolationOf(snap(), prep());
    expect(iso).toMatchObject({ verdict: 'limpia', message: 'sin carga de fondo ajena' });
    const bl = aggregateBackgroundLoad([
      entry('spendable.perf.ts', 'start', snap(), { preparation: prep() }),
    ]);
    expect(bl.suites[0]!.isolation.verdict).toBe('limpia');
    const md = renderMarkdown(buildReport({ ...emptyBase, results: [], backgroundLoad: bl }));
    expect(md).toMatch(
      /purga previa: 470165 eventos del outbox y 1390000 trabajos events\.\*; espera de quietud: 60 s, carga 1\.2 \(límite 3\), 0 consultas ajenas activas/u,
    );
  });

  it('[TC-PLATFORM-PIPELINE-026] eventos pendientes ajenos tras la preparación siguen siendo interferencia con la cantidad medida', () => {
    const iso = isolationOf(snap({ outboxPending: 12_000 }), prep());
    expect(iso.verdict).toBe('interferencia');
    expect(iso.message).toMatch(/\b12000\b/u);
  });

  it('[TC-PLATFORM-PIPELINE-026] si la carga del host no baja del límite tras esperar, el veredicto es interferencia por host con la carga medida', () => {
    const iso = isolationOf(
      snap(),
      prep({ quiet: false, waitedMs: 300_000, hostLoad1m: 7.96, purgedOutbox: 0, purgedJobs: 0 }),
    );
    expect(iso.verdict).toBe('interferencia');
    expect(iso.message).toMatch(/host sin quietud/u);
    expect(iso.message).toMatch(/carga del host 7\.96 \(1 min\) sin bajar de 3 tras esperar 300 s/u);
    expect(iso.preparation?.hostLoad1m).toBe(7.96);
  });

  it('[TC-PLATFORM-PIPELINE-026] consultas activas ajenas que no terminan también son interferencia por host', () => {
    const iso = isolationOf(snap(), prep({ quiet: false, hostLoad1m: 0.5, foreignActiveQueries: 2 }));
    expect(iso.verdict).toBe('interferencia');
    expect(iso.message).toMatch(/2 consultas activas ajenas/u);
    expect(iso.message).not.toMatch(/carga del host/u);
  });

  it('[TC-PLATFORM-PIPELINE-026] backlog y host a la vez: el mensaje lleva ambas causas', () => {
    const iso = isolationOf(snap({ outboxPending: 5 }), prep({ quiet: false, hostLoad1m: 4 }));
    expect(iso.message).toMatch(/5 eventos pendientes/u);
    expect(iso.message).toMatch(/carga del host 4 /u);
  });

  it('[TC-PLATFORM-PIPELINE-026] el reporte marca la suite con host sin quietud como interferencia en la tabla y en el detalle', () => {
    const bl = aggregateBackgroundLoad([
      entry('spendable.perf.ts', 'start', snap(), { preparation: prep({ quiet: false, hostLoad1m: 7.96 }) }),
    ]);
    expect(bl.suites[0]!.isolation.verdict).toBe('interferencia');
    const md = renderMarkdown(buildReport({ ...emptyBase, results: [], backgroundLoad: bl }));
    expect(md).toMatch(/\| interferencia \|/u);
    expect(md).toMatch(/host sin quietud: carga del host 7\.96/u);
  });
});

// ── Benchmark del import: veredictos y reporte de conexiones y drenado (fix-imports-perf-connection-budget) ──

const importsConnections: ConnectionsReport = {
  samples: 120,
  budget: { poolsSum: 67, limit: 67, fits: true },
  pools: [
    { pool: 'api', max: 22, peakInUse: 9, peakWaiting: 0, maxAcquireMs: 12, timeouts: 0 },
    { pool: 'worker', max: 34, peakInUse: 34, peakWaiting: 11, maxAcquireMs: 2150, timeouts: 1 },
  ],
  server: {
    maxConnections: 70,
    reserved: 3,
    peak: 61,
    peakByApplication: { 'finance-api': 9, 'finance-worker': 34, 'pfos-consumer': 4 },
  },
  timeouts: [{ pool: 'worker', inUse: 34, max: 34, waitedMs: 2150 }],
};

const importsDrain: ConsumerDrain[] = [
  {
    queue: 'events.planning.journal-entry-posted',
    pendingAtPersist: 5000,
    peakPending: 5000,
    drainedAfterPersistMs: 123_458,
    eventsPerSecond: 40.5,
  },
  {
    queue: 'events.reporting.data-version',
    pendingAtPersist: 4000,
    peakPending: 4100,
    drainedAfterPersistMs: 90_000,
    eventsPerSecond: 44.4,
  },
  {
    queue: 'outbox',
    pendingAtPersist: 0,
    peakPending: 12,
    drainedAfterPersistMs: 1000,
    eventsPerSecond: null,
  },
];

describe('veredictos del benchmark del import', () => {
  it('[TC-PLATFORM-PIPELINE-030] una adquisición vencida con el pool del worker en 34 de 34 da el veredicto conexiones, separado del drenado', () => {
    const verdict = importsVerdict({
      drainAfterPersistMs: 130_000, // el drenado también excedió: aun así el veredicto es de conexiones
      drainBudgetMs: 120_000,
      connections: importsConnections,
      drainByConsumer: importsDrain,
    });
    expect(verdict.kind).toBe('conexiones');
    expect(verdict.message).toMatch(/pool del worker/u);
    expect(verdict.message).toMatch(/34 de 34 conexiones en uso/u);
    expect(verdict.message).toMatch(/venció tras 2150 ms/u);
    expect(verdict.message).toMatch(/pico del servidor 61 de 70/u);
    expect(verdict.message).not.toMatch(/drenado/u);
  });

  it('[TC-PLATFORM-PIPELINE-032] un drenado de 123 458,95 ms frente a 120 000 ms falla nombrando los consumidores que terminaron después', () => {
    const verdict = importsVerdict({
      drainAfterPersistMs: 123_458.95,
      drainBudgetMs: 120_000,
      connections: { ...importsConnections, timeouts: [] },
      drainByConsumer: importsDrain,
    });
    expect(verdict.kind).toBe('drenado');
    expect(verdict.message).toContain('123,5 s frente a 120 s');
    expect(verdict.message).toContain('events.planning.journal-entry-posted 123,5 s');
    expect(verdict.message).not.toContain('events.reporting.data-version');
    expect(verdict.message).not.toMatch(/conexi/u);
  });

  it('[TC-PLATFORM-PIPELINE-032] un consumidor que no llegó a 0 se nombra como tal; sin ninguno individual, el mensaje lo dice', () => {
    const stuck = importsVerdict({
      drainAfterPersistMs: 180_000,
      drainBudgetMs: 120_000,
      drainByConsumer: [{ ...importsDrain[1]!, drainedAfterPersistMs: null, eventsPerSecond: null }],
    });
    expect(stuck.message).toContain('events.reporting.data-version sin llegar a 0');
    const none = importsVerdict({
      drainAfterPersistMs: 120_400,
      drainBudgetMs: 120_000,
      drainByConsumer: [importsDrain[1]!],
    });
    expect(none.kind).toBe('drenado');
    expect(none.message).toContain('ningún consumidor individual');
  });

  it('[TC-PLATFORM-PIPELINE-031] sin adquisiciones vencidas y con el drenado en el presupuesto, el veredicto es ok (120 s exactos pasan)', () => {
    const verdict = importsVerdict({
      drainAfterPersistMs: 120_000,
      drainBudgetMs: 120_000,
      connections: { ...importsConnections, timeouts: [] },
      drainByConsumer: importsDrain,
    });
    expect(verdict.kind).toBe('ok');
  });
});

describe('reporte del import: conexiones y drenado por consumidor', () => {
  const report = (verdict: ImportsReport['verdict']): ImportsReport => ({
    rows: 5000,
    previewMs: 8200,
    persistMs: 118_000,
    drainAfterPersistMs: 123_459,
    drainBudgetMs: 120_000,
    connections: importsConnections,
    drainByConsumer: importsDrain,
    verdict,
  });

  it('[TC-PLATFORM-PIPELINE-031] la sección publica el pico por pool, el servidor frente a su máximo y el drenado por consumidor', () => {
    const verdict = importsVerdict({
      drainAfterPersistMs: 123_459,
      drainBudgetMs: 120_000,
      drainByConsumer: importsDrain,
    });
    const md = renderImportsSection(report(verdict)).join('\n');
    expect(md).toMatch(/\| worker \| 34 \| 34 \| 11 \| 2150 \| 1 \|/u);
    expect(md).toMatch(/pico del servidor 61/u);
    expect(md).toMatch(/max_connections 70 menos 3 reservadas/u);
    expect(md).toMatch(/\| events\.planning\.journal-entry-posted \| 5000 \| 5000 \| 0 \| 123\.5 \| 40\.5 \|/u);
    expect(md).toMatch(/\| outbox \| 0 \| 12 \| 0 \| 1\.0 \| — \|/u);
    expect(md).toMatch(/FALLA \(drenado\)/u);
  });

  it('[TC-PLATFORM-PIPELINE-031] writeImportsReport agrega imports a perf-results.json y la sección a perf-summary.md sin tocar el resto, y es idempotente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-imports-'));
    const base = buildReport({ ...emptyBase, results: [] });
    writeReport(base, dir, 'diagnóstico');
    const verdict = importsVerdict({
      drainAfterPersistMs: 1000,
      drainBudgetMs: 120_000,
      drainByConsumer: [],
    });
    writeImportsReport(report(verdict), dir);
    writeImportsReport(report(verdict), dir);
    const json = JSON.parse(readFileSync(join(dir, 'perf-results.json'), 'utf8')) as PerfReport;
    expect(json.imports?.drainByConsumer).toHaveLength(3);
    expect(json.imports?.connections?.pools[1]?.peakInUse).toBe(34);
    expect(json.environment).toEqual(base.environment);
    const md = readFileSync(join(dir, 'perf-summary.md'), 'utf8');
    expect(md.match(/<!-- imports:start -->/gu)).toHaveLength(1);
    expect(md).toContain('diagnóstico');
    expect(JSON.parse(readFileSync(join(dir, 'imports-perf.json'), 'utf8'))).toMatchObject({ rows: 5000 });
  });

  it('[TC-PLATFORM-PIPELINE-031] sin perf-results.json solo escribe imports-perf.json (suite del import sola)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-imports-'));
    writeImportsReport(report({ kind: 'ok', message: 'ok' }), dir);
    expect(existsSync(join(dir, 'imports-perf.json'))).toBe(true);
    expect(existsSync(join(dir, 'perf-results.json'))).toBe(false);
  });
});

describe('reporte del import: trabajos reintentados', () => {
  it('[TC-PLATFORM-PIPELINE-031] la sección lista las colas con trabajos reintentados y su último error', () => {
    const md = renderImportsSection({
      rows: 5000,
      previewMs: 1,
      persistMs: 1,
      drainAfterPersistMs: 1,
      drainBudgetMs: 120_000,
      drainByConsumer: [
        {
          queue: 'events.a',
          pendingAtPersist: 5,
          peakPending: 5,
          peakRetrying: 2,
          drainedAfterPersistMs: 1000,
          eventsPerSecond: 5,
        },
      ],
      retries: [{ queue: 'events.a', jobs: 2, maxRetryCount: 1, error: 'timeout exceeded | connect' }],
      verdict: { kind: 'ok', message: 'ok' },
    }).join('\n');
    expect(md).toMatch(/\| events\.a \| 5 \| 5 \| 2 \| 1\.0 \| 5 \|/u);
    expect(md).toMatch(/\| events\.a \| 2 \| 1 \| timeout exceeded \/ connect \|/u);
  });
});
