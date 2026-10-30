import type { MappingProfileVersion } from './mapping-profile.js';
import type { ColumnRef, ProfileAmount, ProfileColumns, ProfileMapping } from './profile-options.js';
import type { StatementFormat } from './statement.js';

/**
 * `ProfileMatcher` (FR-IMPORTS-005, openspec add-import-pipeline decisión 6): elige el perfil que se aplica solo a un
 * archivo. Orden: perfiles vigentes de la CUENTA, luego los de su INSTITUCIÓN (del mismo formato), cada grupo por
 * `updatedAt` descendente. Se aplica el primero cuyas columnas obligatorias existen en el encabezado, comparando sin
 * mayúsculas ni acentos; las posiciones se resuelven por nombre. Sin coincidencia: candidatos y columnas que faltan.
 */
export interface ProfileMatchInput {
  readonly header: readonly string[];
  readonly format: StatementFormat;
  readonly accountId: string;
  readonly institutionId: string | null;
  /** Última versión de cada perfil NO archivado del workspace (los archivados no se sugieren ni se aplican). */
  readonly profiles: readonly (MappingProfileVersion & {
    readonly updatedAt: string;
    readonly archivedAt?: string | null | undefined;
  })[];
}

export interface ProfileCandidate {
  readonly profileId: string;
  readonly version: number;
  readonly name: string;
  readonly missingColumns: readonly string[];
}

export type ProfileMatch =
  | {
      readonly kind: 'APPLIED';
      readonly profileId: string;
      readonly version: number;
      /** Mapeo con las posiciones resueltas contra el encabezado real (`null` en formatos autodescritos). */
      readonly mapping: ProfileMapping | null;
      readonly profile: MappingProfileVersion;
    }
  | {
      readonly kind: 'AWAITING_MAPPING';
      readonly candidates: readonly ProfileCandidate[];
      readonly missingColumns: readonly string[];
    }
  | { readonly kind: 'NONE' };

/** Minúsculas, sin acentos, espacios colapsados: clave de comparación de nombres de columna. */
export function headerKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

type Resolver = (ref: ColumnRef) => ColumnRef;

/** Resuelve el mapeo contra el encabezado; devuelve el mapeo resuelto o los nombres que faltan. */
export function resolveMapping(
  mapping: ProfileMapping,
  header: readonly string[],
):
  | { readonly ok: true; readonly mapping: ProfileMapping }
  | { readonly ok: false; readonly missing: string[] } {
  const keys = header.map(headerKey);
  const missing: string[] = [];
  const resolve: Resolver = (ref) => {
    if (ref.header !== undefined) {
      const at = keys.indexOf(headerKey(ref.header));
      if (at < 0) {
        missing.push(ref.header);
        return ref;
      }
      return { index: at, header: ref.header };
    }
    if (ref.index >= header.length) missing.push(`#${ref.index}`);
    return ref;
  };
  const c = mapping.columns;
  const amount: ProfileAmount =
    c.amount.mode === 'SIGNED'
      ? { ...c.amount, column: resolve(c.amount.column) }
      : c.amount.mode === 'DEBIT_CREDIT'
        ? { ...c.amount, debit: resolve(c.amount.debit), credit: resolve(c.amount.credit) }
        : { ...c.amount, column: resolve(c.amount.column), indicator: resolve(c.amount.indicator) };
  const columns: ProfileColumns = {
    ...c,
    date: resolve(c.date),
    description: c.description.map(resolve),
    amount,
    ...(c.currency ? { currency: { ...c.currency, column: resolve(c.currency.column) } } : {}),
    ...(c.reference ? { reference: { ...c.reference, column: resolve(c.reference.column) } } : {}),
    ...(c.runningBalance ? { runningBalance: resolve(c.runningBalance) } : {}),
    ...(c.time ? { time: { ...c.time, column: resolve(c.time.column) } } : {}),
    ...(c.valueDate ? { valueDate: resolve(c.valueDate) } : {}),
  };
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, mapping: { ...mapping, columns } };
}

export function matchProfile(input: ProfileMatchInput): ProfileMatch {
  const live = input.profiles.filter((p) => p.format === input.format && (p.archivedAt ?? null) === null);
  const byRecent = (a: { updatedAt: string }, b: { updatedAt: string }) =>
    a.updatedAt < b.updatedAt ? 1 : -1;
  const ofAccount = live.filter((p) => p.accountId === input.accountId).sort(byRecent);
  const ofInstitution = live
    .filter(
      (p) => p.accountId === null && input.institutionId !== null && p.institutionId === input.institutionId,
    )
    .sort(byRecent);
  const ordered = [...ofAccount, ...ofInstitution];
  if (ordered.length === 0) return { kind: 'NONE' };

  const candidates: ProfileCandidate[] = [];
  for (const profile of ordered) {
    const mapping = profile.options.mapping;
    if (mapping === null) {
      // Formatos autodescritos (OFX, JSON, QIF): el perfil solo aporta opciones, no exige columnas.
      return { kind: 'APPLIED', profileId: profile.id, version: profile.version, mapping: null, profile };
    }
    const resolved = resolveMapping(mapping, input.header);
    if (resolved.ok) {
      return {
        kind: 'APPLIED',
        profileId: profile.id,
        version: profile.version,
        mapping: resolved.mapping,
        profile,
      };
    }
    candidates.push({
      profileId: profile.id,
      version: profile.version,
      name: profile.name,
      missingColumns: resolved.missing,
    });
  }
  const missing = [...new Set(candidates.flatMap((c) => c.missingColumns))];
  return { kind: 'AWAITING_MAPPING', candidates, missingColumns: missing };
}
