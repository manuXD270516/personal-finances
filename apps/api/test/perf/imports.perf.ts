import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  asAdmin,
  money,
  startHarness,
  until,
  type Harness,
  type Json,
  type User,
} from '../support/portability.js';
import { perfOutDir, recordSuiteLoad } from './background-load.js';
import { renderPdf } from '../../../../packages/contexts/imports/test/support/render-pdf.js';
import { paintLargeStatement } from '../../../../tests/fixtures/imports/statements-bo/pdf/paint-statement.js';
import {
  ACQUIRE_TIMEOUT_MESSAGE,
  AcquisitionRecorder,
  assertConnectionBudget,
  checkConnectionBudget,
  ConnectionSampler,
  DrainTracker,
  HARNESS_CONNECTIONS,
  instrumentPool,
  QUEUE_POOL_MAX,
  readServerLimits,
  type ConnectionBudgetCheck,
  type PoolBudget,
  type ServerConnectionLimits,
} from './connection-budget.js';
import { IMPORTS_API_POOL_MAX, PERF_RATE_LIMITS } from './perf-env.js';
import {
  classifyRetryReason,
  importsVerdict,
  writeImportsReport,
  type ConsumerDrain,
  type ImportsReport,
  type JobFailure,
  type RetriedJobs,
} from './perf-report.js';

// Foto de la carga de fondo al empezar, antes de cada benchmark y al terminar (investigate-perf-under-load).
recordSuiteLoad(import.meta.url, inject('deps').superuserUrl);

/**
 * NFR-PERF-007 / NFR-PERF-008 (TC-IMPORTS-CSV-029, Should; openspec add-basic-csv-import, decisión 16; docs/33 D112):
 * un extracto de 5 000 filas nuevas llega a la vista previa en ≤ 30 s desde la subida, se persiste en ≤ 20 s desde la
 * aprobación (escritura masiva, add-bulk-imported-transactions) y el backlog de CADA consumidor de eventos (los reales del worker, incluidos `planning.budget-thresholds`,
 * `reporting.data-version` y los de Phase 3) se drena en ≤ 120 s; el import publica exactamente 2 eventos propios.
 * Corre en el job nightly `perf` (`pnpm perf:bench`); no bloquea los PR. El archivo se genera aquí (no se versiona).
 */
const ROWS = 5000;
const PREVIEW_BUDGET_MS = 30_000;
const PERSIST_BUDGET_MS = 20_000;
const DRAIN_BUDGET_MS = 120_000;

let h: Harness;
let owner: User;
let accountId = '';
let sampler: Client | undefined;
let server: ServerConnectionLimits;
let budget: ConnectionBudgetCheck;
let acquisitions = new AcquisitionRecorder();
const restorers: (() => void)[] = [];

/**
 * Configuraciones que mide la suite (optimize-consumer-throughput, D307 y D311): la del código (concurrencia 4 y pool del
 * worker 52, los valores por omisión; INFORMATIVA) y la de la plantilla del host (`EVENT_CONSUMER_CONCURRENCY=1`,
 * `DATABASE_POOL_MAX=34` en el worker y 22 en la API: la que corre en producción; BLOQUEANTE). Las dos con la misma
 * precondición de presupuesto de conexiones.
 */
interface ImportConfig {
  readonly label: 'code' | 'host';
  readonly title: string;
  readonly concurrency: number;
  readonly workerEnv: Record<string, string>;
  /** `true`: el drenado fuera de presupuesto hace fallar la suite (D311); `false`: se publica sin decidir el veredicto. */
  readonly gate: boolean;
}
const CODE_CONFIG: ImportConfig = {
  label: 'code',
  title: 'configuración del código (informativa)',
  concurrency: 4,
  workerEnv: {},
  gate: false,
};
const HOST_CONFIG: ImportConfig = {
  label: 'host',
  title: 'configuración de la plantilla del host (bloqueante)',
  concurrency: 1,
  workerEnv: { EVENT_CONSUMER_CONCURRENCY: '1', DATABASE_POOL_MAX: '34' },
  gate: true,
};
let codeReport: ImportsReport | undefined;

const W = () => `/api/v1/workspaces/${owner.ws}`;

function generateCsv(rows: number): Buffer {
  const lines = ['Fecha;Descripción;Monto'];
  for (let i = 0; i < rows; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((Math.floor(i / 28) % 3) + 8).padStart(2, '0');
    const cents = String(i % 100).padStart(2, '0');
    lines.push(`${day}/${month}/2026;COMPRA COMERCIO ${i};-${(i % 250) + 1},${cents}`);
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'latin1');
}

