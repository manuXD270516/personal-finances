import { parseAmount, scaleFor, type AmountError } from '../common/money';

/**
 * Lógica pura de las pantallas de identidad (add-workspace-identity 8.4): configuración del workspace
 * (FR-IDENTITY-005), preferencias personales (FR-IDENTITY-003) y el locale de la UI que corresponde a la preferencia.
 * El servidor revalida todo (`INVALID_TIMEZONE`, `VALIDATION_FAILED`, `AMOUNT_SCALE_EXCEEDED`, `REFERENCE_NOT_FOUND`);
 * la UI solo evita viajes inútiles y muestra el error junto al campo.
 */

/** Monedas del catálogo global `fx.currency` de Phase 1 (moneda base y moneda de la reserva). */
export const BASE_CURRENCIES = ['BOB', 'USD', 'USDT', 'BTC', 'ETH'] as const;

/** Zonas sugeridas (el campo acepta cualquier identificador IANA). */
export const SUGGESTED_TIME_ZONES = [
  'America/La_Paz',
  'America/Sao_Paulo',
  'America/Lima',
  'America/Bogota',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Mexico_City',
  'America/New_York',
  'Europe/Madrid',
  'UTC',
] as const;

/** Locales de formato/preferencia admitidos: español de Bolivia por defecto, inglés y portugués. */
export const FORMAT_LOCALES = ['es-BO', 'en-US', 'pt-BR'] as const;

export type UiLocale = 'es' | 'en' | 'pt';

/** Locale de la UI (rutas `/`, `/en`, `/pt`) que corresponde a un locale BCP 47 (`en-US` ⇒ `en`). */
export function uiLocaleFor(tag: string): UiLocale {
  const lang = tag.trim().toLowerCase().split(/[-_]/)[0];
  return lang === 'en' || lang === 'pt' ? lang : 'es';
}

/**
 * Ruta equivalente en otro locale de la UI (`localePrefix: as-needed`: español sin prefijo). Conserva la ruta y
 * la query: `/en/preferencias?x=1` → `/pt/preferencias?x=1`.
 */
