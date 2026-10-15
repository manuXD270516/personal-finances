import { INSTITUTION_KINDS, type InstitutionKind } from './institution.js';
import { CATALOG_CODE } from './catalog-ref.js';

/**
 * Catálogo de referencia de instituciones por país (accounts/institutions, FR-ACCOUNTS-012; change
 * add-exchange-house-rate-providers). Es DATO versionado de la instalación (un archivo por país), no código ni filas de
 * la base: sin datos de ningún usuario o workspace, sin logos ni marcas. Una entrada adoptada se copia al workspace como
 * una institución normal y editable (el catálogo no se modifica).
 */

/** Categorías regulatorias del alcance (design.md decisión 1). Conjunto cerrado. */
export const CATALOG_CATEGORIES = [
  'MULTIPLE_BANK',
  'SME_BANK',
  'PUBLIC_BANK',
  'DEVELOPMENT_BANK',
  'HOUSING_FINANCE',
  'SAVINGS_COOP',
  'DEVELOPMENT_FINANCE',
  'MOBILE_PAYMENT',
  'FINTECH',
  'EXCHANGE_HOUSE',
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

/**
 * Tipo de institución de cada categoría (design.md decisión 2): el enum `InstitutionKind` es cerrado en las respuestas
 * de la API y NO se amplía. La categoría regulatoria se muestra aparte.
 */
export const KIND_OF_CATEGORY: Readonly<Record<CatalogCategory, InstitutionKind>> = Object.freeze({
  MULTIPLE_BANK: 'BANK',
  SME_BANK: 'BANK',
  PUBLIC_BANK: 'BANK',
  DEVELOPMENT_BANK: 'BANK',
  HOUSING_FINANCE: 'BANK',
  SAVINGS_COOP: 'BANK',
  DEVELOPMENT_FINANCE: 'BANK',
  MOBILE_PAYMENT: 'WALLET_PROVIDER',
  FINTECH: 'FINTECH',
  EXCHANGE_HOUSE: 'OTHER',
});

export const SUPPORT_DIMENSIONS = ['rates', 'statementImport'] as const;
export type SupportDimension = (typeof SUPPORT_DIMENSIONS)[number];

export const SUPPORT_STATUSES = [
  'SUPPORTED',
  'GENERIC_ONLY',
  'IN_VERIFICATION',
  'PENDING_SAMPLE',
  'NOT_ELIGIBLE',
  'NOT_APPLICABLE',
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** `rates` no admite `GENERIC_ONLY` ni `PENDING_SAMPLE` (solo importación de extractos; design.md decisión 5). */
export const STATUSES_OF_DIMENSION: Readonly<Record<SupportDimension, readonly SupportStatus[]>> =
  Object.freeze({
    rates: ['SUPPORTED', 'IN_VERIFICATION', 'NOT_ELIGIBLE', 'NOT_APPLICABLE'],
    statementImport: SUPPORT_STATUSES,
  });

/** Estados resueltos (cuentan como soporte decidido) y pendientes (siguen abiertos). */
export const RESOLVED_STATUSES: readonly SupportStatus[] = [
  'SUPPORTED',
  'GENERIC_ONLY',
  'NOT_ELIGIBLE',
  'NOT_APPLICABLE',
];
export const PENDING_STATUSES: readonly SupportStatus[] = ['IN_VERIFICATION', 'PENDING_SAMPLE'];

/** Razones de `NOT_ELIGIBLE` (conjunto cerrado; design.md decisión 5). `OTHER` exige una nota. */
export const NOT_ELIGIBLE_REASONS = [
  'NO_PUBLICATION',
  'TERMS_PROHIBIT_AUTOMATION',
  'TERMS_UNAVAILABLE',
  'REQUIRES_CREDENTIALS',
  'UNSTABLE_FORMAT',
  'IMAGE_ONLY_STATEMENT',
  'OTHER',
] as const;
export type NotEligibleReason = (typeof NOT_ELIGIBLE_REASONS)[number];

export interface SupportState {
  readonly status: SupportStatus;
  /** Solo con `NOT_ELIGIBLE`. */
  readonly reason: NotEligibleReason | null;
  /** Fecha (`YYYY-MM-DD`) de la evaluación que fijó este estado. */
  readonly evaluatedOn: string;
  /** ADR que registra la verificación (p. ej. de los términos de la fuente); `null` si no aplica. */
  readonly adr: string | null;
  /** Proveedores de tasas que respaldan un `SUPPORTED` de tasas (ids de FX). */
  readonly providerIds: readonly string[];
  readonly note: string | null;
}

export type ListingStatus = 'ACTIVE' | 'DELISTED';
export type VerificationStatus = 'CONFIRMED' | 'PENDING';

export interface CatalogEntry {
  readonly code: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly category: CatalogCategory;
  readonly kind: InstitutionKind;
  /** `false` en las casas de cambio: nadie tiene cuenta en ellas, solo declaran su soporte de tasas. */
  readonly adoptable: boolean;
  readonly website: string | null;
  readonly listing: { readonly status: ListingStatus; readonly since: string | null };
  readonly verification: { readonly status: VerificationStatus; readonly note: string | null };
  readonly support: Readonly<Record<SupportDimension, SupportState>>;
}

export interface CatalogSource {
  readonly name: string;
  readonly url: string | null;
  /** Fecha de corte del listado oficial (`YYYY-MM-DD`). */
  readonly cutoffDate: string;
  /** Fecha en que se consultó la fuente. */
  readonly retrievedOn: string;
}

export interface CensusRow {
  readonly category: CatalogCategory;
  /** Entidades de la categoría declaradas por la fuente a la fecha de corte. */
  readonly count: number;
  readonly source: string | null;
}

export interface InstitutionCatalog {
  /** `true` en un catálogo de PRUEBA con entidades inventadas: nunca se confunde con el registro real. */
  readonly fictitious: boolean;
  readonly country: string;
  /** Versión del catálogo (= fecha de corte). */
  readonly catalogVersion: string;
  readonly source: CatalogSource;
  readonly census: readonly CensusRow[];
  readonly entries: readonly CatalogEntry[];
}

/** Estado de la verificación de términos de un proveedor de tasas (FX), tal como lo informa su descriptor. */
export type ProviderTermsStatus = 'VERIFIED' | 'REJECTED' | 'UNVERIFIED';
/** Consulta de términos de un proveedor por id (`null` si el id no existe). La compone `apps/api` con FX. */
export type ProviderTermsLookup = (providerId: string) => ProviderTermsStatus | null;

export interface CatalogIssue {
  /** Código estable de la falla (`CENSUS_SHORTFALL`, `DUPLICATE_CODE`…). */
  readonly code: string;
  /** JSON Pointer del dato con la falla. */
  readonly path: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type CatalogValidation =
  | { readonly ok: true; readonly catalog: InstitutionCatalog }
  | { readonly ok: false; readonly issues: readonly CatalogIssue[] };

export interface ValidateCatalogOptions {
  readonly terms: ProviderTermsLookup;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const inSet = <T extends string>(set: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (set as readonly string[]).includes(v);

/**
 * `CatalogValidator` (TDD, design.md decisión 1 y requirement "Completitud del catálogo frente al censo oficial"):
 * valida el JSON crudo de un catálogo y, si es correcto, lo devuelve tipado. Reúne TODAS las fallas (no se detiene en la
 * primera): fuente, fechas de corte y consulta, códigos únicos, censo por categoría frente a las entradas activas,
 * razón y fecha obligatorias en `NOT_ELIGIBLE`, estados válidos por dimensión y proveedores con términos `VERIFIED`
 * detrás de todo `SUPPORTED` de tasas. No lanza por datos mal formados.
 */
export function validateCatalog(raw: unknown, options: ValidateCatalogOptions): CatalogValidation {
  const issues: CatalogIssue[] = [];
  const add = (code: string, path: string, message: string, details?: Record<string, unknown>) =>
    issues.push({ code, path, message, ...(details ? { details } : {}) });

  if (!isObject(raw)) {
    add('CATALOG_NOT_OBJECT', '', 'the catalog must be a JSON object');
    return { ok: false, issues };
  }

  if (!isString(raw['country']) || !/^[A-Z]{2}$/.test(raw['country'])) {
    add('COUNTRY_INVALID', '/country', 'country must be ISO 3166-1 alpha-2');
  }
  if (
    !isString(raw['catalogVersion']) ||
    raw['catalogVersion'].length < 1 ||
    raw['catalogVersion'].length > 40
  ) {
    add('CATALOG_VERSION_REQUIRED', '/catalogVersion', 'catalogVersion is required (1..40 characters)');
  }

  const source = validateSource(raw['source'], add);
  const census = validateCensus(raw['census'], add);

  const entries: CatalogEntry[] = [];
  if (!Array.isArray(raw['entries'])) {
    add('ENTRIES_REQUIRED', '/entries', 'entries must be an array');
  } else {
    const seen = new Set<string>();
    raw['entries'].forEach((rawEntry: unknown, i: number) => {
      const entry = validateEntry(rawEntry, `/entries/${i}`, options, add);
      if (!entry) return;
      if (seen.has(entry.code)) {
        add('DUPLICATE_CODE', `/entries/${i}/code`, `duplicate catalog code ${entry.code}`, {
          code: entry.code,
        });
      }
      seen.add(entry.code);
      entries.push(entry);
    });
  }

  if (census) checkCensus(census, entries, add);

  if (issues.length > 0 || !source || !census) return { ok: false, issues };
  return {
    ok: true,
    catalog: {
      fictitious: raw['fictitious'] === true,
      country: raw['country'] as string,
      catalogVersion: raw['catalogVersion'] as string,
      source,
      census,
      entries,
    },
  };
}

type Add = (code: string, path: string, message: string, details?: Record<string, unknown>) => void;

function validateSource(raw: unknown, add: Add): CatalogSource | null {
  if (!isObject(raw)) {
    add('SOURCE_REQUIRED', '/source', 'source (name, url, cutoffDate, retrievedOn) is required');
    return null;
  }
  const before = { problems: 0 };
  const name = raw['name'];
  if (!isString(name) || name.trim() === '') {
    add('SOURCE_REQUIRED', '/source/name', 'the official source name is required');
    before.problems++;
  }
  if (!isCalendarDate(raw['cutoffDate'])) {
    add('CUTOFF_DATE_REQUIRED', '/source/cutoffDate', 'the source cutoff date (YYYY-MM-DD) is required');
    before.problems++;
  }
  if (!isCalendarDate(raw['retrievedOn'])) {
    add('RETRIEVED_ON_REQUIRED', '/source/retrievedOn', 'the retrieval date (YYYY-MM-DD) is required');
    before.problems++;
  }
  const url = raw['url'];
  if (url !== undefined && url !== null && (!isString(url) || !isHttpUrl(url))) {
    add('SOURCE_URL_INVALID', '/source/url', 'source url must be an http(s) URL');
    before.problems++;
  }
  if (before.problems > 0) return null;
  return {
    name: (name as string).trim(),
    url: isString(url) ? url : null,
    cutoffDate: raw['cutoffDate'] as string,
    retrievedOn: raw['retrievedOn'] as string,
  };
}

function validateCensus(raw: unknown, add: Add): CensusRow[] | null {
  if (!Array.isArray(raw)) {
    add('CENSUS_REQUIRED', '/census', 'census (entities per category at the cutoff date) is required');
    return null;
  }
  const rows: CensusRow[] = [];
  const seen = new Set<string>();
  let ok = true;
  raw.forEach((row: unknown, i: number) => {
    const path = `/census/${i}`;
    if (!isObject(row) || !inSet(CATALOG_CATEGORIES, row['category'])) {
      add('CENSUS_INVALID', `${path}/category`, 'census category is not valid');
      ok = false;
      return;
    }
    const count = row['count'];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 1000) {
      add('CENSUS_INVALID', `${path}/count`, 'census count must be an integer between 0 and 1000');
      ok = false;
      return;
    }
    if (seen.has(row['category'])) {
      add('CENSUS_INVALID', `${path}/category`, `census category ${row['category']} is declared twice`);
      ok = false;
      return;
    }
    seen.add(row['category']);
    rows.push({ category: row['category'], count, source: isString(row['source']) ? row['source'] : null });
  });
  return ok ? rows : null;
}

/** Cada categoría con censo debe tener al menos tantas entradas ACTIVAS como entidades declara la fuente. */
function checkCensus(census: readonly CensusRow[], entries: readonly CatalogEntry[], add: Add): void {
  const active = new Map<CatalogCategory, number>();
  const any = new Set<CatalogCategory>();
  for (const e of entries) {
    any.add(e.category);
    if (e.listing.status === 'ACTIVE') active.set(e.category, (active.get(e.category) ?? 0) + 1);
  }
  const declared = new Set(census.map((c) => c.category));
  for (const category of any) {
    if (!declared.has(category)) {
      add('CENSUS_MISSING', '/census', `category ${category} has entries but no census declaration`, {
        category,
      });
    }
  }
  for (const row of census) {
    const have = active.get(row.category) ?? 0;
    if (have < row.count) {
      add(
        'CENSUS_SHORTFALL',
        '/entries',
        `category ${row.category} declares ${row.count} entities in the census but has ${have} active entries (missing ${row.count - have})`,
        { category: row.category, census: row.count, entries: have, missing: row.count - have },
      );
    }
  }
}

function validateEntry(
  raw: unknown,
  path: string,
  options: ValidateCatalogOptions,
  add: Add,
): CatalogEntry | null {
  if (!isObject(raw)) {
    add('ENTRY_NOT_OBJECT', path, 'a catalog entry must be an object');
    return null;
  }
  let ok = true;
  const fail = (code: string, p: string, message: string, details?: Record<string, unknown>) => {
    add(code, `${path}${p}`, message, details);
    ok = false;
  };

  const code = raw['code'];
  if (!isString(code) || !CATALOG_CODE.test(code)) {
    fail('CODE_INVALID', '/code', 'code must match ^[A-Z0-9][A-Z0-9-]{1,39}$');
  }
  const name = raw['name'];
  if (!isString(name) || name.trim().length < 1 || name.trim().length > 100) {
    fail('NAME_INVALID', '/name', 'name must have 1..100 characters');
  }
  const legalName = raw['legalName'];
  if (legalName !== undefined && legalName !== null && (!isString(legalName) || legalName.length > 200)) {
    fail('NAME_INVALID', '/legalName', 'legalName must have at most 200 characters');
  }
  const category = raw['category'];
  if (!inSet(CATALOG_CATEGORIES, category)) {
    fail('CATEGORY_INVALID', '/category', `category must be one of ${CATALOG_CATEGORIES.join(', ')}`);
  }
  const kind = raw['kind'];
  if (!inSet(INSTITUTION_KINDS, kind)) {
    fail('KIND_INVALID', '/kind', `kind must be one of ${INSTITUTION_KINDS.join(', ')}`);
  } else if (inSet(CATALOG_CATEGORIES, category) && KIND_OF_CATEGORY[category] !== kind) {
    fail(
      'CATEGORY_KIND_MISMATCH',
      '/kind',
      `category ${category} maps to kind ${KIND_OF_CATEGORY[category]}, not ${kind}`,
    );
  }
  const website = raw['website'];
  if (website !== undefined && website !== null && (!isString(website) || !isHttpUrl(website))) {
    fail('WEBSITE_INVALID', '/website', 'website must be an http(s) URL');
  }
  let adoptable = true;
  if (raw['adoptable'] !== undefined) {
    if (typeof raw['adoptable'] !== 'boolean')
      fail('ADOPTABLE_INVALID', '/adoptable', 'adoptable must be a boolean');
    else adoptable = raw['adoptable'];
  }
  if (category === 'EXCHANGE_HOUSE') {
    if (raw['adoptable'] === true) {
      fail(
        'EXCHANGE_HOUSE_NOT_ADOPTABLE',
        '/adoptable',
        'exchange houses are not adoptable: nobody holds an account in them (design.md decisión 3)',
      );
    }
    adoptable = false;
  }

  const listing = raw['listing'];
  let listingStatus: ListingStatus = 'ACTIVE';
  let since: string | null = null;
  if (!isObject(listing) || !inSet(['ACTIVE', 'DELISTED'] as const, listing['status'])) {
    fail('LISTING_INVALID', '/listing/status', 'listing.status must be ACTIVE or DELISTED');
  } else {
    listingStatus = listing['status'];
    const rawSince = listing['since'];
    if (rawSince !== undefined && rawSince !== null && !isCalendarDate(rawSince)) {
      fail('LISTING_INVALID', '/listing/since', 'listing.since must be a date (YYYY-MM-DD)');
    } else if (isString(rawSince)) since = rawSince;
    if (listingStatus === 'DELISTED' && since === null) {
      fail(
        'DELISTED_SINCE_REQUIRED',
        '/listing/since',
        'a DELISTED entry needs the date it left the registry',
      );
    }
  }

  const verification = raw['verification'];
  let verificationStatus: VerificationStatus = 'CONFIRMED';
  let verificationNote: string | null = null;
  if (!isObject(verification) || !inSet(['CONFIRMED', 'PENDING'] as const, verification['status'])) {
    fail('VERIFICATION_INVALID', '/verification/status', 'verification.status must be CONFIRMED or PENDING');
  } else {
    verificationStatus = verification['status'];
    verificationNote = isString(verification['note']) ? verification['note'] : null;
  }

  const support = validateSupport(raw['support'], `${path}/support`, options, add);
  if (!support) ok = false;

  if (!ok || !support) return null;
  return {
    code: code as string,
    name: (name as string).trim(),
    legalName: isString(legalName) ? legalName : null,
    category: category as CatalogCategory,
    kind: kind as InstitutionKind,
    adoptable,
    website: isString(website) ? website : null,
    listing: { status: listingStatus, since },
    verification: { status: verificationStatus, note: verificationNote },
    support,
  };
}

function validateSupport(
  raw: unknown,
  path: string,
  options: ValidateCatalogOptions,
  add: Add,
): Record<SupportDimension, SupportState> | null {
  if (!isObject(raw)) {
    add('SUPPORT_REQUIRED', path, 'support (rates, statementImport) is required');
    return null;
  }
  const out: Partial<Record<SupportDimension, SupportState>> = {};
  let ok = true;
  for (const dimension of SUPPORT_DIMENSIONS) {
    const state = validateSupportState(raw[dimension], dimension, `${path}/${dimension}`, options, add);
    if (state) out[dimension] = state;
    else ok = false;
  }
  return ok ? (out as Record<SupportDimension, SupportState>) : null;
}

function validateSupportState(
  raw: unknown,
  dimension: SupportDimension,
  path: string,
  options: ValidateCatalogOptions,
  add: Add,
): SupportState | null {
  if (!isObject(raw)) {
    add('SUPPORT_REQUIRED', path, `support.${dimension} is required`);
    return null;
  }
  let ok = true;
  const fail = (code: string, p: string, message: string, details?: Record<string, unknown>) => {
    add(code, `${path}${p}`, message, details);
    ok = false;
  };

  const status = raw['status'];
  if (!inSet(STATUSES_OF_DIMENSION[dimension], status)) {
    fail(
      'SUPPORT_STATUS_INVALID',
      '/status',
      `${dimension} status must be one of ${STATUSES_OF_DIMENSION[dimension].join(', ')}`,
    );
  }
  if (!isCalendarDate(raw['evaluatedOn'])) {
    fail(
      'EVALUATED_ON_REQUIRED',
      '/evaluatedOn',
      'evaluatedOn (YYYY-MM-DD) is required in every support status',
    );
  }
  const note = isString(raw['note']) && raw['note'].trim() !== '' ? raw['note'] : null;
  const rawReason = raw['reason'];
  let reason: NotEligibleReason | null = null;
  if (status === 'NOT_ELIGIBLE') {
    if (rawReason === undefined || rawReason === null || rawReason === '') {
      fail('NOT_ELIGIBLE_REASON_REQUIRED', '/reason', 'NOT_ELIGIBLE requires a reason from the closed set');
    } else if (!inSet(NOT_ELIGIBLE_REASONS, rawReason)) {
      fail(
        'NOT_ELIGIBLE_REASON_INVALID',
        '/reason',
        `reason must be one of ${NOT_ELIGIBLE_REASONS.join(', ')}`,
      );
    } else {
      reason = rawReason;
      if (reason === 'OTHER' && note === null) {
        fail('NOT_ELIGIBLE_NOTE_REQUIRED', '/note', 'the reason OTHER requires an explanatory note');
      }
    }
  } else if (rawReason !== undefined && rawReason !== null) {
    fail('REASON_NOT_ALLOWED', '/reason', 'reason is only allowed with NOT_ELIGIBLE');
  }

  const rawProviders = raw['providerIds'];
  const providerIds: string[] = [];
  if (rawProviders !== undefined) {
    if (!Array.isArray(rawProviders) || !rawProviders.every((p) => isString(p) && p !== '')) {
      fail('PROVIDER_IDS_INVALID', '/providerIds', 'providerIds must be an array of provider ids');
    } else providerIds.push(...(rawProviders as string[]));
  }
  if (dimension === 'rates' && status === 'SUPPORTED') {
    if (providerIds.length === 0) {
      fail(
        'SUPPORTED_WITHOUT_PROVIDER',
        '/providerIds',
        'SUPPORTED rates need at least one provider with verified terms',
      );
    }
    providerIds.forEach((id, i) => {
      if (options.terms(id) !== 'VERIFIED') {
        fail(
          'PROVIDER_TERMS_NOT_VERIFIED',
          `/providerIds/${i}`,
          `provider ${id} has no verified terms (NFR-COMP-007): the entity cannot be SUPPORTED`,
          { providerId: id },
        );
      }
    });
  }

  if (!ok) return null;
  return {
    status: status as SupportStatus,
    reason,
    evaluatedOn: raw['evaluatedOn'] as string,
    adr: isString(raw['adr']) ? raw['adr'] : null,
    providerIds,
    note,
  };
}
