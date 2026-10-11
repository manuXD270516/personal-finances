import {
  isZeroAmount,
  normalizeDecimalInput,
  parseAmount,
  subtractAmounts,
  sumAmounts,
} from '../common/money';
import type { StatusPresentation } from '../recurring/logic';
import {
  CHARGE_KEYS,
  type ChargeKey,
  type ChargeMode,
  type DateFormat,
  type Delimiter,
  type InstallmentStatus,
  type LoanCharges,
  type LoanDayCount,
  type LoanFrequency,
  type LoanInstallment,
  type LoanOrigin,
  type LoanStatus,
  type MappingField,
  type ReferenceInput,
  type ReferenceManualRow,
  type ReferenceMapping,
  type ReferenceRowError,
  REQUIRED_MAPPING,
  MAPPING_FIELDS,
} from './types';

/** Lógica pura de Deudas → Préstamos (openspec add-loans, UI): conversiones % ↔ fracción, payloads, mapeo de columnas. */

// ───────────────────────────── Rutas ─────────────────────────────

export const loansPath = (base: string): string => `${base}/loans`;
export const loanPath = (base: string, id: string): string => `${base}/loans/${id}`;
export const previewPath = (base: string): string => `${base}/loans/schedule-preview`;
export const debtHref = (id?: string, suffix = ''): string => (id ? `/debts/${id}${suffix}` : '/debts');

/** Enlace al formulario de pago prellenado (pregunta 10: "Registrar pago" desde Recurrentes). */
export function paymentHref(loanId: string, opts: { installmentNo?: number; date?: string } = {}): string {
  const q = new URLSearchParams({ pagar: '1' });
  if (opts.installmentNo !== undefined) q.set('cuota', String(opts.installmentNo));
  if (opts.date) q.set('fecha', opts.date);
  return `${debtHref(loanId)}?${q.toString()}`;
}

// ───────────────────────────── Tasas: % en pantalla ↔ fracción en la API ─────────────────────────────

/**
 * Porcentaje escrito por la persona (`11,50`, `11.5`) → fracción decimal exacta como string (`"0.115"`), desplazando
 * el punto dos lugares sin pasar por `number`. `null` si no es un número no negativo válido.
 */
export function percentToFraction(raw: string, locale: string): string | null {
  if (raw.trim() === '' || raw.trim().startsWith('-')) return null;
  const n = normalizeDecimalInput(raw, locale);
  if (n === null) return null;
  const [i = '0', f = ''] = n.split('.');
  const left = i.length > 2 ? i.slice(0, -2) : '0';
  const right = (i.length > 2 ? i.slice(-2) : i.padStart(2, '0')) + f;
  const trimmed = right.replace(/0+$/, '');
  const int = left.replace(/^0+(?=\d)/, '') || '0';
  return trimmed === '' ? int : `${int}.${trimmed}`;
}

/** Fracción de la API (`"0.115"`) → porcentaje para mostrar con al menos 2 decimales (`"11.50"`). */
export function fractionToPercent(fraction: string, minDecimals = 2): string {
  const [i = '0', f = ''] = fraction.split('.');
  const padded = f.padEnd(2, '0');
  const left = `${i}${padded.slice(0, 2)}`.replace(/^0+(?=\d)/, '') || '0';
  const rest = padded.slice(2).replace(/0+$/, '');
  return `${left}.${rest.padEnd(minDecimals, '0')}`;
}

// ───────────────────────────── Formulario de alta ─────────────────────────────

export interface ChargeForm {
  readonly mode: 'NONE' | ChargeMode;
  readonly value: string;
}

export interface LoanForm {
  readonly origin: LoanOrigin;
  readonly name: string;
  readonly principal: string;
  readonly currency: string;
  /** Tasa nominal anual EN PORCENTAJE (11,50). */
  readonly ratePct: string;
  readonly dayCount: LoanDayCount;
  readonly frequency: LoanFrequency;
  readonly termInstallments: string;
  readonly disbursementDate: string;
  readonly firstDueDate: string;
  readonly charges: Readonly<Record<ChargeKey, ChargeForm>>;
  readonly lenderCounterpartyId: string;
  readonly accountMode: 'EXISTING' | 'CREATE';
  readonly accountId: string;
  readonly newAccountName: string;
  readonly disbursementAccountId: string;
  readonly paymentAccountId: string;
  readonly disburseNow: boolean;
  readonly retainedFee: string;
  /** Préstamo en curso. */
  readonly asOf: string;
  readonly nextInstallmentNo: string;
}

