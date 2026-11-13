import type {
  CashFlowAccount,
  CashFlowCalendar,
  CashFlowCurrency,
  CashFlowDay,
  CashFlowEvent,
  CashFlowHomeBlock,
  CashFlowRisk,
  Money,
  PredictedCashFlow,
} from './types';

/** Ruta de la vista (sin prefijo de locale) y parámetros de URL: `horizonte`, `moneda` y `cuenta`. */
export const CASH_FLOW_PATH = '/flujo-de-caja';
export const CASH_FLOW_HORIZONS = [7, 30, 60, 90] as const;
export type CashFlowHorizon = (typeof CASH_FLOW_HORIZONS)[number];
export const DEFAULT_CASH_FLOW_HORIZON: CashFlowHorizon = 30;

export const isCashFlowHorizon = (value: number): value is CashFlowHorizon =>
  (CASH_FLOW_HORIZONS as readonly number[]).includes(value);

export interface CashFlowSelection {
  readonly horizon: CashFlowHorizon;
  /** Moneda elegida; `undefined` ⇒ la de mayor riesgo. */
  readonly currency: string | undefined;
  /** Cuenta líquida cuya serie diaria se pide; `undefined` ⇒ el total de la moneda. */
  readonly accountId: string | undefined;
}

/** Horizonte de un parámetro de URL: solo 7/30/60/90; cualquier otro valor cae al de 30 días. */
export function parseHorizon(raw: string | null | undefined): CashFlowHorizon {
  const n = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
  return isCashFlowHorizon(n) ? n : DEFAULT_CASH_FLOW_HORIZON;
}

/** Selección a partir de la URL (`?horizonte=60&moneda=USD&cuenta=<id>`). */
export function selectionFromSearch(search: URLSearchParams): CashFlowSelection {
  const currency = search.get('moneda')?.trim().toUpperCase();
  const accountId = search.get('cuenta')?.trim();
  return {
    horizon: parseHorizon(search.get('horizonte')),
    currency: currency && /^[A-Z0-9]{3,10}$/.test(currency) ? currency : undefined,
    accountId: accountId || undefined,
  };
}

/** Parámetros de URL de una selección (los valores por omisión no se escriben). */
export function selectionToSearch(sel: CashFlowSelection): URLSearchParams {
  const q = new URLSearchParams();
  if (sel.horizon !== DEFAULT_CASH_FLOW_HORIZON) q.set('horizonte', String(sel.horizon));
  if (sel.currency) q.set('moneda', sel.currency);
  if (sel.accountId) q.set('cuenta', sel.accountId);
  return q;
}

/** Ruta de la API: solo `horizon` y `accountId` (la moneda se elige en la UI entre las del calendario). */
export function calendarApiPath(base: string, sel: CashFlowSelection): string {
  const q = new URLSearchParams({ horizon: String(sel.horizon) });
  if (sel.accountId) q.set('accountId', sel.accountId);
  return `${base}/reports/cash-flow-calendar?${q.toString()}`;
}

// ───────────────────────────────────────────── decimales exactos (solo comparar; nunca `number`)

const fractionDigits = (amount: string): number => amount.split('.')[1]?.length ?? 0;

function scaled(decimal: string, scale: number): bigint {
  const negative = decimal.startsWith('-');
  const [int = '0', frac = ''] = decimal.replace(/^[-+]/, '').split('.');
  const digits = BigInt(`${int || '0'}${frac.padEnd(scale, '0').slice(0, scale)}`);
  return negative ? -digits : digits;
}

/** Compara dos decimales canónicos (−1, 0, 1). */
export function compareDecimal(a: string, b: string): number {
  const scale = Math.max(fractionDigits(a), fractionDigits(b));
  const [x, y] = [scaled(a, scale), scaled(b, scale)];
  return x === y ? 0 : x < y ? -1 : 1;
}

/** El saldo está por debajo del umbral (estricto). */
export const isBelow = (balance: Money, threshold: Money): boolean =>
  compareDecimal(balance.amount, threshold.amount) < 0;

