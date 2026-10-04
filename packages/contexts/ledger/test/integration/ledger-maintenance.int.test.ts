import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AuditPort } from '@pf/audit/contracts';
import { requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { EventSchemaRegistry, PgOutboxWriter } from '@pf/platform/events';
import { runWithCorrelation } from '@pf/platform/logging';
import { FixedClock, Instant, Money, currency } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { PostingLineDto, PostJournalEntryCommand } from '../../src/contracts/index.js';
import {
  createLedgerMaintenance,
  createLedgerRuntime,
  LEDGER_INVARIANT_VIOLATIONS_METRIC,
  type LedgerMaintenance,
  type LedgerRuntime,
} from '../../src/interface/ledger.module.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const C1 = '0190a000-0000-7000-8000-0000000000c1';
const S1 = randomUUID();

let app: Pool;
let worker: Pool;
let migrator: Pool;
let u1: string;
// 2026-02-01T02:30:00Z = 2026-01-31 22:30 en La Paz (TC-LEDGER-BALANCES-002, tercer punto).
const clock = new FixedClock(Instant.parse('2026-02-01T02:30:00Z'));
let ledger: LedgerRuntime;
let maintenance: LedgerMaintenance;
const counters: { name: string; labels: Record<string, string>; value: number }[] = [];
const errors: Record<string, unknown>[] = [];

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithCorrelation({ correlationId: C1, requestId: C1 }, () =>
    runWithRequestContext({ actor: { type: 'USER', userId: u1 }, origin: 'api' }, fn),
  );

const userLine = (accountId: string, amount: string): PostingLineDto => ({
  target: { kind: 'USER_ACCOUNT', accountId, nature: 'ASSET' },
  amount: { amount, currency: 'BOB' },
});
const sysLine = (systemKind: 'EXPENSE' | 'OPENING_BALANCE' | 'INCOME', amount: string): PostingLineDto => ({
  target: { kind: 'SYSTEM', systemKind },
  amount: { amount, currency: 'BOB' },
  splitId: systemKind === 'OPENING_BALANCE' ? null : S1,
});

const post = (
  workspaceId: string,
  entryDate: string,
  postings: PostingLineDto[],
  over: Partial<PostJournalEntryCommand> = {},
) =>
  asUser(() =>
    ledger.posting.postJournalEntry({
      workspaceId,
      entryDate,
      entryType: 'STANDARD',
      sourceRef: { type: 'Transaction', id: randomUUID(), revision: 1 },
      postings,
      ...over,
    }),
  );

const ledgerAccount = async (workspaceId: string, accountId: string) =>
  (
    await asUser(() =>
      ledger.posting.ledgerAccountForUserAccount({
        workspaceId,
        accountId,
        nature: 'ASSET',
        currency: 'BOB',
      }),
    )
  ).ledgerAccountId;

const balance = async (workspaceId: string, accountId: string, asOf?: string) => {
  const ledgerAccountId = await ledgerAccount(workspaceId, accountId);
  const b = await asUser(() =>
    ledger.balances.getBalance({ workspaceId, ledgerAccountId, ...(asOf ? { asOf } : {}) }),
  );
  return b.balance.amount;
};

/** Σ postings directa (sin snapshots) como pf_app con contexto RLS. */
async function sumPostings(workspaceId: string, ledgerAccountId: string, asOf: string): Promise<string> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      u1,
      workspaceId,
    ]);
    const { rows } = await c.query<{ s: string }>(
      `SELECT round(COALESCE(SUM(amount), 0), 2)::text AS s FROM ledger.posting
        WHERE ledger_account_id = $1 AND entry_date <= $2`,
      [ledgerAccountId, asOf],
    );
    await c.query('ROLLBACK');
    return rows[0]!.s;
  } finally {
    c.release();
  }
}

