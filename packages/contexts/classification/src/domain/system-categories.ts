import { DomainError } from '@pf/shared-kernel';

export type CategoryKind = 'EXPENSE' | 'INCOME';
export const CATEGORY_KINDS: readonly CategoryKind[] = ['EXPENSE', 'INCOME'];
export const isCategoryKind = (v: unknown): v is CategoryKind => v === 'EXPENSE' || v === 'INCOME';

export type SupportedLocale = 'es' | 'en' | 'pt';

export type SystemCode =
  | 'FEES'
  | 'FX_FEES'
  | 'INTEREST'
  | 'LOAN_FEES'
  | 'INSURANCE'
  | 'TAXES'
  | 'ADJUSTMENTS'
  | 'UNCATEGORIZED'
  | 'INTEREST_EARNED'
  | 'ADJUSTMENTS_INCOME'
  | 'UNCATEGORIZED_INCOME';

export interface SystemCategoryDefinition {
  readonly code: SystemCode;
  readonly kind: CategoryKind;
  /** Nombre (es) del grupo de usuario donde se provisiona inicialmente. */
  readonly group: string;
  readonly names: Readonly<Record<SupportedLocale, string>>;
}

const def = (
  code: SystemCode,
  kind: CategoryKind,
  group: string,
  es: string,
  en: string,
  pt: string,
): SystemCategoryDefinition => ({ code, kind, group, names: { es, en, pt } });

/**
 * `SystemCategoryCatalog` (design §6, docs/31 D9): los 11 códigos de sistema, su tipo, grupo inicial y nombres
 * visibles por locale. `OPENING_BALANCE` y `CASHBACK` NO se provisionan (preguntas abiertas del design).
 */
export const SYSTEM_CATEGORY_CATALOG: readonly SystemCategoryDefinition[] = [
  def('FEES', 'EXPENSE', 'Finanzas', 'Comisiones', 'Fees', 'Tarifas'),
  def('FX_FEES', 'EXPENSE', 'Finanzas', 'Comisiones de cambio', 'FX fees', 'Tarifas de câmbio'),
  def('INTEREST', 'EXPENSE', 'Finanzas', 'Intereses pagados', 'Interest paid', 'Juros pagos'),
  def('LOAN_FEES', 'EXPENSE', 'Finanzas', 'Comisiones de préstamo', 'Loan fees', 'Tarifas de empréstimo'),
  def('INSURANCE', 'EXPENSE', 'Finanzas', 'Seguros', 'Insurance', 'Seguros'),
  def('TAXES', 'EXPENSE', 'Finanzas', 'Impuestos', 'Taxes', 'Impostos'),
  def('ADJUSTMENTS', 'EXPENSE', 'Otros gastos', 'Ajustes', 'Adjustments', 'Ajustes'),
  def('UNCATEGORIZED', 'EXPENSE', 'Otros gastos', 'Sin categoría', 'Uncategorized', 'Sem categoria'),
  def(
    'INTEREST_EARNED',
    'INCOME',
    'Otros ingresos',
    'Intereses ganados',
    'Interest earned',
    'Juros recebidos',
  ),
  def('ADJUSTMENTS_INCOME', 'INCOME', 'Otros ingresos', 'Ajustes', 'Adjustments', 'Ajustes'),
  def('UNCATEGORIZED_INCOME', 'INCOME', 'Otros ingresos', 'Sin categoría', 'Uncategorized', 'Sem categoria'),
];

const BY_CODE = new Map(SYSTEM_CATEGORY_CATALOG.map((d) => [d.code, d]));

export const isSystemCode = (v: unknown): v is SystemCode =>
  typeof v === 'string' && BY_CODE.has(v as SystemCode);

export function systemCategory(code: SystemCode): SystemCategoryDefinition {
  const found = BY_CODE.get(code);
  if (!found) throw new Error(`unknown system code ${code}`);
  return found;
}

/** Locale BCP 47 → idioma soportado (`es-BO` → `es`); sin traducción cae a español (TC-CLASSIFICATION-SYSTEM-003). */
export function supportedLocale(locale: string | null | undefined): SupportedLocale {
  const lang = (locale ?? '').toLowerCase().split(/[-_]/)[0];
  return lang === 'en' || lang === 'pt' ? lang : 'es';
}

/** Nombre visible de una categoría de sistema en el locale del usuario. */
export function systemCategoryName(code: SystemCode, locale: string | null | undefined): string {
  return systemCategory(code).names[supportedLocale(locale)];
}

/**
 * `SystemCategoryPolicy` (design §6): una categoría de sistema no se archiva, no se renombra, no cambia de tipo,
 * no tiene padre ni subcategorías ⇒ `SYSTEM_CATEGORY_IMMUTABLE`. Icono, color, orden y grupo (mismo tipo) sí.
 */
export const SystemCategoryPolicy = {
  immutable(detail: string): DomainError {
    return new DomainError('SYSTEM_CATEGORY_IMMUTABLE', detail);
  },
} as const;