export const EMPTY_CHARGE: ChargeForm = { mode: 'NONE', value: '' };

export function emptyLoanForm(currency: string, today: string): LoanForm {
  return {
    origin: 'NEW',
    name: '',
    principal: '',
    currency,
    ratePct: '',
    dayCount: 'D30_360',
    frequency: 'MONTHLY',
    termInstallments: '',
    disbursementDate: today,
    firstDueDate: '',
    charges: { fees: EMPTY_CHARGE, insurance: EMPTY_CHARGE, taxes: EMPTY_CHARGE },
    lenderCounterpartyId: '',
    accountMode: 'CREATE',
    accountId: '',
    newAccountName: '',
    disbursementAccountId: '',
    paymentAccountId: '',
    disburseNow: false,
    retainedFee: '',
    asOf: today,
    nextInstallmentNo: '1',
  };
}

export type FormErrorCode = 'REQUIRED' | 'INVALID' | 'SCALE' | 'NOT_POSITIVE' | 'RANGE' | 'DATE_ORDER';
export type LoanFormErrors = Partial<Record<string, FormErrorCode>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: string): boolean => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

interface Opts {
  readonly locale: string;
  readonly scale: number;
}

function amountOrError(
  raw: string,
  field: string,
  o: Opts & { currency: string },
  errors: Record<string, FormErrorCode>,
  allowZero = false,
): string | undefined {
  const r = parseAmount(raw, { locale: o.locale, currency: o.currency, scale: o.scale, allowZero });
  if (r.ok) return r.value;
  errors[field] = r.error === 'EMPTY' ? 'REQUIRED' : r.error;
  return undefined;
}

/** Cargos opcionales → `charges` de la API (fijo: monto; tasa MENSUAL: % → fracción). */
export function buildCharges(form: LoanForm, o: Opts, errors: Record<string, FormErrorCode>): LoanCharges {
  const out: Partial<Record<ChargeKey, { mode: ChargeMode; value: string }>> = {};
  for (const key of CHARGE_KEYS) {
    const c = form.charges[key];
    if (c.mode === 'NONE') continue;
    if (c.mode === 'FIXED') {
      const v = amountOrError(c.value, `charges.${key}`, { ...o, currency: form.currency }, errors);
      if (v !== undefined) out[key] = { mode: 'FIXED', value: v };
    } else {
      const fraction = c.value.trim() === '' ? null : percentToFraction(c.value, o.locale);
      if (fraction === null || isZeroAmount(fraction))
        errors[`charges.${key}`] = c.value.trim() === '' ? 'REQUIRED' : 'INVALID';
      else out[key] = { mode: 'RATE_ON_BALANCE', value: fraction };
    }
  }
  return out;
}

/** Condiciones comunes del alta y de la vista previa. `errors` acumula por campo. */
function buildTerms(form: LoanForm, o: Opts, errors: Record<string, FormErrorCode>) {
  const principal = amountOrError(form.principal, 'principal', { ...o, currency: form.currency }, errors);
  let annualRate: string | undefined;
  if (form.ratePct.trim() === '') errors['ratePct'] = 'REQUIRED';
  else {
    const fraction = percentToFraction(form.ratePct, o.locale);
    if (fraction === null) errors['ratePct'] = 'INVALID';
    else if (fraction !== '1' && !fraction.startsWith('0')) errors['ratePct'] = 'RANGE';
    else annualRate = fraction;
  }
  const term = Number(form.termInstallments);
  if (form.termInstallments.trim() === '') errors['termInstallments'] = 'REQUIRED';
  else if (!/^\d+$/.test(form.termInstallments.trim()) || term < 1 || term > 600)
    errors['termInstallments'] = 'RANGE';
  if (form.firstDueDate === '') errors['firstDueDate'] = 'REQUIRED';
  else if (!isDate(form.firstDueDate)) errors['firstDueDate'] = 'INVALID';
  if (form.origin === 'NEW') {
    if (form.disbursementDate === '') errors['disbursementDate'] = 'REQUIRED';
    else if (!isDate(form.disbursementDate)) errors['disbursementDate'] = 'INVALID';
    else if (isDate(form.firstDueDate) && form.firstDueDate <= form.disbursementDate)
      errors['firstDueDate'] = 'DATE_ORDER';
  } else {
    if (form.asOf === '') errors['asOf'] = 'REQUIRED';
    else if (!isDate(form.asOf)) errors['asOf'] = 'INVALID';
    else if (isDate(form.firstDueDate) && form.firstDueDate <= form.asOf)
      errors['firstDueDate'] = 'DATE_ORDER';
    const next = form.nextInstallmentNo.trim();
    if (next === '') errors['nextInstallmentNo'] = 'REQUIRED';
    else if (!/^\d+$/.test(next) || Number(next) < 1) errors['nextInstallmentNo'] = 'RANGE';
  }
  const charges = buildCharges(form, o, errors);
  return { principal, annualRate, term, charges };
}

