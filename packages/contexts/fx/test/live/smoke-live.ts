// `pnpm fx:smoke-live` (add-market-rate-providers 7.3; design.md decisión 14): smoke OPCIONAL contra los providers
// reales. Una solicitud a cada endpoint (paralelo.bo `/api/v1/rate` y `/api/v1/historical.json`, bo.dolarapi.com
// `/v1/dolares`) con el MISMO cliente HTTP y adapters que el worker (allowlist de hosts, User-Agent genérico, sin
// query, cookies ni credenciales), validación de cada respuesta contra el consumer contract del adapter y hash SHA-256
// del spec de paralelo.bo (URL canónica `https://paralelo.bo/api/v1/openapi.json`, docs/31 D46) contra la línea base
// grabada (`<sha256>  <url>`, ver `openapi-baseline.ts`). Solo corre en el job nightly `fx-smoke-live`
// (`continue-on-error`): su falla abre/actualiza un issue para revisar el adapter y nunca bloquea el pipeline.
//
// Uso: pnpm fx:smoke-live [-- --out <dir>] [--update-baseline]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { systemClock } from '@pf/shared-kernel';
import {
  DOLARAPI_BO_BASE_URL,
  DOLARAPI_DOLARES_CONTRACT,
  DolarApiBoProvider,
} from '../../src/infrastructure/providers/dolarapi-bo.provider.js';
import {
  PARALELO_BO_BASE_URL,
  PARALELO_HISTORY_CONTRACT,
  PARALELO_RATE_CONTRACT,
  ParaleloBoProvider,
} from '../../src/infrastructure/providers/paralelo-bo.provider.js';
import {
  nodeTransport,
  ProviderHttpClient,
} from '../../src/infrastructure/providers/provider-http-client.js';
import { validateContract, type JsonContract } from './json-contract.js';
import { compareBaseline, formatBaseline, PARALELO_OPENAPI_PATH } from './openapi-baseline.js';

const BASELINE = fileURLToPath(new URL('../fixtures/providers/paralelo-bo/openapi.sha256', import.meta.url));
const OPENAPI_URL = `${PARALELO_BO_BASE_URL}${PARALELO_OPENAPI_PATH}`;
const TIMEOUT_MS = 15_000;

interface Check {
  readonly name: string;
  readonly url: string;
  readonly ok: boolean;
  readonly detail: string;
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { out: { type: 'string' }, 'update-baseline': { type: 'boolean' } },
});
const outDir = resolve(
  values.out ?? fileURLToPath(new URL('../../../../../reports/fx-smoke/', import.meta.url)),
);

/** Respuestas crudas capturadas del transporte real (el adapter valida su propio contrato además). */
const bodies = new Map<string, string>();
const http = new ProviderHttpClient({
  clock: systemClock,
  timeoutMs: TIMEOUT_MS,
  transport: async (url, headers, timeoutMs) => {
    const res = await nodeTransport(url, headers, timeoutMs);
    bodies.set(url.href, res.body);
    // El cliente traduce los estados ≠ 200 (429, 503…) a ProviderError, igual que en el worker.
    return res;
  },
});

const message = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

async function endpoint(
  name: string,
  url: string,
  contract: JsonContract,
  fetch: () => Promise<readonly { value: string; rateType: string; base: string; quote: string }[]>,
): Promise<Check> {
  try {
    const samples = await fetch();
    const body = bodies.get(url);
    if (body === undefined) return { name, url, ok: false, detail: 'sin respuesta capturada' };
    const violations = validateContract(contract, JSON.parse(body) as unknown);
    if (violations.length > 0)
      return { name, url, ok: false, detail: `contrato: ${violations.slice(0, 5).join('; ')}` };
    const first = samples[0];
    return {
      name,
      url,
      ok: samples.length > 0,
      detail: first
        ? `${samples.length} muestras (p. ej. ${first.base}/${first.quote} ${first.rateType} ${first.value})`
        : 'el adapter no produjo muestras',
    };
  } catch (err) {
    return { name, url, ok: false, detail: message(err) };
  }
}

async function openapiHash(): Promise<Check> {
  try {
    const res = await nodeTransport(
      new URL(OPENAPI_URL),
      { accept: 'application/json', 'user-agent': 'PFOS-fx-smoke' },
      TIMEOUT_MS,
    );
    if (res.status !== 200)
      return { name: 'openapi.json (hash)', url: OPENAPI_URL, ok: false, detail: `HTTP ${res.status}` };
    const hash = createHash('sha256').update(res.body, 'utf8').digest('hex');
    if (values['update-baseline']) {
      writeFileSync(BASELINE, formatBaseline({ sha256: hash, url: OPENAPI_URL }), 'utf8');
      return {
        name: 'openapi.json (hash)',
        url: OPENAPI_URL,
        ok: true,
        detail: `línea base actualizada: ${hash}`,
      };
    }
    const recorded = existsSync(BASELINE) ? readFileSync(BASELINE, 'utf8') : '';
    const comparison = compareBaseline({ sha256: hash, url: OPENAPI_URL }, recorded);
    return { name: 'openapi.json (hash)', url: OPENAPI_URL, ...comparison };
  } catch (err) {
    return { name: 'openapi.json (hash)', url: OPENAPI_URL, ok: false, detail: message(err) };
  }
}

const paralelo = new ParaleloBoProvider(http, systemClock);
const dolarapi = new DolarApiBoProvider(http);
const checks: Check[] = [
  await endpoint(
    'paralelo.bo /api/v1/rate',
    `${PARALELO_BO_BASE_URL}/api/v1/rate`,
    PARALELO_RATE_CONTRACT,
    () => paralelo.fetchLatest(),
  ),
  await endpoint(
    'paralelo.bo /api/v1/historical.json',
    `${PARALELO_BO_BASE_URL}/api/v1/historical.json`,
    PARALELO_HISTORY_CONTRACT,
    () => paralelo.fetchHistory(),
  ),
  await endpoint(
    'bo.dolarapi.com /v1/dolares',
    `${DOLARAPI_BO_BASE_URL}/v1/dolares`,
    DOLARAPI_DOLARES_CONTRACT,
    () => dolarapi.fetchLatest(),
  ),
  await openapiHash(),
];

const failed = checks.filter((c) => !c.ok);
const report = { generatedAt: systemClock.now().toString(), ok: failed.length === 0, checks };
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'fx-smoke.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(
  join(outDir, 'fx-smoke.md'),
  [
    '# fx:smoke-live — providers de tasas en vivo',
    '',
    `Resultado: **${report.ok ? 'OK' : `FALLA (${failed.length})`}** · ${report.generatedAt}`,
    '',
    '| Chequeo | Estado | Detalle |',
    '|---|---|---|',
    ...checks.map((c) => `| ${c.name} | ${c.ok ? 'OK' : 'FALLA'} | ${c.detail.replaceAll('|', '\\|')} |`),
    '',
    'Una falla no bloquea el pipeline: revisar el adapter (`packages/contexts/fx/src/infrastructure/providers/`) y',
    'los fixtures grabados; si el cambio de `openapi.json` es inocuo, regrabar con `pnpm fx:smoke-live -- --update-baseline`.',
    '',
  ].join('\n'),
  'utf8',
);
for (const c of checks) console.log(`${c.ok ? 'OK   ' : 'FALLA'} ${c.name}: ${c.detail}`);
process.exitCode = failed.length === 0 ? 0 : 1;
