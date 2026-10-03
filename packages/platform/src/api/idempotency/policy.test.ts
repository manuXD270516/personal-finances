import { DomainError, FixedClock, Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ApiProblem, renderProblem, type HttpResponseSnapshot } from '../errors/problem.js';
import { InMemoryIdempotencyStore } from './memory-store.js';
import { IdempotencyPolicy, MIN_RETENTION_MS, isStorableStatus, type IdempotentRequest } from './policy.js';
import { canonicalJson, idempotencyRequestHash } from './request-hash.js';

const W1 = '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d01';
const EDITOR = '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9e01';
const H = 3_600_000;

const expense = (amount: string, key = '0191f0c2-7a1e-7c4e-9a51-3f2d7c1b9e01'): IdempotentRequest => ({
  scope: { workspaceId: W1, userId: EDITOR },
  key,
  method: 'POST',
  route: '/workspaces/{workspaceId}/transactions',
  body: { kind: 'EXPENSE', amount: { amount, currency: 'BOB' }, transactionDate: '2026-03-15' },
});

/** Comando falso que "registra" un gasto y cuenta efectos (transacción, saldo). */
function fakeLedger() {
  const effects: string[] = [];
  let balance = 100_000n; // 1000.00 BOB en centavos
  return {
    effects,
    balance: () => (Number(balance) / 100).toFixed(2),
    command: (amount: string, fail?: () => never) => async (): Promise<HttpResponseSnapshot> => {
      if (fail) fail();
      const id = `tx-${effects.length + 1}`;
      effects.push(id);
      balance -= BigInt(Math.round(Number(amount) * 100));
      return {
        status: 201,
        headers: { location: `/api/v1/workspaces/${W1}/transactions/${id}`, etag: '"1"' },
        body: { id, amount: { amount, currency: 'BOB' }, version: 1 },
      };
    },
  };
}

const render = (err: unknown) => renderProblem(err, { requestId: 'req-1' }).response;

function setup(retentionMs = 24 * H) {
  const store = new InMemoryIdempotencyStore();
  const clock = new FixedClock(Instant.parse('2026-10-01T10:00:00Z'));
  const policy = new IdempotencyPolicy(store, clock, { retentionMs });
  return { store, clock, policy, ledger: fakeLedger() };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof ApiProblem ? err.code : String(err);
  }
  return undefined;
};

