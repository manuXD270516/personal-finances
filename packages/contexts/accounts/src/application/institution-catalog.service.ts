import type { AuditPort } from '@pf/audit/contracts';
import { DomainError, type Clock } from '@pf/shared-kernel';
import {
  CatalogRef,
  computeSupportCoverage,
  Institution,
  type CatalogCategory,
  type CatalogEntry,
  type InstitutionCatalog,
  type InstitutionState,
  type ListingStatus,
  type SupportCoverage,
  type SupportDimension,
  type SupportState,
} from '../domain/index.js';
import type {
  IdGenerator,
  InstitutionCatalogReader,
  InstitutionRepository,
  UnitOfWork,
} from './ports/index.js';

/** Estado de soporte de una entrada tal como lo expone la consulta (`InstitutionSupportStatus` del contrato). */
export interface SupportStateView {
  readonly status: SupportState['status'];
  readonly reason: SupportState['reason'];
  readonly evaluatedOn: string;
  readonly providerIds: readonly string[];
}

export interface CatalogEntryView {
  readonly code: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly category: CatalogCategory;
  readonly kind: CatalogEntry['kind'];
  readonly adoptable: boolean;
  readonly website: string | null;
  readonly listingStatus: ListingStatus;
  readonly delistedSince: string | null;
  readonly verification: CatalogEntry['verification']['status'];
  readonly support: Readonly<Record<SupportDimension, SupportStateView>>;
  /** Institución NO archivada del workspace que consulta vinculada a esta entrada; `null` si ninguna. */
  readonly adoptedInstitutionId: string | null;
}

export interface InstitutionCatalogView {
  readonly fictitious: boolean;
  readonly country: string;
  readonly catalogVersion: string;
  readonly source: InstitutionCatalog['source'];
  readonly entries: readonly CatalogEntryView[];
  /** Cobertura del catálogo COMPLETO (no depende de los filtros de la consulta). */
  readonly coverage: SupportCoverage;
}

export interface CatalogQuery {
  readonly workspaceId: string;
  readonly country: string;
  readonly categories?: readonly string[];
  readonly q?: string;
  readonly includeDelisted?: boolean;
}

const supportView = (s: SupportState): SupportStateView => ({
  status: s.status,
  reason: s.reason,
  evaluatedOn: s.evaluatedOn,
  providerIds: s.providerIds,
});

const entryView = (e: CatalogEntry, adoptedId: string | null): CatalogEntryView => ({
  code: e.code,
  name: e.name,
  legalName: e.legalName,
  category: e.category,
  kind: e.kind,
  adoptable: e.adoptable,
  website: e.website,
  listingStatus: e.listing.status,
  delistedSince: e.listing.since,
  verification: e.verification.status,
  support: { rates: supportView(e.support.rates), statementImport: supportView(e.support.statementImport) },
  adoptedInstitutionId: adoptedId,
});

/** Vínculo de una institución con el catálogo vigente de la instalación (`Institution.catalogRef` del contrato). */
export interface CatalogRefView {
  readonly country: string;
  readonly code: string;
  readonly catalogVersion: string;
  /** Estado de la entrada en el catálogo VIGENTE de la instalación; `null` si la entrada ya no figura en él. */
  readonly listingStatus: ListingStatus | null;
  readonly delistedSince: string | null;
  readonly support: Readonly<Record<SupportDimension, SupportStateView>> | null;
}

/**
 * `GetInstitutionCatalog` (accounts/institutions, FR-ACCOUNTS-012): consulta de solo lectura del catálogo de
 * referencia con filtros por categoría y texto, la institución del workspace vinculada a cada entrada y la cobertura
 * del soporte. El catálogo es de la instalación (sin datos de usuario); solo `adoptedInstitutionId` es del workspace.
 */
