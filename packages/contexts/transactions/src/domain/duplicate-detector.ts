import type { Money } from '@pf/shared-kernel';
import type { TransactionStatus } from './transaction-status.js';

export interface DuplicateProbe {
  readonly accountId: string;
  readonly amount: Money;
  readonly businessDate: string;
  readonly description?: string | null;
  readonly counterpartyId?: string | null;
  readonly excludeTransactionId?: string | null;
}

export interface DuplicateCandidateInput {
  readonly id: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly businessDate: string;
  readonly description: string | null;
  readonly counterpartyId: string | null;
  readonly status: TransactionStatus;
}

export const DUPLICATE_WINDOW_DAYS = 3;
const MIN_COMMON_PREFIX = 5;

/** Minúsculas, sin acentos y sin espacios repetidos (design.md decisión 13). */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const dayNumber = (date: string): number =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

export const daysBetween = (a: string, b: string): number => Math.abs(dayNumber(a) - dayNumber(b));

function similarDescription(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= MIN_COMMON_PREFIX;
}

/**
 * `DuplicateDetector` puro (transactions/duplicate-detection, solo advertencia): misma cuenta, mismo monto y moneda,
 * |Δ fecha de negocio| ≤ 3 días, no anulada, y descripción normalizada igual (o prefijo común ≥ 5) o misma
 * contraparte. Nunca bloquea ni persiste nada.
 */
export function findDuplicates<T extends DuplicateCandidateInput>(
  probe: DuplicateProbe,
  candidates: readonly T[],
): T[] {
  const probeText = normalizeText(probe.description);
  return candidates.filter((c) => {
    if (c.id === probe.excludeTransactionId || c.status === 'VOIDED') return false;
    if (c.accountId !== probe.accountId) return false;
    if (c.amount.currency.code !== probe.amount.currency.code || !c.amount.equals(probe.amount)) return false;
    if (daysBetween(c.businessDate, probe.businessDate) > DUPLICATE_WINDOW_DAYS) return false;
    const sameCounterparty = !!probe.counterpartyId && probe.counterpartyId === c.counterpartyId;
    return sameCounterparty || similarDescription(probeText, normalizeText(c.description));
  });
}
