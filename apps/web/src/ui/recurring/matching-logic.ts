/**
 * Lógica pura del matching sugerido (openspec add-commitment-matching 6.1; docs/28 §4.8): presentación de la confianza
 * (texto + icono, NFR-USAB-104), motivos explicables, consultas y validación de las tolerancias de la definición. Sin
 * React ni zona horaria del proceso. Los montos son strings decimales (INV-001): se comparan sin pasar por `number`.
 */
import { formatDecimal } from '../AuditHistory';
import type { FormatContext } from '../dashboard/types';
import { LIST_LIMIT, type StatusPresentation } from './logic';
import type {
  MatchConfidence,
  MatchSuggestion,
  MatchingTolerances,
  RecurringAmountType,
  RecurringDefinition,
} from './types';

/** La confianza SIEMPRE se muestra en texto (Alta, Media, Baja); el icono y el color solo refuerzan. */
export const CONFIDENCE_PRESENTATION: Readonly<Record<MatchConfidence, StatusPresentation>> = {
  HIGH: { icon: '●●●', tone: 'ok' },
  MEDIUM: { icon: '●●○', tone: 'warn' },
  LOW: { icon: '●○○', tone: 'neutral' },
};

/** Valores por omisión de la tolerancia de monto según el tipo (docs/35 D120), en %. */
export const DEFAULT_TOLERANCE_PERCENT: Readonly<Record<RecurringAmountType, string>> = {
  FIXED: '2',
  ESTIMATED: '25',
  MIN_MAX: '5',
  VARIABLE: '0',
};
export const DEFAULT_WINDOW_DAYS = 5;
export const MAX_WINDOW_DAYS = 15;

export const proposedQuery = (): string => `status=PROPOSED&limit=${LIST_LIMIT}`;
export const forTransactionQuery = (transactionId: string): string =>
  `status=PROPOSED&transactionId=${encodeURIComponent(transactionId)}&limit=20`;
export const forOccurrenceQuery = (occurrenceId: string): string =>
  `status=PROPOSED&occurrenceId=${encodeURIComponent(occurrenceId)}&limit=20`;
export const matchSuggestionsPath = (base: string, query: string): string =>
  `${base}/recurring/match-suggestions?${query}`;

/** Contador de la pestaña: 99+ como tope visual. */
export const matchesBadge = (count: number): string => (count > 99 ? '99+' : String(count));

/** Es una sugerencia que el EDITOR/OWNER puede confirmar o descartar. */
export const isActionable = (s: Pick<MatchSuggestion, 'status'>, canEdit: boolean): boolean =>
  canEdit && s.status === 'PROPOSED';

/**
 * Motivos legibles de una sugerencia ("mismo monto", "1 día de diferencia", "contraparte sin indicar"): explican el
 * puntaje sin números mágicos. `locale` formatea el monto con la escala que trae la API.
 */
export function matchReasons(s: Pick<MatchSuggestion, 'reasons'>, f: FormatContext): string[] {
  const out: string[] = [];
  const delta = s.reasons.amountDelta;
  if (delta === null) out.push(f.t('matches.reasons.amountVariable'));
  else if (isZero(delta.amount)) out.push(f.t('matches.reasons.amountSame'));
  else
    out.push(
      f.t('matches.reasons.amountDiff', {
        delta: `${formatDecimal(delta.amount, f.locale)} ${delta.currency}`,
      }),
    );
  out.push(
    s.reasons.dateDeltaDays === 0
      ? f.t('matches.reasons.dateSame')
      : f.t('matches.reasons.dateDays', { days: s.reasons.dateDeltaDays }),
  );
  out.push(
    s.reasons.counterparty === 'MATCH'
      ? f.t('matches.reasons.counterpartyMatch')
      : f.t('matches.reasons.counterpartyUnknown'),
  );
  return out;
}

const isZero = (amount: string): boolean => /^-?0+(\.0+)?$/.test(amount);