function termsPayload(form: LoanForm, t: ReturnType<typeof buildTerms>) {
  return {
    origin: form.origin,
    principal: { amount: t.principal!, currency: form.currency },
    annualRate: t.annualRate!,
    dayCount: form.dayCount,
    frequency: form.frequency,
    termInstallments: t.term,
    method: 'FRENCH',
    firstDueDate: form.firstDueDate,
    ...(form.origin === 'NEW'
      ? { disbursementDate: form.disbursementDate }
      : {
          existing: { asOf: form.asOf, nextInstallmentNo: Number(form.nextInstallmentNo.trim()) },
        }),
    ...(Object.keys(t.charges).length > 0 ? { charges: t.charges } : {}),
  };
}

/** Cuerpo de `POST …/loans/schedule-preview`; `null` mientras falte algún dato (la vista previa espera). */
export function buildPreviewInput(form: LoanForm, o: Opts): Record<string, unknown> | null {
  const errors: Record<string, FormErrorCode> = {};
  const t = buildTerms(form, o, errors);
  if (Object.keys(errors).length > 0) return null;
  return { name: form.name.trim() || 'Préstamo', ...termsPayload(form, t) };
}

export type BuildResult<T> =
  { readonly ok: true; readonly input: T } | { readonly ok: false; readonly errors: LoanFormErrors };

/** Cuerpo de `POST …/loans` (alta nueva o en curso). La tasa se convierte a fracción; los montos van como string. */
export function buildLoanInput(form: LoanForm, o: Opts): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  if (form.name.trim() === '') errors['name'] = 'REQUIRED';
  const t = buildTerms(form, o, errors);
  if (form.accountMode === 'EXISTING' && form.accountId === '') errors['accountId'] = 'REQUIRED';
  if (form.accountMode === 'CREATE' && form.newAccountName.trim() === '')
    errors['newAccountName'] = 'REQUIRED';
  if (form.paymentAccountId === '' && form.origin === 'EXISTING') errors['paymentAccountId'] = 'REQUIRED';
  if (form.origin === 'NEW' && form.disbursementAccountId === '')
    errors['disbursementAccountId'] = 'REQUIRED';
  let retained: string | undefined;
  if (form.origin === 'NEW' && form.disburseNow && form.retainedFee.trim() !== '')
    retained = amountOrError(
      form.retainedFee,
      'retainedFee',
      { ...o, currency: form.currency },
      errors,
      true,
    );
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // Un préstamo en curso no desembolsa: la API exige la cuenta destino, que aquí es la de pago.
  const destination = form.origin === 'NEW' ? form.disbursementAccountId : form.paymentAccountId;
  return {
    ok: true,
    input: {
      name: form.name.trim(),
      ...termsPayload(form, t),
      account:
        form.accountMode === 'EXISTING'
          ? { id: form.accountId }
          : { create: { name: form.newAccountName.trim() } },
      disbursementAccountId: destination,
      ...(form.paymentAccountId !== '' ? { paymentAccountId: form.paymentAccountId } : {}),
      ...(form.lenderCounterpartyId !== '' ? { lenderCounterpartyId: form.lenderCounterpartyId } : {}),
      ...(form.origin === 'NEW' && form.disburseNow
        ? { disburseNow: true, ...(retained !== undefined ? { retainedFee: retained } : {}) }
        : {}),
    },
  };
}

// ───────────────────────────── Pago ─────────────────────────────

export interface PaymentForm {
  readonly amount: string;
  readonly businessDate: string;
  readonly accountId: string;
  readonly paymentMethod: string;
  readonly mode: 'AUTO' | 'BREAKDOWN';
  readonly installmentNo: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
}

