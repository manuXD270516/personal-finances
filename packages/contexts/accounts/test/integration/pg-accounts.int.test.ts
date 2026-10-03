import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { DomainError } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Account, Institution } from '../../src/domain/index.js';
import {
  PgAccountRepository,
  PgInstitutionRepository,
  pgCurrencyCatalog,
} from '../../src/infrastructure/pg-accounts.js';

// Repositorios Kysely de ACCOUNTS contra PostgreSQL real (Testcontainers postgres:18 + `migrate` real): RLS por
// workspace, únicos parciales → ACCOUNT_NAME_TAKEN/NAME_TAKEN, optimistic locking y sin DELETE (tareas 2.3, 5.1, 5.2).
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
let app: Pool;
let migrator: Pool;
let uow: PgUnitOfWork;
let u1: string;
const w1 = randomUUID();
const w2 = randomUUID();
const accounts = new PgAccountRepository();
const institutions = new PgInstitutionRepository();

const inWs = <T>(workspaceId: string, fn: () => Promise<T>) => uow.run({ userId: u1, workspaceId }, fn);

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    return (err as { code?: string }).code;
  }
  return undefined;
}

const newAccount = (
  workspaceId: string,
  name: string,
  over: Partial<Parameters<typeof Account.open>[0]> = {},
) =>
  Account.open({
    id: randomUUID(),
    workspaceId,
    name,
    type: 'BANK',
    currency: 'BOB',
    currencyKind: 'FIAT',
    openedOn: '2026-01-01',
    displayOrder: 0,
    ...over,
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/accounts', $1, $2, 'U1') AS id`,
    [`sub-accounts-${randomUUID()}`, `accounts-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await uow.run({ userId: u1, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Accounts', 'BOB', 'America/La_Paz', 'es-BO')`,
        [ws],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, u1],
      );
    });
  }
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('PgAccountRepository', () => {
  it('[TC-ACCOUNTS-NAME-001] único parcial por nombre (case-insensitive) entre no archivadas y por workspace', async () => {
    await inWs(w1, () => accounts.insert(newAccount(w1, 'Bank A')));
    expect(await code(inWs(w1, () => accounts.insert(newAccount(w1, 'bank a'))))).toBe('ACCOUNT_NAME_TAKEN');
    const old = newAccount(w1, 'Old Bank');
    await inWs(w1, () => accounts.insert(old));
    const loaded = (await inWs(w1, () => accounts.findById(w1, old.id)))!;
    loaded.archive('2026-03-15T14:00:00Z', null);
    expect(await inWs(w1, () => accounts.update(loaded))).toBe(true);
    await inWs(w1, () => accounts.insert(newAccount(w1, 'Old Bank')));
    await inWs(w2, () => accounts.insert(newAccount(w2, 'Bank A')));
    // RLS: W2 no ve las cuentas de W1.
    expect(await inWs(w2, () => accounts.findById(w2, old.id))).toBeNull();
    expect(
      (await inWs(w2, () => accounts.list(w2, { statuses: ['ACTIVE', 'CLOSED', 'ARCHIVED'] }))).length,
    ).toBe(1);
  });

  it('[TC-ACCOUNTS-CURRENCY-002] optimistic locking por version y round-trip de todos los campos', async () => {
    const a = newAccount(w1, 'Bank Lock', { accountNumberLast4: '6789', tagIds: [randomUUID()], notes: 'n' });
    await inWs(w1, () => accounts.insert(a));
    const first = (await inWs(w1, () => accounts.findById(w1, a.id)))!;
    const second = (await inWs(w1, () => accounts.findById(w1, a.id)))!;
    expect(first.snapshot).toMatchObject({
      accountNumberLast4: '6789',
      openedOn: '2026-01-01',
      tagIds: a.snapshot.tagIds,
      version: 1,
    });
    first.update({ currency: 'USD' }, { hasPostings: false, currencyKind: 'FIAT' });
    second.update({ name: 'Bank Lock 2' }, { hasPostings: false });
    expect(await inWs(w1, () => accounts.update(first))).toBe(true);
    expect(await inWs(w1, () => accounts.update(second))).toBe(false);
    const after = (await inWs(w1, () => accounts.findById(w1, a.id)))!;
    expect(after.snapshot).toMatchObject({ currency: 'USD', name: 'Bank Lock', version: 2 });
  });

  it('[TC-ACCOUNTS-NODELETE-001] pf_app no puede borrar cuentas ni instituciones', async () => {
    const a = newAccount(w1, 'Bank Del');
    await inWs(w1, () => accounts.insert(a));
    expect(
      await code(
        inWs(w1, () => requireSqlExecutor().query('DELETE FROM accounts.account WHERE id = $1', [a.id])),
      ),
    ).toBe('42501');
    expect(await code(inWs(w1, () => requireSqlExecutor().query('DELETE FROM accounts.institution')))).toBe(
      '42501',
    );
  });

  it('[TC-ACCOUNTS-ARCHIVE-002] elegibilidad con FOR SHARE: estado, moneda y naturaleza', async () => {
    const card = newAccount(w1, 'Card Elig', { type: 'CREDIT_CARD' });
    await inWs(w1, () => accounts.insert(card));
    const locked = await inWs(w1, () => accounts.lockForPosting(w1, [card.id, randomUUID(), 'not-a-uuid']));
    expect(locked.map((x) => [x.id, x.nature, x.status, x.currency])).toEqual([
      [card.id, 'LIABILITY', 'ACTIVE', 'BOB'],
    ]);
  });
});

describe('PgInstitutionRepository', () => {
  it('[TC-ACCOUNTS-INSTITUTION-002] instituciones por workspace, sin filas globales ni datos en migraciones', async () => {
    expect(await inWs(w2, () => institutions.list(w2, { includeArchived: true }))).toEqual([]);
    const demo = Institution.create({
      id: randomUUID(),
      workspaceId: w1,
      name: 'Banco Andino Demo',
      kind: 'BANK',
    });
    await inWs(w1, () => institutions.insert(demo));
    expect(
      await code(
        inWs(w1, () =>
          institutions.insert(
            Institution.create({
              id: randomUUID(),
              workspaceId: w1,
              name: 'BANCO ANDINO DEMO',
              kind: 'BANK',
            }),
          ),
        ),
      ),
    ).toBe('NAME_TAKEN');
    await inWs(w2, () =>
      institutions.insert(
        Institution.create({ id: randomUUID(), workspaceId: w2, name: 'Banco Andino Demo', kind: 'BANK' }),
      ),
    );
    const renamed = (await inWs(w2, () => institutions.list(w2, { includeArchived: false })))[0]!;
    renamed.update({ name: 'Banco Andino' });
    expect(await inWs(w2, () => institutions.update(renamed))).toBe(true);
    expect((await inWs(w1, () => institutions.findById(w1, demo.id)))?.snapshot.name).toBe(
      'Banco Andino Demo',
    );
    const { rows } = await migrator.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM pg_policies WHERE schemaname = $1',
      ['accounts'],
    );
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(3);
    const currency = await inWs(w1, () => pgCurrencyCatalog.find('USDT'));
    expect(currency).toMatchObject({ kind: 'CRYPTO', scale: 6, active: true });
  });
});
