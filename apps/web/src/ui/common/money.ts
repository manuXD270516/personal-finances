import { Money, currency as currencyOf } from '@pf/shared-kernel';

/**
 * Montos en la UI (INV-001, ADR-0006): siempre strings decimales. La entrada del usuario se normaliza tolerando el
 * locale (NFR-USAB-003: `1.234,56` en es-BO, `1,234.56` en en-US) y se valida contra la escala de la moneda sin
 * redondear; la aritmética (sumas, restante por asignar, repartos) usa `Money` del shared-kernel (bigint exacto).
 */

/** Escalas del catálogo de Phase 1 (fx.currency); la UI usa las de `GET /currencies` cuando están disponibles. */
export const KNOWN_SCALES: Readonly<Record<string, number>> = {
  BOB: 2,
  USD: 2,
  EUR: 2,
  USDT: 6,
  USDC: 6,
  TRX: 6,
  BTC: 8,
  ETH: 18,
};

export const scaleFor = (code: string, scales?: Readonly<Record<string, number>>): number =>
  scales?.[code] ?? KNOWN_SCALES[code] ?? 2;

export type AmountError = 'EMPTY' | 'INVALID' | 'SCALE' | 'NOT_POSITIVE';
export type AmountResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: AmountError };

function separatorsOf(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(12345.6);
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
  };
}

const groupsValid = (body: string, sep: string): boolean => {
  const [head = '', ...rest] = body.split(sep);
  return /^\d{1,3}$/.test(head) && rest.every((g) => /^\d{3}$/.test(g));
};

/**
 * Normaliza lo que escribió el usuario a un decimal canónico sin signo (`"1234.5"`), o `null` si no es un número.
 * Reglas: espacios ignorados; con `.` y `,` a la vez, el último es el separador decimal; un separador repetido es de
 * miles (grupos de 3); uno solo es decimal salvo que sea el separador de miles del locale seguido de exactamente
 * 3 dígitos (`1.234` en es-BO = 1234, pero `45.90` = 45,90).
 */
