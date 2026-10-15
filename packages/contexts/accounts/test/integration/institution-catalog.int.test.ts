import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '@pf/audit/contracts';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { DomainError, FixedClock, Instant } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  AdoptCatalogInstitutions,
  InstitutionCatalogQueries,
} from '../../src/application/institution-catalog.service.js';
import { InstitutionsService } from '../../src/application/institutions.service.js';
import { InMemoryCatalogReader } from '../../src/application/testing/in-memory.js';
import { CatalogRef, Institution, validateCatalog, type InstitutionCatalog } from '../../src/domain/index.js';
import { demoTerms, threeEntryCatalog } from '../../src/domain/institution-catalog.test-support.js';
import {
  PgAccountsUnitOfWork,
  PgInstitutionRepository,
  uuidV7Ids,
} from '../../src/infrastructure/pg-accounts.js';

// Adopción desde el catálogo de referencia sobre PostgreSQL real (add-exchange-house-rate-providers tarea 4.8): el
// vínculo viaja en la fila, el índice único parcial impide dos instituciones activas con la misma entrada, "los tres o
// ninguno", RLS por workspace y la adopción de punta a punta con los repositorios reales. Catálogo FICTICIO.
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
const institutions = new PgInstitutionRepository();
const audits: AuditEntry[] = [];

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

function catalog(): InstitutionCatalog {
  const r = validateCatalog(threeEntryCatalog(), { terms: demoTerms });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.catalog;
}

const adopted = (ws: string, name: string, c: string, version = '2026-09-30') =>
  Institution.create({
    id: randomUUID(),
    workspaceId: ws,
    name,
    kind: 'BANK',
    countryCode: 'BO',
    catalogRef: CatalogRef.of('BO', c, version),
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/accounts-catalog', $1, $2, 'U1') AS id`,
    [`sub-acc-cat-${randomUUID()}`, `acc-cat-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await uow.run({ userId: u1, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Catalog', 'BOB', 'America/La_Paz', 'es-BO')`,
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

describe('Vínculo de la institución con el catálogo sobre PostgreSQL', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-002] el vínculo se guarda y se lee con país, código y versión; renombrar lo conserva', async () => {
    const bad = adopted(w1, 'Banco Andino Demo', 'BAD');
    await inWs(w1, () => institutions.insert(bad));
    const loaded = (await inWs(w1, () => institutions.findById(w1, bad.id)))!;
    expect(loaded.snapshot.catalogRef?.toJSON()).toEqual({ country: 'BO', code: 'BAD', version: '2026-09-30' });
    loaded.update({ name: 'Mi banco' });
    expect(await inWs(w1, () => institutions.update(loaded))).toBe(true);
    const renamed = (await inWs(w1, () => institutions.findById(w1, bad.id)))!;
    expect([renamed.snapshot.name, renamed.snapshot.catalogRef?.code]).toEqual(['Mi banco', 'BAD']);
    // Las instituciones creadas a mano no tienen vínculo.
    const manual = Institution.create({ id: randomUUID(), workspaceId: w1, name: 'Propia', kind: 'BANK' });
    await inWs(w1, () => institutions.insert(manual));
    expect((await inWs(w1, () => institutions.findById(w1, manual.id)))?.snapshot.catalogRef).toBeNull();
  });

  it('[TC-ACCOUNTS-INSTCATALOG-002] el único parcial impide dos instituciones activas con la misma entrada; archivar libera el código; otro workspace puede adoptar la misma', async () => {
    const first = adopted(w1, 'Cooperativa Illimani Demo', 'CID');
    await inWs(w1, () => institutions.insert(first));
    expect(
      await code(inWs(w1, () => institutions.insert(adopted(w1, 'Otro nombre', 'CID')))),
    ).toBe('VALIDATION_FAILED');
    const loaded = (await inWs(w1, () => institutions.findById(w1, first.id)))!;
    loaded.archive('2026-10-15T14:00:00Z');
    expect(await inWs(w1, () => institutions.update(loaded))).toBe(true);
    await inWs(w1, () => institutions.insert(adopted(w1, 'Cooperativa Illimani Demo', 'CID')));
    await inWs(w2, () => institutions.insert(adopted(w2, 'Cooperativa Illimani Demo', 'CID')));
  });

  it('los tres datos del vínculo o ninguno: una fila con vínculo parcial o mal formado la rechaza la base (23514)', async () => {
    const insert = (country: string | null, c: string | null, version: string | null) =>
      inWs(w1, () =>
        requireSqlExecutor().query(
          `INSERT INTO accounts.institution (id, workspace_id, name, kind, catalog_country, catalog_code, catalog_version)
           VALUES ($1, $2, $3, 'BANK', $4, $5, $6)`,
          [randomUUID(), w1, `Parcial ${randomUUID()}`, country, c, version],
        ),
      );
    expect(await code(insert('BO', null, null))).toBe('23514');
    expect(await code(insert(null, 'BAD', '2026-09-30'))).toBe('23514');
    expect(await code(insert('BO', 'bad', '2026-09-30'))).toBe('23514');
    expect(await code(insert('BO', 'ZZZ', ''))).toBe('23514');
    expect(await code(insert(null, null, null))).toBeUndefined();
  });

  it('listLinked y findActiveByName respetan archivadas y la RLS por workspace', async () => {
    const linked = await inWs(w1, () => institutions.listLinked(w1, 'BO'));
    expect(linked.map((i) => i.snapshot.catalogRef?.code).sort()).toEqual(['BAD', 'CID']);
    expect(linked.every((i) => !i.isArchived)).toBe(true);
    expect(await inWs(w1, () => institutions.listLinked(w1, 'AR'))).toEqual([]);
    expect((await inWs(w1, () => institutions.findActiveByName(w1, 'MI BANCO')))?.snapshot.catalogRef?.code).toBe(
      'BAD',
    );
    expect(await inWs(w1, () => institutions.findActiveByName(w1, 'Inexistente'))).toBeNull();
    // W2 solo ve su propia adopción de CID (la de W1 no se filtra).
    const other = await inWs(w2, () => institutions.listLinked(w2, 'BO'));
    expect(other.map((i) => [i.snapshot.workspaceId, i.snapshot.catalogRef?.code])).toEqual([[w2, 'CID']]);
    expect(await inWs(w2, () => institutions.listLinked(w1, 'BO'))).toEqual([]);
  });
});