export const BREAKDOWN_FIELDS = ['principal', 'interest', 'fees', 'insurance', 'taxes'] as const;

export function emptyPaymentForm(opts: {
  businessDate: string;
  accountId?: string;
  installmentNo?: number;
  amount?: string;
}): PaymentForm {
  return {
    amount: opts.amount ?? '',
    businessDate: opts.businessDate,
    accountId: opts.accountId ?? '',
    paymentMethod: '',
    mode: 'AUTO',
    installmentNo: opts.installmentNo === undefined ? '' : String(opts.installmentNo),
    principal: '',
    interest: '',
    fees: '',
    insurance: '',
    taxes: '',
  };
}

/** Σ de los componentes del desglose (campos vacíos valen 0); `null` si algún campo no es un monto válido. */
export function breakdownSum(form: PaymentForm, o: Opts & { currency: string }): string | null {
  const values: string[] = [];
  for (const k of BREAKDOWN_FIELDS) {
    if (form[k].trim() === '') continue;
    const r = parseAmount(form[k], {
      locale: o.locale,
      currency: o.currency,
      scale: o.scale,
      allowZero: true,
    });
    if (!r.ok) return null;
    values.push(r.value);
  }
  return sumAmounts(values.length > 0 ? values : ['0'], o.currency, o.scale);
}

/** Monto pagado − Σ del desglose (cero = el recibo cuadra); `null` si falta o es inválido el monto o algún componente. */
export function breakdownDelta(form: PaymentForm, o: Opts & { currency: string }): string | null {
  const sum = breakdownSum(form, o);
  if (sum === null) return null;
  const paid = parseAmount(form.amount, { locale: o.locale, currency: o.currency, scale: o.scale });
  return paid.ok ? subtractAmounts(paid.value, sum, o.currency, o.scale) : null;
}

/** Comisión retenida opcional del desembolso (vacía ⇒ sin comisión). */
export function parseDisburseFee(
  raw: string,
  o: Opts & { currency: string },
):
  | { readonly ok: true; readonly value: string | undefined }
  | { readonly ok: false; readonly error: FormErrorCode } {
  if (raw.trim() === '') return { ok: true, value: undefined };
  const r = parseAmount(raw, { locale: o.locale, currency: o.currency, scale: o.scale, allowZero: true });
  return r.ok
    ? { ok: true, value: r.value }
    : { ok: false, error: r.error === 'EMPTY' ? 'REQUIRED' : r.error };
}

/** Cuerpo de `POST …/payments`: automático (solo monto) o con el desglose del recibo (una cuota, `installmentNo`). */
export function buildPaymentInput(
  form: PaymentForm,
  o: Opts & { currency: string },
): BuildResult<Record<string, unknown>> {
  const errors: Record<string, FormErrorCode> = {};
  const amount = amountOrError(form.amount, 'amount', o, errors);
  if (form.businessDate === '') errors['businessDate'] = 'REQUIRED';
  else if (!isDate(form.businessDate)) errors['businessDate'] = 'INVALID';
  if (form.accountId === '') errors['accountId'] = 'REQUIRED';
  const breakdown: Record<string, string> = {};
  let installmentNo: number | undefined;
  if (form.mode === 'BREAKDOWN') {
    const n = form.installmentNo.trim();
    if (n === '') errors['installmentNo'] = 'REQUIRED';
    else if (!/^\d+$/.test(n) || Number(n) < 1) errors['installmentNo'] = 'RANGE';
    else installmentNo = Number(n);
    for (const k of BREAKDOWN_FIELDS) {
      if (form[k].trim() === '') continue;
      const v = amountOrError(form[k], k, o, errors, true);
      if (v !== undefined) breakdown[k] = v;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      amount: { amount: amount!, currency: o.currency },
      businessDate: form.businessDate,
      accountId: form.accountId,
      ...(form.paymentMethod.trim() !== '' ? { paymentMethod: form.paymentMethod.trim() } : {}),
      ...(form.mode === 'BREAKDOWN' ? { installmentNo, breakdown } : {}),
    },
  };
}

// ───────────────────────────── Estados ─────────────────────────────

export const LOAN_PRESENTATION: Readonly<Record<LoanStatus, StatusPresentation>> = {
  DRAFT: { icon: '✎', tone: 'neutral' },
  ACTIVE: { icon: '●', tone: 'ok' },
  PAID_OFF: { icon: '✓', tone: 'ok' },
  CANCELLED: { icon: '✕', tone: 'neutral' },
};

