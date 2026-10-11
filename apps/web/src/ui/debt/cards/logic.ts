import { isZeroAmount, normalizeDecimalInput, parseAmount } from '../../common/money';
import type { Money } from '../../common/types';
import { compareDecimal, type StatusPresentation } from '../../recurring/logic';
import type {
  CardAccount,
  CardFigures,
  CardMaterializationMode,
  CardMinimumRule,
  CardMinimumRuleInput,
  CardPaymentPlanInput,
  CardPaymentPolicy,
  CardStatement,
  CardStatementStatus,
  CardUtilization,
  CreditCard,
  WeekendAdjustment,
} from './types';

/**
 * Lógica pura de Deudas → Tarjetas (openspec add-credit-cards, UI): rutas, utilización (texto + barra), estados de
 * cuenta, formulario de alta en pasos, cuerpos de la API y sugerencias del pago de tarjeta. Los montos son strings
 * decimales (INV-001); los porcentajes viajan como string (`"5.00"`).
 */

// ───────────────────────────── Rutas ─────────────────────────────

export const cardsPath = (base: string): string => `${base}/credit-cards`;
export const cardPath = (base: string, id: string): string => `${base}/credit-cards/${id}`;
export const NEW_CARD_HREF = '/debts/tarjetas/nueva';
/** Pestaña Tarjetas de `/debts`. */
export const CARDS_TAB_HREF = '/debts?vista=tarjetas';

/** Detalle de la tarjeta; la notificación de vencimiento añade `?statementId=` para abrir ese estado de cuenta. */
export function cardHref(cardId: string, statementId?: string): string {
  const base = `/debts/tarjetas/${cardId}`;
  return statementId ? `${base}?${new URLSearchParams({ statementId }).toString()}` : base;
}

// ───────────────────────────── Nombre del pago de tarjeta (Q8) ─────────────────────────────

/** Prefijo con el que Deuda nombra la definición administrada del plan de pago: "Pago de tarjeta · Visa Oro". */
const CARD_PAYMENT_PREFIX = /^Pago de tarjeta\s*·\s*/u;

/** Nombre de la tarjeta dentro del nombre de la definición del plan de pago (o el nombre tal cual si no lleva prefijo). */
export const cardPaymentName = (definitionName: string): string =>
  definitionName.replace(CARD_PAYMENT_PREFIX, '').trim();

/** ¿El nombre de un pago próximo parece el de un plan de pago de tarjeta? (los próximos pagos no traen el tipo). */
export const looksLikeCardPayment = (name: string): boolean => CARD_PAYMENT_PREFIX.test(name);

// ───────────────────────────── Utilización (texto + barra, nunca solo color) ─────────────────────────────

export type UtilizationLevel = 'ok' | 'warn' | 'danger' | 'unknown';

export const UTILIZATION_PRESENTATION: Readonly<Record<UtilizationLevel, StatusPresentation>> = {
  ok: { icon: '✓', tone: 'ok' },
  warn: { icon: '●', tone: 'warn' },
  danger: { icon: '⚠', tone: 'danger' },
  unknown: { icon: '?', tone: 'neutral' },
};

export interface UtilizationView {
  readonly level: UtilizationLevel;
  /** Porcentaje a mostrar (`"30.53"`), `null` si no puede calcularse. */
  readonly percent: string | null;
  /** Ancho de la barra 0..100 (entero; solo presentación, no es dinero). */
  readonly width: number;
  readonly overdrawn: boolean;
  readonly missingRates: readonly string[];
}

/**
 * Nivel de la barra según los umbrales de la tarjeta (el menor ⇒ atención, el mayor ⇒ crítico). Sin tasa para valorar
 * un límite compartido el porcentaje es `null`: se dice y no se inventa un valor (nunca 1:1).
 */