describe('IdempotencyPolicy (platform/api-conventions, design §3)', () => {
  it('[TC-TRANSACTIONS-IDEMPOTENCY-001] repetir el POST con la misma clave reproduce la respuesta sin re-ejecutar', async () => {
    const { policy, ledger } = setup();
    const first = await policy.execute(expense('75.00'), ledger.command('75.00'), render);
    const second = await policy.execute(expense('75.00'), ledger.command('75.00'), render);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.response).toEqual(first.response);
    expect(second.response.headers).toEqual({
      location: `/api/v1/workspaces/${W1}/transactions/tx-1`,
      etag: '"1"',
    });
    expect(ledger.effects).toEqual(['tx-1']);
    expect(ledger.balance()).toBe('925.00');
  });

  it('[TC-TRANSACTIONS-IDEMPOTENCY-001] el hash ignora el orden de las claves del JSON (JCS, RFC 8785)', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 1, y: undefined } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"z":1}}',
    );
    expect(idempotencyRequestHash('post', '/r', { a: 1, b: 2 })).toBe(
      idempotencyRequestHash('POST', '/r', { b: 2, a: 1 }),
    );
    expect(idempotencyRequestHash('POST', '/r', { a: 1 })).not.toBe(
      idempotencyRequestHash('POST', '/s', { a: 1 }),
    );
    expect(idempotencyRequestHash('POST', '/r', undefined)).toBe(idempotencyRequestHash('POST', '/r', null));
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
  });

  it('[TC-PLATFORM-API-008] misma clave con otro monto ⇒ 422 IDEMPOTENCY_KEY_REUSED y solo existe el primer gasto', async () => {
    const { policy, ledger } = setup();
    await policy.execute(expense('75.00', 'K-0001-0001-0001'), ledger.command('75.00'), render);
    expect(
      await codeOf(policy.execute(expense('80.00', 'K-0001-0001-0001'), ledger.command('80.00'), render)),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(ledger.effects).toHaveLength(1);
    expect(ledger.balance()).toBe('925.00');
  });

  it('[TC-PLATFORM-API-009] una segunda petición mientras la primera sigue en curso ⇒ 409 IN_PROGRESS con Retry-After', async () => {
    const { policy, ledger } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = policy.execute(
      expense('75.00', 'K-0009-0009-0009'),
      async () => {
        await gate;
        return ledger.command('75.00')();
      },
      render,
    );
    const concurrent = policy.execute(expense('75.00', 'K-0009-0009-0009'), ledger.command('75.00'), render);
    const err = await concurrent.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiProblem);
    expect((err as ApiProblem).code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    expect((err as ApiProblem).headers).toEqual({ 'retry-after': '1' });
    // Un payload distinto con la clave en curso es reutilización, no "en curso".
    expect(
      await codeOf(policy.execute(expense('80.00', 'K-0009-0009-0009'), ledger.command('80.00'), render)),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    release();
    expect((await slow).replayed).toBe(false);
    expect(ledger.effects).toHaveLength(1);
  });

  it('[TC-PLATFORM-API-009] una reserva IN_PROGRESS vencida (proceso caído) se retoma y produce un solo efecto', async () => {
    const { policy, clock, store, ledger } = setup();
    const crashed = await store.reserve({
      scope: { workspaceId: W1, userId: EDITOR },
      key: 'K-0009-0009-0010',
      method: 'POST',
      route: '/workspaces/{workspaceId}/transactions',
      requestHash: idempotencyRequestHash(
        'POST',
        '/workspaces/{workspaceId}/transactions',
        expense('75.00').body,
      ),
      now: clock.now().toDate(),
      lockTtlMs: 30_000,
      retentionMs: 24 * H,
    });
    expect(crashed.outcome).toBe('reserved');
    expect(
      await codeOf(policy.execute(expense('75.00', 'K-0009-0009-0010'), ledger.command('75.00'), render)),
    ).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    clock.advance(31_000);
    const retaken = await policy.execute(
      expense('75.00', 'K-0009-0009-0010'),
      ledger.command('75.00'),
      render,
    );
    expect(retaken.replayed).toBe(false);
    expect(ledger.effects).toHaveLength(1);
    // El dueño original (caído) ya no puede completar sobre la reserva retomada.
    if (crashed.outcome !== 'reserved') throw new Error('unreachable');
    await expect(
      store.complete(crashed.ref, { status: 201, headers: {}, body: {} }, clock.now().toDate()),
    ).rejects.toThrow(/reservation lost/);
  });

  it('[TC-PLATFORM-API-010] un 503 libera la clave: el reintento re-ejecuta y responde 201 sin replay', async () => {
    const { policy, ledger } = setup();
    const dbDown = () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    };
    const failed = await policy
      .execute(expense('75.00', 'K-0002-0002-0002'), ledger.command('75.00', dbDown), render)
      .catch((e: unknown) => e);
    expect(render(failed).status).toBe(503);
    const retry = await policy.execute(expense('75.00', 'K-0002-0002-0002'), ledger.command('75.00'), render);
    expect(retry.replayed).toBe(false);
    expect(retry.response.status).toBe(201);
    expect(ledger.effects).toHaveLength(1);
  });

  it('[TC-PLATFORM-API-010] un 429 o un 500 tampoco se almacenan; un rechazo de dominio 422 sí se reproduce', async () => {
    const { policy, ledger, store } = setup();
    const rateLimited = () => {
      throw new ApiProblem('RATE_LIMITED');
    };
    await policy
      .execute(expense('1.00', 'K-0004-0004-0004'), ledger.command('1.00', rateLimited), render)
      .catch(() => undefined);
    const boom = () => {
      throw new Error('bug');
    };
    await policy
      .execute(expense('1.00', 'K-0005-0005-0005'), ledger.command('1.00', boom), render)
      .catch(() => undefined);
    expect(store.size).toBe(0);

    const scale = () => {
      throw new DomainError('AMOUNT_SCALE_EXCEEDED', 'BOB allows 2 decimals').at('/amount/amount');
    };
    const first = await policy
      .execute(expense('685.005', 'K-0003-0003-0003'), ledger.command('685.005', scale), render)
      .catch((e: unknown) => e);
    expect(render(first).status).toBe(422);
    const replay = await policy.execute(
      expense('685.005', 'K-0003-0003-0003'),
      ledger.command('685.005'),
      render,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.response.status).toBe(422);
    expect((replay.response.body as { code: string }).code).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(ledger.effects).toHaveLength(0);
    expect([200, 201, 404, 409, 422].every(isStorableStatus)).toBe(true);
    expect([429, 500, 503].some(isStorableStatus)).toBe(false);
  });

  it('[TC-PLATFORM-API-011] una clave vencida (25 h con retención de 24 h) se trata como nueva', async () => {
    const { policy, clock, ledger, store } = setup();
    await policy.execute(expense('75.00', 'K-0011-0011-0011'), ledger.command('75.00'), render);
    clock.advance(23 * H);
    expect(
      (await policy.execute(expense('75.00', 'K-0011-0011-0011'), ledger.command('75.00'), render)).replayed,
    ).toBe(true);
    clock.advance(2 * H);
    expect(store.purgeExpired(clock.now().toDate())).toBe(1);
    const again = await policy.execute(expense('75.00', 'K-0011-0011-0011'), ledger.command('75.00'), render);
    expect(again.replayed).toBe(false);
    expect(ledger.effects).toEqual(['tx-1', 'tx-2']);
    // Sin purga, la reserva vencida también se reutiliza como nueva.
    clock.advance(25 * H);
    expect(
      (await policy.execute(expense('75.00', 'K-0011-0011-0011'), ledger.command('75.00'), render)).replayed,
    ).toBe(false);
  });

  it('[TC-PLATFORM-API-011] la retención se acota entre 24 h y 7 días', () => {
    const store = new InMemoryIdempotencyStore();
    const clock = new FixedClock(Instant.parse('2026-10-01T10:00:00Z'));
    expect(() => new IdempotencyPolicy(store, clock, { retentionMs: MIN_RETENTION_MS - 1 })).toThrow(
      RangeError,
    );
    expect(() => new IdempotencyPolicy(store, clock, { retentionMs: 7 * 24 * H + 1 })).toThrow(RangeError);
    expect(() => new IdempotencyPolicy(store, clock, { retentionMs: 7 * 24 * H })).not.toThrow();
  });

  it('[TC-TRANSACTIONS-IDEMPOTENCY-001] las claves están aisladas por ámbito (workspace o usuario)', async () => {
    const { policy, ledger } = setup();
    const req = expense('75.00', 'K-0012-0012-0012');
    await policy.execute(req, ledger.command('75.00'), render);
    const otherWorkspace = {
      ...req,
      scope: { workspaceId: '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d02', userId: EDITOR },
    };
    expect((await policy.execute(otherWorkspace, ledger.command('75.00'), render)).replayed).toBe(false);
    const userScoped = { ...req, scope: { userId: EDITOR } };
    expect((await policy.execute(userScoped, ledger.command('75.00'), render)).replayed).toBe(false);
    expect(ledger.effects).toHaveLength(3);
  });

  it('la política completa dentro del comando cuando éste lo pide (misma transacción)', async () => {
    const { policy, ledger } = setup();
    const out = await policy.execute(
      expense('75.00', 'K-0013-0013-0013'),
      async (ctx) => {
        const response = await ledger.command('75.00')();
        await ctx.complete(response);
        return response;
      },
      render,
    );
    expect(out.replayed).toBe(false);
    expect(
      (await policy.execute(expense('75.00', 'K-0013-0013-0013'), ledger.command('75.00'), render)).replayed,
    ).toBe(true);
  });
});
