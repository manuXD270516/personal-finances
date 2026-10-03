import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AuditPort } from '@pf/audit/contracts';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { EventSchemaRegistry, PgOutboxWriter } from '@pf/platform/events';
import { runWithCorrelation } from '@pf/platform/logging';
import { currency, DomainError, FixedClock, Instant } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { PostingLineDto, PostJournalEntryCommand } from '../../src/contracts/index.js';
import { PgLedgerUnitOfWork } from '../../src/infrastructure/pg-ledger.js';
import { createLedgerRuntime, type LedgerRuntime } from '../../src/interface/ledger.module.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const C1 = '0190a000-0000-7000-8000-0000000000c1';

let app: Pool;
let migrator: Pool;
let ledger: LedgerRuntime;
let u1: string;
const w1 = randomUUID();
const w2 = randomUUID();
const bankA = randomUUID();
const bankAW2 = randomUUID();
const S1 = randomUUID();

async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

async function domainCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

/** Transacción directa como `pf_app` con contexto RLS LOCAL (rollback salvo `commit`). */
async function inCtx<T>(
  pool: Pool,
  workspaceId: string | null,
  fn: (c: PoolClient) => Promise<T>,
  commit = false,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      u1 ?? '',
      workspaceId ?? '',
    ]);
    const result = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithCorrelation({ correlationId: C1, requestId: C1 }, () =>
    runWithRequestContext({ actor: { type: 'USER', userId: u1 }, origin: 'api' }, fn),
  );

const userLine = (accountId: string, amount: string, ccy = 'BOB'): PostingLineDto => ({
  target: { kind: 'USER_ACCOUNT', accountId, nature: 'ASSET' },
  amount: { amount, currency: ccy },
});
const sysLine = (
  systemKind: 'INCOME' | 'EXPENSE' | 'OPENING_BALANCE' | 'FX_TRADING' | 'ADJUSTMENTS',
  amount: string,
  ccy = 'BOB',
  splitId: string | null = null,
): PostingLineDto => ({ target: { kind: 'SYSTEM', systemKind }, amount: { amount, currency: ccy }, splitId });

const post = (workspaceId: string, postings: PostingLineDto[], over: Partial<PostJournalEntryCommand> = {}) =>
  asUser(() =>
    ledger.posting.postJournalEntry({
      workspaceId,
      entryDate: '2026-03-10',
      entryType: 'STANDARD',
      sourceRef: { type: 'Transaction', id: randomUUID(), revision: 1 },
      postings,
      ...over,
    }),
  );

const balance = async (workspaceId: string, accountId: string, asOf?: string) => {
  const { ledgerAccountId } = await asUser(() =>
    ledger.posting.ledgerAccountForUserAccount({ workspaceId, accountId, nature: 'ASSET', currency: 'BOB' }),
  );
  const b = await asUser(() =>
    ledger.balances.getBalance({ workspaceId, ledgerAccountId, ...(asOf ? { asOf } : {}) }),
  );
  return b.balance.amount;
};

async function createWorkspace(id: string): Promise<void> {
  await inCtx(
    app,
    id,
    async (c) => {
      await c.query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Ledger', 'BOB', 'America/La_Paz', 'es-BO')`,
        [id],
      );
      await c.query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [id, u1],
      );
    },
    true,
  );
}

/** Inserta como pf_app un asiento con los postings dados contra cuentas existentes (escritura directa). */
async function rawEntry(
  c: PoolClient,
  workspaceId: string,
  date: string,
  lines: { account: string; type: string; amount: string; split?: string }[],
): Promise<string> {
  const entryId = randomUUID();
  await c.query(
    `INSERT INTO ledger.journal_entry (id, workspace_id, entry_date, entry_type, source_type, source_id, source_revision)
     VALUES ($1, $2, $3, 'STANDARD', 'Transaction', $4, 1)`,
    [entryId, workspaceId, date, randomUUID()],
  );
  let n = 0;
  for (const l of lines) {
    n += 1;
    await c.query(
      `INSERT INTO ledger.posting (id, workspace_id, journal_entry_id, entry_date, line_no, ledger_account_id, account_type, currency, amount, split_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'BOB', $8, $9)`,
      [randomUUID(), workspaceId, entryId, date, n, l.account, l.type, l.amount, l.split ?? null],
    );
  }
  return entryId;
}