export function utilizationView(
  u: CardUtilization | null,
  thresholds: readonly string[] = ['30.00', '80.00'],
): UtilizationView {
  if (!u || u.utilization === null)
    return {
      level: 'unknown',
      percent: null,
      width: 0,
      overdrawn: false,
      missingRates: u?.missingRates ?? [],
    };
  const sorted = [...thresholds].sort(compareDecimal);
  const high = sorted[sorted.length - 1];
  const low = sorted[0];
  const pct = u.utilization;
  let level: UtilizationLevel = 'ok';
  if (u.overdrawn || (high !== undefined && compareDecimal(pct, high) >= 0)) level = 'danger';
  else if (low !== undefined && compareDecimal(pct, low) >= 0) level = 'warn';
  const width = Math.max(0, Math.min(100, Math.round(Number(pct))));
  return { level, percent: pct, width, overdrawn: u.overdrawn, missingRates: u.missingRates };
}

// ───────────────────────────── Estados de cuenta ─────────────────────────────

export const STATEMENT_PRESENTATION: Readonly<Record<CardStatementStatus, StatusPresentation>> = {
  OPEN: { icon: '◷', tone: 'neutral' },
  ISSUED: { icon: '●', tone: 'warn' },
  PAID: { icon: '✓', tone: 'ok' },
  PARTIALLY_PAID: { icon: '◐', tone: 'warn' },
  OVERDUE: { icon: '⚠', tone: 'danger' },
};

export const FIGURE_KEYS = [
  'previousBalance',
  'purchases',
  'refunds',
  'payments',
  'otherNet',
  'closingBalance',
  'unbilledInstallments',
  'billedBalance',
  'minimumDue',
  'noInterestPayment',
  'creditBalance',
] as const satisfies readonly (keyof CardFigures)[];
export type FigureKey = (typeof FIGURE_KEYS)[number];

/** Cifras que cambiaron entre lo emitido y el recálculo de hoy (vacío si no hay emisión o no hay diferencia). */
export function changedFigures(statement: CardStatement): readonly FigureKey[] {
  const diff = statement.difference;
  if (!diff) return [];
  return FIGURE_KEYS.filter((k) => !isZeroAmount(diff[k].amount));
}

/** ¿El estado de cuenta ya se emitió (tiene cifras congeladas)? */
export const isIssued = (s: CardStatement): boolean => s.issued !== null;

/** ¿Se puede registrar lo informado por el banco? Solo en estados emitidos (con `id` y `version`). */
export const canReportBank = (s: CardStatement): boolean => s.id !== null && s.version !== null;

/** El ciclo de un estado de cuenta, p. ej. `01/09 – 25/09`: lo arma la vista con las fechas formateadas. */
export const statementKey = (s: Pick<CardStatement, 'accountId' | 'closingDate'>): string =>
  `${s.accountId}:${s.closingDate}`;

/** Estado de cuenta indicado por `?statementId=` (o `undefined`). */
export function findStatement(
  statements: readonly CardStatement[],
  statementId: string | undefined,
): CardStatement | undefined {
  return statementId ? statements.find((s) => s.id === statementId) : undefined;
}

// ───────────────────────────── Listado ─────────────────────────────

/** Nombre de las cuentas de la tarjeta para mostrar (`Visa Oro · BOB, USD`). */
export const currenciesOf = (card: Pick<CreditCard, 'accounts'>): string =>
  card.accounts.map((a) => a.currency).join(', ');

/** Tarjeta que incluye la cuenta del ledger indicada. */
export function cardOfAccount(cards: readonly CreditCard[], accountId: string): CreditCard | undefined {
  return cards.find((c) => c.status === 'ACTIVE' && c.accounts.some((a) => a.accountId === accountId));
}

/** Tarjeta y cuenta del plan de pago cuya definición es `definitionId` (Recurrentes y próximos pagos). */
export function cardOfDefinition(
  cards: readonly CreditCard[],
  definitionId: string,
): { card: CreditCard; account: CardAccount } | undefined {
  for (const card of cards) {
    const account = card.accounts.find((a) => a.paymentPlan?.definitionId === definitionId);
    if (account) return { card, account };
  }
  return undefined;
}