export class InstitutionCatalogQueries {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly institutions: InstitutionRepository;
      readonly catalog: InstitutionCatalogReader;
    },
  ) {}

  async getCatalog(query: CatalogQuery): Promise<InstitutionCatalogView> {
    const catalog = await this.deps.catalog.get(query.country);
    if (!catalog) {
      throw new DomainError('RESOURCE_NOT_FOUND', `no institution catalog for country ${query.country}`);
    }
    const linked = await this.deps.uow.run(query.workspaceId, () =>
      this.deps.institutions.listLinked(query.workspaceId, query.country),
    );
    const adopted = new Map<string, string>();
    for (const i of linked) {
      const ref = i.snapshot.catalogRef;
      if (ref) adopted.set(ref.code, i.id);
    }
    const categories = query.categories && query.categories.length > 0 ? new Set(query.categories) : null;
    const text = query.q?.trim().toLowerCase() ?? '';
    const entries = catalog.entries
      .filter((e) => query.includeDelisted === true || e.listing.status === 'ACTIVE')
      .filter((e) => categories === null || categories.has(e.category))
      .filter(
        (e) =>
          text === '' ||
          e.name.toLowerCase().includes(text) ||
          e.code.toLowerCase().includes(text) ||
          (e.legalName?.toLowerCase().includes(text) ?? false),
      )
      .map((e) => entryView(e, adopted.get(e.code) ?? null));
    return {
      fictitious: catalog.fictitious,
      country: catalog.country,
      catalogVersion: catalog.catalogVersion,
      source: catalog.source,
      entries,
      coverage: computeSupportCoverage(catalog),
    };
  }

  /**
   * Estado de soporte en tasas de las instituciones ADOPTADAS del workspace (las vinculadas a una entrada presente en el
   * catálogo vigente): lo consume FX para su estado de providers (puerto compuesto en el composition root).
   */
  async adoptedRatesSupport(
    workspaceId: string,
  ): Promise<readonly { readonly code: string; readonly status: string; readonly reason: string | null }[]> {
    const linked = await this.deps.uow.run(workspaceId, () => this.deps.institutions.listLinked(workspaceId));
    const refs = await this.describeRefs(linked.map((i) => i.snapshot));
    const out: { code: string; status: string; reason: string | null }[] = [];
    for (const ref of refs.values()) {
      if (!ref.support) continue;
      out.push({ code: ref.code, status: ref.support.rates.status, reason: ref.support.rates.reason });
    }
    return out.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }

  /**
   * Estado de cada vínculo frente al catálogo vigente (para mostrar "no figura en el registro desde …", los estados
   * de soporte y "no figura en el catálogo de esta instalación"). Una consulta por país, no por institución.
   */
  async describeRefs(states: readonly InstitutionState[]): Promise<ReadonlyMap<string, CatalogRefView>> {
    const out = new Map<string, CatalogRefView>();
    const catalogs = new Map<string, InstitutionCatalog | null>();
    for (const s of states) {
      const ref = s.catalogRef;
      if (!ref) continue;
      if (!catalogs.has(ref.country)) catalogs.set(ref.country, await this.deps.catalog.get(ref.country));
      const entry = catalogs.get(ref.country)?.entries.find((e) => e.code === ref.code) ?? null;
      out.set(s.id, {
        country: ref.country,
        code: ref.code,
        catalogVersion: ref.version,
        listingStatus: entry ? entry.listing.status : null,
        delistedSince: entry && entry.listing.status === 'DELISTED' ? entry.listing.since : null,
        support: entry
          ? {
              rates: supportView(entry.support.rates),
              statementImport: supportView(entry.support.statementImport),
            }
          : null,
      });
    }
    return out;
  }
}

export interface AdoptCommand {
  readonly workspaceId: string;
  readonly country: string;
  readonly codes: readonly string[];
  /** Vincular una institución EXISTENTE (creada a mano) a una entrada en lugar de crear otra. */
  readonly links?: readonly { readonly code: string; readonly institutionId: string }[];
}

export interface AdoptionResult {
  readonly adopted: readonly InstitutionState[];
  /** Entradas ya vinculadas a una institución activa del workspace, o vinculadas por `links[]` en esta operación. */
  readonly alreadyLinked: readonly InstitutionState[];
  readonly conflicts: readonly {
    readonly code: string;
    readonly reason: 'NAME_TAKEN';
    readonly institutionId: string;
  }[];
}

/**
 * `AdoptCatalogInstitutions` (accounts/institutions): cada entrada adoptada crea en el workspace una institución normal
 * (nombre, tipo, país y sitio web de la entrada, vinculada a su código y versión de catálogo) en UNA unidad de trabajo
 * con UNA entrada de auditoría. Todo se valida antes de escribir: un código inexistente (`INSTITUTION_CATALOG_ENTRY_UNKNOWN`)
 * o una entrada retirada o no adoptable (`VALIDATION_FAILED`) abortan sin crear nada; adoptar de nuevo una entrada ya
 * vinculada no duplica; un nombre usado por otra institución activa se informa como conflicto sin impedir las demás.
 */
