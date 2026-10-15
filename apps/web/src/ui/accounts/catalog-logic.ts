import type { InstitutionKind, SupportByDimension, SupportStatus } from '../common/types';

/** Categoría regulatoria de una entrada del catálogo (conjunto abierto: se muestran las desconocidas tal cual). */
export type CatalogCategory = string;

export interface CatalogEntry {
  readonly code: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly category: CatalogCategory;
  readonly kind: InstitutionKind;
  readonly adoptable: boolean;
  readonly website: string | null;
  readonly listingStatus: 'ACTIVE' | 'DELISTED' | string;
  readonly delistedSince: string | null;
  readonly verification: 'CONFIRMED' | 'PENDING';
  readonly support: SupportByDimension;
  readonly adoptedInstitutionId: string | null;
}

export interface StatusCount {
  readonly status: string;
  readonly reason: string | null;
  readonly count: number;
}

export interface DimensionCoverage {
  readonly dimension: 'rates' | 'statementImport';
  readonly resolved: number;
  readonly pending: number;
  readonly resolvedPct: string;
  readonly byStatus: readonly StatusCount[];
  readonly notEligible: readonly { readonly reason: string; readonly count: number }[];
}

export interface CategoryCoverage {
  readonly category: CatalogCategory;
  readonly census: number;
  readonly entries: number;
  readonly censusCoveragePct: string;
}

export interface SupportCoverage {
  readonly complete: boolean;
  readonly censusCoveragePct: string;
  readonly byCategory: readonly CategoryCoverage[];
  readonly byDimension: readonly DimensionCoverage[];
}

export interface InstitutionCatalogData {
  readonly country: string;
  readonly catalogVersion: string;
  readonly fictitious: boolean;
  readonly source: {
    readonly name: string;
    readonly url: string | null;
    readonly cutoffDate: string;
    readonly retrievedOn: string;
  };
  readonly entries: readonly CatalogEntry[];
  readonly coverage: SupportCoverage;
}

export interface AdoptionConflict {
  readonly code: string;
  readonly reason: 'NAME_TAKEN' | string;
  readonly institutionId: string;
}

export interface AdoptionResult {
  readonly adopted: readonly { readonly id: string; readonly name: string }[];
  readonly alreadyLinked: readonly { readonly id: string; readonly name: string }[];
  readonly conflicts: readonly AdoptionConflict[];
}

/** País del catálogo que ofrece la pantalla (MVP: Bolivia; el catálogo de otro país lo trae su archivo). */
export const CATALOG_COUNTRY = 'BO';

/** Texto normalizado para buscar sin distinguir mayúsculas ni tildes. */
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface CatalogFilters {
  readonly query: string;
  readonly category: string;
}

export const EMPTY_CATALOG_FILTERS: CatalogFilters = { query: '', category: '' };

/** Búsqueda por nombre, razón social o sigla, y filtro de categoría; conserva el orden del catálogo. */
export function filterEntries(
  entries: readonly CatalogEntry[],
  filters: CatalogFilters,
): readonly CatalogEntry[] {
  const q = fold(filters.query.trim());
  return entries.filter((e) => {
    if (filters.category && e.category !== filters.category) return false;
    if (!q) return true;
    return [e.name, e.legalName ?? '', e.code].some((s) => fold(s).includes(q));
  });
}

/** Categorías presentes, en el orden en que aparecen (para el filtro). */
export function categoriesOf(entries: readonly CatalogEntry[]): readonly string[] {
  return [...new Set(entries.map((e) => e.category))];
}

/** Se puede seleccionar para adoptar: vigente, adoptable (no casa de cambio) y sin institución vinculada. */
export const isSelectable = (e: CatalogEntry): boolean =>
  e.listingStatus === 'ACTIVE' && e.adoptable && e.adoptedInstitutionId === null;

export function adoptionBody(
  country: string,
  codes: readonly string[],
  links: readonly { code: string; institutionId: string }[] = [],
): { country: string; codes: string[]; links?: { code: string; institutionId: string }[] } {
  return {
    country,
    codes: [...codes],
    ...(links.length > 0 ? { links: links.map((l) => ({ ...l })) } : {}),
  };
}

/** Tono de un estado de soporte: decide el énfasis visual (siempre acompañado de texto, no solo de color). */
export type SupportTone = 'ok' | 'pending' | 'neutral';
export function supportTone(s: SupportStatus): SupportTone {
  if (s.status === 'SUPPORTED') return 'ok';
  if (s.status === 'IN_VERIFICATION' || s.status === 'PENDING_SAMPLE') return 'pending';
  return 'neutral';
}

/**
 * Clave de mensaje (relativa a `Accounts.support`) de un estado: `NOT_ELIGIBLE` usa su razón cuando es conocida, para
 * no presentar como soportada una entidad no elegible.
 */
export function supportLabelKey(s: SupportStatus, has: (key: string) => boolean): string {
  if (s.status === 'NOT_ELIGIBLE' && s.reason && has(`support.reasons.${s.reason}`)) {
    return `support.reasons.${s.reason}`;
  }
  return has(`support.states.${s.status}`) ? `support.states.${s.status}` : 'support.states.UNKNOWN';
}

/** Instituciones adoptadas del catálogo que ya no figuran en el registro oficial vigente o en el catálogo. */
export type CatalogStanding = 'LISTED' | 'DELISTED' | 'NOT_IN_CATALOG';
export function catalogStanding(ref: {
  readonly listingStatus: string | null;
  readonly delistedSince: string | null;
}): CatalogStanding {
  if (ref.listingStatus === null) return 'NOT_IN_CATALOG';
  if (ref.listingStatus === 'DELISTED') return 'DELISTED';
  return 'LISTED';
}
