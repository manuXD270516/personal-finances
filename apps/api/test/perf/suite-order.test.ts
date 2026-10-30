import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { orderPerfSuites, PERF_SUITE_ORDER } from './suite-order.js';

describe('orden determinista de las suites de perf (investigate-perf-under-load 5.2)', () => {
  it('[TC-PLATFORM-PIPELINE-024] PERF_SUITE_ORDER lista exactamente los archivos *.perf.ts, sin repetidos', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.perf.ts'));
    expect([...PERF_SUITE_ORDER].sort()).toEqual([...files].sort());
    expect(new Set(PERF_SUITE_ORDER).size).toBe(PERF_SUITE_ORDER.length);
  });

  it('[TC-PLATFORM-PIPELINE-025] nightly va primero, las suites de latencia después, y commitments, throughput e imports al final', () => {
    const idx = (n: string) => PERF_SUITE_ORDER.indexOf(`${n}.perf.ts`);
    expect(idx('nightly')).toBe(0);
    const latency = ['spendable', 'goals', 'rules', 'loan-simulator', 'upcoming-payments', 'subscriptions'];
    for (const s of latency) expect(idx(s)).toBeLessThan(idx('commitments'));
    expect(idx('commitments')).toBeLessThan(idx('throughput'));
    expect(idx('throughput')).toBeLessThan(idx('imports'));
    expect(idx('imports')).toBe(PERF_SUITE_ORDER.length - 1);
  });

  it('[TC-PLATFORM-PIPELINE-024] el orden no depende del orden de entrada (la caché de duraciones de Vitest no lo altera)', () => {
    const paths = PERF_SUITE_ORDER.map((n) => `/repo/apps/api/test/perf/${n}`);
    const shuffled = [
      paths[5]!,
      paths[0]!,
      paths[9]!,
      paths[2]!,
      paths[7]!,
      paths[1]!,
      paths[6]!,
      paths[3]!,
      paths[8]!,
      paths[4]!,
    ];
    expect(orderPerfSuites(shuffled, (p) => p)).toEqual(paths);
    expect(orderPerfSuites([...paths].reverse(), (p) => p)).toEqual(paths);
  });

  it('[TC-PLATFORM-PIPELINE-024] un archivo que no figura en la lista va al final por nombre, nunca se descarta', () => {
    const out = orderPerfSuites(
      ['/x/zeta.perf.ts', '/x/imports.perf.ts', '/x/alfa.perf.ts', '/x/nightly.perf.ts'],
      (p) => p,
    );
    expect(out).toEqual(['/x/nightly.perf.ts', '/x/imports.perf.ts', '/x/alfa.perf.ts', '/x/zeta.perf.ts']);
  });
});
