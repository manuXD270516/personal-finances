import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { createWorkerRuntime, type WorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import {
  apiConfig,
  baseEnv,
  capturingLogger,
  waitFor,
  workerConfig,
  type LogRecord,
} from '../support/harness.js';

const deps = inject('deps');
const TOKEN = 'token-ficticio-de-prueba';
const SESSION = 'cookie-de-sesion-ficticia';

describe('logs estructurados y correlacionados API → worker (platform/observability)', () => {
  const apiLogs = capturingLogger('finance-api', 'api', 'debug');
  const workerLogs = capturingLogger('finance-worker', 'worker', 'debug');
  let api: ApiRuntime;
  let worker: WorkerRuntime;
  let baseUrl: string;

  beforeAll(async () => {
    const env = baseEnv(deps, { LOG_LEVEL: 'debug' });
    worker = await createWorkerRuntime(workerConfig(env), workerLogs.logger);
    api = await createApiRuntime(apiConfig(env), apiLogs.logger);
    baseUrl = await api.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await api?.close();
    await worker?.close();
  });

  async function ping(headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}/internal/platform/ping`, { method: 'POST', headers });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; correlationId: string };
    return { body, requestId: res.headers.get('x-request-id') };
  }

  const processed = (jobId: string) =>
    workerLogs.records().find((r) => r['msg'] === 'platform ping processed' && r['job.id'] === jobId);

  it('[TC-PLATFORM-OBS-002] las líneas de la API y del worker de una misma petición comparten el correlation_id', async () => {
    const requestId = '0191f0c2-0000-7000-8000-000000000001';
    const { body, requestId: echoed } = await ping({ 'X-Request-Id': requestId });
    expect(echoed).toBe(requestId);
    expect(body.correlationId).toBe(requestId);

    const workerLine = await waitFor(() => processed(body.jobId));
    expect(workerLine['correlation_id']).toBe(requestId);

    const apiLines = apiLogs.records().filter((r) => r['correlation_id'] === requestId);
    expect(apiLines.map((r) => r['msg'])).toEqual(
      expect.arrayContaining(['platform ping requested', 'job enqueued', 'request completed']),
    );
    const workerLines = workerLogs.records().filter((r) => r['job.id'] === body.jobId);
    expect(workerLines.map((r) => r['msg'])).toEqual(
      expect.arrayContaining(['job started', 'platform ping processed', 'job completed']),
    );
    for (const line of workerLines) expect(line['correlation_id']).toBe(requestId);
  });

  it('[TC-PLATFORM-OBS-002] sin header entrante la API genera un id y lo propaga igualmente al worker', async () => {
    const { body, requestId } = await ping();
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(body.correlationId).toBe(requestId);
    const workerLine = await waitFor(() => processed(body.jobId));
    expect(workerLine['correlation_id']).toBe(requestId);
  });

  it('[TC-PLATFORM-OBS-002] cada línea es JSON con time, level, service, entorno y rol', () => {
    const all: LogRecord[] = [...apiLogs.records(), ...workerLogs.records()];
    expect(all.length).toBeGreaterThan(5);
    for (const r of all) {
      expect(typeof r['time']).toBe('string');
      expect(typeof r['level']).toBe('string');
      expect(['finance-api', 'finance-worker']).toContain(r['service.name']);
      expect(r['deployment.environment']).toBe('ci');
      expect(['api', 'worker']).toContain(r['process.role']);
    }
  });

  it('[TC-PLATFORM-OBS-003] el log de una petición con Authorization y cookies no contiene sus valores', async () => {
    const before = apiLogs.lines.length;
    const res = await fetch(`${baseUrl}/health/ready`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Cookie: `pf_session=${SESSION}` },
    });
    expect(res.status).toBe(200);
    const { body } = await ping({ Authorization: `Bearer ${TOKEN}`, Cookie: `pf_session=${SESSION}` });
    await waitFor(() => processed(body.jobId));

    const newApiLines = apiLogs.lines.slice(before);
    // Las peticiones sí quedaron registradas (también /health/ready, en debug)…
    expect(newApiLines.some((l) => l.includes('"http.route":"/health/ready"'))).toBe(true);
    expect(newApiLines.some((l) => l.includes('"http.route":"/internal/platform/ping"'))).toBe(true);
    // …pero ningún valor sensible aparece en la salida de ningún proceso.
    const everything = [...apiLogs.lines, ...workerLogs.lines].join('\n');
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(SESSION);
  });
});
