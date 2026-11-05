import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { runWithCorrelation } from '@pf/platform/logging';
import { dec, FixedClock, Instant } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { PostingLineDto } from '../../src/contracts/index.js';
import { createLedgerRuntime, type LedgerRuntime } from '../../src/interface/ledger.module.js';
import { PgOutboxWriter, EventSchemaRegistry } from '@pf/platform/events';

// AccountSetFlowQuery en PostgreSQL real (openspec add-financial-reports, tarea 4.1): el flujo de un CONJUNTO de cuentas
// por clase de contrapartida (INV-004), con transferencias internas fuera, conversión entre monedas, paginación por
// cursor con totales de toda la celda y aislamiento por workspace (RLS).
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
let uow: PgUnitOfWork;
let u1: string;
const w1 = randomUUID();
const w2 = randomUUID();
const banco = randomUUID();
const efectivo = randomUUID();
const plazo = randomUUID();
const deuda = randomUUID();
const wallet = randomUUID();
const bancoW2 = randomUUID();

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithCorrelation({ correlationId: C1, requestId: C1 }, () =>
    runWithRequestContext({ actor: { type: 'USER', userId: u1 }, origin: 'api' }, fn),
  );
const user = (
  accountId: string,
  amount: string,
  ccy = 'BOB',
  nature: 'ASSET' | 'LIABILITY' = 'ASSET',
): PostingLineDto => ({
  target: { kind: 'USER_ACCOUNT', accountId, nature },
  amount: { amount, currency: ccy },
});
const sys = (
  systemKind: 'INCOME' | 'EXPENSE' | 'OPENING_BALANCE' | 'FX_TRADING',
  amount: string,
  ccy = 'BOB',
): PostingLineDto => ({
  target: { kind: 'SYSTEM', systemKind },
  amount: { amount, currency: ccy },
  splitId: systemKind === 'INCOME' || systemKind === 'EXPENSE' ? randomUUID() : null,
});
const post = (workspaceId: string, date: string, postings: PostingLineDto[]) =>
  asUser(() =>
    ledger.posting.postJournalEntry({
      workspaceId,
      entryDate: date,
      entryType: 'STANDARD',
      sourceRef: { type: 'Transaction', id: randomUUID(), revision: 1 },
      postings,
    }),
  );
const inWs = <T>(workspaceId: string, fn: () => Promise<T>) => uow.run({ userId: u1, workspaceId }, fn);
const SET = [banco, efectivo];
const range = { dateFrom: '2026-10-01', dateTo: '2026-10-31' } as const;

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/ledger', $1, $2, 'U1') AS id`,
    [`sub-set-${randomUUID()}`, `set-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  for (const id of [w1, w2]) {
    await uow.run({ userId: u1, workspaceId: id }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Set', 'BOB', 'America/La_Paz', 'es-BO')`,
        [id],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [id, u1],
      );
    });
  }
  ledger = createLedgerRuntime({
    pool: app,
    clock: new FixedClock(Instant.parse('2026-11-15T16:00:00Z')),
    audit: { append: async () => undefined },
    outbox: new PgOutboxWriter(
      EventSchemaRegistry.fromDirectory(
        fileURLToPath(new URL('../../../../../contracts/events/', import.meta.url)),
      ),
    ),
  });
  // Octubre del scenario: sueldo, gasto, pago de deuda, plazo fijo, transferencia interna y conversión USDT → BOB.
  await inWs(w1, async () => {
    await post(w1, '2026-10-05', [user(banco, '12000.00'), sys('INCOME', '-12000.00')]);
    await post(w1, '2026-10-10', [user(banco, '-3500.00'), sys('EXPENSE', '3500.00')]);
    await post(w1, '2026-10-12', [user(banco, '200.00'), sys('EXPENSE', '-200.00')]);
    await post(w1, '2026-10-20', [user(banco, '-500.00'), user(deuda, '500.00', 'BOB', 'LIABILITY')]);
    await post(w1, '2026-10-21', [user(banco, '-1000.00'), user(plazo, '1000.00')]);
    await post(w1, '2026-10-22', [user(banco, '-200.00'), user(efectivo, '200.00')]);
    await post(w1, '2026-10-25', [
      user(wallet, '-100.000000', 'USDT'),
      sys('FX_TRADING', '100.000000', 'USDT'),
      sys('FX_TRADING', '-1190.00'),
      user(banco, '1190.00'),
    ]);
    // Fuera de octubre: no cuenta.
    await post(w1, '2026-09-01', [user(banco, '10000.00'), sys('OPENING_BALANCE', '-10000.00')]);
  });
  await inWs(w2, async () => {
    await post(w2, '2026-10-05', [user(bancoW2, '777.00'), sys('INCOME', '-777.00')]);
  });
}, 120_000);

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

