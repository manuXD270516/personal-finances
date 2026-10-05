import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildReport,
  latencyResult,
  percentile,
  PERF_THRESHOLDS,
  renderMarkdown,
  rlsResult,
  stats,
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
});
