import type { JsonValue, NotificationParams } from './types.js';

/**
 * Digest periódico del Home por email (openspec add-cash-flow-forecast; FR-NOTIFY-007; D385, D386). Funciones puras: la
 * ventana vigente (semana ISO o periodo financiero) en la zona del workspace, la clave de deduplicación y los parámetros
 * que se guardan con la notificación (solo lo que se va a mostrar: sin montos si el destinatario no activó los detalles).
 */

export const HOME_DIGEST_MESSAGE_KEY = 'notifications.home_digest.v1';

export const DIGEST_FREQUENCY_VALUES = ['OFF', 'WEEKLY', 'MONTHLY'] as const;
export type DigestFrequencyValue = (typeof DIGEST_FREQUENCY_VALUES)[number];

export const isDigestFrequency = (value: unknown): value is DigestFrequencyValue =>
  typeof value === 'string' && (DIGEST_FREQUENCY_VALUES as readonly string[]).includes(value);

/** Hora local a partir de la cual sale el digest el primer día de su ventana (D385: hora fija 08:00). */
export const DIGEST_SEND_MINUTES = 8 * 60;

export interface DigestWindow {
  readonly frequency: 'WEEKLY' | 'MONTHLY';
  /** `2026-W45` (semanal) o la etiqueta `AAAA-MM` del inicio del periodo financiero (mensual). */
  readonly key: string;
  /** Primer día de la ventana (fecha local `AAAA-MM-DD`). */
  readonly startsOn: string;
}

export interface DigestCalendar {
  readonly timeZone: string;
  /** Día de inicio del mes financiero (1..28). */
  readonly fiscalMonthStartDay: number;
}

/** Clave de deduplicación por destinatario y ventana: `HOME_DIGEST:WEEKLY:2026-W45`. */
export const digestDedupeKey = (window: Pick<DigestWindow, 'frequency' | 'key'>): string =>
  `HOME_DIGEST:${window.frequency}:${window.key}`;