// ───────────────────────────── Sugerencias del pago de tarjeta (formulario de transferencia) ─────────────────────────────

export interface PaymentSuggestions {
  readonly cardId: string;
  readonly cardName: string;
  readonly statementId: string | null;
  readonly dueDate: string;
  /** "Total para no generar intereses": lo que falta del último estado emitido; `null` si no falta nada. */
  readonly noInterest: Money | null;
  /** "Pago mínimo": lo que falta para cubrir el mínimo; `null` si ya está cubierto. */
  readonly minimum: Money | null;
  readonly status: CardStatementStatus;
}

/**
 * Sugerencias de monto al pagar la cuenta `accountId` de una tarjeta: `remainingNoInterest` y `remainingMinimum` del
 * último estado emitido. `null` si la tarjeta no tiene un estado emitido para esa cuenta.
 */
export function paymentSuggestions(
  card: CreditCard | undefined,
  accountId: string,
): PaymentSuggestions | null {
  const account = card?.accounts.find((a) => a.accountId === accountId);
  const statement = account?.lastStatement;
  if (!card || !account || !statement) return null;
  return {
    cardId: card.id,
    cardName: card.name,
    statementId: statement.id,
    dueDate: statement.dueDate,
    noInterest: isZeroAmount(statement.remainingNoInterest.amount) ? null : statement.remainingNoInterest,
    minimum: isZeroAmount(statement.remainingMinimum.amount) ? null : statement.remainingMinimum,
    status: statement.status,
  };
}

// ───────────────────────────── Porcentajes ─────────────────────────────

/**
 * Porcentaje escrito por la persona → string con al menos 2 decimales (`"5"` → `"5.00"`). `'INVALID'` si no es un
 * número, `'RANGE'` fuera de `[min, max]` o con más de 2 decimales.
 */
export function normalizePercent(
  raw: string,
  locale: string,
  range: { readonly min: string; readonly max: string },
): string | 'INVALID' | 'RANGE' {
  if (raw.trim().startsWith('-')) return 'RANGE';
  const n = normalizeDecimalInput(raw, locale);
  if (n === null) return 'INVALID';
  const [int = '0', frac = ''] = n.split('.');
  if (frac.length > 2) return 'RANGE';
  const value = `${int}.${frac.padEnd(2, '0')}`;
  if (compareDecimal(value, range.min) < 0 || compareDecimal(value, range.max) > 0) return 'RANGE';
  return value;
}

// ───────────────────────────── Formulario de alta en pasos ─────────────────────────────

export type MinimumType = 'PERCENT' | 'FIXED';

export interface CardAccountForm {
  readonly creditLimit: string;
  readonly minimumType: MinimumType;
  readonly percent: string;
  readonly floor: string;
  readonly fixed: string;
  readonly planEnabled: boolean;
  readonly planSourceId: string;
  readonly planPolicy: CardPaymentPolicy;
  readonly planMode: CardMaterializationMode;
}

export interface CardForm {
  readonly name: string;
  /** Cuentas `credit_card` elegidas (una por moneda), en el orden de selección. */
  readonly selected: readonly string[];
  readonly accounts: Readonly<Record<string, CardAccountForm>>;
  readonly limitMode: 'SEPARATE' | 'SHARED';
  readonly sharedLimit: string;
  readonly sharedCurrency: string;
  readonly statementDay: string;
  readonly dueDay: string;
  readonly weekend: WeekendAdjustment;
  readonly annualRate: string;
  /** Umbrales de utilización separados por punto y coma o espacio (vacío = 30 % y 80 %). */
  readonly thresholds: string;
  readonly reminderDays: string;
}

export const EMPTY_CARD_ACCOUNT: CardAccountForm = {
  creditLimit: '',
  minimumType: 'PERCENT',
  percent: '5',
  floor: '',
  fixed: '',
  planEnabled: false,
  planSourceId: '',
  planPolicy: 'NO_INTEREST',
  planMode: 'PENDING_APPROVAL',
};