async function consumerBacklog(): Promise<{
  backlog: Map<string, number>;
  retrying: Map<string, number>;
}> {
  return asAdmin(h, async (c) => {
    const { rows } = await c.query<{ name: string; pending: number; retrying: number }>(
      `SELECT name, count(*)::int AS pending, (count(*) FILTER (WHERE state = 'retry'))::int AS retrying
         FROM pgboss.job
        WHERE name LIKE 'events.%' AND name NOT LIKE '%.dlq' AND state IN ('created', 'retry', 'active')
        GROUP BY name`,
    );
    return {
      backlog: new Map(rows.map((r) => [r.name, r.pending])),
      retrying: new Map(rows.map((r) => [r.name, r.retrying])),
    };
  });
}

/**
 * Trabajos de los consumidores creados desde `since` que fallaron al menos una vez, con el último error que pg-boss
 * guardó en `output` y la latencia máxima de un trabajo reintentado (del alta a su fin): un evento con varios reintentos
 * espera el backoff exponencial (1, 2, 4... s) y puede alargar el drenado de su cola.
 */
async function retriedJobs(since: Date): Promise<RetriedJobs[]> {
  return asAdmin(h, async (c) => {
    const { rows } = await c.query<{
      name: string;
      jobs: number;
      max_retry: number;
      max_latency_ms: number;
      error: string | null;
    }>(
      `SELECT name, count(*)::int AS jobs, max(retry_count)::int AS max_retry,
              (max(EXTRACT(EPOCH FROM (COALESCE(completed_on, now()) - created_on))) * 1000)::int AS max_latency_ms,
              left(max(COALESCE(output::jsonb ->> 'message', output::text)), 200) AS error
         FROM pgboss.job
        WHERE name LIKE 'events.%' AND name NOT LIKE '%.dlq' AND retry_count > 0 AND created_on >= $1
        GROUP BY name
        ORDER BY name`,
      [since],
    );
    return rows.map((r) => ({
      queue: r.name,
      jobs: r.jobs,
      maxRetryCount: r.max_retry,
      maxLatencyMs: r.max_latency_ms,
      error: r.error ?? '(sin mensaje)',
      reason: classifyRetryReason(r.error ?? ''),
    }));
  });
}

/** Fallos de entrega que registró el worker (`job failed`), agrupados por cola y error. */
function jobFailures(): JobFailure[] {
  const groups = new Map<string, JobFailure>();
  for (const line of h.workerLog?.lines ?? []) {
    if (!line.includes('"job failed"')) continue;
    const rec = JSON.parse(line) as Record<string, unknown>;
    const err = (rec['err'] ?? {}) as { type?: string; message?: string; code?: string };
    const queue = String(rec['job.queue'] ?? '(sin cola)');
    const error = `${err.code ? `${err.code} ` : ''}${err.type ?? 'Error'}: ${(err.message ?? '').slice(0, 160)}`;
    const key = `${queue} | ${error}`;
    const attempt = Number(rec['job.attempt'] ?? 1);
    const current = groups.get(key);
    groups.set(key, {
      queue,
      error,
      count: (current?.count ?? 0) + 1,
      maxAttempt: Math.max(current?.maxAttempt ?? 0, attempt),
    });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 15);
}

/** Los pools máximos que abre esta suite: API, worker, sus colas pg-boss y las conexiones propias del harness. */
function poolBudgets(): PoolBudget[] {
  return [
    { name: 'api', max: h.api.resources.pool.options.max ?? 10 },
    { name: 'worker', max: h.worker!.pool.options.max ?? 10 },
    { name: 'api-queue', max: QUEUE_POOL_MAX },
    { name: 'worker-queue', max: QUEUE_POOL_MAX },
    { name: 'harness', max: HARNESS_CONNECTIONS },
  ];
}

/** Colas de los consumidores (`events.*` sin dead-letter), con 0 las que no tienen trabajos pendientes. */
async function consumerBacklogWithZeros(): Promise<{
  backlog: Map<string, number>;
  retrying: Map<string, number>;
}> {
  const queues = await asAdmin(h, async (c) => {
    const { rows } = await c.query<{ name: string }>(
      `SELECT name FROM pgboss.queue WHERE name LIKE 'events.%' AND name NOT LIKE '%.dlq'`,
    );
    return rows.map((r) => r.name);
  });
  const { backlog, retrying } = await consumerBacklog();
  return { backlog: new Map([...queues.map((q) => [q, 0] as const), ...backlog]), retrying };
}