export type InstallmentView = InstallmentStatus | 'OVERDUE';

/** Estado mostrado de una cuota: pendiente, parcial, pagada o atrasada (vencida antes de hoy y sin pagar completa). */
export const installmentView = (i: Pick<LoanInstallment, 'status' | 'overdue'>): InstallmentView =>
  i.status !== 'PAID' && i.overdue ? 'OVERDUE' : i.status;

export const INSTALLMENT_PRESENTATION: Readonly<Record<InstallmentView, StatusPresentation>> = {
  UNPAID: { icon: '○', tone: 'neutral' },
  PARTIALLY_PAID: { icon: '◐', tone: 'warn' },
  PAID: { icon: '✓', tone: 'ok' },
  OVERDUE: { icon: '⚠', tone: 'danger' },
};

/** Un `LOAN_PAYMENT` / `LOAN_DISBURSEMENT` lo administra el préstamo (no se edita ni se anula desde transacciones). */
export const isLoanManagedKind = (kind: string): boolean =>
  kind === 'LOAN_PAYMENT' || kind === 'LOAN_DISBURSEMENT';

/** ¿Puede anularse este pago? Solo el último pago activo (`LOAN_PAYMENT_NOT_LATEST`). */
export function lastActivePaymentId(payments: readonly { id: string; status: string; paymentNo: number }[]) {
  return [...payments].filter((p) => p.status === 'ACTIVE').sort((a, b) => b.paymentNo - a.paymentNo)[0]?.id;
}

/** `true` si el valor decimal con signo es distinto de cero (resalta diferencias). */
export const isDifferent = (value: string | null | undefined): boolean =>
  value !== null && value !== undefined && !isZeroAmount(value);

// ───────────────────────────── Comparación con la tabla del banco ─────────────────────────────

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9#]/g, '');

const ALIASES: Readonly<Record<MappingField, readonly string[]>> = {
  installmentNo: ['nro', 'n', 'no', 'num', 'numero', 'nrocuota', 'ncuota', 'cuotano', 'numerocuota', '#'],
  dueDate: ['fecha', 'vencimiento', 'fechavencimiento', 'fechadepago', 'date', 'fechacuota'],
  principal: ['capital', 'principal', 'amortizacion', 'abonocapital', 'abonoacapital'],
  interest: ['interes', 'intereses', 'interest'],
  fees: ['comision', 'comisiones', 'cargos', 'fees', 'gastos'],
  insurance: ['seguro', 'seguros', 'desgravamen', 'segurodedesgravamen', 'insurance'],
  taxes: ['impuesto', 'impuestos', 'iva', 'taxes'],
  total: ['cuota', 'total', 'pago', 'montocuota', 'cuotatotal', 'totalcuota'],
  balance: ['saldo', 'saldocapital', 'balance', 'saldoprestamo'],
};

/** Propone el mapeo por nombre del encabezado (la persona lo confirma o corrige). */
export function autoMapping(headers: readonly string[]): ReferenceMapping {
  const out: Partial<Record<MappingField, string>> = {};
  const used = new Set<string>();
  for (const field of MAPPING_FIELDS) {
    const hit = headers.find((h) => !used.has(h) && ALIASES[field].includes(fold(h)));
    if (hit !== undefined) {
      out[field] = hit;
      used.add(hit);
    }
  }
  return out;
}

/** Campos obligatorios sin columna asignada. */
export const missingMapping = (m: ReferenceMapping): MappingField[] =>
  REQUIRED_MAPPING.filter((f) => !m[f] || m[f] === '');