export function emptyCardForm(): CardForm {
  return {
    name: '',
    selected: [],
    accounts: {},
    limitMode: 'SEPARATE',
    sharedLimit: '',
    sharedCurrency: '',
    statementDay: '',
    dueDay: '',
    weekend: 'NONE',
    annualRate: '',
    thresholds: '',
    reminderDays: '3',
  };
}

export type CardFormError =
  'REQUIRED' | 'INVALID' | 'SCALE' | 'NOT_POSITIVE' | 'RANGE' | 'DUPLICATE_CURRENCY' | 'SHARED_NEEDS_TWO';
export type CardFormErrors = Partial<Record<string, CardFormError>>;

export interface AccountRef {
  readonly id: string;
  readonly currency: string;
}

export interface BuildOpts {
  readonly locale: string;
  readonly scales: Readonly<Record<string, number>>;
  readonly accounts: readonly AccountRef[];
}

export type CardInput = {
  readonly name: string;
  readonly accounts: readonly {
    readonly accountId: string;
    readonly creditLimit?: Money;
    readonly minimumRule: CardMinimumRuleInput;
    readonly paymentPlan?: CardPaymentPlanInput;
  }[];
  readonly limitMode: 'SEPARATE' | 'SHARED';
  readonly sharedLimit?: Money;
  readonly statementDay: number;
  readonly dueDay: number;
  readonly dueWeekendAdjustment: WeekendAdjustment;
  readonly annualRate?: string;
  readonly utilizationThresholds?: readonly string[];
  readonly reminderDays: number;
};

const scaleOf = (currency: string, scales: Readonly<Record<string, number>>): number => scales[currency] ?? 2;

/** Día 1..31 entero, o `undefined` con el error anotado. */
function dayOrError(raw: string, field: string, errors: Record<string, CardFormError>): number | undefined {
  if (raw.trim() === '') {
    errors[field] = 'REQUIRED';
    return undefined;
  }
  if (!/^\d{1,2}$/.test(raw.trim()) || Number(raw) < 1 || Number(raw) > 31) {
    errors[field] = 'RANGE';
    return undefined;
  }
  return Number(raw);
}

function moneyOrError(
  raw: string,
  currency: string,
  field: string,
  o: BuildOpts,
  errors: Record<string, CardFormError>,
): Money | undefined {
  const r = parseAmount(raw, { locale: o.locale, currency, scale: scaleOf(currency, o.scales) });
  if (r.ok) return { amount: r.value, currency };
  errors[field] = r.error === 'EMPTY' ? 'REQUIRED' : r.error;
  return undefined;
}

/**
 * Valida el formulario y arma el cuerpo de `createCreditCard`. `errors` se indexa por campo (`name`, `accounts`,
 * `statementDay`, `account.<id>.creditLimit`, `account.<id>.percent`, `account.<id>.plan`…). Los montos se validan contra
 * la escala de su moneda sin redondear; los porcentajes con hasta 2 decimales.
 */
