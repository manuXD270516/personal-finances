import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendEntry,
  BACKGROUND_LOAD_LOG,
  readEntries,
  refreshReportFiles,
  suiteNameOf,
  takeBackgroundLoad,
} from './background-load.js';
import {
  aggregateBackgroundLoad,
  buildReport,
  renderMarkdown,
  writeReport,
  type BackgroundLoadEntry,
  type BackgroundLoadSnapshot,
} from './perf-report.js';

const snap = (takenAt: string, outboxPending = 0): BackgroundLoadSnapshot => ({
  takenAt,
  outboxPending,
  eventJobs: [],
  connections: [],
  ungrantedLocks: 0,
  tables: [],
  loadAvg: [0.1, 0.2, 0.3],
  processCpuMs: 10,
});
const entry = (
  suite: string,
  phase: BackgroundLoadEntry['phase'],
  takenAt: string,
  runId = 'run-1',
  outboxPending = 0,
): BackgroundLoadEntry => ({ runId, suite, phase, snapshot: snap(takenAt, outboxPending) });
const tmp = () => mkdtempSync(join(tmpdir(), 'pf-bgload-'));

describe('registro y reporte de la carga de fondo (investigate-perf-under-load, tareas 2.2 y 2.3)', () => {
  it('[TC-PLATFORM-PIPELINE-024] el nombre de la suite sale del archivo *.perf.ts', () => {
    expect(suiteNameOf('file:///repo/apps/api/test/perf/spendable.perf.ts')).toBe('spendable.perf.ts');
  });

  it('[TC-PLATFORM-PIPELINE-024] el registro NDJSON conserva el orden de escritura y tolera líneas corruptas o un directorio inexistente', () => {
    const dir = join(tmp(), 'anidado');
    expect(readEntries(dir)).toEqual([]);
    appendEntry(dir, entry('a.perf.ts', 'start', '2026-10-23T06:00:00.000Z'));
    appendEntry(dir, entry('a.perf.ts', 'end', '2026-10-23T06:01:00.000Z'));
    writeFileSync(join(dir, BACKGROUND_LOAD_LOG), '{no es json\n', { flag: 'a' });
    appendEntry(dir, entry('b.perf.ts', 'start', '2026-10-23T06:02:00.000Z'));
    expect(readEntries(dir).map((e) => [e.suite, e.phase])).toEqual([
      ['a.perf.ts', 'start'],
      ['a.perf.ts', 'end'],
      ['b.perf.ts', 'start'],
    ]);
  });

  it('[TC-PLATFORM-PIPELINE-024] una suite posterior a nightly agrega su carga a perf-results.json y a perf-summary.md sin tocar el resto', () => {
    const dir = tmp();
    appendEntry(dir, entry('nightly.perf.ts', 'start', '2026-10-23T06:00:00.000Z'));
    appendEntry(dir, entry('nightly.perf.ts', 'end', '2026-10-23T06:30:00.000Z'));
    const report = buildReport({
      generatedAt: 'x',
      environment: { cpus: 4 },
      dataset: {},
      results: [],
      backgroundLoad: aggregateBackgroundLoad(readEntries(dir)),
    });
    writeReport(report, dir, 'diagnóstico RLS');
    expect(refreshReportFiles(dir)).toBe(true); // sin cambios: idempotente
    appendEntry(dir, entry('spendable.perf.ts', 'start', '2026-10-23T06:40:00.000Z', 'run-1', 12_000));
    expect(refreshReportFiles(dir)).toBe(true);
    const json = JSON.parse(readFileSync(join(dir, 'perf-results.json'), 'utf8')) as typeof report;
    expect(json.backgroundLoad?.fileOrder).toEqual(['nightly.perf.ts', 'spendable.perf.ts']);
    expect(json.backgroundLoad?.suites[1]?.isolation.verdict).toBe('interferencia');
    expect(json.environment).toEqual({ cpus: 4 });
    const md = readFileSync(join(dir, 'perf-summary.md'), 'utf8');
    expect(md).toMatch(/\| 2 \| spendable\.perf\.ts \| 12000 \|/u);
    expect(md).toContain('diagnóstico RLS');
    expect(md).toBe(renderMarkdown({ ...json }, 'diagnóstico RLS'));
  });

  it('[TC-PLATFORM-PIPELINE-024] no mezcla corridas: un reporte de otra corrida (o sin reporte) no se modifica', () => {
    const dir = tmp();
    expect(refreshReportFiles(dir)).toBe(false); // sin perf-results.json
    const stale = buildReport({
      generatedAt: 'viejo',
      environment: {},
      dataset: {},
      results: [],
      backgroundLoad: aggregateBackgroundLoad([
        entry('a.perf.ts', 'start', '2026-10-22T06:00:00.000Z', 'run-0'),
      ]),
    });
    writeReport(stale, dir);
    const before = readFileSync(join(dir, 'perf-results.json'), 'utf8');
    appendEntry(dir, entry('b.perf.ts', 'start', '2026-10-23T06:00:00.000Z', 'run-1'));
    expect(refreshReportFiles(dir)).toBe(false);
    expect(readFileSync(join(dir, 'perf-results.json'), 'utf8')).toBe(before);
    // Un reporte sin carga de fondo (versión anterior) tampoco se toca.
    const legacy = buildReport({ generatedAt: 'x', environment: {}, dataset: {}, results: [] });
    mkdirSync(dir, { recursive: true });
    writeReport(legacy, dir);
    expect(refreshReportFiles(dir)).toBe(false);
  });

  it('[TC-PLATFORM-PIPELINE-024] la foto se toma con consultas en serie sobre un mismo cliente (nunca en paralelo) y agrega por rol, aplicación y estado', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const seen: string[] = [];
    const client = {
      query: async (sql: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        seen.push(sql);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        if (/FROM platform\.outbox/u.test(sql)) return { rows: [{ n: 7 }] };
        if (/FROM pgboss\.job/u.test(sql)) return { rows: [{ queue: 'events.a', state: 'created', n: 5 }] };
        if (/pg_stat_activity/u.test(sql))
          return { rows: [{ role: 'pf_app', application: 'finance-api', state: 'idle', n: 2 }] };
        if (/pg_locks/u.test(sql)) return { rows: [{ n: 1 }] };
        if (/pg_stat_user_tables/u.test(sql))
          return {
            rows: [
              {
                table: 'platform.outbox',
                live: '10',
                dead: '3',
                last_autovacuum: null,
                last_autoanalyze: new Date('2026-10-23T05:00:00.000Z'),
              },
            ],
          };
        return { rows: [{ run_id: 'run-x', ok: true }] };
      },
    };
    const s = await takeBackgroundLoad(client);
    expect(maxInFlight).toBe(1);
    expect(s.outboxPending).toBe(7);
    expect(s.eventJobs).toEqual([{ queue: 'events.a', state: 'created', count: 5 }]);
    expect(s.connections).toEqual([{ role: 'pf_app', application: 'finance-api', state: 'idle', count: 2 }]);
    expect(s.ungrantedLocks).toBe(1);
    expect(s.tables).toEqual([
      {
        table: 'platform.outbox',
        liveTuples: 10,
        deadTuples: 3,
        lastAutovacuum: null,
        lastAutoanalyze: '2026-10-23T05:00:00.000Z',
      },
    ]);
    expect(s.loadAvg).toHaveLength(3);
    expect(s.processCpuMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(s.takenAt)).not.toBeNaN();
    expect(seen.length).toBeGreaterThanOrEqual(5);
  });
});