const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (d: Date): string => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Fecha local (`AAAA-MM-DD`) y minutos desde la medianoche de un instante en una zona IANA (nunca la del servidor). */
export function localClock(at: Date, timeZone: string): { readonly date: string; readonly minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/** Semana ISO 8601 de una fecha (el jueves de la semana fija el año): `{ year: 2026, week: 45, monday: '2026-10-26' }`. */
export function isoWeek(iso: string): {
  readonly year: number;
  readonly week: number;
  readonly monday: string;
} {
  const date = dateOf(iso);
  const weekday = (date.getUTCDay() + 6) % 7; // lunes = 0
  const monday = new Date(date.getTime() - weekday * 86_400_000);
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  const firstMonday = new Date(firstThursday.getTime() - firstWeekday * 86_400_000);
  const week = Math.round((monday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1;
  return { year: thursday.getUTCFullYear(), week, monday: ymd(monday) };
}

/** Inicio (fecha local) del periodo financiero que contiene `iso`, con el día de inicio del workspace. */
export function financialPeriodStart(iso: string, startDay: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  if (d >= startDay) return `${y}-${pad(m)}-${pad(startDay)}`;
  const previous = new Date(Date.UTC(y, m - 2, 1));
  return `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-${pad(startDay)}`;
}

/**
 * Ventana de digest vigente ahora para la frecuencia dada, o `null` si todavía no empezó (antes de las 08:00 de su primer
 * día) o la frecuencia es `OFF`. La ventana es la semana ISO (el digest sale desde el lunes 08:00 y se recupera hasta el
 * domingo) o el periodo financiero (desde su primer día 08:00 hasta su fin): pasado ese lapso no se envía atrasado.
 */
export function currentDigestWindow(
  frequency: DigestFrequencyValue,
  now: Date,
  calendar: DigestCalendar,
): DigestWindow | null {
  if (frequency === 'OFF') return null;
  const local = localClock(now, calendar.timeZone);
  let window: DigestWindow;
  if (frequency === 'WEEKLY') {
    const w = isoWeek(local.date);
    window = { frequency, key: `${w.year}-W${pad(w.week)}`, startsOn: w.monday };
  } else {
    const start = financialPeriodStart(local.date, calendar.fiscalMonthStartDay);
    window = { frequency, key: start.slice(0, 7), startsOn: start };
  }
  const started = local.date > window.startsOn || local.minutes >= DIGEST_SEND_MINUTES;
  return started ? window : null;
}

// ───────────────────────────────────────────────────────────────────────────── contenido guardado

/** Pregunta del digest tal como la entrega REPORTING (estructural: NOTIFY no importa `@pf/reporting`). */
export interface DigestQuestionInput {
  readonly question: string;
  readonly status: 'AVAILABLE' | 'NO_DATA';
  readonly counts: Readonly<Record<string, number>>;
  readonly percents: Readonly<Record<string, string>>;
  readonly dates: Readonly<Record<string, string>>;
  readonly states: Readonly<Record<string, string>>;
  readonly amounts: Readonly<Record<string, { readonly amount: string; readonly currency: string }>>;
}

export interface DigestInput {
  readonly today: string;
  readonly timeZone: string;
  readonly reportingCurrency: string;
  readonly questions: readonly DigestQuestionInput[];
}

/** Claves admitidas por tipo de dato: lo demás nunca se guarda (una lista cerrada, no un volcado). */
const ALLOWED = {
  counts: ['upcoming7d', 'overdue', 'goals', 'goalsBehind', 'goalsOnTrack', 'goalsAhead'],
  percents: ['incomeChange', 'expenseChange', 'savingsRate'],
  dates: ['firstShortfall'],
  states: ['spendableSign', 'risk', 'riskCurrency'],
  amounts: ['liquid', 'income', 'expense', 'committed', 'spendable', 'savings', 'lowestBalance'],
} as const;

const DECIMAL = /^[+-]?\d+(\.\d+)?$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATE = /^[A-Z_]{1,40}$/;

function pick<T extends JsonValue>(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  valid: (value: unknown) => value is T,
  map: (value: T) => JsonValue = (v) => v,
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const key of keys) {
    const value = source[key];
    if (valid(value)) out[key] = map(value);
  }
  return out;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isDecimal = (v: unknown): v is string => typeof v === 'string' && DECIMAL.test(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && LOCAL_DATE.test(v);
const isState = (v: unknown): v is string => typeof v === 'string' && STATE.test(v);
const isMoney = (v: unknown): v is { amount: string; currency: string } =>
  typeof v === 'object' &&
  v !== null &&
  isDecimal((v as { amount?: unknown }).amount) &&
  typeof (v as { currency?: unknown }).currency === 'string';

/**
 * Parámetros del digest que se guardan con la notificación: solo cantidades, porcentajes, estados y fechas (D386); los
 * montos (`amounts`) únicamente si el destinatario activó la inclusión de detalles. Nunca nombres de cuentas,
 * categorías, metas ni compromisos: la lista de claves es cerrada.
 */
export function buildDigestParams(input: {
  readonly digest: DigestInput;
  readonly window: Pick<DigestWindow, 'frequency' | 'key'>;
  readonly includeDetails: boolean;
}): NotificationParams {
  const { digest, window, includeDetails } = input;
  return {
    frequency: window.frequency,
    windowKey: window.key,
    generatedOn: digest.today,
    timeZone: digest.timeZone,
    reportingCurrency: digest.reportingCurrency,
    includeDetails,
    questions: digest.questions.map((q) => ({
      question: q.question,
      status: q.status,
      counts: pick(q.counts, ALLOWED.counts, isCount),
      percents: pick(q.percents, ALLOWED.percents, isDecimal),
      dates: pick(q.dates, ALLOWED.dates, isDate),
      states: pick(q.states, ALLOWED.states, isState),
      ...(includeDetails
        ? {
            amounts: pick(q.amounts, ALLOWED.amounts, isMoney, (m) => ({
              amount: m.amount,
              currency: m.currency,
            })),
          }
        : {}),
    })),
  };
}
