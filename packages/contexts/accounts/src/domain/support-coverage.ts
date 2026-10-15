import { dec, MoneyDecimal } from '@pf/shared-kernel';
import {
  CATALOG_CATEGORIES,
  NOT_ELIGIBLE_REASONS,
  PENDING_STATUSES,
  RESOLVED_STATUSES,
  SUPPORT_DIMENSIONS,
  SUPPORT_STATUSES,
  type CatalogCategory,
  type InstitutionCatalog,
  type NotEligibleReason,
  type SupportDimension,
  type SupportStatus,
} from './institution-catalog.js';

export interface CategoryCoverage {
  readonly category: CatalogCategory;
  /** Entidades de la categoría declaradas por la fuente oficial a la fecha de corte. */
  readonly census: number;
  /** Entradas ACTIVAS del catálogo en la categoría. */
  readonly entries: number;
  /** `min(entries, census) / census` en %, HALF_EVEN a 2 decimales (`100.00` si el censo es 0). */
  readonly censusCoveragePct: string;
}

export interface StatusCount {
  readonly status: SupportStatus;
  readonly reason: NotEligibleReason | null;
  readonly count: number;
}

export interface DimensionCoverage {
  readonly dimension: SupportDimension;
  /** Entradas activas con estado resuelto (`SUPPORTED`, `GENERIC_ONLY`, `NOT_ELIGIBLE`, `NOT_APPLICABLE`). */
  readonly resolved: number;
  /** Entradas activas con estado pendiente (`IN_VERIFICATION`, `PENDING_SAMPLE`). */
  readonly pending: number;
  /** `resolved / (resolved + pending)` en %, HALF_EVEN a 2 decimales (`100.00` sin entradas activas). */
  readonly resolvedPct: string;
  readonly byStatus: readonly StatusCount[];
  /** Las `NOT_ELIGIBLE` informadas aparte, por razón, para no presentarlas como soportadas. */
  readonly notEligible: readonly { readonly reason: NotEligibleReason; readonly count: number }[];
}

export interface SupportCoverage {
  /** Censo 100 % cubierto y ninguna entrada ACTIVA pendiente en ninguna dimensión (design.md decisión 6). */
  readonly complete: boolean;
  /** Cobertura global del censo: Σ cubiertas / Σ censo. */
  readonly censusCoveragePct: string;
  readonly byCategory: readonly CategoryCoverage[];
  readonly byDimension: readonly DimensionCoverage[];
}

/**
 * Porcentaje `part / whole × 100` con Decimal, redondeado HALF_EVEN a 2 decimales (nunca `number`). `whole = 0` ⇒
 * `100.00`: no hay nada pendiente ni que cubrir.
 */
export function percentHalfEven(part: number, whole: number): string {
  if (whole === 0) return '100.00';
  return dec(String(part))
    .mul(100)
    .div(String(whole))
    .toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_EVEN)
    .toFixed(2);
}

/**
 * `SupportCoverage` (accounts/institutions, "Medición del soporte completo"; TDD + PBT): cobertura del censo oficial
 * por categoría y estado de soporte por dimensión. SOLO cuentan las entradas `ACTIVE`: una `DELISTED` no es pendiente.
 */
export function computeSupportCoverage(catalog: InstitutionCatalog): SupportCoverage {
  const active = catalog.entries.filter((e) => e.listing.status === 'ACTIVE');

  const censusOf = new Map(catalog.census.map((c) => [c.category, c.count] as const));
  const categories = CATALOG_CATEGORIES.filter(
    (c) => censusOf.has(c) || active.some((e) => e.category === c),
  );
  const byCategory: CategoryCoverage[] = categories.map((category) => {
    const census = censusOf.get(category) ?? 0;
    const entries = active.filter((e) => e.category === category).length;
    return {
      category,
      census,
      entries,
      censusCoveragePct: percentHalfEven(Math.min(entries, census), census),
    };
  });
  const totalCensus = byCategory.reduce((acc, c) => acc + c.census, 0);
  const totalCovered = byCategory.reduce((acc, c) => acc + Math.min(c.entries, c.census), 0);

  const byDimension: DimensionCoverage[] = SUPPORT_DIMENSIONS.map((dimension) => {
    const counts = new Map<string, StatusCount>();
    let resolved = 0;
    let pending = 0;
    for (const entry of active) {
      const state = entry.support[dimension];
      if (RESOLVED_STATUSES.includes(state.status)) resolved++;
      else if (PENDING_STATUSES.includes(state.status)) pending++;
      const key = `${state.status}|${state.reason ?? ''}`;
      const current = counts.get(key);
      counts.set(key, {
        status: state.status,
        reason: state.reason,
        count: (current?.count ?? 0) + 1,
      });
    }
    const byStatus = [...counts.values()].sort(
      (a, b) =>
        SUPPORT_STATUSES.indexOf(a.status) - SUPPORT_STATUSES.indexOf(b.status) ||
        reasonRank(a.reason) - reasonRank(b.reason),
    );
    const notEligible = byStatus
      .filter((s): s is StatusCount & { reason: NotEligibleReason } => s.status === 'NOT_ELIGIBLE' && s.reason !== null)
      .map((s) => ({ reason: s.reason, count: s.count }));
    return {
      dimension,
      resolved,
      pending,
      resolvedPct: percentHalfEven(resolved, resolved + pending),
      byStatus,
      notEligible,
    };
  });

  return {
    complete: byCategory.every((c) => c.entries >= c.census) && byDimension.every((d) => d.pending === 0),
    censusCoveragePct: percentHalfEven(totalCovered, totalCensus),
    byCategory,
    byDimension,
  };
}

const reasonRank = (reason: NotEligibleReason | null): number =>
  reason === null ? -1 : NOT_ELIGIBLE_REASONS.indexOf(reason);