beforeAll(async () => {
  // API con el pool de la plantilla del host (A1): la suma de los pools máximos cabe en el servidor del benchmark. El
  // worker se levanta por configuración dentro de cada test (`prepare`).
  h = await startHarness({
    apiEnv: { ...PERF_RATE_LIMITS, DATABASE_POOL_MAX: String(IMPORTS_API_POOL_MAX) },
  });
  sampler = new Client({
    connectionString: inject('deps').superuserUrl,
    application_name: 'pf-perf-conn-sampler',
  });
  await sampler.connect();
  server = await readServerLimits(sampler);
}, 300_000);

/**
 * Levanta el worker con la configuración dada, verifica la precondición de presupuesto [TC-PLATFORM-PIPELINE-029] (si la
 * suma de los pools máximos no cabe en el servidor, falla ANTES de subir el archivo y no publica ninguna medición como
 * válida) y crea el usuario y la cuenta de la corrida.
 */
async function prepare(cfg: ImportConfig): Promise<void> {
  for (const restore of restorers.splice(0)) restore();
  await h.stopWorker();
  acquisitions = new AcquisitionRecorder();
  await h.startWorker({}, { env: cfg.workerEnv });
  budget = checkConnectionBudget(poolBudgets(), server);
  assertConnectionBudget(poolBudgets(), server);
  restorers.push(instrumentPool('api', h.api.resources.pool, acquisitions));
  restorers.push(instrumentPool('worker', h.worker!.pool, acquisitions));
  owner = await h.user(`kc-imp-perf-${cfg.label}-${randomUUID()}`);
  const account = await h.call('POST', `${W()}/accounts`, {
    token: owner.token,
    body: {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('10000000.00'), date: '2026-07-01' },
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(account.status).toBe(201);
  accountId = account.body['id'] as string;
}

afterAll(async () => {
  for (const restore of restorers) restore();
  await h?.close();
  await sampler?.end();
});

/** Una corrida completa del benchmark con la configuración `cfg`; publica su fila y aplica sus umbrales. */
async function runImportBenchmark(cfg: ImportConfig): Promise<void> {
  await prepare(cfg);
  {
    const connections = new ConnectionSampler(
      { api: h.api.resources.pool, worker: h.worker!.pool },
      sampler!,
      acquisitions,
    );
    connections.start();
    const tracker = new DrainTracker();
    let uploadedMs = 0;
    let previewMs = 0;
    let persistMs = 0;
    let drainAfterPersistMs = 0;
    let events: string[] = [];
    let failure: unknown;
    const startedAt = new Date(Date.now() - 1000);
    try {
      const csv = generateCsv(ROWS);
      const t0 = performance.now();
      const form = new FormData();
      form.append('file', new Blob([csv], { type: 'text/csv' }), 'extracto-5000.csv');
      form.append('accountId', accountId);
      const upload = await h.call('POST', `${W()}/imports`, {
        token: owner.token,
        form,
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(upload.status, JSON.stringify(upload.body)).toBe(201);
      uploadedMs = performance.now() - t0;

      const mapped = await h.call('PUT', `${W()}/imports/${upload.body['id'] as string}/mapping`, {
        token: owner.token,
        body: {
          hasHeader: true,
          skipRows: 0,
          columns: {
            date: { index: 0 },
            description: { index: 1 },
            amount: { mode: 'SIGNED', index: 2, signConvention: 'NEGATIVE_IS_OUTFLOW' },
          },
          dateFormat: 'dd/MM/yyyy',
          decimalSeparator: ',',
        },
        headers: { 'if-match': `"${String(upload.body['version'])}"` },
      });
      expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
      previewMs = performance.now() - t0;
      const counts = (mapped.body['previewSummary'] as { counts: Record<string, number> }).counts;
      expect(counts).toMatchObject({ rows: ROWS, new: ROWS });

      const t1 = performance.now();
      const approved = await h.call('POST', `${W()}/imports/${upload.body['id'] as string}/approve`, {
        token: owner.token,
        headers: { 'idempotency-key': randomUUID(), 'if-match': `"${String(mapped.body['version'])}"` },
      });
      expect(approved.status, JSON.stringify(approved.body)).toBe(202);
      const done = await until(
        async () => {
          const r = await h.call('GET', `${W()}/imports/${upload.body['id'] as string}`, {
            token: owner.token,
          });
          return ['COMPLETED', 'PARTIALLY_FAILED'].includes(r.body['status'] as string) ? r.body : undefined;
        },
        600_000,
        500,
      );
      persistMs = performance.now() - t1;
      const persistEnd = t1 + persistMs;
      expect(done['status']).toBe('COMPLETED');
      expect((done['counters'] as Json)['created']).toBe(ROWS);

      // Cada consumidor termina de procesar los eventos de esas transacciones; se mide desde el fin de la persistencia
      // [TC-PLATFORM-PIPELINE-031].
      await until(
        async () => {
          const { backlog, retrying } = await consumerBacklogWithZeros();
          const outbox = await asAdmin(h, (c) =>
            c.query(`SELECT count(*)::int AS n FROM platform.outbox WHERE published_at IS NULL`),
          );
          const outboxPending = outbox.rows[0]!.n as number;
          tracker.observe(performance.now() - persistEnd, backlog, outboxPending, retrying);
          const pendingTotal = [...backlog.values()].reduce((a, b) => a + b, 0);
          return pendingTotal === 0 && outboxPending === 0 ? true : undefined;
        },
        DRAIN_BUDGET_MS + 60_000,
        500,
      );
      drainAfterPersistMs = performance.now() - persistEnd;
      events = await asAdmin(h, async (c) => {
        const { rows } = await c.query<{ event_type: string }>(
          `SELECT event_type FROM platform.outbox WHERE workspace_id = $1 AND event_type LIKE 'imports.%'`,
          [owner.ws],
        );
        return rows.map((r) => r.event_type).sort();
      });
    } catch (err) {
      failure = err;
    } finally {
      await connections.stop();
    }

    const connectionsReport = connections.report(server, budget);
    const drainByConsumer: ConsumerDrain[] = tracker.result();
    const retries = await retriedJobs(startedAt).catch(() => []);
    if (drainAfterPersistMs === 0 && persistMs > 0) {
      // El drenado no terminó (tiempo de espera agotado): se mide hasta ahora para el veredicto.
      drainAfterPersistMs = DRAIN_BUDGET_MS + 60_000;
    }
    const verdict = importsVerdict({
      drainAfterPersistMs,
      drainBudgetMs: DRAIN_BUDGET_MS,
      connections: connectionsReport,
      drainByConsumer,
    });
    const report: ImportsReport = {
      rows: ROWS,
      previewMs: Math.round(previewMs),
      persistMs: Math.round(persistMs),
      drainAfterPersistMs: Math.round(drainAfterPersistMs),
      drainBudgetMs: DRAIN_BUDGET_MS,
      connections: connectionsReport,
      drainByConsumer,
      retries,
      jobFailures: jobFailures(),
      verdict,
      configuration: {
        label: cfg.label,
        eventConsumerConcurrency: cfg.concurrency,
        workerPoolMax: h.worker!.pool.options.max ?? 10,
        apiPoolMax: h.api.resources.pool.options.max ?? 10,
        poolsSum: budget.poolsSum,
        usableConnections: budget.limit,
        gate: cfg.gate,
      },
    };
    // La fila del código es `imports` (informativa) y la del host cuelga de ella como `hostConfig` (bloqueante, D311).
    if (cfg.label === 'code') codeReport = report;
    writeImportsReport(
      cfg.label === 'host' && codeReport ? { ...codeReport, hostConfig: report } : report,
      perfOutDir(),
    );

    // Informe para el job nightly (informativo + umbrales de la spec).
    console.log(
      JSON.stringify({
        test: 'TC-IMPORTS-CSV-029',
        configuration: cfg.label,
        rows: ROWS,
        uploadMs: Math.round(uploadedMs),
        previewMs: Math.round(previewMs),
        persistMs: Math.round(persistMs),
        drainAfterPersistMs: Math.round(drainAfterPersistMs),
        verdict: verdict.kind,
        server: connectionsReport.server,
        pools: connectionsReport.pools,
        drainByConsumer,
      }),
    );

    // Un fallo del propio import (no del drenado ni de las conexiones) invalida la medición en cualquier configuración.
    const connectionFailure =
      verdict.kind === 'conexiones' ||
      (failure instanceof Error && ACQUIRE_TIMEOUT_MESSAGE.test(failure.message));
    if (failure && !connectionFailure) throw failure;
    // La fila del código es informativa (D311): se publica y no decide el veredicto.
    if (!cfg.gate) return;

    // Una adquisición de conexión vencida es un fallo de conexiones, no del drenado (TC-PLATFORM-PIPELINE-030).
    if (connectionFailure) {
      const detail = failure instanceof Error ? `; error: ${failure.message}` : '';
      throw new Error(
        `${verdict.kind === 'conexiones' ? verdict.message : '[TC-PLATFORM-PIPELINE-030] veredicto conexiones: la adquisición de conexión venció'}${detail}`,
        {
          cause: failure,
        },
      );
    }

    expect(previewMs).toBeLessThanOrEqual(PREVIEW_BUDGET_MS);
    // Fila bloqueante de la ráfaga del import (D152, D311, D359; add-bulk-imported-transactions): con la escritura masiva
    // la persistencia cumple los 20 s de la spec por omisión (se retiraron la variable de relajación y el techo de 300 s) y los
    // ~15 000 hechos llegan juntos a los consumidores, que drenan en ≤ 120 s cada uno (aserción siguiente).
    expect(persistMs).toBeLessThanOrEqual(PERSIST_BUDGET_MS);
    // El backlog de los consumidores se drena en ≤ 120 s DESPUÉS de la última transacción creada; si no, el fallo nombra
    // los consumidores que terminaron después del presupuesto [TC-PLATFORM-PIPELINE-032].
    expect(drainAfterPersistMs, verdict.message).toBeLessThanOrEqual(DRAIN_BUDGET_MS);
    expect(events).toEqual(['imports.ImportApproved', 'imports.ImportCompleted']);
  }
}

describe('import CSV de 5 000 filas', () => {
  it(`[TC-IMPORTS-CSV-029][TC-PLATFORM-THROUGHPUT-014] ${CODE_CONFIG.title}: se publica la fila sin decidir el veredicto`, async () => {
    await runImportBenchmark(CODE_CONFIG);
  }, 1_800_000);

  it(`[TC-IMPORTS-CSV-029][TC-PLATFORM-THROUGHPUT-008][TC-PLATFORM-THROUGHPUT-014] ${HOST_CONFIG.title}: vista previa ≤ 30 s, persistencia ≤ 20 s y cada consumidor drena en ≤ 120 s`, async () => {
    await runImportBenchmark(HOST_CONFIG);
  }, 1_800_000);
});

/** OFX 1.x SGML sintético de `count` movimientos nuevos (SINTETICO; el archivo no se versiona). */
function ofxOf(count: number): Buffer {
  const rows: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((Math.floor(i / 28) % 3) + 8).padStart(2, '0');
    const cents = String(i % 100).padStart(2, '0');
    rows.push(
      `<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>2026${month}${day}\n<TRNAMT>-${(i % 250) + 1}.${cents}\n<FITID>PERF${String(i).padStart(8, '0')}\n<NAME>COMPRA COMERCIO ${i}\n</STMTTRN>`,
    );
  }
  return Buffer.from(
    [
      'OFXHEADER:100',
      'DATA:OFXSGML',
      'VERSION:102',
      '',
      '<OFX>',
      '<BANKMSGSRSV1>',
      '<STMTTRNRS>',
      '<STMTRS>',
      '<CURDEF>BOB',
      '<BANKTRANLIST>',
      ...rows,
      '</BANKTRANLIST>',
      '</STMTRS>',
      '</STMTTRNRS>',
      '</BANKMSGSRSV1>',
      '</OFX>',
    ].join('\n'),
    'latin1',
  );
}

describe('import por documento OFX de 5 000 movimientos', () => {
  it('[TC-IMPORTS-PIPELINE-066] llega a revisión en ≤ 30 s con el pipeline completo (lectura, normalización, validación, clasificación con 200 reglas activas, duplicados y coincidencias)', async () => {
    await prepare(HOST_CONFIG);
    // 200 reglas activas del disparador IMPORT (add-rule-engine): la evaluación entra en el presupuesto (TC-066).
    const categories = await h.call('GET', `${W()}/categories?kind=EXPENSE&limit=1`, { token: owner.token });
    const categoryId = (categories.body['data'] as { id: string }[])[0]!.id;
    await asAdmin(h, async (c) => {
      await c.query(
        `INSERT INTO rules.rule (id, workspace_id, name, priority, triggers, match_mode, conditions, actions, created_by, created_at, updated_at)
         SELECT gen_random_uuid(), $1, 'Regla ' || n, n, ARRAY['IMPORT']::text[], 'ALL',
                jsonb_build_array(jsonb_build_object('field', 'DESCRIPTION', 'operator', 'contains', 'value', 'comercio ' || n)),
                $2::jsonb, $3, now() + (n || ' milliseconds')::interval, now()
           FROM generate_series(1, 200) n`,
        [owner.ws, JSON.stringify([{ type: 'SET_CATEGORY', categoryId }]), owner.id],
      );
    });
    const content = ofxOf(ROWS);
    const requested = await h.call('POST', `${W()}/documents/uploads`, {
      token: owner.token,
      body: {
        fileName: 'extracto-5000.ofx',
        contentType: 'application/x-ofx',
        sizeBytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        purpose: 'IMPORT_SOURCE',
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    const target = requested.body['upload'] as {
      url: string;
      method: string;
      headers: Record<string, string>;
    };
    const put = await fetch(target.url, { method: target.method, headers: target.headers, body: content });
    expect(put.status).toBe(200);
    const documentId = (requested.body['document'] as { id: string }).id;
    const done = await h.call('POST', `${W()}/documents/${documentId}/complete`, {
      token: owner.token,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const started = performance.now();
    const created = await h.call('POST', `${W()}/imports`, {
      token: owner.token,
      body: { accountId, documentId },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(202);
    const importId = created.body['id'] as string;
    const review = await until(async () => {
      const r = await h.call('GET', `${W()}/imports/${importId}`, { token: owner.token });
      const status = r.body['status'] as string;
      if (status === 'PARSE_FAILED') throw new Error(JSON.stringify(r.body['failure']));
      return status === 'AWAITING_REVIEW' ? r.body : undefined;
    }, 120_000);
    const reviewMs = performance.now() - started;
    console.log(`[imports-pipeline] ${ROWS} movimientos OFX hasta la revisión: ${Math.round(reviewMs)} ms`);
    expect((review['counters'] as Record<string, number>)['rows']).toBe(ROWS);
    expect(reviewMs).toBeLessThanOrEqual(PREVIEW_BUDGET_MS);
  }, 600_000);
});

// Fila informativa del extracto PDF (openspec add-pdf-statement-parser, decisión 16, TC-IMPORTS-PDF-046, Should): un PDF
// de 100 páginas y 5 000 movimientos, generado aquí con pdfkit (no se versiona), llega a revisión en ≤ 30 s con el
// pipeline completo; el presupuesto interno es hilo ≤ 0,5 s, extracción ≤ 6 s y reconstrucción ≤ 2 s.
describe('import por documento PDF de 100 páginas y 5 000 movimientos', () => {
  it('[TC-IMPORTS-PDF-046] llega a revisión en ≤ 30 s (extracción en el hilo aislado, reconstrucción, coherencia y el resto del pipeline)', async () => {
    await prepare(HOST_CONFIG);
    const content = Buffer.from(await renderPdf(paintLargeStatement(ROWS, 50)));
    const requested = await h.call('POST', `${W()}/documents/uploads`, {
      token: owner.token,
      body: {
        fileName: 'extracto-5000.pdf',
        contentType: 'application/pdf',
        sizeBytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        purpose: 'IMPORT_SOURCE',
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    const target = requested.body['upload'] as {
      url: string;
      method: string;
      headers: Record<string, string>;
    };
    const put = await fetch(target.url, { method: target.method, headers: target.headers, body: content });
    expect(put.status).toBe(200);
    const documentId = (requested.body['document'] as { id: string }).id;
    const done = await h.call('POST', `${W()}/documents/${documentId}/complete`, {
      token: owner.token,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const started = performance.now();
    const created = await h.call('POST', `${W()}/imports`, {
      token: owner.token,
      body: { accountId, documentId },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(202);
    const importId = created.body['id'] as string;
    const review = await until(async () => {
      const r = await h.call('GET', `${W()}/imports/${importId}`, { token: owner.token });
      const status = r.body['status'] as string;
      if (status === 'PARSE_FAILED') throw new Error(JSON.stringify([r.body['failure'], r.body['pdf']]));
      return status === 'AWAITING_REVIEW' ? r.body : undefined;
    }, 120_000);
    const reviewMs = performance.now() - started;
    console.log(
      `[imports-pdf] ${ROWS} movimientos en ${(review['pdf'] as { pagesRead: number }).pagesRead} páginas PDF hasta la revisión: ${Math.round(reviewMs)} ms`,
    );
    expect((review['counters'] as Record<string, number>)['rows']).toBe(ROWS);
    expect((review['pdf'] as { pagesRead: number }).pagesRead).toBe(100);
    expect(reviewMs).toBeLessThanOrEqual(PREVIEW_BUDGET_MS);
  }, 600_000);
});