export function buildCardInput(
  form: CardForm,
  o: BuildOpts,
): { ok: true; input: CardInput } | { ok: false; errors: CardFormErrors } {
  const errors: Record<string, CardFormError> = {};
  const name = form.name.trim();
  if (name === '') errors['name'] = 'REQUIRED';
  const refs = form.selected
    .map((id) => o.accounts.find((a) => a.id === id))
    .filter((a): a is AccountRef => !!a);
  if (refs.length === 0) errors['accounts'] = 'REQUIRED';
  else if (new Set(refs.map((a) => a.currency)).size !== refs.length)
    errors['accounts'] = 'DUPLICATE_CURRENCY';
  const statementDay = dayOrError(form.statementDay, 'statementDay', errors);
  const dueDay = dayOrError(form.dueDay, 'dueDay', errors);

  let sharedLimit: Money | undefined;
  if (form.limitMode === 'SHARED') {
    if (refs.length < 2) errors['limitMode'] = 'SHARED_NEEDS_TWO';
    const currency = form.sharedCurrency || refs[0]?.currency || '';
    if (!refs.some((a) => a.currency === currency)) errors['sharedLimit'] = 'INVALID';
    else sharedLimit = moneyOrError(form.sharedLimit, currency, 'sharedLimit', o, errors);
  }

  const accounts: CardInput['accounts'][number][] = [];
  for (const ref of refs) {
    const a = form.accounts[ref.id] ?? EMPTY_CARD_ACCOUNT;
    const key = `account.${ref.id}`;
    const entry: { -readonly [K in keyof CardInput['accounts'][number]]: CardInput['accounts'][number][K] } =
      {
        accountId: ref.id,
        minimumRule: { type: 'FIXED', amount: { amount: '0', currency: ref.currency } },
      };
    if (form.limitMode === 'SEPARATE') {
      const limit = moneyOrError(a.creditLimit, ref.currency, `${key}.creditLimit`, o, errors);
      if (limit) entry.creditLimit = limit;
    }
    if (a.minimumType === 'PERCENT') {
      const percent = normalizePercent(a.percent, o.locale, { min: '0.01', max: '100.00' });
      if (percent === 'INVALID' || percent === 'RANGE')
        errors[`${key}.percent`] = a.percent.trim() === '' ? 'REQUIRED' : percent;
      else {
        const rule: { type: 'PERCENT'; percent: string; floor?: Money } = { type: 'PERCENT', percent };
        if (a.floor.trim() !== '') {
          const floor = moneyOrError(a.floor, ref.currency, `${key}.floor`, o, errors);
          if (floor) rule.floor = floor;
        }
        entry.minimumRule = rule;
      }
    } else {
      const amount = moneyOrError(a.fixed, ref.currency, `${key}.fixed`, o, errors);
      if (amount) entry.minimumRule = { type: 'FIXED', amount };
    }
    if (a.planEnabled) {
      if (a.planSourceId === '') errors[`${key}.plan`] = 'REQUIRED';
      else
        entry.paymentPlan = {
          sourceAccountId: a.planSourceId,
          policy: a.planPolicy,
          materialization: { mode: a.planMode },
        };
    }
    accounts.push(entry);
  }

  let annualRate: string | undefined;
  if (form.annualRate.trim() !== '') {
    const rate = normalizePercent(form.annualRate, o.locale, { min: '0.00', max: '999.99' });
    if (rate === 'INVALID' || rate === 'RANGE') errors['annualRate'] = rate;
    else annualRate = rate;
  }

  let thresholds: string[] | undefined;
  if (form.thresholds.trim() !== '') {
    const parts = form.thresholds.split(/[;\s]+/u).filter((p) => p.trim() !== '');
    const parsed = parts.map((p) => normalizePercent(p, o.locale, { min: '0.01', max: '100.00' }));
    if (
      parsed.length < 1 ||
      parsed.length > 3 ||
      parsed.some((p) => p === 'INVALID' || p === 'RANGE') ||
      new Set(parsed).size !== parsed.length
    )
      errors['thresholds'] = 'RANGE';
    else thresholds = parsed.filter((p): p is string => p !== 'INVALID' && p !== 'RANGE');
  }

  let reminderDays = 3;
  if (form.reminderDays.trim() !== '') {
    if (
      !/^\d{1,2}$/.test(form.reminderDays.trim()) ||
      Number(form.reminderDays) < 1 ||
      Number(form.reminderDays) > 30
    )
      errors['reminderDays'] = 'RANGE';
    else reminderDays = Number(form.reminderDays);
  }

  if (Object.keys(errors).length > 0 || statementDay === undefined || dueDay === undefined)
    return { ok: false, errors };
  return {
    ok: true,
    input: {
      name,
      accounts,
      limitMode: form.limitMode,
      ...(sharedLimit ? { sharedLimit } : {}),
      statementDay,
      dueDay,
      dueWeekendAdjustment: form.weekend,
      ...(annualRate !== undefined ? { annualRate } : {}),
      ...(thresholds ? { utilizationThresholds: thresholds } : {}),
      reminderDays,
    },
  };
}