export function switchLocalePath(pathWithQuery: string, target: UiLocale): string {
  const [path = '/', query] = splitOnce(pathWithQuery, '?');
  const bare = path.replace(/^\/(?:en|pt|es)(?=\/|$)/, '') || '/';
  const prefixed = target === 'es' ? bare : `/${target}${bare === '/' ? '' : bare}`;
  return query === undefined ? prefixed : `${prefixed}?${query}`;
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

/** Identificador IANA aceptado por el runtime (`America/La_Paz` sí; `GMT-4 Bolivia`, `Bolivia/LaPaz` no). */
export function isValidTimeZone(tz: string): boolean {
  const value = tz.trim();
  if (!value || /\s/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export interface WorkspaceSettingsValues {
  readonly name: string;
  readonly baseCurrency: string;
  readonly timezone: string;
  readonly locale: string;
  readonly fiscalMonthStartDay: number;
  readonly minimumLiquidityReserve: { readonly amount: string; readonly currency: string } | null;
}

/** Estado editable del formulario (todo como texto, tal cual lo escribe el usuario). */
export interface SettingsForm {
  readonly name: string;
  readonly baseCurrency: string;
  readonly timezone: string;
  readonly locale: string;
  readonly fiscal: string;
  readonly reserve: string;
}

export type SettingsField = keyof SettingsForm;

export type SettingsError =
  | { readonly key: 'nameRequired' | 'nameTooLong' | 'timezoneInvalid' | 'fiscalRange' | 'localeRequired' }
  | {
      readonly key: 'reserve';
      readonly amountError: AmountError;
      readonly scale: number;
      readonly currency: string;
    };

export const settingsFormOf = (ws: WorkspaceSettingsValues, formatLocale: string): SettingsForm => ({
  name: ws.name,
  baseCurrency: ws.baseCurrency,
  timezone: ws.timezone,
  locale: ws.locale,
  fiscal: String(ws.fiscalMonthStartDay),
  reserve: ws.minimumLiquidityReserve
    ? formatReserveForInput(ws.minimumLiquidityReserve.amount, formatLocale)
    : '',
});

/** Decimal canónico → texto de entrada en el locale (`1500.00` ⇒ `1500,00` en es-BO), sin separador de miles. */
export function formatReserveForInput(amount: string, locale: string): string {
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
  return decimal === '.' ? amount : amount.replace('.', decimal);
}

/**
 * Valida el formulario y arma el merge-patch con SOLO los campos que cambiaron (un PATCH sin cambios no se envía).
 * La reserva va en la moneda base elegida, con su escala exacta (sin redondear, INV-020); vacía ⇒ `null`.
 */
export function buildSettingsPatch(
  original: WorkspaceSettingsValues,
  form: SettingsForm,
  opts: { readonly locale: string; readonly scales?: Readonly<Record<string, number>> },
):
  | { readonly ok: true; readonly patch: Partial<WorkspaceSettingsValues> }
  | { readonly ok: false; readonly errors: Partial<Record<SettingsField, SettingsError>> } {
  const errors: Partial<Record<SettingsField, SettingsError>> = {};
  const name = form.name.trim();
  if (!name) errors.name = { key: 'nameRequired' };
  else if (name.length > 100) errors.name = { key: 'nameTooLong' };
  const timezone = form.timezone.trim();
  if (!isValidTimeZone(timezone)) errors.timezone = { key: 'timezoneInvalid' };
  if (!form.locale.trim()) errors.locale = { key: 'localeRequired' };
  const fiscal = /^\d{1,2}$/.test(form.fiscal.trim()) ? Number(form.fiscal.trim()) : NaN;
  if (!(fiscal >= 1 && fiscal <= 28)) errors.fiscal = { key: 'fiscalRange' };
  let reserve: WorkspaceSettingsValues['minimumLiquidityReserve'] = null;
  if (form.reserve.trim()) {
    const scale = scaleFor(form.baseCurrency, opts.scales);
    const r = parseAmount(form.reserve, {
      locale: opts.locale,
      currency: form.baseCurrency,
      scale,
      allowZero: true,
    });
    if (r.ok) reserve = { amount: r.value, currency: form.baseCurrency };
    else errors.reserve = { key: 'reserve', amountError: r.error, scale, currency: form.baseCurrency };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const patch: { -readonly [K in keyof WorkspaceSettingsValues]?: WorkspaceSettingsValues[K] } = {};
  if (name !== original.name) patch.name = name;
  if (form.baseCurrency !== original.baseCurrency) patch.baseCurrency = form.baseCurrency;
  if (timezone !== original.timezone) patch.timezone = timezone;
  if (form.locale !== original.locale) patch.locale = form.locale;
  if (fiscal !== original.fiscalMonthStartDay) patch.fiscalMonthStartDay = fiscal;
  const before = original.minimumLiquidityReserve;
  const sameReserve =
    (before === null && reserve === null) ||
    (before !== null &&
      reserve !== null &&
      before.amount === reserve.amount &&
      before.currency === reserve.currency);
  if (!sameReserve) patch.minimumLiquidityReserve = reserve;
  return { ok: true, patch };
}

export interface PreferencesValues {
  readonly displayName: string;
  readonly locale: string;
  readonly timezone: string;
}

export type PreferencesField = keyof PreferencesValues;
export type PreferencesError = 'displayNameRequired' | 'displayNameTooLong' | 'timezoneInvalid';

/** Valida las preferencias personales y devuelve solo los campos cambiados (merge-patch de `PATCH /me`). */
export function buildPreferencesPatch(
  original: PreferencesValues,
  form: PreferencesValues,
):
  | { readonly ok: true; readonly patch: Partial<PreferencesValues> }
  | { readonly ok: false; readonly errors: Partial<Record<PreferencesField, PreferencesError>> } {
  const errors: Partial<Record<PreferencesField, PreferencesError>> = {};
  const displayName = form.displayName.trim();
  if (!displayName) errors.displayName = 'displayNameRequired';
  else if (displayName.length > 100) errors.displayName = 'displayNameTooLong';
  const timezone = form.timezone.trim();
  if (!isValidTimeZone(timezone)) errors.timezone = 'timezoneInvalid';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const patch: { -readonly [K in keyof PreferencesValues]?: string } = {};
  if (displayName !== original.displayName) patch.displayName = displayName;
  if (form.locale !== original.locale) patch.locale = form.locale;
  if (timezone !== original.timezone) patch.timezone = timezone;
  return { ok: true, patch };
}

/** Opciones de un `<select>` que incluyen el valor actual aunque no esté en la lista sugerida. */
export const withCurrent = (options: readonly string[], current: string): readonly string[] =>
  current && !options.includes(current) ? [current, ...options] : options;
