import { FORMAT_LOCALE, MESSAGE_CATALOGS } from './messages.js';
import {
  escapeHtml,
  fill,
  formatDate,
  formatDecimal,
  message,
  type EmailVariant,
  type RenderedEmail,
} from './render.js';
import type { JsonValue, NotificationLocale, NotificationParams } from './types.js';

/**
 * Email del digest del Home (openspec add-cash-flow-forecast; D386): una sección por pregunta, redactada solo con lo que
 * trae `params` (cantidades, porcentajes, estados y fechas; los montos únicamente si se guardaron por el opt-in). Los
 * porcentajes, las cantidades y las fechas siguen el formato del locale del destinatario, con español de respaldo.
 */

type Json = { readonly [key: string]: JsonValue };
const asRecord = (value: JsonValue | undefined): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};

const plural = (locale: NotificationLocale, n: number): '_one' | '_other' =>
  new Intl.PluralRules(FORMAT_LOCALE[locale]).select(n) === 'one' ? '_one' : '_other';

const AMOUNT_ORDER = ['liquid', 'income', 'expense', 'committed', 'spendable', 'savings', 'lowestBalance'];
const QUESTIONS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'];

const num = (v: JsonValue | undefined): number | null => (typeof v === 'number' ? v : null);
const text = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);

/** Frases de una pregunta disponible; vacío si no hay nada que mostrar (se remite a la app). */
function fragmentsOf(q: Json, locale: NotificationLocale, detailed: boolean): string[] {
  const counts = asRecord(q['counts']);
  const percents = asRecord(q['percents']);
  const dates = asRecord(q['dates']);
  const states = asRecord(q['states']);
  const amounts = asRecord(q['amounts']);
  const out: string[] = [];

  const upcoming = num(counts['upcoming7d']);
  if (upcoming !== null) {
    out.push(fill(message(locale, `digest.upcoming${plural(locale, upcoming)}`), { n: String(upcoming) }));
  }
  const overdue = num(counts['overdue']);
  if (overdue !== null && overdue > 0) {
    out.push(fill(message(locale, `digest.overdue${plural(locale, overdue)}`), { n: String(overdue) }));
  }
  for (const [key, template] of [
    ['incomeChange', 'digest.income_change'],
    ['expenseChange', 'digest.expense_change'],
    ['savingsRate', 'digest.savings_rate'],
  ] as const) {
    const value = text(percents[key]);
    if (value !== null) out.push(fill(message(locale, template), { p: formatDecimal(value, locale) }));
  }
  const sign = text(states['spendableSign']);
  if (sign !== null) out.push(message(locale, `digest.spendable_${sign}`));
  const risk = text(states['risk']);
  if (risk !== null) {
    out.push(
      fill(message(locale, `digest.risk_${risk}`), {
        currency: text(states['riskCurrency']) ?? '',
        date: formatDate(text(dates['firstShortfall']) ?? '', locale),
      }),
    );
  }
  const goals = num(counts['goals']);
  if (goals !== null && goals > 0) {
    out.push(fill(message(locale, `digest.goals${plural(locale, goals)}`), { n: String(goals) }));
    const ahead = num(counts['goalsAhead']);
    const onTrack = num(counts['goalsOnTrack']);
    const behind = num(counts['goalsBehind']);
    if (ahead !== null || onTrack !== null || behind !== null) {
      out.push(
        fill(message(locale, 'digest.goals_status'), {
          ahead: String(ahead ?? 0),
          onTrack: String(onTrack ?? 0),
          behind: String(behind ?? 0),
        }),
      );
    }
  }
  if (detailed) {
    for (const key of AMOUNT_ORDER) {
      const money = asRecord(amounts[key]);
      const amount = text(money['amount']);
      const currency = text(money['currency']);
      if (amount !== null && currency !== null) {
        out.push(
          fill(message(locale, `digest.amount.${key}`), {
            amount: `${formatDecimal(amount, locale)} ${currency}`,
          }),
        );
      }
    }
  }
  return out;
}

export interface DigestEmailInput {
  readonly locale: NotificationLocale;
  readonly variant: EmailVariant;
  readonly params: NotificationParams;
  /** Página principal de la app autenticada (el Home). */
  readonly homeUrl: string;
  readonly preferencesUrl: string;
}

/** Secciones del digest ya redactadas: título de la pregunta y sus frases. */
export function digestSections(
  params: NotificationParams,
  locale: NotificationLocale,
  variant: EmailVariant,
): { readonly title: string; readonly lines: readonly string[] }[] {
  const questions = Array.isArray(params['questions']) ? (params['questions'] as JsonValue[]) : [];
  const byQuestion = new Map(questions.map((q) => [String(asRecord(q)['question']), asRecord(q)]));
  return QUESTIONS.map((id) => {
    const q = byQuestion.get(id);
    const title = message(locale, `digest.q.${id}`);
    if (!q || q['status'] !== 'AVAILABLE') {
      const specific = `digest.no_data.${id}`;
      return {
        title,
        lines: [message(locale, specific in MESSAGE_CATALOGS.es ? specific : 'digest.no_data')],
      };
    }
    const lines = fragmentsOf(q, locale, variant === 'detailed');
    return { title, lines: lines.length > 0 ? lines : [message(locale, 'digest.see_app')] };
  });
}

export function renderHomeDigestEmail(input: DigestEmailInput): RenderedEmail {
  const { locale, variant, params } = input;
  const subject = message(locale, 'email.home_digest.subject');
  const intro = fill(
    message(
      locale,
      params['frequency'] === 'MONTHLY'
        ? 'email.home_digest.intro_monthly'
        : 'email.home_digest.intro_weekly',
    ),
    { date: formatDate(typeof params['generatedOn'] === 'string' ? params['generatedOn'] : '', locale) },
  );
  const sections = digestSections(params, locale, variant);
  const cta = message(locale, 'email.home_digest.cta');
  const footer = message(locale, 'email.footer');
  const preferences = message(locale, 'email.preferences');

  const textBody = [
    intro,
    '',
    ...sections.flatMap((s) => [s.title, ...s.lines.map((l) => `- ${l}`), '']),
    `${cta}: ${input.homeUrl}`,
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
    `<p>${escapeHtml(intro)}</p>`,
    ...sections.map(
      (s) =>
        `<h3 style="margin-bottom:4px">${escapeHtml(s.title)}</h3><ul>${s.lines
          .map((l) => `<li>${escapeHtml(l)}</li>`)
          .join('')}</ul>`,
    ),
    `<p><a href="${escapeHtml(input.homeUrl)}">${escapeHtml(cta)}</a></p>`,
    '<hr style="border:none;border-top:1px solid #d1d5db">',
    `<p style="font-size:12px;color:#6b7280">${escapeHtml(footer)} `,
    `<a href="${escapeHtml(input.preferencesUrl)}">${escapeHtml(preferences)}</a></p>`,
    '</body></html>',
    '',
  ].join('\n');

  return { subject, text: textBody, html };
}