/** Puntaje con la escala del locale (`85.00` → `85,00`). */
export const formatScore = (score: string, locale: string): string => formatDecimal(score, locale);

/** Texto de la tolerancia efectiva de una definición ("±2 % de monto y ±5 días", marcando lo que es por omisión). */
export function toleranceSummary(
  matching: MatchingTolerances | undefined,
  type: RecurringAmountType,
  f: FormatContext,
): string {
  const percent = matching?.amountTolerancePercent ?? null;
  const days = matching?.dateWindowDays ?? null;
  if (type === 'VARIABLE') {
    return f.t('detail.matchingVariable', {
      days: days ?? DEFAULT_WINDOW_DAYS,
      origin: f.t(days === null ? 'detail.matchingDefault' : 'detail.matchingCustom'),
    });
  }
  return f.t('detail.matchingValue', {
    percent: formatDecimal(percent ?? DEFAULT_TOLERANCE_PERCENT[type], f.locale),
    days: days ?? DEFAULT_WINDOW_DAYS,
    origin: f.t(percent === null && days === null ? 'detail.matchingDefault' : 'detail.matchingCustom'),
  });
}

export interface ToleranceForm {
  readonly percent: string;
  readonly days: string;
}

export const toleranceFormOf = (definition: Pick<RecurringDefinition, 'matching'>): ToleranceForm => ({
  percent: definition.matching?.amountTolerancePercent ?? '',
  days:
    definition.matching?.dateWindowDays === null || definition.matching === undefined
      ? ''
      : String(definition.matching.dateWindowDays),
});

export type ToleranceErrors = Partial<Record<'percent' | 'days', 'TOLERANCE_PERCENT' | 'TOLERANCE_DAYS'>>;

/**
 * Parche `matching` de `PATCH …/recurring/{id}` a partir del formulario: vacío = `null` (valor por omisión); solo
 * incluye lo que cambió. La API valida de nuevo (porcentaje 0..100 con 2 decimales, días enteros 0..15).
 */
export function buildMatchingPatch(
  form: ToleranceForm,
  current: MatchingTolerances | undefined,
  locale: string,
):
  | { ok: true; patch: Record<string, string | number | null> | null }
  | { ok: false; errors: ToleranceErrors } {
  const errors: ToleranceErrors = {};
  const patch: Record<string, string | number | null> = {};
  const percentText = form.percent.trim();
  if (percentText !== '' || current?.amountTolerancePercent) {
    let next: string | null = null;
    if (percentText !== '') {
      const normalized = normalizeDecimal(percentText, locale);
      if (normalized === null || !/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/.test(normalized)) {
        errors.percent = 'TOLERANCE_PERCENT';
      } else next = normalized;
    }
    if (!errors.percent && !sameDecimal(next, current?.amountTolerancePercent ?? null)) {
      patch['amountTolerancePercent'] = next;
    }
  }
  const daysText = form.days.trim();
  if (daysText !== '' || (current?.dateWindowDays ?? null) !== null) {
    let next: number | null = null;
    if (daysText !== '') {
      if (!/^\d{1,2}$/.test(daysText) || Number(daysText) > MAX_WINDOW_DAYS) errors.days = 'TOLERANCE_DAYS';
      else next = Number(daysText);
    }
    if (!errors.days && next !== (current?.dateWindowDays ?? null)) patch['dateWindowDays'] = next;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, patch: Object.keys(patch).length === 0 ? null : patch };
}

/** `5,5` (coma decimal del locale) o `5.5` → `5.5`; `null` si no es un decimal sin separador de miles. */
function normalizeDecimal(text: string, locale: string): string | null {
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
  const value = text.replace(decimal, '.');
  return /^\d+(\.\d+)?$/.test(value) ? value : null;
}

const sameDecimal = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null) return a === b;
  const trim = (v: string) => {
    const [i = '0', f = ''] = v.split('.');
    return `${i.replace(/^0+(?=\d)/, '')}.${f.replace(/0+$/, '')}`;
  };
  return trim(a) === trim(b);
};
