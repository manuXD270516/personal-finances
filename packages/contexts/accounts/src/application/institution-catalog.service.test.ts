import { DomainError } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateCatalog, type InstitutionCatalog } from '../domain/index.js';
import {
  demoCatalog,
  demoEntry,
  demoTerms,
  status,
  threeEntryCatalog,
} from '../domain/institution-catalog.test-support.js';
import { AccountsService } from './accounts.service.js';
import { AdoptCatalogInstitutions, InstitutionCatalogQueries } from './institution-catalog.service.js';
import { InstitutionsService } from './institutions.service.js';
import { InMemoryAccounts, InMemoryCatalogReader } from './testing/in-memory.js';

const W1 = 'w1';
const W2 = 'w2';

function validated(raw: unknown): InstitutionCatalog {
  const r = validateCatalog(raw, { terms: demoTerms });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.catalog;
}

let mem: InMemoryAccounts;
let reader: InMemoryCatalogReader;
let queries: InstitutionCatalogQueries;
let adopt: AdoptCatalogInstitutions;
let institutions: InstitutionsService;
let accounts: AccountsService;

beforeEach(() => {
  mem = new InMemoryAccounts();
  reader = new InMemoryCatalogReader().set(validated(threeEntryCatalog()));
  const deps = mem.deps();
  queries = new InstitutionCatalogQueries({
    uow: deps.uow,
    institutions: deps.institutions,
    catalog: reader,
  });
  adopt = new AdoptCatalogInstitutions({ ...deps, catalog: reader }, deps.audit);
  institutions = new InstitutionsService(deps, deps.audit);
  accounts = new AccountsService(deps);
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

describe('GetInstitutionCatalog (accounts/institutions: catálogo de referencia por país)', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-001] consulta el catálogo con fuente, fecha de corte, versión y las tres entradas ACTIVE', async () => {
    const view = await queries.getCatalog({ workspaceId: W1, country: 'BO' });
    expect(view.entries.map((e) => [e.code, e.category, e.kind, e.listingStatus])).toEqual([
      ['BAD', 'MULTIPLE_BANK', 'BANK', 'ACTIVE'],
      ['CID', 'SAVINGS_COOP', 'BANK', 'ACTIVE'],
      ['BAL', 'MOBILE_PAYMENT', 'WALLET_PROVIDER', 'ACTIVE'],
    ]);
    expect(view.catalogVersion).toBe('2026-09-30');
    expect(view.source.name).toBe('Registro Demo (ficticio)');
    expect(view.source.cutoffDate).toBe('2026-09-30');
    expect(view.fictitious).toBe(true);
    expect(view.coverage.byCategory).toHaveLength(3);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-001] filtra por categoría y por texto; el listado de instituciones del workspace sigue vacío', async () => {
    const coops = await queries.getCatalog({ workspaceId: W1, country: 'BO', categories: ['SAVINGS_COOP'] });
    expect(coops.entries.map((e) => e.name)).toEqual(['Cooperativa Illimani Demo']);
    const text = await queries.getCatalog({ workspaceId: W1, country: 'BO', q: 'billetera' });
    expect(text.entries.map((e) => e.code)).toEqual(['BAL']);
    const byCode = await queries.getCatalog({ workspaceId: W1, country: 'BO', q: 'bad' });
    expect(byCode.entries.map((e) => e.code)).toEqual(['BAD']);
    expect(await institutions.listInstitutions({ workspaceId: W1 })).toEqual([]);
    expect(mem.institutions.size).toBe(0);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-001] un país sin catálogo es RESOURCE_NOT_FOUND', async () => {
    expect(await codeOf(queries.getCatalog({ workspaceId: W1, country: 'AR' }))).toBe('RESOURCE_NOT_FOUND');
  });

  it('las entradas retiradas solo se listan con includeDelisted, y la cobertura no depende de los filtros', async () => {
    reader.set(
      validated(
        demoCatalog(
          [
            demoEntry('BAD', { name: 'Banco Andino Demo' }),
            demoEntry('CAN', {
              name: 'Cooperativa Antigua Demo',
              listing: { status: 'DELISTED', since: '2026-06-30' },
            }),
          ],
          [{ category: 'MULTIPLE_BANK', count: 1 }],
        ),
      ),
    );
    expect((await queries.getCatalog({ workspaceId: W1, country: 'BO' })).entries.map((e) => e.code)).toEqual(
      ['BAD'],
    );
    const all = await queries.getCatalog({ workspaceId: W1, country: 'BO', includeDelisted: true });
    expect(all.entries.map((e) => [e.code, e.listingStatus, e.delistedSince])).toEqual([
      ['BAD', 'ACTIVE', null],
      ['CAN', 'DELISTED', '2026-06-30'],
    ]);
    const filtered = await queries.getCatalog({ workspaceId: W1, country: 'BO', q: 'zzz' });
    expect(filtered.entries).toEqual([]);
    expect(filtered.coverage.byCategory[0]?.entries).toBe(1);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-006] devuelve el estado de soporte por entrada y dimensión', async () => {
    const view = await queries.getCatalog({ workspaceId: W1, country: 'BO' });
    const bad = view.entries.find((e) => e.code === 'BAD');
    expect(bad?.support.rates).toMatchObject({ status: 'IN_VERIFICATION', reason: null });
    expect(bad?.support.statementImport.status).toBe('PENDING_SAMPLE');
    const cid = view.entries.find((e) => e.code === 'CID');
    expect(cid?.support.rates).toMatchObject({ status: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION' });
    const bal = view.entries.find((e) => e.code === 'BAL');
    expect(bal?.support.rates.status).toBe('NOT_APPLICABLE');
    expect(bal?.support.statementImport.status).toBe('GENERIC_ONLY');
  });
});