const key = (r: { currency: string; counterpart: string }) => `${r.currency}:${r.counterpart}`;

describe('PgAccountSetFlowQuery', () => {
  it('[TC-REPORTING-REPORTS-008] clasifica el flujo del conjunto por contrapartida y omite la transferencia interna', async () => {
    const rows = await inWs(w1, () =>
      ledger.accountSetFlow.summarize({ workspaceId: w1, accountIds: SET, ...range }),
    );
    const sum = (k: string) =>
      rows
        .filter((r) => key(r) === k)
        .reduce((a, r) => a.plus(r.amount), dec('0'))
        .toFixed(2);
    expect(sum('BOB:INCOME')).toBe('12000.00');
    expect(sum('BOB:EXPENSE')).toBe('-3300.00');
    expect(sum('BOB:OUTSIDE_LIABILITY')).toBe('-500.00');
    expect(sum('BOB:OUTSIDE_ASSET')).toBe('-1000.00');
    // La conversión: las patas de afuera en BOB son FX_TRADING; en USDT el conjunto no tiene patas ⇒ no aparece.
    expect(sum('BOB:FX_TRADING')).toBe('1190.00');
    expect(rows.some((r) => r.currency === 'USDT')).toBe(false);
    // La transferencia banco → efectivo (ambas del conjunto) no genera ninguna fila.
    expect(rows.filter((r) => r.businessDate === '2026-10-22')).toEqual([]);
    // El saldo inicial de septiembre queda fuera del rango.
    expect(rows.some((r) => r.counterpart === 'OPENING_BALANCE')).toBe(false);
  });

  it('[TC-REPORTING-REPORTS-008] incluir la wallet en el conjunto reparte la conversión en BOB 1190.00 y USDT −100.000000', async () => {
    const rows = await inWs(w1, () =>
      ledger.accountSetFlow.summarize({ workspaceId: w1, accountIds: [banco, efectivo, wallet], ...range }),
    );
    const fx = rows
      .filter((r) => r.counterpart === 'FX_TRADING')
      .map((r) => `${r.currency} ${r.amount}`)
      .sort();
    expect(fx).toEqual(['BOB 1190.00', 'USDT -100.000000']);
  });

  it('[TC-REPORTING-REPORTS-020] listMovements pagina por cursor sin repetidos y entrega los totales de toda la celda', async () => {
    const first = await inWs(w1, () =>
      ledger.accountSetFlow.listMovements({ workspaceId: w1, accountIds: SET, ...range, limit: 2 }),
    );
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const seen = new Set(first.rows.map((r) => `${r.journalEntryId}|${r.currency}|${r.counterpart}`));
    let cursor = first.nextCursor;
    let guard = 0;
    while (cursor && guard < 10) {
      guard += 1;
      const page = await inWs(w1, () =>
        ledger.accountSetFlow.listMovements({
          workspaceId: w1,
          accountIds: SET,
          ...range,
          limit: 2,
          cursor: cursor as string,
        }),
      );
      for (const r of page.rows) {
        const k = `${r.journalEntryId}|${r.currency}|${r.counterpart}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
      expect(page.totals).toEqual(first.totals);
      cursor = page.nextCursor;
    }
    expect(seen.size).toBe(first.count);
    expect(first.totals.find((t) => t.currency === 'BOB')?.amount).toBe('8390.00');
    const debt = await inWs(w1, () =>
      ledger.accountSetFlow.listMovements({
        workspaceId: w1,
        accountIds: SET,
        ...range,
        counterparts: ['OUTSIDE_LIABILITY'],
        limit: 50,
      }),
    );
    expect(debt.rows.map((r) => r.amount)).toEqual(['-500.00']);
    expect(debt.rows[0]?.transactionId).toEqual(expect.any(String));
    expect(debt.rows[0]?.accountIds).toEqual([banco]);
  });

  it('[TC-REPORTING-REPORTS-025] otro workspace no ve los movimientos de W1 (RLS) y un conjunto vacío no devuelve filas', async () => {
    const other = await inWs(w2, () =>
      ledger.accountSetFlow.summarize({ workspaceId: w2, accountIds: SET, ...range }),
    );
    expect(other).toEqual([]);
    const own = await inWs(w2, () =>
      ledger.accountSetFlow.summarize({ workspaceId: w2, accountIds: [bancoW2], ...range }),
    );
    expect(own.map((r) => r.amount)).toEqual(['777.00']);
    expect(
      await inWs(w1, () => ledger.accountSetFlow.summarize({ workspaceId: w1, accountIds: [], ...range })),
    ).toEqual([]);
  });
});