describe('AdoptCatalogInstitutions sobre PostgreSQL', () => {
  const clock = new FixedClock(Instant.parse('2026-10-15T14:00:00Z'));
  const reader = new InMemoryCatalogReader().set(catalog());
  const base = () => ({
    uow: new PgAccountsUnitOfWork(app),
    institutions,
    ids: uuidV7Ids,
    clock,
  });
  const audit = { append: async (e: AuditEntry) => void audits.push(e) };
  const adopt = new AdoptCatalogInstitutions({ ...base(), catalog: reader }, audit);
  const queries = new InstitutionCatalogQueries({ ...base(), catalog: reader });
  const asUser = <T>(ws: string, fn: () => Promise<T>) =>
    uow.run({ userId: u1, workspaceId: ws }, async () => fn());
  const w3 = randomUUID();

  it('[TC-ACCOUNTS-INSTCATALOG-002] adopta dos entradas en un workspace nuevo con una sola auditoría; la repetición no crea otra', async () => {
    await uow.run({ userId: u1, workspaceId: w3 }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Catalog3', 'BOB', 'America/La_Paz', 'es-BO')`,
        [w3],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [w3, u1],
      );
    });
    const result = await asUser(w3, () => adopt.execute({ workspaceId: w3, country: 'BO', codes: ['BAD', 'BAL'] }));
    expect(result.adopted.map((i) => [i.name, i.kind, i.countryCode, i.catalogRef?.code])).toEqual([
      ['Banco Andino Demo', 'BANK', 'BO', 'BAD'],
      ['Billetera Altiplano Demo', 'WALLET_PROVIDER', 'BO', 'BAL'],
    ]);
    expect(audits.filter((a) => a.action === 'accounts.institutions.adopted' && a.workspaceId === w3)).toHaveLength(1);
    const again = await asUser(w3, () => adopt.execute({ workspaceId: w3, country: 'BO', codes: ['BAD'] }));
    expect([again.adopted.length, again.alreadyLinked.map((i) => i.catalogRef?.code)]).toEqual([0, ['BAD']]);
    const view = await asUser(w3, () => queries.getCatalog({ workspaceId: w3, country: 'BO' }));
    expect(view.entries.filter((e) => e.adoptedInstitutionId !== null).map((e) => e.code).sort()).toEqual([
      'BAD',
      'BAL',
    ]);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-003] un código desconocido no crea ninguna institución (sin filas parciales)', async () => {
    const before = await asUser(w3, () => institutions.list(w3, { includeArchived: true }));
    expect(await code(asUser(w3, () => adopt.execute({ workspaceId: w3, country: 'BO', codes: ['CID', 'ZZZ'] })))).toBe(
      'INSTITUTION_CATALOG_ENTRY_UNKNOWN',
    );
    expect((await asUser(w3, () => institutions.list(w3, { includeArchived: true }))).length).toBe(before.length);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-004] con un nombre ya usado por una institución propia: conflicto NAME_TAKEN y la otra entrada se adopta', async () => {
    const w4 = randomUUID();
    await uow.run({ userId: u1, workspaceId: w4 }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Catalog4', 'BOB', 'America/La_Paz', 'es-BO')`,
        [w4],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [w4, u1],
      );
    });
    const svc = new InstitutionsService(
      { ...base(), institutions } as ConstructorParameters<typeof InstitutionsService>[0],
      audit,
    );
    const mine = await asUser(w4, () =>
      svc.createInstitution({ workspaceId: w4, name: 'Banco Andino Demo', kind: 'BANK' }),
    );
    const result = await asUser(w4, () => adopt.execute({ workspaceId: w4, country: 'BO', codes: ['BAD', 'CID'] }));
    expect(result.conflicts).toEqual([{ code: 'BAD', reason: 'NAME_TAKEN', institutionId: mine.id }]);
    expect(result.adopted.map((i) => i.catalogRef?.code)).toEqual(['CID']);
    const linked = await asUser(w4, () =>
      adopt.execute({
        workspaceId: w4,
        country: 'BO',
        codes: ['BAD'],
        links: [{ code: 'BAD', institutionId: mine.id }],
      }),
    );
    expect(linked.alreadyLinked.map((i) => [i.id, i.catalogRef?.code])).toEqual([[mine.id, 'BAD']]);
    const stored = await asUser(w4, () => institutions.findById(w4, mine.id));
    expect(stored?.snapshot.catalogRef?.code).toBe('BAD');
  });
});