export function normalizeDecimalInput(raw: string, locale: string): string | null {
  // `\s` incluye los espacios Unicode (no separables y finos que usa Intl en algunos locales).
  const s = raw.replace(/[\s']/g, '').replace(/^\+/, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dots = s.split('.').length - 1;
  const commas = s.split(',').length - 1;
  let intPart: string;
  let fracPart = '';
  if (dots > 0 && commas > 0) {
    const decimalSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const groupSep = decimalSep === '.' ? ',' : '.';
    if ((decimalSep === '.' ? dots : commas) !== 1) return null;
    const [body = '', frac = ''] = s.split(decimalSep);
    if (!groupsValid(body, groupSep)) return null;
    intPart = body.split(groupSep).join('');
    fracPart = frac;
  } else if (dots + commas === 0) {
    intPart = s;
  } else {
    const sep = dots > 0 ? '.' : ',';
    const count = dots + commas;
    const { decimal, group } = separatorsOf(locale);
    if (count > 1) {
      if (!groupsValid(s, sep)) return null;
      intPart = s.split(sep).join('');
    } else {
      const [body = '', frac = ''] = s.split(sep);
      const isGroup = sep !== decimal && sep === group && frac.length === 3 && /^\d{1,3}$/.test(body);
      if (isGroup) intPart = `${body}${frac}`;
      else {
        intPart = body;
        fracPart = frac;
      }
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (intPart === '' && fracPart === '') return null;
  const int = intPart.replace(/^0+(?=\d)/, '') || '0';
  return fracPart ? `${int}.${fracPart}` : int;
}

/**
 * Monto positivo en `currency` con la escala canónica (`"45.90"`, `"100.000000"`). Más decimales significativos
 * que la escala ⇒ `SCALE` (nunca se redondea ni trunca, INV-020); cero ⇒ `NOT_POSITIVE` salvo `allowZero`.
 */
export function parseAmount(
  raw: string,
  opts: { readonly locale: string; readonly currency: string; readonly scale: number; allowZero?: boolean },
): AmountResult {
  if (raw.trim() === '') return { ok: false, error: 'EMPTY' };
  if (raw.trim().startsWith('-')) return { ok: false, error: 'NOT_POSITIVE' };
  const normalized = normalizeDecimalInput(raw, opts.locale);
  if (normalized === null) return { ok: false, error: 'INVALID' };
  let money: Money;
  try {
    money = Money.parse(normalized, currencyOf(opts.currency, opts.scale));
  } catch (err) {
    const code = (err as { code?: string }).code;
    return { ok: false, error: code === 'AMOUNT_SCALE_EXCEEDED' ? 'SCALE' : 'INVALID' };
  }
  if (money.isZero() && !opts.allowZero) return { ok: false, error: 'NOT_POSITIVE' };
  return { ok: true, value: money.toFixed() };
}

/** Tasa positiva tolerante al locale (sin escala de moneda; hasta 18 decimales). */
export function parseRate(raw: string, locale: string): AmountResult {
  if (raw.trim() === '') return { ok: false, error: 'EMPTY' };
  const normalized = normalizeDecimalInput(raw, locale);
  if (normalized === null) return { ok: false, error: 'INVALID' };
  if (/^0*(\.0*)?$/.test(normalized)) return { ok: false, error: 'NOT_POSITIVE' };
  const frac = normalized.split('.')[1] ?? '';
  if (frac.length > 18) return { ok: false, error: 'SCALE' };
  return { ok: true, value: normalized };
}

const money = (value: string, code: string, scale: number) => Money.parse(value, currencyOf(code, scale));

/** Σ exacta de montos canónicos de una moneda. */
export function sumAmounts(values: readonly string[], code: string, scale: number): string {
  return Money.sum(
    values.map((v) => money(v, code, scale)),
    currencyOf(code, scale),
  ).toFixed();
}

/** a − b exacto (puede ser negativo: p. ej. "restante por asignar" excedido). */
export const subtractAmounts = (a: string, b: string, code: string, scale: number): string =>
  money(a, code, scale)
    .subtract(money(b, code, scale))
    .toFixed();

export const isZeroAmount = (value: string): boolean => /^-?0*(\.0*)?$/.test(value);

/**
 * Reparto en `parts` partes iguales por mayor residuo (desempate por el índice menor), la misma regla que el
 * dominio (`Money.allocate`, INV-021): 100.00 BOB / 3 = 33.34, 33.33, 33.33.
 */
export const allocateEqually = (total: string, parts: number, code: string, scale: number): string[] =>
  money(total, code, scale)
    .allocate(parts)
    .map((m) => m.toFixed());

/**
 * Reparto por porcentajes (strings decimales que deben sumar exactamente 100), mismo método de mayor residuo:
 * 10.000001 USDT al 50/50 = 5.000001 y 5.000000. `null` si los porcentajes no suman 100 o no son válidos.
 */
export function allocateByPercent(
  total: string,
  percents: readonly string[],
  code: string,
  scale: number,
): string[] | null {
  if (percents.length === 0 || percents.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const sum = Money.sum(
    percents.map((p) => Money.parse(p, currencyOf('PCT', 18))),
    currencyOf('PCT', 18),
  );
  if (!sum.equals(Money.parse('100', currencyOf('PCT', 18)))) return null;
  return money(total, code, scale)
    .allocate(percents)
    .map((m) => m.toFixed());
}

/** Redondeo SOLO de presentación (HALF_EVEN, exacto con bigint): p. ej. un spread de 0.7194… % se muestra 0.72. */
export const roundForDisplay = (value: string, places: number): string =>
  Money.roundToScale(value, currencyOf('DISPLAY', places)).toFixed();

/**
 * Tasa para mostrar: sin ceros finales de la persistencia a 18 decimales, con al menos `minDecimals`
 * (`6.850000000000000000` → `6.85`, `12.02` → `12.02`, `62375` → `62375.00`).
 */
export function trimRate(value: string, minDecimals = 2): string {
  const [int = '0', frac = ''] = value.split('.');
  const trimmed = frac.replace(/0+$/, '');
  return `${int}.${trimmed.padEnd(minDecimals, '0')}`;
}