let ledgerBankA: string;
let ledgerExpense: string;

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  const clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));
  // AuditPort que escribe en audit.audit_log con la conexión de la unidad de trabajo en curso: verifica la
  // atomicidad ledger + auditoría sin depender de las capas internas de @pf/audit (regla no-cross-context-internals).
  const audit: AuditPort = {
    append: async (e) => {
      await requireSqlExecutor().query(
        `INSERT INTO audit.audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, action, aggregate_type,
           aggregate_id, reason, origin, correlation_id) VALUES ($1, now(), $2, 'USER', $3, $4, $5, $6, $7, 'api', $8)`,
        [randomUUID(), e.workspaceId, u1, e.action, e.aggregateType, e.aggregateId, e.reason ?? null, C1],
      );
    },
  };
  const outbox = new PgOutboxWriter(
    EventSchemaRegistry.fromDirectory(
      fileURLToPath(new URL('../../../../../contracts/events/', import.meta.url)),
    ),
  );
  ledger = createLedgerRuntime({ pool: app, clock, audit, outbox });
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/ledger', $1, $2, 'U1') AS id`,
    [`sub-ledger-${randomUUID()}`, `ledger-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  await createWorkspace(w1);
  await createWorkspace(w2);
  await post(w1, [userLine(bankA, '1000.00'), sysLine('OPENING_BALANCE', '-1000.00')], {
    entryType: 'OPENING',
    entryDate: '2026-01-01',
  });
  await post(w2, [userLine(bankAW2, '500.00'), sysLine('OPENING_BALANCE', '-500.00')], {
    entryType: 'OPENING',
  });
  ledgerBankA = (
    await asUser(() =>
      ledger.posting.ledgerAccountForUserAccount({
        workspaceId: w1,
        accountId: bankA,
        nature: 'ASSET',
        currency: 'BOB',
      }),
    )
  ).ledgerAccountId;
  await post(w1, [sysLine('EXPENSE', '1.00', 'BOB', S1), userLine(bankA, '-1.00')], {
    entryDate: '2026-01-02',
  });
  ledgerExpense = await inCtx(app, w1, async (c) =>
    String((await c.query(`SELECT id FROM ledger.ledger_account WHERE code = 'EXPENSE:BOB'`)).rows[0]?.id),
  );
  // Deja Bank A en 1000.00: revierte el gasto de prueba.
  const { rows: e } = await inCtx(app, w1, (c) =>
    c.query(`SELECT id FROM ledger.journal_entry WHERE entry_date = '2026-01-02'`),
  );
  await asUser(() =>
    ledger.posting.reverseJournalEntry({
      workspaceId: w1,
      journalEntryId: e[0].id,
      reverseDate: '2026-01-02',
      reason: 'setup',
    }),
  );
});

afterAll(async () => {
  await Promise.all([app?.end(), migrator?.end()]);
});

describe('Persistencia del ledger con PostgreSQL 18 real (rol pf_app, RLS forzada)', () => {
  it('[TC-LEDGER-MONEY-002] NUMERIC(38,18) ida y vuelta exacta como string (nunca number)', async () => {
    const huge = '12345678901234567890.123456789012345678';
    const eth = randomUUID();
    const res = await post(w1, [userLine(eth, huge, 'ETH'), sysLine('OPENING_BALANCE', `-${huge}`, 'ETH')], {
      entryType: 'OPENING',
    });
    const rows = await inCtx(
      app,
      w1,
      async (c) =>
        (
          await c.query(`SELECT amount FROM ledger.posting WHERE journal_entry_id = $1 ORDER BY line_no`, [
            res.journalEntryId,
          ])
        ).rows,
    );
    expect(rows.map((r) => r.amount)).toEqual([huge, `-${huge}`]);
    expect(typeof rows[0].amount).toBe('string');
    const sum = await inCtx(
      app,
      w1,
      async (c) => (await c.query(`SELECT (0.1::numeric(38,18) + 0.2::numeric(38,18))::text AS s`)).rows[0].s,
    );
    expect(sum).toBe('0.300000000000000000');
    const entries = await asUser(() => ledger.balances.getTrialBalance({ workspaceId: w1 }));
    const ethLine = entries.currencies.find((c) => c.currency === 'ETH')!;
    expect(ethLine.total).toEqual({ amount: '0.000000000000000000', currency: 'ETH' });
    expect(ethLine.lines.find((l) => l.accountId === eth)!.balance.amount).toBe(huge);
  });

  it('[TC-LEDGER-IDEMPOTENCY-001] repetir origen+revisión devuelve el mismo asiento; el saldo refleja -120.00 una vez', async () => {
    const src = { type: 'Transaction' as const, id: randomUUID(), revision: 1 };
    const acc = randomUUID();
    const postings = [sysLine('EXPENSE', '120.00', 'BOB', S1), userLine(acc, '-120.00')];
    const [a, b] = [
      await post(w1, postings, { sourceRef: src }),
      await post(w1, postings, { sourceRef: src }),
    ];
    expect(b).toEqual({ ...a, created: false });
    expect(await balance(w1, acc)).toBe('-120.00');
    const entries = await asUser(() =>
      ledger.balances.getEntriesBySource({ workspaceId: w1, sourceId: src.id }),
    );
    expect(entries).toHaveLength(1);
  });

  it('[TC-LEDGER-CHART-002] la cuenta contable de una cuenta del usuario se obtiene una sola vez, también en concurrencia', async () => {
    const binance = randomUUID();
    const get = () =>
      asUser(() =>
        ledger.posting.ledgerAccountForUserAccount({
          workspaceId: w1,
          accountId: binance,
          nature: 'ASSET',
          currency: 'USDT',
        }),
      );
    const [a, b, c] = await Promise.all([get(), get(), get()]);
    expect(new Set([a.ledgerAccountId, b.ledgerAccountId, c.ledgerAccountId]).size).toBe(1);
    const rows = await inCtx(
      app,
      w1,
      async (cl) =>
        (
          await cl.query(`SELECT type, currency FROM ledger.ledger_account WHERE source_account_id = $1`, [
            binance,
          ])
        ).rows,
    );
    expect(rows).toEqual([{ type: 'ASSET', currency: 'USDT' }]);
  });

  it('[TC-LEDGER-CHART-003] cuentas de sistema por moneda: una sola EXPENSE:USDT y una sola FX_TRADING:BOB bajo concurrencia', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const wallet = randomUUID();
    await post(ws, [sysLine('EXPENSE', '0.100000', 'USDT', S1), userLine(wallet, '-0.100000', 'USDT')]);
    await post(ws, [sysLine('EXPENSE', '2.000000', 'USDT', S1), userLine(wallet, '-2.000000', 'USDT')]);
    const results = await Promise.allSettled([
      post(ws, [sysLine('FX_TRADING', '-10.00'), userLine(randomUUID(), '10.00')]),
      post(ws, [sysLine('FX_TRADING', '-20.00'), userLine(randomUUID(), '20.00')]),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const codes = await inCtx(app, ws, async (c) =>
      (
        await c.query(`SELECT code FROM ledger.ledger_account WHERE system_kind IS NOT NULL ORDER BY code`)
      ).rows.map((r) => r.code),
    );
    expect(codes).toEqual(['EQUITY:FX_TRADING:BOB', 'EXPENSE:USDT']);
  });

  it('[TC-LEDGER-BALANCE-002] la BD rechaza al COMMIT un asiento desbalanceado (PF001) y acepta uno cuadrado línea a línea', async () => {
    const before = await balance(w1, bankA);
    expect(
      await sqlState(() =>
        inCtx(
          app,
          w1,
          async (c) =>
            rawEntry(c, w1, '2026-03-11', [
              { account: ledgerExpense, type: 'EXPENSE', amount: '50.00', split: S1 },
              { account: ledgerBankA, type: 'ASSET', amount: '-49.00' },
            ]),
          true,
        ),
      ),
    ).toBe('PF001');
    expect(await balance(w1, bankA)).toBe(before);
    const ok = await inCtx(
      app,
      w1,
      async (c) =>
        rawEntry(c, w1, '2026-03-11', [
          { account: ledgerExpense, type: 'EXPENSE', amount: '50.00', split: S1 },
          { account: ledgerBankA, type: 'ASSET', amount: '-50.00' },
        ]),
      true,
    );
    expect(ok).toBeTruthy();
    expect([before, await balance(w1, bankA)]).toEqual(['1000.00', '950.00']);
  });

  it('[TC-LEDGER-STRUCTURE-002] la BD rechaza un asiento con un solo posting (PF005 al COMMIT) y un posting en 0 (CHECK)', async () => {
    const count = () =>
      inCtx(app, w1, async (c) =>
        Number((await c.query('SELECT count(*) FROM ledger.journal_entry')).rows[0].count),
      );
    const n = await count();
    expect(
      await sqlState(() =>
        inCtx(
          app,
          w1,
          (c) =>
            rawEntry(c, w1, '2026-03-12', [
              { account: ledgerExpense, type: 'EXPENSE', amount: '150.00', split: S1 },
            ]),
          true,
        ),
      ),
    ).toBe('PF005');
    expect(
      await sqlState(() =>
        inCtx(
          app,
          w1,
          (c) =>
            rawEntry(c, w1, '2026-03-12', [
              { account: ledgerExpense, type: 'EXPENSE', amount: '150.00', split: S1 },
              { account: ledgerBankA, type: 'ASSET', amount: '-150.00' },
              { account: ledgerBankA, type: 'ASSET', amount: '0.00' },
            ]),
          true,
        ),
      ),
    ).toBe('23514');
    expect(
      await sqlState(() =>
        inCtx(
          app,
          w1,
          (c) =>
            rawEntry(c, w1, '2026-03-12', [
              { account: ledgerExpense, type: 'EXPENSE', amount: '15.00' },
              { account: ledgerBankA, type: 'ASSET', amount: '-15.00' },
            ]),
          true,
        ),
      ),
    ).toBe('23514');
    // moneda del posting ≠ moneda de la cuenta (FK compuesta, INV-006)
    expect(
      await sqlState(() =>
        inCtx(
          app,
          w1,
          async (c) => {
            const id = await rawEntry(c, w1, '2026-03-12', [
              { account: ledgerExpense, type: 'EXPENSE', amount: '1.00', split: S1 },
            ]);
            await c.query(
              `INSERT INTO ledger.posting (id, workspace_id, journal_entry_id, entry_date, line_no, ledger_account_id, account_type, currency, amount)
             VALUES ($1, $2, $3, '2026-03-12', 2, $4, 'ASSET', 'USD', -1)`,
              [randomUUID(), w1, id, ledgerBankA],
            );
          },
          true,
        ),
      ),
    ).toBe('23503');
    expect(await count()).toBe(n);
  });

  it('[TC-LEDGER-IMMUTABILITY-001] UPDATE/DELETE/TRUNCATE fallan para pf_app (42501) y para el owner (PF003)', async () => {
    const tables = ['ledger.posting', 'ledger.journal_entry', 'ledger.entry_reversal'];
    for (const t of tables) {
      const col =
        t === 'ledger.entry_reversal'
          ? 'created_at = now()'
          : t === 'ledger.posting'
            ? 'amount = 100'
            : 'memo = $$x$$';
      expect(await sqlState(() => inCtx(app, w1, (c) => c.query(`UPDATE ${t} SET ${col}`))), t).toBe('42501');
      expect(await sqlState(() => inCtx(app, w1, (c) => c.query(`DELETE FROM ${t}`))), t).toBe('42501');
      expect(await sqlState(() => inCtx(app, w1, (c) => c.query(`TRUNCATE ${t} CASCADE`))), t).toBe('42501');
      expect(await sqlState(() => migrator.query(`TRUNCATE ${t} CASCADE`)), t).toBe('PF003');
    }
    // Con RLS forzada el owner no ve filas; la defensa de fila se prueba con una política temporal en una transacción.
    const c = await migrator.connect();
    try {
      await c.query('BEGIN');
      await c.query(`CREATE POLICY tmp_owner ON ledger.posting TO CURRENT_USER USING (true)`);
      expect(
        await sqlState(() => c.query(`UPDATE ledger.posting SET amount = 100 WHERE workspace_id = $1`, [w1])),
      ).toBe('PF003');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    expect(await balance(w1, bankA)).toMatch(/^\d+\.\d{2}$/);
  });

  it('[TC-LEDGER-CHART-001] (BD) naturaleza y moneda de la cuenta contable no son actualizables; archived_at sí', async () => {
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(`UPDATE ledger.ledger_account SET currency = 'USD' WHERE id = $1`, [ledgerBankA]),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() =>
        inCtx(app, w1, (c) =>
          c.query(`UPDATE ledger.ledger_account SET type = 'LIABILITY' WHERE id = $1`, [ledgerBankA]),
        ),
      ),
    ).toBe('42501');
    const archived = await inCtx(
      app,
      w1,
      async (c) =>
        (await c.query(`UPDATE ledger.ledger_account SET archived_at = now() WHERE id = $1`, [ledgerBankA]))
          .rowCount,
    );
    expect(archived).toBe(1);
    const row = await inCtx(
      app,
      w1,
      async (c) =>
        (await c.query(`SELECT type, currency FROM ledger.ledger_account WHERE id = $1`, [ledgerBankA]))
          .rows[0],
    );
    expect(row).toEqual({ type: 'ASSET', currency: 'BOB' });
  });

  it('[TC-LEDGER-PERIOD-002] con agosto bloqueado la inserción directa del 2026-08-31 falla (PF004) y la app ve PERIOD_CLOSED', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    await asUser(() =>
      ledger.periodLock.lockPeriod({ workspaceId: ws, yearMonth: '2026-08', periodId: randomUUID() }),
    );
    await asUser(() => ledger.periodLock.lockPeriod({ workspaceId: ws, yearMonth: '2026-08' }));
    const acc = randomUUID();
    await post(ws, [userLine(acc, '100.00'), sysLine('OPENING_BALANCE', '-100.00')], {
      entryType: 'OPENING',
      entryDate: '2026-07-01',
    });
    const accounts = await inCtx(
      app,
      ws,
      async (c) =>
        (await c.query(`SELECT id, type FROM ledger.ledger_account ORDER BY type`)).rows as {
          id: string;
          type: string;
        }[],
    );
    const assetId = accounts.find((a) => a.type === 'ASSET')!.id;
    const equityId = accounts.find((a) => a.type === 'EQUITY')!.id;
    expect(
      await sqlState(() =>
        inCtx(
          app,
          ws,
          (c) =>
            rawEntry(c, ws, '2026-08-31', [
              { account: assetId, type: 'ASSET', amount: '1.00' },
              { account: equityId, type: 'EQUITY', amount: '-1.00' },
            ]),
          true,
        ),
      ),
    ).toBe('PF004');
    expect(
      await domainCode(
        post(ws, [sysLine('EXPENSE', '45.00', 'BOB', S1), userLine(acc, '-45.00')], {
          entryDate: '2026-08-15',
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    // Barrera de BD mapeada por la unidad de trabajo del ledger (PF004 → PERIOD_CLOSED)
    const uow = new PgLedgerUnitOfWork(app);
    const err = await asUser(() =>
      uow
        .run(ws, () =>
          rawEntry(requireSqlExecutor() as unknown as PoolClient, ws, '2026-08-01', [
            { account: assetId, type: 'ASSET', amount: '1.00' },
            { account: equityId, type: 'EQUITY', amount: '-1.00' },
          ]),
        )
        .catch((e: unknown) => e),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect([(err as DomainError).code, ((err as DomainError).cause as { code: string }).code]).toEqual([
      'PERIOD_CLOSED',
      'PF004',
    ]);
    await post(ws, [sysLine('EXPENSE', '45.00', 'BOB', S1), userLine(acc, '-45.00')], {
      entryDate: '2026-09-01',
    });
    expect(await balance(ws, acc)).toBe('55.00');
  });

  it('[TC-LEDGER-REVERSAL-002] dos reversas concurrentes: exactamente una se registra; la otra LEDGER_ENTRY_ALREADY_REVERSED', async () => {
    const acc = randomUUID();
    const e2 = await post(w1, [sysLine('EXPENSE', '45.00', 'BOB', S1), userLine(acc, '-45.00')]);
    const reverse = () =>
      asUser(() =>
        ledger.posting.reverseJournalEntry({
          workspaceId: w1,
          journalEntryId: e2.journalEntryId,
          reverseDate: '2026-03-20',
          reason: 'dup',
        }),
      );
    const results = await Promise.allSettled([reverse(), reverse(), reverse()]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected.map((r) => (r.reason as DomainError).code)).toEqual([
      'LEDGER_ENTRY_ALREADY_REVERSED',
      'LEDGER_ENTRY_ALREADY_REVERSED',
    ]);
    expect(await balance(w1, acc)).toBe('0.00');
    const reversal = (ok[0] as PromiseFulfilledResult<{ journalEntryId: string }>).value.journalEntryId;
    expect(
      await domainCode(
        asUser(() =>
          ledger.posting.reverseJournalEntry({
            workspaceId: w1,
            journalEntryId: reversal,
            reverseDate: '2026-03-21',
            reason: 'x',
          }),
        ),
      ),
    ).toBe('LEDGER_ENTRY_NOT_REVERSIBLE');
  });

  it('[TC-LEDGER-ISOLATION-001] cuenta contable de otro workspace → REFERENCE_NOT_FOUND; sin contexto falla con PF002', async () => {
    const ledgerBankAW2 = await inCtx(app, w2, async (c) =>
      String(
        (await c.query(`SELECT id FROM ledger.ledger_account WHERE source_account_id = $1`, [bankAW2]))
          .rows[0].id,
      ),
    );
    const count = (ws: string) =>
      inCtx(app, ws, async (c) =>
        Number((await c.query('SELECT count(*) FROM ledger.posting')).rows[0].count),
      );
    const [n1, n2] = [await count(w1), await count(w2)];
    expect(
      await domainCode(
        post(w1, [
          sysLine('EXPENSE', '10.00', 'BOB', S1),
          {
            target: { kind: 'LEDGER_ACCOUNT', ledgerAccountId: ledgerBankAW2 },
            amount: { amount: '-10.00', currency: 'BOB' },
          },
        ]),
      ),
    ).toBe('REFERENCE_NOT_FOUND');
    expect([await count(w1), await count(w2)]).toEqual([n1, n2]);
    for (const t of [
      'ledger.posting',
      'ledger.journal_entry',
      'ledger.ledger_account',
      'ledger.entry_reversal',
      'ledger.period_lock',
      'ledger.balance_snapshot',
    ]) {
      expect(await sqlState(() => inCtx(app, null, (c) => c.query(`SELECT * FROM ${t}`))), t).toBe('PF002');
    }
    const seen = await inCtx(app, w1, async (c) =>
      (await c.query(`SELECT DISTINCT workspace_id FROM ledger.posting`)).rows.map((r) => r.workspace_id),
    );
    expect(seen).toEqual([w1]);
    // Inserción directa cruzada: la FK compuesta / RLS lo impiden
    expect(
      await sqlState(() =>
        inCtx(
          app,
          w1,
          (c) =>
            rawEntry(c, w1, '2026-03-12', [
              { account: ledgerExpense, type: 'EXPENSE', amount: '10.00', split: S1 },
              { account: ledgerBankAW2, type: 'ASSET', amount: '-10.00' },
            ]),
          true,
        ),
      ),
    ).toBe('23503');
  });

  it('[TC-LEDGER-BALANCES-003] saldos agregados por moneda sin mezclar BOB y USDT', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const [a, b, usdt] = [randomUUID(), randomUUID(), randomUUID()];
    await post(ws, [userLine(a, '595.50'), sysLine('OPENING_BALANCE', '-595.50')], { entryType: 'OPENING' });
    await post(ws, [userLine(b, '200.00'), sysLine('OPENING_BALANCE', '-200.00')], { entryType: 'OPENING' });
    await post(ws, [userLine(usdt, '99.900000', 'USDT'), sysLine('OPENING_BALANCE', '-99.900000', 'USDT')], {
      entryType: 'OPENING',
    });
    const totals = await asUser(() => ledger.balances.getBalances({ workspaceId: ws }));
    expect([...totals].sort((x, y) => x.currency.localeCompare(y.currency))).toEqual([
      { amount: '795.50', currency: 'BOB' },
      { amount: '99.900000', currency: 'USDT' },
    ]);
    const trial = await asUser(() => ledger.balances.getTrialBalance({ workspaceId: ws }));
    expect(trial.currencies.map((c) => c.total.amount)).toEqual(['0.00', '0.000000']);
  });

  it('[TC-LEDGER-BALANCES-002] (parcial) saldo a una fecha incluye solo asientos hasta esa fecha, también retroactivos', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const acc = randomUUID();
    await post(ws, [userLine(acc, '1000.00'), sysLine('OPENING_BALANCE', '-1000.00')], {
      entryType: 'OPENING',
      entryDate: '2026-01-01',
    });
    await post(ws, [sysLine('EXPENSE', '150.00', 'BOB', S1), userLine(acc, '-150.00')], {
      entryDate: '2026-01-15',
    });
    await post(ws, [sysLine('EXPENSE', '300.00', 'BOB', S1), userLine(acc, '-300.00')], {
      entryDate: '2026-02-10',
    });
    expect([
      await balance(ws, acc, '2026-01-01'),
      await balance(ws, acc, '2026-01-31'),
      await balance(ws, acc, '2026-02-28'),
    ]).toEqual(['1000.00', '850.00', '550.00']);
    await post(ws, [sysLine('EXPENSE', '20.00', 'BOB', S1), userLine(acc, '-20.00')], {
      entryDate: '2026-01-20',
    });
    expect(await balance(ws, acc, '2026-01-31')).toBe('830.00');
  });

  it('[TC-LEDGER-BALANCES-004] (BD) saldo presentado según la naturaleza: pasivo e ingreso en positivo', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const visa = randomUUID();
    await post(ws, [
      sysLine('EXPENSE', '2000.00', 'BOB', S1),
      {
        target: { kind: 'USER_ACCOUNT', accountId: visa, nature: 'LIABILITY' },
        amount: { amount: '-2000.00', currency: 'BOB' },
      },
    ]);
    const trial = await asUser(() => ledger.balances.getTrialBalance({ workspaceId: ws }));
    const line = trial.currencies[0]!.lines.find((l) => l.accountId === visa)!;
    expect([line.nature, line.balance.amount, line.presented.amount]).toEqual([
      'LIABILITY',
      '-2000.00',
      '2000.00',
    ]);
  });

  it('[TC-LEDGER-EVENT-001] (integración) smoke 8.2: postear y revertir 120.00 BOB deja 1000.00, publica 2 eventos y audita', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const acc = randomUUID();
    await post(ws, [userLine(acc, '1000.00'), sysLine('OPENING_BALANCE', '-1000.00')], {
      entryType: 'OPENING',
    });
    const e = await post(ws, [sysLine('EXPENSE', '120.00', 'BOB', S1), userLine(acc, '-120.00')]);
    expect(await balance(ws, acc)).toBe('880.00');
    const r = await asUser(() =>
      ledger.posting.reverseJournalEntry({
        workspaceId: ws,
        journalEntryId: e.journalEntryId,
        reverseDate: '2026-03-10',
        reason: 'error',
      }),
    );
    expect(await balance(ws, acc)).toBe('1000.00');
    const events = await (async () => {
      const w = new Pool({ connectionString: deps.workerDatabaseUrl, max: 1 });
      try {
        return (
          await w.query(
            `SELECT aggregate_id, envelope->'payload'->>'entryType' AS t, envelope->>'correlationId' AS corr FROM platform.outbox
              WHERE workspace_id = $1 AND event_type = 'ledger.JournalEntryPosted' ORDER BY sequence`,
            [ws],
          )
        ).rows;
      } finally {
        await w.end();
      }
    })();
    expect(events.map((x) => x.t)).toEqual(['OPENING', 'STANDARD', 'REVERSAL']);
    expect(events.map((x) => x.aggregate_id).slice(1)).toEqual([e.journalEntryId, r.journalEntryId]);
    expect(events.every((x) => x.corr === C1)).toBe(true);
    const audits = await inCtx(app, ws, async (c) =>
      (
        await c.query(`SELECT action FROM audit.audit_log WHERE workspace_id = $1 ORDER BY occurred_at, id`, [
          ws,
        ])
      ).rows.map((x) => x.action),
    );
    expect(audits.filter((a) => a === 'ledger.journal_entry.posted')).toHaveLength(2);
    expect(audits).toContain('ledger.journal_entry.reversed');
    // Asiento rechazado: ni evento ni auditoría
    const before = events.length;
    expect(
      await domainCode(post(ws, [sysLine('EXPENSE', '50.00', 'BOB', S1), userLine(acc, '-49.00')])),
    ).toBe('LEDGER_UNBALANCED_ENTRY');
    const after = await inCtx(app, ws, async (c) =>
      Number((await c.query(`SELECT count(*) FROM ledger.journal_entry`)).rows[0].count),
    );
    expect(after).toBe(3);
    expect(before).toBe(3);
  });

  it('mapeo de SQLSTATE: PF001 → LEDGER_UNBALANCED_ENTRY y 42501 → INTERNAL_ERROR conservando la causa', async () => {
    const uow = new PgLedgerUnitOfWork(app);
    const run = (fn: () => Promise<unknown>) => asUser(() => uow.run(w1, fn).catch((e: unknown) => e));
    const unbalanced = await run(() =>
      rawEntry(requireSqlExecutor() as unknown as PoolClient, w1, '2026-03-13', [
        { account: ledgerExpense, type: 'EXPENSE', amount: '50.00', split: S1 },
        { account: ledgerBankA, type: 'ASSET', amount: '-49.00' },
      ]),
    );
    expect([
      (unbalanced as DomainError).code,
      ((unbalanced as DomainError).cause as { code: string }).code,
    ]).toEqual(['LEDGER_UNBALANCED_ENTRY', 'PF001']);
    const tooFew = await run(() =>
      rawEntry(requireSqlExecutor() as unknown as PoolClient, w1, '2026-03-13', [
        { account: ledgerExpense, type: 'EXPENSE', amount: '5.00', split: S1 },
      ]),
    );
    expect((tooFew as DomainError).code).toBe('LEDGER_ENTRY_TOO_FEW_POSTINGS');
    const denied = await run(() => requireSqlExecutor().query('DELETE FROM ledger.posting'));
    expect([(denied as DomainError).code, ((denied as DomainError).cause as { code: string }).code]).toEqual([
      'INTERNAL_ERROR',
      '42501',
    ]);
    expect(currency('BOB', 2).code).toBe('BOB');
    expect(PgUnitOfWork).toBeDefined();
  });
});
