import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@pf/platform/config';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { LARGE_MAIN_WORKSPACE_ID } from '../../src/seed/large/large-plan.js';
import { MINIMAL_USERS, runSeed } from '../../src/seed/run-seed.js';
import { demoQueryRuntimes } from '../support/demo-runtimes.js';
import { capturingLogger } from '../support/harness.js';
import { ISSUER, startHarness, until, type Harness } from '../support/portability.js';
import { recordSuiteLoad } from './background-load.js';
import { PERF_RATE_LIMITS } from './perf-env.js';

/**
 * add-category-suggestions 5.2, 5.3 y 5.4 (D477; TC-CLASSIFICATION-AUTO-019 y -026), contra PostgreSQL real y el Large
 * Seed:
 *  - fila BLOQUEANTE de precisión: el backtesting temporal de los últimos 3 meses de la ventana del workspace principal
 *    del Large Seed (julio a septiembre de 2026) debe tener precisión top-1 ≥ 0.8500. El umbral no se cambia aquí: si el
 *    seed no lo alcanza por cómo genera las categorías se registra la medición y se le pregunta al owner (D477);
 *  - consulta del alta manual con 5 000 transacciones de historial: ≤ 150 ms p95 con la caché y ≤ 400 ms p95 sin ella;
 *  - un extracto de 5 000 filas con historial llega a la vista previa en ≤ 30 s con las sugerencias calculadas.
 * El informe (sin descripciones ni montos) se escribe en `reports/perf/category-suggestions.json`. Corre en el job nightly
 * `perf` (`pnpm perf:bench`); no bloquea los PR.
 */
const deps = inject('deps');
recordSuiteLoad(import.meta.url, deps.superuserUrl);
const WS = LARGE_MAIN_WORKSPACE_ID;
const PRECISION_FLOOR = '0.8500';
const WARM_BUDGET_MS = 150;
const COLD_BUDGET_MS = 400;
const PREVIEW_BUDGET_MS = 30_000;
const ROWS = 5000;
const SAMPLES = 40;