export class AdoptCatalogInstitutions {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly institutions: InstitutionRepository;
      readonly catalog: InstitutionCatalogReader;
      readonly ids: IdGenerator;
      readonly clock: Clock;
    },
    private readonly audit: AuditPort,
  ) {}

  async execute(cmd: AdoptCommand): Promise<AdoptionResult> {
    const catalog = await this.deps.catalog.get(cmd.country);
    if (!catalog) {
      throw new DomainError('RESOURCE_NOT_FOUND', `no institution catalog for country ${cmd.country}`);
    }
    const links = new Map((cmd.links ?? []).map((l) => [l.code, l.institutionId] as const));
    const codes = [...new Set([...cmd.codes, ...links.keys()])];
    const byCode = new Map(catalog.entries.map((e) => [e.code, e] as const));

    const missing = codes.filter((c) => !byCode.has(c));
    if (missing.length > 0) {
      throw new DomainError(
        'INSTITUTION_CATALOG_ENTRY_UNKNOWN',
        `the ${cmd.country} catalog has no entry ${missing.join(', ')}`,
        { details: { codes: missing } },
      ).at(`/codes/${codes.indexOf(missing[0] as string)}`);
    }
    codes.forEach((code, i) => {
      const entry = byCode.get(code) as CatalogEntry;
      if (entry.listing.status === 'DELISTED') {
        throw new DomainError(
          'VALIDATION_FAILED',
          `catalog entry ${code} is no longer in the registry (since ${entry.listing.since ?? 'unknown'}) and cannot be adopted`,
        ).at(`/codes/${i}`);
      }
      if (!entry.adoptable) {
        throw new DomainError('VALIDATION_FAILED', `catalog entry ${code} is not adoptable`).at(
          `/codes/${i}`,
        );
      }
    });

    return this.deps.uow.run(cmd.workspaceId, async () => {
      const linked = new Map<string, Institution>();
      for (const i of await this.deps.institutions.listLinked(cmd.workspaceId, cmd.country)) {
        const ref = i.snapshot.catalogRef;
        if (ref) linked.set(ref.code, i);
      }
      const adopted: Institution[] = [];
      const alreadyLinked: Institution[] = [];
      const conflicts: { code: string; reason: 'NAME_TAKEN'; institutionId: string }[] = [];
      const linkedNow: { code: string; institutionId: string }[] = [];

      for (const code of codes) {
        const entry = byCode.get(code) as CatalogEntry;
        const ref = CatalogRef.of(cmd.country, code, catalog.catalogVersion);
        const existingLink = linked.get(code);
        if (existingLink) {
          alreadyLinked.push(existingLink);
          continue;
        }
        const linkId = links.get(code);
        if (linkId !== undefined) {
          const target = await this.deps.institutions.findById(cmd.workspaceId, linkId);
          if (!target) {
            throw new DomainError('RESOURCE_NOT_FOUND', `institution ${linkId} not found`).at('/links');
          }
          if (target.isArchived) {
            throw new DomainError('INSTITUTION_ARCHIVED', 'an archived institution cannot be linked').at(
              '/links',
            );
          }
          if (target.linkToCatalog(ref)) {
            if (!(await this.deps.institutions.update(target))) {
              throw new DomainError('PRECONDITION_FAILED', 'the institution changed concurrently');
            }
            linkedNow.push({ code, institutionId: target.id });
          }
          alreadyLinked.push(target);
          continue;
        }
        const sameName = await this.deps.institutions.findActiveByName(cmd.workspaceId, entry.name);
        if (sameName) {
          conflicts.push({ code, reason: 'NAME_TAKEN', institutionId: sameName.id });
          continue;
        }
        const institution = Institution.create({
          id: this.deps.ids.next(),
          workspaceId: cmd.workspaceId,
          name: entry.name,
          kind: entry.kind,
          countryCode: cmd.country,
          website: entry.website,
          catalogRef: ref,
        });
        await this.deps.institutions.insert(institution);
        adopted.push(institution);
      }

      if (adopted.length > 0 || linkedNow.length > 0) {
        await this.audit.append({
          workspaceId: cmd.workspaceId,
          action: 'accounts.institutions.adopted',
          aggregateType: 'InstitutionAdoption',
          aggregateId: this.deps.ids.next(),
          aggregateVersion: null,
          // Valores compuestos como texto JSON (la auditoría guarda texto/escalares, no estructuras).
          changes: [
            { field: 'country', before: null, after: cmd.country },
            { field: 'catalogVersion', before: null, after: catalog.catalogVersion },
            {
              field: 'adopted',
              before: null,
              after: JSON.stringify(
                adopted.map((i) => ({ code: i.snapshot.catalogRef?.code, institutionId: i.id })),
              ),
            },
            { field: 'linked', before: null, after: JSON.stringify(linkedNow) },
            { field: 'codes', before: null, after: JSON.stringify(codes) },
          ],
        });
      }
      return {
        adopted: adopted.map((i) => i.snapshot),
        alreadyLinked: alreadyLinked.map((i) => i.snapshot),
        conflicts,
      };
    });
  }
}