describe('AdoptCatalogInstitutions (accounts/institutions: adopción desde el catálogo)', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-002] adopta dos entradas: instituciones normales vinculadas, con una sola auditoría con los códigos', async () => {
    const result = await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD', 'BAL'] });
    expect(
      result.adopted.map((i) => [i.name, i.kind, i.countryCode, i.catalogRef?.code, i.catalogRef?.version]),
    ).toEqual([
      ['Banco Andino Demo', 'BANK', 'BO', 'BAD', '2026-09-30'],
      ['Billetera Altiplano Demo', 'WALLET_PROVIDER', 'BO', 'BAL', '2026-09-30'],
    ]);
    expect(result.alreadyLinked).toEqual([]);
    expect(result.conflicts).toEqual([]);
    const audits = mem.audits.filter((a) => a.action === 'accounts.institutions.adopted');
    expect(audits).toHaveLength(1);
    const changes = Object.fromEntries((audits[0]?.changes ?? []).map((c) => [c.field, c.after]));
    expect(JSON.parse(changes['codes'] as string)).toEqual(['BAD', 'BAL']);
    expect(JSON.parse(changes['adopted'] as string).map((a: { code: string }) => a.code)).toEqual([
      'BAD',
      'BAL',
    ]);
    expect(changes['country']).toBe('BO');
    // Las instituciones adoptadas se listan como cualquier otra.
    const listed = await institutions.listInstitutions({ workspaceId: W1 });
    expect(listed.map((i) => i.name).sort()).toEqual(['Banco Andino Demo', 'Billetera Altiplano Demo']);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-002] adoptar de nuevo una entrada vinculada no crea otra y la informa como ya vinculada', async () => {
    await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD', 'BAL'] });
    const auditsBefore = mem.audits.length;
    const again = await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD'] });
    expect(again.adopted).toEqual([]);
    expect(again.alreadyLinked.map((i) => i.catalogRef?.code)).toEqual(['BAD']);
    expect(mem.institutions.size).toBe(2);
    // Una operación sin efecto no deja registro de auditoría.
    expect(mem.audits.length).toBe(auditsBefore);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-002] renombrar la institución adoptada conserva el vínculo y no cambia el catálogo', async () => {
    const [bad] = (await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD'] })).adopted;
    const renamed = await institutions.updateInstitution(W1, bad!.id, bad!.version, { name: 'Mi banco' });
    expect(renamed.name).toBe('Mi banco');
    expect(renamed.catalogRef?.code).toBe('BAD');
    // Adoptar otra vez devuelve la renombrada (sigue vinculada), sin crear otra.
    const again = await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD'] });
    expect(again.alreadyLinked[0]?.name).toBe('Mi banco');
    expect(mem.institutions.size).toBe(1);
    const view = await queries.getCatalog({ workspaceId: W1, country: 'BO' });
    expect(view.entries.find((e) => e.code === 'BAD')).toMatchObject({
      name: 'Banco Andino Demo',
      adoptedInstitutionId: bad!.id,
    });
  });

  it('[TC-ACCOUNTS-INSTCATALOG-003] un código desconocido se rechaza con INSTITUTION_CATALOG_ENTRY_UNKNOWN sin crear ninguna institución', async () => {
    let error: unknown;
    try {
      await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD', 'ZZZ'] });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INSTITUTION_CATALOG_ENTRY_UNKNOWN');
    expect(mem.institutions.size).toBe(0);
    expect(mem.audits).toHaveLength(0);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-004] un nombre usado por una institución propia es conflicto NAME_TAKEN sin impedir las demás', async () => {
    const mine = await institutions.createInstitution({
      workspaceId: W1,
      name: 'Banco Andino Demo',
      kind: 'BANK',
    });
    const result = await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD', 'CID'] });
    expect(result.adopted.map((i) => [i.name, i.catalogRef?.code])).toEqual([
      ['Cooperativa Illimani Demo', 'CID'],
    ]);
    expect(result.conflicts).toEqual([{ code: 'BAD', reason: 'NAME_TAKEN', institutionId: mine.id }]);
    expect(mem.institutions.size).toBe(2);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-004] con links la institución existente queda vinculada sin crear otra, y el vínculo no cambia su nombre', async () => {
    const mine = await institutions.createInstitution({
      workspaceId: W1,
      name: 'Banco Andino Demo',
      kind: 'BANK',
    });
    const result = await adopt.execute({
      workspaceId: W1,
      country: 'BO',
      codes: ['BAD'],
      links: [{ code: 'BAD', institutionId: mine.id }],
    });
    expect(result.adopted).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.alreadyLinked.map((i) => [i.id, i.catalogRef?.code])).toEqual([[mine.id, 'BAD']]);
    expect(mem.institutions.size).toBe(1);
    const audit = mem.audits.find((a) => a.action === 'accounts.institutions.adopted');
    const linked = (audit?.changes ?? []).find((c) => c.field === 'linked')?.after as string;
    expect(JSON.parse(linked)).toEqual([{ code: 'BAD', institutionId: mine.id }]);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-004] links hacia una institución inexistente, de otro workspace o archivada se rechaza sin cambios', async () => {
    const other = await institutions.createInstitution({ workspaceId: W2, name: 'Ajena', kind: 'BANK' });
    expect(
      await codeOf(
        adopt.execute({
          workspaceId: W1,
          country: 'BO',
          codes: ['BAD'],
          links: [{ code: 'BAD', institutionId: other.id }],
        }),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
    const mine = await institutions.createInstitution({ workspaceId: W1, name: 'Vieja', kind: 'BANK' });
    await institutions.archiveInstitution(W1, mine.id, 1);
    expect(
      await codeOf(
        adopt.execute({
          workspaceId: W1,
          country: 'BO',
          codes: ['BAD'],
          links: [{ code: 'BAD', institutionId: mine.id }],
        }),
      ),
    ).toBe('INSTITUTION_ARCHIVED');
    expect([...mem.institutions.values()].filter((i) => i.snapshot.catalogRef !== null)).toEqual([]);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-005] adoptar una entrada DELISTED se rechaza con VALIDATION_FAILED sin crear ninguna institución', async () => {
    reader.set(
      validated(
        demoCatalog(
          [
            demoEntry('BAD', { listing: { status: 'DELISTED', since: '2026-12-31' } }),
            demoEntry('CID', { name: 'Cooperativa Illimani Demo', category: 'SAVINGS_COOP' }),
          ],
          [
            { category: 'MULTIPLE_BANK', count: 0 },
            { category: 'SAVINGS_COOP', count: 1 },
          ],
          { catalogVersion: '2026-12-31' },
        ),
      ),
    );
    expect(await codeOf(adopt.execute({ workspaceId: W2, country: 'BO', codes: ['CID', 'BAD'] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(mem.institutions.size).toBe(0);
  });

  it('una casa de cambio (no adoptable) se rechaza con VALIDATION_FAILED', async () => {
    reader.set(
      validated(
        demoCatalog(
          [demoEntry('CCS', { name: 'Casa de Cambio Sol Demo', category: 'EXCHANGE_HOUSE', kind: 'OTHER' })],
          [{ category: 'EXCHANGE_HOUSE', count: 1 }],
        ),
      ),
    );
    expect(await codeOf(adopt.execute({ workspaceId: W1, country: 'BO', codes: ['CCS'] }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('las adopciones de dos workspaces son independientes (aislamiento por workspace)', async () => {
    await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD'] });
    const second = await adopt.execute({ workspaceId: W2, country: 'BO', codes: ['BAD'] });
    expect(second.adopted).toHaveLength(1);
    expect(mem.institutions.size).toBe(2);
    expect(
      (await queries.getCatalog({ workspaceId: W2, country: 'BO' })).entries[0]?.adoptedInstitutionId,
    ).toBe(second.adopted[0]?.id);
  });
});

describe('Entrada retirada del registro (accounts/institutions)', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-005] la institución adoptada sigue activa con su cuenta y saldo y se informa desde cuándo no figura', async () => {
    const [bad] = (await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD'] })).adopted;
    const bankA = await accounts.openAccount({
      workspaceId: W1,
      name: 'Bank A',
      type: 'BANK',
      currency: 'BOB',
      institutionId: bad!.id,
      openingBalance: { amount: { amount: '1000.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    // Versión nueva del catálogo con BAD retirada.
    reader.set(
      validated(
        demoCatalog(
          [
            demoEntry('BAD', {
              name: 'Banco Andino Demo',
              listing: { status: 'DELISTED', since: '2026-12-31' },
            }),
            demoEntry('CID', { name: 'Cooperativa Illimani Demo', category: 'SAVINGS_COOP' }),
          ],
          [
            { category: 'MULTIPLE_BANK', count: 0 },
            { category: 'SAVINGS_COOP', count: 1 },
          ],
          { catalogVersion: '2026-12-31' },
        ),
      ),
    );
    const refs = await queries.describeRefs([await institutions.getInstitution(W1, bad!.id)]);
    expect(refs.get(bad!.id)).toMatchObject({
      code: 'BAD',
      catalogVersion: '2026-09-30',
      listingStatus: 'DELISTED',
      delistedSince: '2026-12-31',
    });
    const after = await institutions.getInstitution(W1, bad!.id);
    expect(after.archivedAt).toBeNull();
    expect(after.name).toBe('Banco Andino Demo');
    expect(after.catalogRef?.code).toBe('BAD');
    const account = await accounts.getAccount(W1, bankA.account.id);
    expect(account.balance).toEqual({ amount: '1000.00', currency: 'BOB' });
    expect(account.account.institutionId).toBe(bad!.id);
  });

  it('[TC-IDENTITY-EXPORT-014] una entrada ausente del catálogo de la instalación se informa sin romper la institución', async () => {
    const [bad] = (await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD'] })).adopted;
    reader.set(validated(demoCatalog([], [])));
    const refs = await queries.describeRefs([bad!]);
    expect(refs.get(bad!.id)).toMatchObject({
      code: 'BAD',
      listingStatus: null,
      delistedSince: null,
      support: null,
    });
    // Sin catálogo para el país: igual.
    const empty = new InMemoryCatalogReader();
    const q2 = new InstitutionCatalogQueries({
      uow: mem.deps().uow,
      institutions: mem.deps().institutions,
      catalog: empty,
    });
    expect((await q2.describeRefs([bad!])).get(bad!.id)?.listingStatus).toBeNull();
  });

  it('una institución sin vínculo no tiene entrada en describeRefs', async () => {
    const mine = await institutions.createInstitution({ workspaceId: W1, name: 'Propia', kind: 'BANK' });
    expect((await queries.describeRefs([mine])).size).toBe(0);
  });
});

describe('estado de soporte (accounts/institutions)', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-006] la institución adoptada muestra el estado y la razón de su entrada', async () => {
    await adopt.execute({ workspaceId: W1, country: 'BO', codes: ['BAD', 'CID'] });
    const states = await institutions.listInstitutions({ workspaceId: W1 });
    const refs = await queries.describeRefs(states);
    const byCode = new Map([...refs.values()].map((r) => [r.code, r]));
    expect(byCode.get('BAD')?.support?.rates.status).toBe('IN_VERIFICATION');
    expect(byCode.get('BAD')?.support?.statementImport.status).toBe('PENDING_SAMPLE');
    expect(byCode.get('CID')?.support?.rates).toMatchObject({
      status: 'NOT_ELIGIBLE',
      reason: 'NO_PUBLICATION',
    });
  });

  it('[TC-ACCOUNTS-INSTCATALOG-007] la cobertura de la consulta informa soporte incompleto con 66.67 % de tasas resueltas', async () => {
    const view = await queries.getCatalog({ workspaceId: W1, country: 'BO' });
    const rates = view.coverage.byDimension.find((d) => d.dimension === 'rates');
    expect(rates).toMatchObject({ resolved: 2, pending: 1, resolvedPct: '66.67' });
    expect(rates?.notEligible).toEqual([{ reason: 'NO_PUBLICATION', count: 1 }]);
    expect(view.coverage.complete).toBe(false);
    expect(view.coverage.censusCoveragePct).toBe('100.00');
  });

  it('el catálogo completo (todo resuelto) se informa como soporte completo', async () => {
    reader.set(
      validated(
        demoCatalog(
          [
            demoEntry('BAD', {
              support: {
                rates: status('SUPPORTED', { providerIds: ['INSTRATE_VERIFIED'] }),
                statementImport: status('GENERIC_ONLY'),
              },
            }),
          ],
          [{ category: 'MULTIPLE_BANK', count: 1 }],
        ),
      ),
    );
    const view = await queries.getCatalog({ workspaceId: W1, country: 'BO' });
    expect(view.coverage.complete).toBe(true);
    expect(view.coverage.censusCoveragePct).toBe('100.00');
  });
});