const query = { kind: 'EXPENSE' as const, description: 'Súper 12' };
const p95 = (samples: number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

let h: Harness;
let q: ReturnType<typeof demoQueryRuntimes>;
const report: Record<string, unknown> = {};

beforeAll(async () => {
  const admin = new Client({ connectionString: deps.superuserUrl });
  await admin.connect();
  try {
    const present = await admin.query('SELECT 1 FROM iam.workspace WHERE id = $1', [WS]);
    if (present.rowCount === 0) {
      await runSeed(
        loadConfig('seed', {
          PFOS_ENV: 'ci',
          LOG_LEVEL: 'warn',
          DATABASE_URL: deps.databaseUrl,
          OIDC_ISSUER_URL: ISSUER,
        }),
        capturingLogger('finance-api', 'seed', 'warn').logger,
        'large',
        { scale: Number(process.env['PF_PERF_SCALE'] ?? '0.1'), concurrency: 4 },
      );
    }
  } finally {
    await admin.end();
  }
  q = demoQueryRuntimes({ databaseUrl: deps.databaseUrl, today: '2026-10-01' });
  // Diagnóstico: `CS_PERF_SUGGEST_OFF=1` mide el mismo extracto con las sugerencias deshabilitadas (la base de comparación).
  const off = process.env['CS_PERF_SUGGEST_OFF'] === '1' ? { RULES_CATEGORY_SUGGEST_ENABLED: 'false' } : {};
  h = await startHarness({
    worker: true,
    apiEnv: { ...PERF_RATE_LIMITS, LOG_LEVEL: 'warn', ...off },
    workerEnv: off,
  });
}, 900_000);

afterAll(async () => {
  await q?.close();
  await h?.close();
  const out =
    process.env['PF_PERF_OUT'] ?? fileURLToPath(new URL('../../../../reports/perf', import.meta.url));
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/category-suggestions.json`, `${JSON.stringify(report, null, 2)}\n`);
});

describe('sugerencias de categoría sobre el Large Seed', () => {
  it('[TC-CLASSIFICATION-AUTO-019] la precisión top-1 de los últimos 3 meses de la ventana alcanza 0.8500 (fila bloqueante, D477)', async () => {
    const service = q.r.rules.categorySuggestions;
    const result = await service.backtest(WS, { months: 3, asOf: '2026-09' });
    // Solo cifras agregadas: ni descripciones ni montos.
    report['backtest'] = result;
    console.info(
      `[category-suggestions] backtest ${result.byMonth.map((m) => m.month).join(', ')}: precisión ${result.total.precision}, cobertura ${result.total.coverage}`,
    );
    expect(result.total.suggestions).toBeGreaterThan(0);
    expect(Number(result.total.precision), JSON.stringify(result.total)).toBeGreaterThanOrEqual(
      Number(PRECISION_FLOOR),
    );
  }, 600_000);

  it('[TC-CLASSIFICATION-AUTO-026] la consulta del alta manual responde en ≤ 150 ms p95 con caché y ≤ 400 ms p95 sin ella (5 000 transacciones de historial)', async () => {
    const service = q.r.rules.categorySuggestions;
    const call = () => q.inWs(MINIMAL_USERS[0].subject, WS, () => service.query(WS, query));
    service.clearCache();
    await call();
    const warm: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const t0 = performance.now();
      await call();
      warm.push(performance.now() - t0);
    }
    const cold: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      service.clearCache();
      const t0 = performance.now();
      await call();
      cold.push(performance.now() - t0);
    }
    const figures = { warmP95Ms: Math.round(p95(warm)), coldP95Ms: Math.round(p95(cold)), samples: SAMPLES };
    report['query'] = figures;
    console.info(
      `[category-suggestions] consulta p95: con caché ${figures.warmP95Ms} ms, sin caché ${figures.coldP95Ms} ms`,
    );
    expect(figures.warmP95Ms).toBeLessThanOrEqual(WARM_BUDGET_MS);
    expect(figures.coldP95Ms).toBeLessThanOrEqual(COLD_BUDGET_MS);
  }, 600_000);

  it('[TC-CLASSIFICATION-AUTO-026] un extracto de 5 000 filas con 5 000 transacciones de historial llega a la vista previa en ≤ 30 s con las sugerencias calculadas', async () => {
    // Workspace nuevo: el historial son las 5 000 filas de un primer import, clasificadas por el usuario (edición en lote)
    // y aprobadas; el segundo import del mismo tamaño las usa como evidencia. El primero es la base de comparación (sin
    // historial no hay sugerencias), así que la diferencia es el costo de las sugerencias.
    const user = await h.user(`kc-cs-perf-${randomUUID()}`);
    const base = `/api/v1/workspaces/${user.ws}`;
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      h.call(method, `${base}${path}`, {
        token: user.token,
        ...(body === undefined ? {} : { body }),
        headers: { 'idempotency-key': randomUUID(), ...headers },
      });
    const account = await call('POST', '/accounts', {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: { amount: '5000000.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    expect(account.status, JSON.stringify(account.body)).toBe(201);
    const bank = account.body['id'] as string;
    const cats = await call('GET', '/categories?kind=EXPENSE&limit=200');
    const restaurants = (cats.body['data'] as { id: string; name: string }[]).find(
      (c) => c.name === 'Restaurantes',
    )!.id;
    const descriptions = ['Súper', 'Pasaje', 'Almuerzo', 'Café', 'Farmacia', 'Taxi'];

    const ofx = (tag: string, firstMonth: number): Buffer => {
      const rows: string[] = [];
      for (let i = 0; i < ROWS; i += 1) {
        const day = String((i % 28) + 1).padStart(2, '0');
        const month = String((Math.floor(i / 28) % 3) + firstMonth).padStart(2, '0');
        rows.push(
          `<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>2026${month}${day}\n<TRNAMT>-${(i % 250) + 1 + (firstMonth > 5 ? 300 : 0)}.${String(i % 100).padStart(2, '0')}\n<FITID>${tag}${String(i).padStart(8, '0')}\n<NAME>${descriptions[i % descriptions.length]} ${i}\n</STMTTRN>`,
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
    };

    /** Sube el extracto, crea la importación y devuelve el tiempo hasta la revisión. */
    const importUntilReview = async (content: Buffer, name: string) => {
      const requested = await call('POST', '/documents/uploads', {
        fileName: name,
        contentType: 'application/x-ofx',
        sizeBytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        purpose: 'IMPORT_SOURCE',
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
      expect((await call('POST', `/documents/${documentId}/complete`)).status).toBe(200);
      const started = performance.now();
      const created = await call('POST', '/imports', { accountId: bank, documentId });
      expect(created.status, JSON.stringify(created.body)).toBe(202);
      const importId = created.body['id'] as string;
      const review = await until(async () => {
        const r = await h.call('GET', `${base}/imports/${importId}`, { token: user.token });
        if (r.body['status'] === 'PARSE_FAILED') throw new Error(JSON.stringify(r.body['failure']));
        return r.body['status'] === 'AWAITING_REVIEW' ? r.body : undefined;
      }, 300_000);
      return { importId, version: review['version'] as number, ms: performance.now() - started };
    };

    // 1) Base: sin historial.
    const first = await importUntilReview(ofx('CSPERFA', 3), 'historial-5000.ofx');
    // 2) Se clasifica en lote como lo haría el usuario y se aprueba: pasa a ser historial (origen manual).
    const bulk = await call(
      'POST',
      `/imports/${first.importId}/rows/bulk-edit`,
      { filter: {}, set: { categoryId: restaurants } },
      { 'if-match': `"${first.version}"` },
    );
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);
    const approved = await call('POST', `/imports/${first.importId}/approve`, undefined, {
      'if-match': `"${bulk.body['version']}"`,
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(202);
    await until(async () => {
      const r = await h.call('GET', `${base}/imports/${first.importId}`, { token: user.token });
      return /^COMPLETED/u.test(String(r.body['status'])) ? r.body : undefined;
    }, 600_000);

    // 3) Con 5 000 transacciones de historial: las sugerencias se calculan en la etapa de clasificación.
    const second = await importUntilReview(ofx('CSPERFB', 7), 'extracto-5000.ofx');
    const withSuggestion = await h.call(
      'GET',
      `${base}/imports/${second.importId}/preview?limit=200&hasSuggestion=true`,
      {
        token: user.token,
      },
    );
    const shown = (withSuggestion.body['rows'] as unknown[] | undefined)?.length ?? 0;
    report['import'] = {
      rows: ROWS,
      baselinePreviewMs: Math.round(first.ms),
      previewMs: Math.round(second.ms),
      rowsWithSuggestionInFirstPage: shown,
    };
    console.info(
      `[category-suggestions] ${ROWS} filas hasta la vista previa: sin historial ${Math.round(first.ms)} ms, con 5 000 de historial ${Math.round(second.ms)} ms (${shown} con sugerencia en la primera página)`,
    );
    if (process.env['CS_PERF_SUGGEST_OFF'] !== '1') expect(shown).toBeGreaterThan(0);
    expect(second.ms).toBeLessThanOrEqual(PREVIEW_BUDGET_MS);
  }, 1_800_000);
});