// ───────────────────────────────────────────── riesgo

const RISK_RANK: Record<CashFlowRisk, number> = { NONE: 0, LOW: 1, POSSIBLE: 2, HIGH: 3 };

export const RISK_GLYPH: Record<CashFlowRisk, string> = { NONE: '✓', LOW: 'ⓘ', POSSIBLE: '⚠', HIGH: '⚠' };

/** Tono de un riesgo (nunca la única señal: va con glifo y texto). */
export const riskTone = (risk: CashFlowRisk): 'ok' | 'info' | 'warn' | 'error' =>
  risk === 'HIGH' ? 'error' : risk === 'POSSIBLE' ? 'warn' : risk === 'LOW' ? 'info' : 'ok';

/** Moneda a mostrar: la pedida si existe en el calendario; si no, la de mayor riesgo (y, a igual riesgo, la primera). */
export function pickCurrency(
  currencies: readonly CashFlowCurrency[],
  wanted: string | undefined,
): CashFlowCurrency | undefined {
  const exact = currencies.find((c) => c.currency === wanted);
  if (exact) return exact;
  return currencies.reduce<CashFlowCurrency | undefined>(
    (best, c) => (!best || RISK_RANK[c.risk] > RISK_RANK[best.risk] ? c : best),
    undefined,
  );
}

// ───────────────────────────────────────────── cuentas y series

/** Cuentas líquidas de una moneda. */
export const accountsOf = (calendar: CashFlowCalendar, currency: string): readonly CashFlowAccount[] =>
  calendar.accounts.filter((a) => a.currency === currency);

/** La cuenta cuya serie vino en la respuesta (se pidió con `accountId`). */
export const seriesAccount = (calendar: CashFlowCalendar): CashFlowAccount | undefined =>
  calendar.accounts.find((a) => a.series !== null);

export interface SeriesRow {
  readonly date: string;
  readonly balance: Money;
  readonly low: Money;
  /** Saldo con el gasto planificado restante (si el calendario trae esa serie). */
  readonly planned: Money | null;
  /** El saldo más bajo del día queda por debajo del umbral. */
  readonly belowThreshold: boolean;
  /** Saldos con el gasto variable predicho esperado, alto y bajo (si hay banda). */
  readonly band: { readonly expected: Money; readonly high: Money; readonly low: Money } | null;
}

/** Filas de la tabla equivalente al gráfico: un punto por día, con la serie del plan alineada por fecha. */
export function seriesRows(
  series: readonly CashFlowDay[],
  planned: CashFlowCurrency['planned'],
  threshold: Money | null,
  band: PredictedCashFlow | null = null,
): readonly SeriesRow[] {
  const plannedByDate = new Map((planned?.series ?? []).map((p) => [p.date, p.balance]));
  const bandByDate = new Map((band?.series ?? []).map((p) => [p.date, p]));
  return series.map((d) => ({
    date: d.date,
    balance: d.balance,
    low: d.low,
    planned: plannedByDate.get(d.date) ?? null,
    belowThreshold: threshold ? isBelow(d.low, threshold) : false,
    band: bandByDate.get(d.date) ?? null,
  }));
}

/** ¿La moneda trae una banda del gasto variable predicho para dibujar? */
export const hasBand = (c: CashFlowCurrency): c is CashFlowCurrency & { predicted: PredictedCashFlow } =>
  c.predicted?.status === 'AVAILABLE' && c.predicted.series.length > 0;

// ───────────────────────────────────────────── eventos

/** Moneda de un evento: la de su cuenta (así un `VARIABLE` sin monto también se ubica); si no, la de su monto. */
export function currencyOfEvent(event: CashFlowEvent, calendar: CashFlowCalendar): string | undefined {
  return (
    calendar.accounts.find((a) => a.accountId === event.accountId)?.currency ??
    event.amount?.currency ??
    undefined
  );
}

export interface EventDay {
  readonly date: string;
  readonly events: readonly CashFlowEvent[];
}

