import { DomainError } from '@pf/shared-kernel';
import {
  BUDGET_THRESHOLD_MESSAGE_KEY,
  MONTH_CLOSE_PENDING_MESSAGE_KEY,
  RECURRING_APPROVAL_REQUIRED_MESSAGE_KEY,
  RECURRING_PAYMENT_UPCOMING_MESSAGE_KEY,
  SUBSCRIPTION_PRICE_CHANGE_MESSAGE_KEY,
  SUBSCRIPTION_RENEWAL_MESSAGE_KEY,
  SUBSCRIPTION_TRIAL_ENDING_MESSAGE_KEY,
} from './type-catalog.js';
import { FORMAT_LOCALE, MESSAGE_CATALOGS } from './messages.js';
import type { JsonValue, NotificationLocale, NotificationParams } from './types.js';

/**
 * Render de las notificaciones (design decisiones 3 y 8). Funciones puras: el texto no se guarda, se compone al leer
 * (in-app) y al despachar (email) con el idioma actual del destinatario y los nombres vigentes del objetivo.
 */

/** Nombres que se resuelven al presentar (nunca viajan en el hecho de origen). */
export interface RenderNames {
  /** Categoría, grupo o tag de la línea; `null` si ya no existe (se muestra un texto genérico). */
  readonly targetName: string | null;
}

export type EmailVariant = 'basic' | 'detailed';

