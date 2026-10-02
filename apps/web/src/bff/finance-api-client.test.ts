import { describe, expect, it } from 'vitest';
import { FinanceApiError, createFinanceApiClient, uuidv7 } from './finance-api-client';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** `fetch` falso con una cola de respuestas (o errores de red). */
function fakeFetch(script: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body as string | undefined,
    });
    const next = script.shift();
    if (!next) throw new Error('sin respuesta programada');
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetch: impl as typeof fetch };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const noDelay = async () => undefined;
const expense = { kind: 'EXPENSE', amount: { amount: '75.00', currency: 'BOB' } };

describe('cliente BFF → finance-api (Idempotency-Key, ETag/If-Match)', () => {
  it('[TC-PLATFORM-API-009] un reintento de red reenvía la MISMA Idempotency-Key (UUIDv7) del intento del usuario', async () => {
    const { calls, fetch } = fakeFetch([
      new TypeError('fetch failed'),
      json(409, { code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS' }, { 'retry-after': '1' }),
      json(201, { id: 'tx-1', version: 1 }, { etag: '"1"', 'idempotent-replayed': 'true' }),
    ]);
    const client = createFinanceApiClient({ baseUrl: 'http://api', fetch, delay: noDelay });
    const result = await client.command('POST', '/api/v1/workspaces/w1/transactions', expense);
    expect(result).toMatchObject({ status: 201, etag: '"1"', replayed: true, data: { id: 'tx-1' } });
    expect(calls).toHaveLength(3);
    const keys = calls.map((c) => c.headers['idempotency-key']);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(calls.every((c) => c.body === JSON.stringify(expense))).toBe(true);
  });

  it('[TC-TRANSACTIONS-IDEMPOTENCY-001] cada intento del usuario genera una clave nueva; un 503 se reintenta con la misma', async () => {
    const { calls, fetch } = fakeFetch([
      json(503, { code: 'SERVICE_UNAVAILABLE' }, { 'retry-after': '1' }),
      json(201, { id: 'tx-1' }),
      json(201, { id: 'tx-2' }),
    ]);
    const client = createFinanceApiClient({ baseUrl: 'http://api', fetch, delay: noDelay });
    await client.command('POST', '/api/v1/workspaces/w1/transactions', expense);
    await client.command('POST', '/api/v1/workspaces/w1/transactions', expense);
    const [first, retry, secondAttempt] = calls.map((c) => c.headers['idempotency-key']);
    expect(retry).toBe(first);
    expect(secondAttempt).not.toBe(first);
  });

  it('[TC-PLATFORM-API-008] los errores definitivos no se reintentan y exponen el problem con su code', async () => {
    const { calls, fetch } = fakeFetch([json(422, { code: 'IDEMPOTENCY_KEY_REUSED', requestId: 'r-1' })]);
    const client = createFinanceApiClient({ baseUrl: 'http://api', fetch, delay: noDelay });
    const err = await client.command('POST', '/x', expense).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FinanceApiError);
    expect((err as FinanceApiError).problem.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(calls).toHaveLength(1);
  });

  it('agota los reintentos técnicos y propaga el último error', async () => {
    const { calls, fetch } = fakeFetch([new TypeError('a'), new TypeError('b'), new TypeError('c')]);
    const client = createFinanceApiClient({ baseUrl: 'http://api', fetch, delay: noDelay, maxRetries: 2 });
    await expect(client.command('POST', '/x', expense)).rejects.toThrow('c');
    expect(calls).toHaveLength(3);
  });

  it('[TC-PLATFORM-API-014] propaga If-Match con el ETag de la versión editada y expone el nuevo ETag; 412 trae currentVersion', async () => {
    const { calls, fetch } = fakeFetch([
      json(200, { id: 'w1', version: 3 }, { etag: '"3"' }),
      new Response(null, { status: 304, headers: { etag: '"3"' } }),
      json(200, { id: 'w1', version: 4 }, { etag: '"4"' }),
      json(412, { code: 'PRECONDITION_FAILED', currentVersion: 4 }),
    ]);
    const client = createFinanceApiClient({
      baseUrl: 'http://api',
      fetch,
      delay: noDelay,
      headers: () => ({ authorization: 'Bearer t' }),
    });
    const read = await client.get<{ version: number }>('/api/v1/workspaces/w1');
    const cached = await client.get('/api/v1/workspaces/w1', { etag: read.etag ?? '' });
    expect(cached).toMatchObject({ status: 304, data: undefined, etag: '"3"' });
    expect(calls[1]?.headers['if-none-match']).toBe('"3"');
    const updated = await client.command(
      'PATCH',
      '/api/v1/workspaces/w1',
      { name: 'Hogar' },
      { ifMatch: read.etag ?? '' },
    );
    expect(updated.etag).toBe('"4"');
    expect(calls[2]?.headers).toMatchObject({
      'if-match': '"3"',
      'content-type': 'application/merge-patch+json',
      authorization: 'Bearer t',
    });
    expect(calls[2]?.headers['idempotency-key']).toBeUndefined();
    const stale = await client
      .command('PATCH', '/api/v1/workspaces/w1', { name: 'X' }, { ifMatch: 3 })
      .catch((e: unknown) => e);
    expect((stale as FinanceApiError).problem).toMatchObject({
      code: 'PRECONDITION_FAILED',
      currentVersion: 4,
    });
    expect(calls[3]?.headers['if-match']).toBe('"3"');
  });

  it('uuidv7 codifica el instante en los primeros 48 bits y es ordenable', () => {
    const a = uuidv7(Date.parse('2026-10-02T12:00:00Z'));
    const b = uuidv7(Date.parse('2026-10-02T12:00:01Z'));
    expect(a < b).toBe(true);
    expect(parseInt(a.replaceAll('-', '').slice(0, 12), 16)).toBe(Date.parse('2026-10-02T12:00:00Z'));
  });
});