// ───────────────────────────── Edición de términos ─────────────────────────────

export interface TermsForm {
  readonly name: string;
  readonly statementDay: string;
  readonly dueDay: string;
  readonly weekend: WeekendAdjustment;
  readonly annualRate: string;
  readonly thresholds: string;
  readonly reminderDays: string;
  /** Por cuenta de la tarjeta (id de `CardAccount`): límite y regla de mínimo. */
  readonly accounts: Readonly<Record<string, CardAccountTerms>>;
  readonly sharedLimit: string;
}

export interface CardAccountTerms {
  readonly creditLimit: string;
  readonly minimumType: MinimumType;
  readonly percent: string;
  readonly floor: string;
  readonly fixed: string;
}

const plain = (m: Money | null | undefined): string => m?.amount ?? '';

export function termsFormOf(card: CreditCard): TermsForm {
  const accounts: Record<string, CardAccountTerms> = {};
  for (const a of card.accounts) {
    const rule: CardMinimumRule = a.minimumRule;
    accounts[a.accountId] = {
      creditLimit: plain(a.creditLimit),
      minimumType: rule.type,
      percent: rule.type === 'PERCENT' ? rule.percent : '5.00',
      floor: rule.type === 'PERCENT' ? plain(rule.floor) : '',
      fixed: rule.type === 'FIXED' ? rule.amount.amount : '',
    };
  }
  return {
    name: card.name,
    statementDay: String(card.statementDay),
    dueDay: String(card.dueDay),
    weekend: card.dueWeekendAdjustment,
    annualRate: card.annualRate ?? '',
    thresholds: card.utilizationThresholds.join('; '),
    reminderDays: String(card.reminderDays),
    accounts,
    sharedLimit: plain(card.sharedLimit),
  };
}

/**
 * Cuerpo de `updateCreditCard` (merge-patch) con SOLO lo que cambió respecto de la tarjeta. `null` en `annualRate`
 * borra la tasa. Devuelve `{}` si no hay cambios.
 */