export interface RenderedInApp {
  readonly title: string;
  readonly body: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

// ──────────────────────────────────────────────────────────────────────────── formato por locale (sin float)

const separatorsCache = new Map<string, { decimal: string; group: string }>();

function separatorsOf(tag: string): { decimal: string; group: string } {
  let cached = separatorsCache.get(tag);
  if (!cached) {
    const parts = new Intl.NumberFormat(tag, { useGrouping: true }).formatToParts(12345.6);
    cached = {
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
      group: parts.find((p) => p.type === 'group')?.value ?? ',',
    };
    separatorsCache.set(tag, cached);
  }
  return cached;
}

/**
 * Formatea un decimal canónico (`"1234.50"`) con los separadores del locale conservando su escala: es una
 * manipulación de texto, jamás pasa por `number` (INV-001, NFR-USAB-002).
 */
export function formatDecimal(amount: string, locale: NotificationLocale): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!m) return amount;
  const { decimal, group } = separatorsOf(FORMAT_LOCALE[locale]);
  const integer = (m[2] ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${m[1] ?? ''}${integer}${m[3] ? `${decimal}${m[3]}` : ''}`;
}

const formatPercent = (value: string, locale: NotificationLocale): string => formatDecimal(value, locale);

/** `2026-10-31` → fecha corta del locale (es/pt `31/10/2026`, en `10/31/2026`) sin pasar por la zona del servidor. */
export function formatDate(isoDate: string, locale: NotificationLocale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  return locale === 'en' ? `${mo}/${d}/${y}` : `${d}/${mo}/${y}`;
}

function listOf(items: readonly string[], locale: NotificationLocale): string {
  return new Intl.ListFormat(FORMAT_LOCALE[locale], { style: 'long', type: 'conjunction' }).format(items);
}

// ──────────────────────────────────────────────────────────────────────────── lectura de params

const str = (params: NotificationParams, key: string): string => {
  const value = params[key];
  return typeof value === 'string' ? value : '';
};

function money(params: NotificationParams, key: string): { amount: string; currency: string } {
  const value = params[key];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as { readonly [k: string]: JsonValue };
    const amount = record['amount'];
    const currency = record['currency'];
    if (typeof amount === 'string' && typeof currency === 'string') return { amount, currency };
  }
  return { amount: '', currency: '' };
}

function strings(params: NotificationParams, key: string): string[] {
  const value = params[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// ──────────────────────────────────────────────────────────────────────────── plantillas

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? '');

const message = (locale: NotificationLocale, key: string): string => {
  const text = MESSAGE_CATALOGS[locale][key] ?? MESSAGE_CATALOGS.es[key];
  if (text === undefined) throw new DomainError('VALIDATION_FAILED', `unknown message ${key}`);
  return text;
};

type MessageKind =
  | 'budget_threshold'
  | 'month_close_pending'
  | 'recurring_payment_upcoming'
  | 'recurring_approval_required'
  | 'subscription_renewal'
  | 'subscription_trial_ending'
  | 'subscription_price_change';

const moneyText = (value: { amount: string; currency: string }, locale: NotificationLocale): string =>
  `${formatDecimal(value.amount, locale)} ${value.currency}`;

/** `+20.02` → `+20,02` (el signo se conserva; el decimal sigue el locale). */
const signedPercentText = (value: string, locale: NotificationLocale): string => {
  const sign = value.startsWith('-') || value.startsWith('+') ? value[0] : '';
  return `${sign}${formatDecimal(sign === '' ? value : value.slice(1), locale)}`;
};

const isRecurring = (kind: MessageKind): boolean =>
  kind === 'recurring_payment_upcoming' || kind === 'recurring_approval_required';

/** Monto esperado de la ocurrencia ya formateado; `null` si es VARIABLE (sin monto que mostrar). */
function expectedAmountText(params: NotificationParams, locale: NotificationLocale): string | null {
  const expected = params['expected'];
  const currency = str(params, 'currency');
  if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) return null;
  const record = expected as { readonly [k: string]: JsonValue };
  const field = (key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' ? formatDecimal(value, locale) : null;
  };
  const amount = field('amount');
  if (amount !== null) return `${amount} ${currency}`;
  const min = field('min');
  const max = field('max');
  return min !== null && max !== null ? `${min} – ${max} ${currency}` : null;
}

function kindOf(messageKey: string): MessageKind {
  if (messageKey === BUDGET_THRESHOLD_MESSAGE_KEY) return 'budget_threshold';
  if (messageKey === MONTH_CLOSE_PENDING_MESSAGE_KEY) return 'month_close_pending';
  if (messageKey === RECURRING_PAYMENT_UPCOMING_MESSAGE_KEY) return 'recurring_payment_upcoming';
  if (messageKey === RECURRING_APPROVAL_REQUIRED_MESSAGE_KEY) return 'recurring_approval_required';
  if (messageKey === SUBSCRIPTION_RENEWAL_MESSAGE_KEY) return 'subscription_renewal';
  if (messageKey === SUBSCRIPTION_TRIAL_ENDING_MESSAGE_KEY) return 'subscription_trial_ending';
  if (messageKey === SUBSCRIPTION_PRICE_CHANGE_MESSAGE_KEY) return 'subscription_price_change';
  throw new DomainError('VALIDATION_FAILED', `unknown message key ${messageKey}`);
}

/** Valores de los marcadores de un tipo, ya formateados para el locale. */
function valuesOf(
  kind: MessageKind,
  params: NotificationParams,
  names: RenderNames,
  locale: NotificationLocale,
): Record<string, string> {
  if (kind === 'budget_threshold') {
    const reference = money(params, 'reference');
    const actual = money(params, 'actual');
    const also = strings(params, 'alsoCrossed').map((t) => `${formatPercent(t, locale)} %`);
    return {
      target: names.targetName ?? message(locale, 'inapp.budget_threshold.unknown_target'),
      threshold: formatPercent(str(params, 'threshold'), locale),
      period: str(params, 'periodLabel'),
      actual: formatDecimal(actual.amount, locale),
      reference: formatDecimal(reference.amount, locale),
      currency: reference.currency,
      utilization: formatPercent(str(params, 'utilization'), locale),
      also: listOf(also, locale),
    };
  }
  if (isRecurring(kind)) {
    return {
      name: str(params, 'name'),
      dueDate: formatDate(str(params, 'dueDate'), locale),
      amount: expectedAmountText(params, locale) ?? '',
    };
  }
  if (kind === 'subscription_renewal') {
    const price = money(params, 'expectedPrice');
    const charge = money(params, 'expectedCharge');
    return {
      provider: str(params, 'providerName'),
      plan: str(params, 'planName'),
      renewalDate: formatDate(str(params, 'renewalDate'), locale),
      price: moneyText(price, locale),
      charge: charge.currency === '' ? '' : moneyText(charge, locale),
      account: str(params, 'paymentAccountName'),
      days: String(params['daysBefore'] ?? ''),
    };
  }
  if (kind === 'subscription_trial_ending') {
    return {
      provider: str(params, 'providerName'),
      trialEndsOn: formatDate(str(params, 'trialEndsOn'), locale),
      price: moneyText(money(params, 'firstChargePrice'), locale),
      account: str(params, 'paymentAccountName'),
      days: String(params['daysBefore'] ?? ''),
    };
  }
  if (kind === 'subscription_price_change') {
    return {
      provider: str(params, 'providerName'),
      previous: moneyText(money(params, 'previousPrice'), locale),
      next: moneyText(money(params, 'newPrice'), locale),
      percent: signedPercentText(str(params, 'changePercentage'), locale),
      effectiveFrom: formatDate(str(params, 'effectiveFrom'), locale),
    };
  }
  return {
    period: str(params, 'periodLabel'),
    periodEnd: formatDate(str(params, 'periodEnd'), locale),
  };
}

export function renderInApp(
  locale: NotificationLocale,
  messageKey: string,
  params: NotificationParams,
  names: RenderNames,
): RenderedInApp {
  const kind = kindOf(messageKey);
  const values = valuesOf(kind, params, names, locale);
  const title = fill(message(locale, `inapp.${kind}.title`), values);
  const bodyKey = isRecurring(kind) && values['amount'] === '' ? 'body_variable' : 'body';
  let body = fill(message(locale, `inapp.${kind}.${bodyKey}`), values);
  if (kind === 'subscription_renewal') {
    if (values['plan'] !== '')
      body = `${fill(message(locale, 'inapp.subscription_renewal.plan'), values)} ${body}`;
    if (values['charge'] !== '' && values['charge'] !== values['price']) {
      body += ` ${fill(message(locale, 'inapp.subscription_renewal.charge'), values)}`;
    }
    if (params['requiresApproval'] === true)
      body += ` ${message(locale, 'inapp.subscription_renewal.approval')}`;
  }
  if (kind === 'budget_threshold') {
    if (strings(params, 'alsoCrossed').length > 0) {
      body += ` ${fill(message(locale, 'inapp.budget_threshold.also'), values)}`;
    }
    if (params['actualComplete'] === false) {
      body += ` ${fill(message(locale, 'inapp.budget_threshold.partial'), values)}`;
    }
  }
  return { title, body };
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export interface EmailRenderInput {
  readonly locale: NotificationLocale;
  readonly variant: EmailVariant;
  readonly messageKey: string;
  readonly params: NotificationParams;
  readonly names: RenderNames;
  /** `APP_PUBLIC_URL` + `/notificaciones/{id}`: solo ruta e id opaco (decisión 9). */
  readonly notificationUrl: string;
  readonly preferencesUrl: string;
}

/**
 * Email transaccional en texto plano + HTML simple (sin imágenes remotas ni píxeles de seguimiento, decisión 8).
 * La variante `basic` usa SOLO la plantilla `email.<tipo>.basic`: sin montos, saldos ni nombres (FR-NOTIFY-006).
 */
export function renderEmail(input: EmailRenderInput): RenderedEmail {
  const { locale, variant } = input;
  const kind = kindOf(input.messageKey);
  const values = valuesOf(kind, input.params, input.names, locale);
  const subject = message(locale, `email.${kind}.subject`);
  // Variante `basic`: sin montos ni nombres (FR-NOTIFY-006). Una ocurrencia de monto variable no tiene monto que mostrar.
  const variantKey =
    variant === 'detailed' && isRecurring(kind) && values['amount'] === '' ? 'detailed_variable' : variant;
  const line = fill(message(locale, `email.${kind}.${variantKey}`), values);
  const cta = message(locale, 'email.cta');
  const footer = message(locale, 'email.footer');
  const preferences = message(locale, 'email.preferences');

  const text = [
    line,
    '',
    `${cta}: ${input.notificationUrl}`,
    '',
    '--',
    footer,
    `${preferences}: ${input.preferencesUrl}`,
    '',
  ].join('\n');

  const html = [
    '<!doctype html>',
    `<html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>`,
    '<body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">',
    `<p>${escapeHtml(line)}</p>`,
    `<p><a href="${escapeHtml(input.notificationUrl)}">${escapeHtml(cta)}</a></p>`,
    '<hr style="border:none;border-top:1px solid #d1d5db">',
    `<p style="font-size:12px;color:#6b7280">${escapeHtml(footer)} `,
    `<a href="${escapeHtml(input.preferencesUrl)}">${escapeHtml(preferences)}</a></p>`,
    '</body></html>',
    '',
  ].join('\n');

  return { subject, text, html };
}
