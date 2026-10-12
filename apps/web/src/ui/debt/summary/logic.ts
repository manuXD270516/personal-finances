import { formatMoney } from '../../dashboard/format';
import type { Money } from '../../dashboard/types';
import { periodName } from '../../planning/logic';
import type { DebtKind, DebtSummary, DebtSummaryDue } from './types';

/** Mes y año de la fecha libre de deudas en el locale de formato ("junio de 2029"). */
export const debtFreeMonth = (date: string, locale: string): string => periodName(date.slice(0, 7), locale);

/** Montos sin convertir en una sola frase ("100,00 USD, 5,00 EUR"). */
export const joinMoney = (amounts: readonly Money[], locale: string): string =>
  amounts.map((m) => formatMoney(m, locale)).join(', ');

export const joinNames = (names: readonly string[]): string => names.join(', ');

/** Destino del detalle de una deuda; los otros pasivos no tienen pantalla propia. */
export function debtDetailPath(kind: DebtKind, id: string): string | null {
  if (kind === 'LOAN') return `/debts/${id}`;
  if (kind === 'CREDIT_CARD') return `/debts/tarjetas/${id}`;
  return null;
}

/** Próximo vencimiento global (el primero de la lista ya ordenada: atrasados primero, luego por fecha). */
export const nextDue = (summary: DebtSummary): DebtSummaryDue | null => summary.upcomingDues[0] ?? null;

/** Año del interés pagado (`from` = 1 de enero del año en curso). */
export const interestYear = (summary: DebtSummary): string => summary.interestYtd.from.slice(0, 4);

/** Hay montos de interés que mostrar (ni cero ni vacío): evita pintar "0,00" donde no hay interés. */
export const hasInterest = (summary: DebtSummary): boolean =>
  summary.interestYtd.byCurrency.some((m) => !/^[-+]?0*(\.0*)?$/.test(m.amount));