/** Snapshots de un workspace leídos con el rol de mantenimiento (sin `computed_at`, que cambia por corrida). */
async function snapshots(workspaceId: string) {
  return asMaintenance(async (c) => {
    const { rows } = await c.query<{
      account: string;
      as_of: string;
      balance: string;
      last_sequence: string;
    }>(
      `SELECT ledger_account_id AS account, as_of_date::text AS as_of, round(balance, 2)::text AS balance,
              last_sequence::text AS last_sequence
         FROM ledger.balance_snapshot WHERE workspace_id = $1 ORDER BY ledger_account_id, as_of_date`,
      [workspaceId],
    );
    return rows;
  });
}

async function asMaintenance<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await worker.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE pf_ledger_maintenance');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function createWorkspace(id: string): Promise<void> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      u1,
      id,
    ]);
    await c.query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Ledger', 'BOB', 'America/La_Paz', 'es-BO')`,
      [id],
    );
    await c.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [id, u1],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
}

/** Bank A con +1000.00 (01-01), -150.00 (01-31) y -300.00 (02-01). */
async function seedBankA(ws: string, bank: string): Promise<void> {
  await post(ws, '2026-01-01', [userLine(bank, '1000.00'), sysLine('OPENING_BALANCE', '-1000.00')], {
    entryType: 'OPENING',
  });
  await post(ws, '2026-01-31', [sysLine('EXPENSE', '150.00'), userLine(bank, '-150.00')]);
  await post(ws, '2026-02-01', [sysLine('EXPENSE', '300.00'), userLine(bank, '-300.00')]);
}

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
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
  const logger = {
    info: () => undefined,
    error: (fields: Record<string, unknown>) => {
      errors.push(fields);
    },
  } as unknown as Parameters<typeof createLedgerMaintenance>[0]['logger'];
  maintenance = createLedgerMaintenance({
    pool: worker,
    clock,
    logger,
    metrics: {
      increment: (name, labels, value = 1) => counters.push({ name, labels: { ...labels }, value }),
    },
  });
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/ledger', $1, $2, 'U1') AS id`,
    [`sub-ledger-m-${randomUUID()}`, `ledger-m-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
});

afterAll(async () => {
  await Promise.all([app?.end(), worker?.end(), migrator?.end()]);
});

const violationsFor = <V extends { workspaceId: string }>(ws: string, all: readonly V[]): V[] =>
  all.filter((v) => v.workspaceId === ws);

describe('Snapshots de saldo y verificador de invariantes (PostgreSQL 18, pf_worker → pf_ledger_maintenance)', () => {
  it('[TC-LEDGER-BALANCES-001] saldo = Σ postings = snapshot; borrar y reconstruir da el mismo snapshot', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const bank = randomUUID();
    await post(ws, '2026-01-02', [userLine(bank, '1000.00'), sysLine('OPENING_BALANCE', '-1000.00')], {
      entryType: 'OPENING',
    });
    await post(ws, '2026-01-05', [sysLine('EXPENSE', '150.00'), userLine(bank, '-150.00')]);
    await post(ws, '2026-01-10', [sysLine('INCOME', '-45.50'), userLine(bank, '45.50')]);
    await post(ws, '2026-01-20', [sysLine('EXPENSE', '300.00'), userLine(bank, '-300.00')]);
    const ledgerBank = await ledgerAccount(ws, bank);
    expect(await balance(ws, bank, '2026-01-31')).toBe('595.50');

    await maintenance.rebuildBalanceSnapshots({ workspaceId: ws, asOfDate: '2026-01-31' });
    const before = await snapshots(ws);
    expect(before.find((s) => s.account === ledgerBank)?.balance).toBe('595.50');
    await asMaintenance((c) => c.query(`DELETE FROM ledger.balance_snapshot WHERE workspace_id = $1`, [ws]));
    expect(await snapshots(ws)).toEqual([]);
    await maintenance.rebuildBalanceSnapshots({ workspaceId: ws, asOfDate: '2026-01-31' });
    expect(await snapshots(ws)).toEqual(before);
    // Lectura con snapshot = lectura por Σ postings.
    expect(await balance(ws, bank, '2026-01-31')).toBe('595.50');
    expect(await sumPostings(ws, ledgerBank, '2026-01-31')).toBe('595.50');
  });

  it('[TC-LEDGER-BALANCES-002] saldo a una fecha, retroactivo y saldo actual por defecto en la zona del workspace', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const bank = randomUUID();
    await seedBankA(ws, bank);
    expect([
      await balance(ws, bank, '2026-01-30'),
      await balance(ws, bank, '2026-01-31'),
      await balance(ws, bank, '2026-02-01'),
    ]).toEqual(['1000.00', '850.00', '550.00']);
    // Reloj 2026-02-01T02:30Z = 2026-01-31 22:30 en America/La_Paz → saldo actual al 2026-01-31.
    expect(await balance(ws, bank)).toBe('850.00');
    await post(ws, '2026-01-15', [sysLine('EXPENSE', '20.00'), userLine(bank, '-20.00')]);
    expect(await balance(ws, bank, '2026-01-31')).toBe('830.00');
  });

  it('[TC-LEDGER-SNAPSHOT-001] un asiento retroactivo invalida el snapshot; la lectura no espera al job y reconstruir es determinista', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const bank = randomUUID();
    await seedBankA(ws, bank);
    const ledgerBank = await ledgerAccount(ws, bank);
    await maintenance.rebuildBalanceSnapshots({ workspaceId: ws, asOfDate: '2026-01-31' });
    expect((await snapshots(ws)).find((s) => s.account === ledgerBank)?.balance).toBe('850.00');

    await post(ws, '2026-01-15', [sysLine('EXPENSE', '20.00'), userLine(bank, '-20.00')]);
    // Antes de reconstruir: el snapshot (850.00) queda invalidado por `sequence > last_sequence`.
    expect(await balance(ws, bank, '2026-01-31')).toBe('830.00');
    expect(await balance(ws, bank, '2026-02-01')).toBe('530.00');
    // El verificador no lo trata como corrupción (invalidación pendiente, no divergencia).
    expect(violationsFor(ws, (await maintenance.verifyLedgerIntegrity()).violations)).toEqual([]);

    await asMaintenance((c) => c.query(`DELETE FROM ledger.balance_snapshot WHERE workspace_id = $1`, [ws]));
    await maintenance.rebuildBalanceSnapshots({ workspaceId: ws, asOfDate: '2026-01-31' });
    const first = await snapshots(ws);
    expect(first.find((s) => s.account === ledgerBank)?.balance).toBe('830.00');
    expect(await sumPostings(ws, ledgerBank, '2026-01-31')).toBe('830.00');
    await maintenance.rebuildBalanceSnapshots({ workspaceId: ws, asOfDate: '2026-01-31' });
    expect(await snapshots(ws)).toEqual(first);
    expect(await balance(ws, bank, '2026-01-31')).toBe('830.00');
  });

  it('[TC-LEDGER-SNAPSHOT-001] (lote) saldos de todas las cuentas: snapshots de distinto checkpoint, el más reciente invalidado cae al anterior válido; solo cuentas del usuario', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const bankA = randomUUID();
    const bankB = randomUUID();
    await seedBankA(ws, bankA);
    await post(ws, '2026-01-01', [userLine(bankB, '500.00'), sysLine('OPENING_BALANCE', '-500.00')], {
      entryType: 'OPENING',
    });
    const ledgerA = await ledgerAccount(ws, bankA);
    const ledgerB = await ledgerAccount(ws, bankB);
    await maintenance.rebuildBalanceSnapshots({ workspaceId: ws, asOfDate: '2026-01-31' });
    // Snapshot anterior de A (2026-01-15, 1000.00) con el mismo checkpoint que el del 2026-01-31.
    await asMaintenance(async (c) => {
      const { rows } = await c.query<{ m: string }>(
        `SELECT last_sequence::text AS m FROM ledger.balance_snapshot
          WHERE workspace_id = $1 AND ledger_account_id = $2`,
        [ws, ledgerA],
      );
      await c.query(
        `INSERT INTO ledger.balance_snapshot (workspace_id, ledger_account_id, as_of_date, currency, balance, last_sequence)
         VALUES ($1, $2, '2026-01-15', 'BOB', 1000.00, $3)`,
        [ws, ledgerA, rows[0]!.m],
      );
    });
    // Retroactivo en A (2026-01-20): invalida su snapshot del 01-31 pero no el del 01-15.
    await post(ws, '2026-01-20', [sysLine('EXPENSE', '20.00'), userLine(bankA, '-20.00')]);
    // B se reconstruye después (checkpoint mayor que el de A) y luego recibe un retroactivo (2026-01-10).
    await maintenance.rebuildBalanceSnapshots({
      workspaceId: ws,
      ledgerAccountId: ledgerB,
      asOfDate: '2026-01-31',
    });
    await post(ws, '2026-01-10', [sysLine('EXPENSE', '75.25'), userLine(bankB, '-75.25')]);

    const all = await asUser(() =>
      ledger.accountBalances.getAccountBalances({ workspaceId: ws, asOf: '2026-01-31' }),
    );
    expect(
      all.balances.map((b) => [b.accountId, b.ledgerAccountId, b.nature, b.balance.amount]).sort(),
    ).toEqual(
      [
        [bankA, ledgerA, 'ASSET', '830.00'],
        [bankB, ledgerB, 'ASSET', '424.75'],
      ].sort(),
    );
    expect(await sumPostings(ws, ledgerA, '2026-01-31')).toBe('830.00');
    expect(await sumPostings(ws, ledgerB, '2026-01-31')).toBe('424.75');
    expect(await balance(ws, bankA, '2026-01-31')).toBe('830.00');
    expect(await balance(ws, bankA, '2026-01-16')).toBe('1000.00');
    expect(await balance(ws, bankA, '2026-02-01')).toBe('530.00');

    // Filtro por cuentas del usuario y saldo actual por defecto (2026-01-31 en La Paz).
    const onlyA = await asUser(() =>
      ledger.accountBalances.getAccountBalances({ workspaceId: ws, accountIds: [bankA] }),
    );
    expect(onlyA.balances.map((b) => [b.accountId, b.balance.amount])).toEqual([[bankA, '830.00']]);
    expect(onlyA.asOf).toBe('2026-01-31');
    // El balance de comprobación sigue viendo las cuentas de sistema (Σ por moneda = 0).
    const trial = await asUser(() =>
      ledger.balances.getTrialBalance({ workspaceId: ws, asOf: '2026-01-31' }),
    );
    expect(trial.currencies.map((c) => [c.currency, c.total.amount, c.lines.length])).toEqual([
      ['BOB', '0.00', 4],
    ]);
  });

  it('[TC-LEDGER-INTEGRITY-001] el verificador detecta un snapshot divergente: log error con workspaceId y métrica', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const bank = randomUUID();
    await post(ws, '2026-01-02', [userLine(bank, '1000.00'), sysLine('OPENING_BALANCE', '-1000.00')], {
      entryType: 'OPENING',
    });
    await post(ws, '2026-01-05', [sysLine('EXPENSE', '404.50'), userLine(bank, '-404.50')]);
    const ledgerBank = await ledgerAccount(ws, bank);
    await maintenance.rebuildBalanceSnapshots({ workspaceId: ws, asOfDate: '2026-01-31' });

    counters.length = 0;
    errors.length = 0;
    const clean = await maintenance.verifyLedgerIntegrity();
    expect(violationsFor(ws, clean.violations)).toEqual([]);
    expect(errors.filter((e) => e['workspaceId'] === ws)).toEqual([]);

    // Corrupción de caché simulada con el rol de mantenimiento: 600.00 en lugar de 595.50.
    await asMaintenance(async (c) => {
      await c.query(
        `DELETE FROM ledger.balance_snapshot WHERE workspace_id = $1 AND ledger_account_id = $2`,
        [ws, ledgerBank],
      );
      const { rows } = await c.query<{ m: string }>(
        `SELECT COALESCE(max(sequence), 0)::text AS m FROM ledger.journal_entry WHERE workspace_id = $1`,
        [ws],
      );
      await c.query(
        `INSERT INTO ledger.balance_snapshot (workspace_id, ledger_account_id, as_of_date, currency, balance, last_sequence)
         VALUES ($1, $2, '2026-01-31', 'BOB', 600.00, $3)`,
        [ws, ledgerBank, rows[0]!.m],
      );
    });
    counters.length = 0;
    errors.length = 0;
    const dirty = violationsFor(ws, (await maintenance.verifyLedgerIntegrity()).violations);
    expect(dirty).toEqual([
      {
        invariant: 'INV-022',
        workspaceId: ws,
        ledgerAccountId: ledgerBank,
        asOfDate: '2026-01-31',
        currency: 'BOB',
        difference: '4.50',
        detail: 'balance snapshot differs from the sum of postings',
      },
    ]);
    expect(Money.parse(dirty[0]!.difference!, currency('BOB', 2)).toFixed()).toBe('4.50');
    expect(
      counters.some(
        (c) => c.name === LEDGER_INVARIANT_VIOLATIONS_METRIC && c.labels['invariant'] === 'INV-022',
      ),
    ).toBe(true);
    expect(errors.some((e) => e['workspaceId'] === ws && e['alert'] === 'ledger.invariant_violation')).toBe(
      true,
    );
    // La lectura con snapshot corrupto daría 600.00: la reconstrucción repara la caché.
    await maintenance.rebuildBalanceSnapshots({ workspaceId: ws, asOfDate: '2026-01-31' });
    expect(violationsFor(ws, (await maintenance.verifyLedgerIntegrity()).violations)).toEqual([]);
    expect(await balance(ws, bank, '2026-01-31')).toBe('595.50');
  });

  it('[TC-LEDGER-BALANCES-005] el saldo contable ignora pendientes: sin asiento para el pendiente; el proyectado va aparte', async () => {
    const ws = randomUUID();
    await createWorkspace(ws);
    const bank = randomUUID();
    await post(ws, '2026-01-02', [userLine(bank, '1000.00'), sysLine('OPENING_BALANCE', '-1000.00')], {
      entryType: 'OPENING',
    });
    // Transacción PENDIENTE de 200.00 BOB: Transactions no la postea (FR-LEDGER-013), solo aporta pendingAmount.
    const pendingTransactionId = randomUUID();
    const pendingAmount = Money.parse('200.00', currency('BOB', 2));
    const accounting = await balance(ws, bank);
    expect(accounting).toBe('1000.00');
    expect(
      await asUser(() =>
        ledger.balances.getEntriesBySource({ workspaceId: ws, sourceId: pendingTransactionId }),
      ),
    ).toEqual([]);
    // El proyectado lo arma el consumidor (Accounts) como valor separado: contable − pendientes.
    const projected = Money.parse(accounting, currency('BOB', 2)).subtract(pendingAmount);
    expect([accounting, projected.toFixed()]).toEqual(['1000.00', '800.00']);
  });

  it('el job usa por defecto el día anterior (UTC) y recorre todos los workspaces con postings', async () => {
    const result = await maintenance.rebuildBalanceSnapshots();
    expect(result.asOfDate).toBe('2026-01-31');
    expect(result.workspaces).toBeGreaterThanOrEqual(1);
  });
});
