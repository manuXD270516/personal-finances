import { describe, expect, it } from 'vitest';
import {
  applyConsumerExperiment,
  normalizeSuiteName,
  orderSuites,
  parseExperiment,
} from './experiment-env.js';
import { renderExperimentBlock, summarizeSamples } from './experiment-block.js';
import type { SampleRecord } from './experiment.js';

// Rama de experimentos de investigate-perf-under-load (no se fusiona): interruptores E1–E8.
describe('experimentos de perf: variables PF_PERF_*', () => {
  it('sin variables no activa nada', () => {
    expect(parseExperiment({})).toEqual({
      suites: [],
      purgeBacklog: false,
      trivialHandler: false,
      concurrency: undefined,
      oneConsumer: undefined,
      label: '',
    });
  });

  it('lee suites (con o sin extensión), interruptores, concurrencia, consumidor y etiqueta', () => {
    expect(
      parseExperiment({
        PF_PERF_SUITES: 'spendable, commitments.perf test/perf/nightly.perf.ts',
        PF_PERF_PURGE_BACKLOG: '1',
        PF_PERF_TRIVIAL_HANDLER: 'true',
        PF_PERF_CONCURRENCY: '8',
        PF_PERF_ONE_CONSUMER: 'planning.journal-entry-posted',
        PF_PERF_LABEL: 'e8-run1',
      }),
    ).toEqual({
      suites: ['spendable.perf.ts', 'commitments.perf.ts', 'nightly.perf.ts'],
      purgeBacklog: true,
      trivialHandler: true,
      concurrency: 8,
      oneConsumer: 'planning.journal-entry-posted',
      label: 'e8-run1',
    });
  });

  it('un valor vacío o 0 se trata como no definido o se rechaza', () => {
    expect(parseExperiment({ PF_PERF_PURGE_BACKLOG: '', PF_PERF_CONCURRENCY: '' }).purgeBacklog).toBe(false);
    expect(parseExperiment({ PF_PERF_PURGE_BACKLOG: '0' }).purgeBacklog).toBe(false);
    expect(() => parseExperiment({ PF_PERF_CONCURRENCY: '0' })).toThrow(/PF_PERF_CONCURRENCY/);
    expect(() => parseExperiment({ PF_PERF_CONCURRENCY: 'x' })).toThrow(/PF_PERF_CONCURRENCY/);
  });

  it('normaliza los nombres de suite', () => {
    expect(normalizeSuiteName('spendable')).toBe('spendable.perf.ts');
    expect(normalizeSuiteName('spendable.perf')).toBe('spendable.perf.ts');
    expect(normalizeSuiteName('apps/api/test/perf/spendable.perf.ts')).toBe('spendable.perf.ts');
  });

  it('ordena las suites como en la lista y descarta las que no están', () => {
    const files = ['/x/a.perf.ts', '/x/spendable.perf.ts', '/x/nightly.perf.ts'];
    expect(orderSuites(files, ['nightly.perf.ts', 'spendable.perf.ts'], (f) => f)).toEqual([
      '/x/nightly.perf.ts',
      '/x/spendable.perf.ts',
    ]);
    expect(orderSuites(files, [], (f) => f)).toEqual(files);
  });
});

describe('experimentos de perf: consumidores', () => {
  const real = async (): Promise<void> => {
    throw new Error('handler real');
  };
  const defs = [
    { consumer: 'a.one', handler: real },
    { consumer: 'b.two', handler: real, concurrency: 2 },
  ];

  it('sin interruptores devuelve las mismas definiciones', () => {
    expect(
      applyConsumerExperiment(defs, {
        trivialHandler: false,
        concurrency: undefined,
        oneConsumer: undefined,
      }),
    ).toEqual(defs);
  });

  it('un solo consumidor, concurrencia y handler trivial', async () => {
    const out = applyConsumerExperiment(defs, { trivialHandler: true, concurrency: 7, oneConsumer: 'b.two' });
    expect(out.map((d) => [d.consumer, d.concurrency])).toEqual([['b.two', 7]]);
    await expect(out[0]!.handler()).resolves.toBeUndefined();
  });

  it('un consumidor inexistente falla nombrando los disponibles', () => {
    expect(() =>
      applyConsumerExperiment(defs, { trivialHandler: false, concurrency: undefined, oneConsumer: 'zzz' }),
    ).toThrow(/a\.one, b\.two/);
  });
});

describe('experimentos de perf: bloque PERF-EXPERIMENT', () => {
  const sample = (tag: string, locks: number): SampleRecord => ({
    kind: 'sample',
    tag,
    at: '2026-10-24T10:00:00.000Z',
    maxConnections: 100,
    connections: [{ role: 'pf_worker', application: 'pg-boss', state: 'active', n: 30 }],
    active: [{ state: 'active', waitType: 'Lock', waitEvent: 'transactionid', n: 3 }],
    ungranted: locks > 0 ? [{ locktype: 'transactionid', mode: 'ShareLock', relation: '-', n: locks }] : [],
    loadAvg1m: 3.5,
  });

  it('resume el muestreo por ventana', () => {
    const text = summarizeSamples([sample('w', 0), sample('w', 2)]).join('\n');
    expect(text).toContain('2 muestras');
    expect(text).toContain('conexiones máx 30 de 100');
    expect(text).toContain('locks no concedidos máx 2');
    expect(text).toContain('Lock/transactionid x6');
  });

  it('imprime las marcas de inicio y fin con la etiqueta, las medianas y la foto de carga', () => {
    const block = renderExperimentBlock({
      config: parseExperiment({ PF_PERF_LABEL: 'e1-base-1', PF_PERF_SUITES: 'spendable,commitments' }),
      metrics: [
        {
          kind: 'metric',
          suite: 'spendable.perf.ts',
          name: 'getSpendable',
          unit: 'ms',
          value: 250,
          limit: 300,
          p50: 120,
          p95: 250,
          n: 40,
        },
        { kind: 'purge', suite: 'spendable.perf.ts', at: '2026-10-24T10:00:00.000Z', outbox: 5, jobs: 7 },
      ],
      load: [],
      samples: [],
      extras: '',
    });
    expect(block).toMatch(/^PERF-EXPERIMENT e1-base-1 >>>$/mu);
    expect(block).toMatch(/^PERF-EXPERIMENT e1-base-1 <<<$/mu);
    expect(block).toContain('| spendable.perf.ts | getSpendable | 250 | ms | 300 | 120 | 250 | 40 |');
    expect(block).toContain('5 eventos del outbox y 7 trabajos');
    expect(block).toContain('suites=spendable.perf.ts,commitments.perf.ts');
  });
});