/** Formato de fecha más probable según la primera fecha de la muestra. */
export function guessDateFormat(sample: string | undefined): DateFormat {
  const v = (sample ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'YYYY-MM-DD';
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(v);
  if (m && Number(m[2]) > 12) return 'MM/DD/YYYY';
  return 'DD/MM/YYYY';
}

/** Separador decimal más probable: con `;` o tabulación suele ser coma; con coma como separador, punto. */
export const guessDecimal = (delimiter: string): ',' | '.' => (delimiter === ',' ? '.' : ',');

export interface ReferenceFormState {
  readonly delimiter: Delimiter;
  readonly mapping: ReferenceMapping;
  readonly dateFormat: DateFormat;
  readonly decimalSeparator: ',' | '.';
}

/** Cuerpo de `POST …/reference-schedules` para `CSV`/`PASTE` (texto UTF-8 + mapeo explícito). */
export function buildReferenceInput(
  source: 'CSV' | 'PASTE',
  text: string,
  s: ReferenceFormState,
): ReferenceInput {
  const mapping: Partial<Record<MappingField, string>> = {};
  for (const k of MAPPING_FIELDS) {
    const v = s.mapping[k];
    if (v !== undefined && v !== '') mapping[k] = v;
  }
  return {
    source,
    text,
    delimiter: s.delimiter,
    hasHeader: true,
    mapping,
    dateFormat: s.dateFormat,
    decimalSeparator: s.decimalSeparator,
  };
}

export interface ManualRowForm {
  readonly n: string;
  readonly dueDate: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly total: string;
}

export const emptyManualRow = (n: number): ManualRowForm => ({
  n: String(n),
  dueDate: '',
  principal: '',
  interest: '',
  fees: '',
  insurance: '',
  taxes: '',
  total: '',
});

const MANUAL_AMOUNTS = ['principal', 'interest', 'fees', 'insurance', 'taxes', 'total'] as const;

/** Filas ingresadas a mano → `rows` de la API (`source: MANUAL`). Errores por `"{índice}.{campo}"`. */
export function buildManualRows(
  rows: readonly ManualRowForm[],
  o: Opts & { currency: string },
): BuildResult<ReferenceInput> {
  const errors: Record<string, FormErrorCode> = {};
  const out: ReferenceManualRow[] = [];
  rows.forEach((r, i) => {
    const key = (f: string) => `${i}.${f}`;
    if (!/^\d+$/.test(r.n.trim()) || Number(r.n) < 1) errors[key('n')] = 'RANGE';
    if (r.dueDate === '') errors[key('dueDate')] = 'REQUIRED';
    else if (!isDate(r.dueDate)) errors[key('dueDate')] = 'INVALID';
    const amounts: Record<string, string> = {};
    for (const f of MANUAL_AMOUNTS) {
      const raw = r[f];
      if (raw.trim() === '') {
        if (f === 'principal' || f === 'interest') errors[key(f)] = 'REQUIRED';
        continue;
      }
      const v = amountOrError(raw, key(f), o, errors, true);
      if (v !== undefined) amounts[f] = v;
    }
    if (!errors[key('n')] && !errors[key('dueDate')])
      out.push({
        n: Number(r.n),
        dueDate: r.dueDate,
        principal: amounts['principal'] ?? '0',
        interest: amounts['interest'] ?? '0',
        ...(amounts['fees'] !== undefined ? { fees: amounts['fees'] } : {}),
        ...(amounts['insurance'] !== undefined ? { insurance: amounts['insurance'] } : {}),
        ...(amounts['taxes'] !== undefined ? { taxes: amounts['taxes'] } : {}),
        ...(amounts['total'] !== undefined ? { total: amounts['total'] } : {}),
      });
  });
  if (rows.length === 0) errors['rows'] = 'REQUIRED';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { source: 'MANUAL', rows: out } };
}

/** Errores por fila de `LOAN_REFERENCE_INVALID` (`details.rows[]`), tolerante a formas inesperadas. */
export function referenceRowErrors(problem: { readonly [k: string]: unknown }): ReferenceRowError[] {
  const details = problem['details'];
  const rows =
    typeof details === 'object' && details !== null ? (details as { rows?: unknown }).rows : undefined;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      row: typeof r['row'] === 'number' ? r['row'] : 0,
      field: typeof r['field'] === 'string' ? r['field'] : '',
      code: typeof r['code'] === 'string' ? r['code'] : '',
      message: typeof r['message'] === 'string' ? r['message'] : '',
    }));
}

/** Lee un archivo como texto UTF-8 en el navegador (el servidor limita a 256 KiB y 600 filas). */
export const MAX_REFERENCE_BYTES = 262_144;
export const readTextFile = (file: Blob): Promise<string> => file.text();

export function referencePath(base: string, loanId: string, suffix = ''): string {
  return `${base}/loans/${loanId}/reference-schedules${suffix}`;
}
export const comparisonPath = (base: string, loanId: string, referenceId: string, suffix = ''): string =>
  `${referencePath(base, loanId)}/${referenceId}/comparison${suffix}`;