export function buildCardPatch(
  card: CreditCard,
  form: TermsForm,
  o: Pick<BuildOpts, 'locale' | 'scales'>,
): { ok: true; patch: Record<string, unknown> } | { ok: false; errors: CardFormErrors } {
  const errors: Record<string, CardFormError> = {};
  const patch: Record<string, unknown> = {};
  const opts = { ...o, accounts: [] as readonly AccountRef[] };

  const name = form.name.trim();
  if (name === '') errors['name'] = 'REQUIRED';
  else if (name !== card.name) patch['name'] = name;

  const statementDay = dayOrError(form.statementDay, 'statementDay', errors);
  if (statementDay !== undefined && statementDay !== card.statementDay) patch['statementDay'] = statementDay;
  const dueDay = dayOrError(form.dueDay, 'dueDay', errors);
  if (dueDay !== undefined && dueDay !== card.dueDay) patch['dueDay'] = dueDay;
  if (form.weekend !== card.dueWeekendAdjustment) patch['dueWeekendAdjustment'] = form.weekend;

  if (form.annualRate.trim() === '') {
    if (card.annualRate !== null) patch['annualRate'] = null;
  } else {
    const rate = normalizePercent(form.annualRate, o.locale, { min: '0.00', max: '999.99' });
    if (rate === 'INVALID' || rate === 'RANGE') errors['annualRate'] = rate;
    else if (rate !== card.annualRate) patch['annualRate'] = rate;
  }

  const parts = form.thresholds.split(/[;\s]+/u).filter((p) => p.trim() !== '');
  const parsed = parts.map((p) => normalizePercent(p, o.locale, { min: '0.01', max: '100.00' }));
  if (
    parsed.length < 1 ||
    parsed.length > 3 ||
    parsed.some((p) => p === 'INVALID' || p === 'RANGE') ||
    new Set(parsed).size !== parsed.length
  )
    errors['thresholds'] = 'RANGE';
  else if (parsed.join('|') !== card.utilizationThresholds.join('|')) patch['utilizationThresholds'] = parsed;

  if (
    !/^\d{1,2}$/.test(form.reminderDays.trim()) ||
    Number(form.reminderDays) < 1 ||
    Number(form.reminderDays) > 30
  )
    errors['reminderDays'] = 'RANGE';
  else if (Number(form.reminderDays) !== card.reminderDays) patch['reminderDays'] = Number(form.reminderDays);

  if (card.limitMode === 'SHARED' && card.sharedLimit) {
    const shared = moneyOrError(form.sharedLimit, card.sharedLimit.currency, 'sharedLimit', opts, errors);
    if (shared && shared.amount !== card.sharedLimit.amount) patch['sharedLimit'] = shared;
  }

  const accountPatches: Record<string, unknown>[] = [];
  for (const a of card.accounts) {
    const t = form.accounts[a.accountId];
    if (!t) continue;
    const key = `account.${a.accountId}`;
    const change: Record<string, unknown> = {};
    if (card.limitMode === 'SEPARATE' && a.creditLimit) {
      const limit = moneyOrError(t.creditLimit, a.currency, `${key}.creditLimit`, opts, errors);
      if (limit && limit.amount !== a.creditLimit.amount) change['creditLimit'] = limit;
    }
    let rule: CardMinimumRuleInput | undefined;
    if (t.minimumType === 'PERCENT') {
      const percent = normalizePercent(t.percent, o.locale, { min: '0.01', max: '100.00' });
      if (percent === 'INVALID' || percent === 'RANGE') errors[`${key}.percent`] = percent;
      else {
        const r: { type: 'PERCENT'; percent: string; floor?: Money } = { type: 'PERCENT', percent };
        if (t.floor.trim() !== '') {
          const floor = moneyOrError(t.floor, a.currency, `${key}.floor`, opts, errors);
          if (floor) r.floor = floor;
        }
        rule = r;
      }
    } else {
      const amount = moneyOrError(t.fixed, a.currency, `${key}.fixed`, opts, errors);
      if (amount) rule = { type: 'FIXED', amount };
    }
    if (rule && !sameRule(a.minimumRule, rule)) change['minimumRule'] = rule;
    if (Object.keys(change).length > 0) accountPatches.push({ accountId: a.accountId, ...change });
  }
  if (accountPatches.length > 0) patch['accounts'] = accountPatches;

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, patch };
}

function sameRule(current: CardMinimumRule, next: CardMinimumRuleInput): boolean {
  if (current.type !== next.type) return false;
  if (current.type === 'FIXED' && next.type === 'FIXED') return current.amount.amount === next.amount.amount;
  if (current.type === 'PERCENT' && next.type === 'PERCENT')
    return current.percent === next.percent && (current.floor?.amount ?? '') === (next.floor?.amount ?? '');
  return false;
}

// ───────────────────────────── Plan de pago ─────────────────────────────

export interface PlanForm {
  readonly sourceAccountId: string;
  readonly policy: CardPaymentPolicy;
  readonly mode: CardMaterializationMode;
}

export function planFormOf(account: CardAccount): PlanForm {
  return {
    sourceAccountId: account.paymentPlan?.sourceAccountId ?? '',
    policy: account.paymentPlan?.policy ?? 'NO_INTEREST',
    mode: account.paymentPlan?.materialization.mode ?? 'PENDING_APPROVAL',
  };
}