/** Eventos de una moneda agrupados por el día en que se aplican (orden cronológico; egresos antes que ingresos). */
export function eventsByDay(calendar: CashFlowCalendar, currency: string | undefined): readonly EventDay[] {
  const days = new Map<string, CashFlowEvent[]>();
  for (const e of calendar.events) {
    const eventCurrency = currencyOfEvent(e, calendar);
    if (currency && eventCurrency && eventCurrency !== currency) continue;
    days.set(e.date, [...(days.get(e.date) ?? []), e]);
  }
  const outFirst = (e: CashFlowEvent) => (e.kind === 'INCOME' ? 1 : 0);
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, events]) => ({ date, events: [...events].sort((x, y) => outFirst(x) - outFirst(y)) }));
}

/** Los egresos se muestran con signo menos; los ingresos con más; transferencias y conversiones, sin signo. */
export function eventSign(kind: CashFlowEvent['kind']): '-' | '+' | '' {
  if (kind === 'INCOME') return '+';
  if (kind === 'TRANSFER' || kind === 'CONVERSION') return '';
  return '-';
}

/** `VARIABLE` sin monto: se lista, nunca como 0. */
export const hasNoAmount = (event: CashFlowEvent): boolean => event.amount === null;

/** Ruta (sin locale) al detalle de la ocurrencia de compromiso, para omitirla o aprobarla. */
export const occurrencePathOf = (event: CashFlowEvent): string | undefined =>
  event.source === 'OCCURRENCE' && event.sourceRef.context === 'COMMITMENTS'
    ? `/recurring/occurrences/${event.sourceRef.id}`
    : undefined;

// ───────────────────────────────────────────── tarjeta Q8 del Home

export type HomeCashFlowSummary =
  | {
      readonly kind: 'RISK';
      readonly risk: Exclude<CashFlowRisk, 'NONE'>;
      readonly currency: string;
      readonly lowest: Money;
      readonly date: string;
      readonly firstShortfallDate: string | null;
    }
  | { readonly kind: 'LOWEST'; readonly lowest: Money; readonly date: string; readonly complete: boolean }
  | { readonly kind: 'NONE' };

/**
 * Qué muestra Q8 del bloque `cashFlow`: la moneda con riesgo y su mínimo con fecha o, sin riesgo, el mínimo consolidado.
 * Sin bloque (`null`: sin cuentas líquidas) no hay saldo ni riesgo que mostrar.
 */
export function homeCashFlowSummary(block: CashFlowHomeBlock | null | undefined): HomeCashFlowSummary {
  if (!block) return { kind: 'NONE' };
  const worst = block.worst;
  if (worst && worst.risk !== 'NONE') {
    return {
      kind: 'RISK',
      risk: worst.risk,
      currency: worst.currency,
      lowest: worst.lowest,
      date: worst.lowestDate,
      firstShortfallDate: worst.firstShortfallDate,
    };
  }
  if (block.consolidatedLowest) {
    return {
      kind: 'LOWEST',
      lowest: block.consolidatedLowest.amount,
      date: block.consolidatedLowest.date,
      complete: block.complete,
    };
  }
  if (worst) {
    return { kind: 'LOWEST', lowest: worst.lowest, date: worst.lowestDate, complete: block.complete };
  }
  return { kind: 'NONE' };
}

/** Enlace del calendario con el horizonte y la moneda (misma forma que el de la notificación de riesgo). */
export function cashFlowHref(
  localize: (path: string) => string,
  opts: { readonly horizon?: number; readonly currency?: string } = {},
): string {
  const q = new URLSearchParams();
  if (opts.horizon && opts.horizon !== DEFAULT_CASH_FLOW_HORIZON) q.set('horizonte', String(opts.horizon));
  if (opts.currency) q.set('moneda', opts.currency);
  const qs = q.toString();
  return localize(qs ? `${CASH_FLOW_PATH}?${qs}` : CASH_FLOW_PATH);
}
