import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, DomainError, Instant } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ExchangeRate } from '../../src/domain/index.js';
import {
  PgCurrencyRepository,
  PgExchangeRateRepository,
  PgRatePreferenceRepository,
} from '../../src/infrastructure/pg-fx.js';

// FX sobre PostgreSQL real (add-manual-conversions tarea 2.4): historial append-only (INV-011), reemplazo de un solo
// nivel (índice único parcial + trigger de consistencia), RLS WS+G, preferencias con versión y monedas habilitadas.
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const USDT = currency('USDT', 6);
const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
let app: Pool;
let migrator: Pool;
let uow: PgUnitOfWork;
let u1: string;
let u2: string;
const w1 = randomUUID();
const w2 = randomUUID();
const rates = new PgExchangeRateRepository();
const currencies = new PgCurrencyRepository();
const preferences = new PgRatePreferenceRepository();
const inWs = <T>(ws: string, user: string, fn: () => Promise<T>) =>
  uow.run({ userId: user, workspaceId: ws }, fn);

async function pgError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

const rate = (ws: string, value: string, over: Partial<Parameters<typeof ExchangeRate.record>[0]> = {}) =>
  ExchangeRate.record({
    id: randomUUID(),
    workspaceId: ws,
    base: USDT,
    quote: BOB,
    value,
    rateType: 'P2P',
    sourceLabel: 'Mediana Binance P2P',
    asOf: '2026-09-29T19:00:00Z',
    effectiveDate: '2026-09-29',
    createdAt: '2026-09-29T19:05:00.000Z',
    createdBy: null,
    ...over,
  });