export const buildPlanInput = (form: PlanForm): CardPaymentPlanInput => ({
  sourceAccountId: form.sourceAccountId,
  policy: form.policy,
  materialization: { mode: form.mode },
});

/** Conflicto del plan (409 `CARD_PAYMENT_PLAN_CONFLICT`): definiciones recurrentes del usuario hacia la cuenta. */
export function conflictsOf(
  details: unknown,
): readonly { readonly definitionId: string; readonly name: string }[] {
  const list = (details as { conflictingDefinitions?: unknown } | undefined)?.conflictingDefinitions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((d: unknown) => {
    const x = d as { definitionId?: unknown; name?: unknown };
    return typeof x.definitionId === 'string' && typeof x.name === 'string'
      ? [{ definitionId: x.definitionId, name: x.name }]
      : [];
  });
}

// ───────────────────────────── Informado por el banco ─────────────────────────────

/** Cuerpo de `updateCardStatement`: `null` borra un campo; cadena vacía = sin cambio de ese campo no se envía. */
export function buildReportedPatch(
  form: { billed: string; minimum: string },
  currency: string,
  o: Pick<BuildOpts, 'locale' | 'scales'>,
  original: { billed: string | null; minimum: string | null },
): { ok: true; patch: Record<string, unknown> } | { ok: false; errors: CardFormErrors } {
  const errors: Record<string, CardFormError> = {};
  const patch: Record<string, unknown> = {};
  const opts = { ...o, accounts: [] as readonly AccountRef[] };
  const field = (raw: string, key: 'billed' | 'minimum', apiKey: string) => {
    if (raw.trim() === '') {
      if (original[key] !== null) patch[apiKey] = null;
      return;
    }
    const m = moneyOrError(raw, currency, key, opts, errors);
    if (m && m.amount !== original[key]) patch[apiKey] = m;
  };
  field(form.billed, 'billed', 'reportedBilledBalance');
  field(form.minimum, 'minimum', 'reportedMinimumDue');
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, patch };
}

// ───────────────────────────── Cuotas ─────────────────────────────

/** Cuotas aún no facturadas (a partir de la fecha de cierre de hoy). */
export const pendingInstallments = (
  plan: { installments: readonly { billingClosingDate: string }[] },
  today: string,
): number => plan.installments.filter((i) => i.billingClosingDate >= today).length;

export interface InstallmentForm {
  readonly purchaseTransactionId: string;
  readonly count: string;
  readonly annualRate: string;
  readonly startCycle: 'PURCHASE' | 'NEXT';
}

export const EMPTY_INSTALLMENT_FORM: InstallmentForm = {
  purchaseTransactionId: '',
  count: '3',
  annualRate: '',
  startCycle: 'PURCHASE',
};

/** Cuerpo de `createCardInstallmentPlan`: compra, 2..60 cuotas, tasa anual opcional (0 = sin interés) y ciclo inicial. */
export function buildInstallmentInput(
  form: InstallmentForm,
  locale: string,
):
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; errors: Partial<Record<'purchase' | 'count' | 'annualRate', CardFormError>> } {
  const errors: Partial<Record<'purchase' | 'count' | 'annualRate', CardFormError>> = {};
  if (form.purchaseTransactionId === '') errors.purchase = 'REQUIRED';
  const count = form.count.trim();
  if (count === '') errors.count = 'REQUIRED';
  else if (!/^\d{1,2}$/.test(count) || Number(count) < 2 || Number(count) > 60) errors.count = 'RANGE';
  let annualRate: string | undefined;
  if (form.annualRate.trim() !== '') {
    const rate = normalizePercent(form.annualRate, locale, { min: '0.00', max: '999.99' });
    if (rate === 'INVALID' || rate === 'RANGE') errors.annualRate = rate;
    else annualRate = rate;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      purchaseTransactionId: form.purchaseTransactionId,
      installmentCount: Number(count),
      ...(annualRate !== undefined ? { annualRate } : {}),
      startCycle: form.startCycle,
    },
  };
}