async function provision(label: string, ws: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/fx', $1, $2, $3) AS id`,
    [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID()}@demo.pfos.test`, label],
  );
  const user = rows[0]!.id;
  await inWs(ws, user, async () => {
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, $2, 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws, label],
    );
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [ws, user],
    );
  });
  return user;
}

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  u1 = await provision('fx-w1', w1);
  u2 = await provision('fx-w2', w2);
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('PgExchangeRateRepository (fx/market-rates)', () => {
  it('[TC-FX-RATE-001] round-trip exacto: "6.95" y 18 decimales sin pérdida, con instante y fecha efectiva', async () => {
    const r = rate(w1, '6.95');
    const precise = rate(w1, '6.965432109876543210', { base: USD, rateType: 'PARALLEL' });
    await inWs(w1, u1, async () => {
      await rates.insert(r);
      await rates.insert(precise);
    });
    const read = await inWs(w1, u1, () => rates.findById(w1, r.id));
    expect([read?.rate.valueText, read?.rate.snapshot.asOf, read?.rate.snapshot.effectiveDate]).toEqual([
      '6.95',
      '2026-09-29T19:00:00.000Z',
      '2026-09-29',
    ]);
    expect(read?.supersededById).toBeNull();
    const p = await inWs(w1, u1, () => rates.findById(w1, precise.id));
    expect(p?.rate.rate.toPersisted()).toBe('6.965432109876543210');
  });

  it('[TC-FX-HISTORICAL-001] append-only: UPDATE y DELETE se rechazan por privilegio y la tasa conserva su valor', async () => {
    const r = rate(w1, '6.95');
    await inWs(w1, u1, () => rates.insert(r));
    for (const sql of [
      `UPDATE fx.exchange_rate SET rate = 7.00 WHERE id = $1`,
      `DELETE FROM fx.exchange_rate WHERE id = $1`,
    ]) {
      expect(await pgError(inWs(w1, u1, () => requireSqlExecutor().query(sql, [r.id]))), sql).toBe('42501');
    }
    expect((await inWs(w1, u1, () => rates.findById(w1, r.id)))?.rate.valueText).toBe('6.95');
  });

  it('[TC-FX-HISTORICAL-002] un reemplazo por versión (índice único parcial) y conservando par/tipo/vigencia (trigger)', async () => {
    const r1 = rate(w1, '9.65');
    await inWs(w1, u1, () => rates.insert(r1));
    const r2 = r1.supersede(
      {
        id: randomUUID(),
        value: '6.95',
        reason: 'error de tipeo',
        createdAt: '2026-09-30T12:00:00.000Z',
        createdBy: u1,
      },
      null,
    );
    await inWs(w1, u1, () => rates.insert(r2));
    const old = await inWs(w1, u1, () => rates.findById(w1, r1.id));
    expect([old?.rate.valueText, old?.supersededById]).toEqual(['9.65', r2.id]);
    // Carrera: otra versión que reemplaza la misma R1 ⇒ FX_RATE_ALREADY_SUPERSEDED (no un 500).
    const race = r1.supersede(
      {
        id: randomUUID(),
        value: '6.94',
        reason: 'otra corrección',
        createdAt: '2026-09-30T12:01:00.000Z',
        createdBy: u1,
      },
      null,
    );
    let code: string | undefined;
    try {
      await inWs(w1, u1, () => rates.insert(race));
    } catch (err) {
      code = err instanceof DomainError ? err.code : (err as { code?: string }).code;
    }
    expect(code).toBe('FX_RATE_ALREADY_SUPERSEDED');
    // Segunda barrera: una versión que cambia la vigencia del par se rechaza en BD.
    expect(
      await pgError(
        inWs(w1, u1, () =>
          requireSqlExecutor().query(
            `INSERT INTO fx.exchange_rate (id, workspace_id, base_currency, quote_currency, rate, rate_type, as_of,
                                          as_of_date, source, supersedes_id, supersede_reason)
             VALUES ($1, $2, 'USDT', 'BOB', 6.95, 'P2P', '2026-10-01T00:00:00Z', '2026-09-30', 'MANUAL', $3, 'xyz')`,
            [randomUUID(), w1, r2.id],
          ),
        ),
      ),
    ).toBe('23514');
    // Resolución: R1 reemplazada no es candidata vigente.
    const candidates = await inWs(w1, u1, () =>
      rates.candidates(
        w1,
        ['USDT', 'BOB'],
        Instant.parse('2026-09-22T00:00:00Z'),
        Instant.parse('2026-10-01T00:00:00Z'),
      ),
    );
    expect(candidates.find((c) => c.state.id === r1.id)?.supersededById).toBe(r2.id);
    expect(candidates.find((c) => c.state.id === r2.id)?.supersededById).toBeNull();
  });

  it('aislamiento por workspace (RLS WS+G): W2 no ve ni inserta tasas de W1', async () => {
    const r = rate(w1, '6.95');
    await inWs(w1, u1, () => rates.insert(r));
    expect(await inWs(w2, u2, () => rates.findById(w2, r.id))).toBeNull();
    const listed = await inWs(w2, u2, () =>
      rates.list(w2, { includeSuperseded: true }, { offset: 0, limit: 100 }),
    );
    expect(listed.every((x) => x.rate.snapshot.workspaceId === w2)).toBe(true);
    expect(await pgError(inWs(w1, u1, () => rates.insert(rate(w2, '6.95'))))).toBe('42501');
  });
});

describe('Preferencias y monedas del workspace', () => {
  it('[TC-FX-RATE-004] las preferencias se reemplazan completas con optimistic locking; un par tiene una sola preferencia', async () => {
    expect(await inWs(w1, u1, () => preferences.get(w1))).toEqual({ preferences: [], version: 1 });
    expect(
      await inWs(w1, u1, () =>
        preferences.replace(w1, [{ base: 'USD', quote: 'BOB', rateType: 'OFFICIAL' }], 1),
      ),
    ).toBe(true);
    expect(await inWs(w1, u1, () => preferences.replace(w1, [], 1))).toBe(false);
    expect(
      await inWs(w1, u1, () =>
        preferences.replace(w1, [{ base: 'BOB', quote: 'USD', rateType: 'PARALLEL' }], 2),
      ),
    ).toBe(true);
    expect(await inWs(w1, u1, () => preferences.get(w1))).toEqual({
      preferences: [{ base: 'BOB', quote: 'USD', rateType: 'PARALLEL' }],
      version: 3,
    });
    expect(
      await pgError(
        inWs(w1, u1, () =>
          preferences.replace(
            w1,
            [
              { base: 'USDT', quote: 'BOB', rateType: 'P2P' },
              { base: 'BOB', quote: 'USDT', rateType: 'P2P' },
            ],
            3,
          ),
        ),
      ),
    ).toBe('23505');
    expect((await inWs(w2, u2, () => preferences.get(w2))).preferences).toEqual([]);
  });

  it('[TC-FX-CURRENCY-001] catálogo con tipo y escala; habilitar monedas es idempotente y por workspace', async () => {
    const before = await inWs(w2, u2, () => currencies.list(w2, {}));
    expect(
      before
        .filter((c) => c.enabled)
        .map((c) => c.definition.code)
        .sort(),
    ).toEqual(['BOB', 'USD', 'USDT']);
    await inWs(w2, u2, () => currencies.enable(w2, ['BOB', 'BTC']));
    await inWs(w2, u2, () => currencies.enable(w2, ['BOB']));
    const after = await inWs(w2, u2, () => currencies.list(w2, { kind: 'CRYPTO' }));
    expect(after.map((c) => [c.definition.code, c.definition.scale, c.enabled])).toEqual([
      ['BTC', 8, true],
      ['ETH', 18, false],
      ['TRX', 6, false],
      ['USDC', 6, false],
      ['USDT', 6, false],
    ]);
    expect((await inWs(w2, u2, () => currencies.find('ETH')))?.scale).toBe(18);
    expect(await inWs(w2, u2, () => currencies.find('XYZ'))).toBeNull();
  });
});
