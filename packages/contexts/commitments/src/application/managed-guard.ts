import { DomainError } from '@pf/shared-kernel';
import type { RecurringDefinition } from '../domain/index.js';

/**
 * Guarda de las acciones de usuario sobre cuotas de préstamo (openspec add-loans, N4): aprobar, editar, omitir o
 * vincular una ocurrencia `LOAN_PAYMENT` desde recurrentes se rechaza con `RECURRING_MANAGED_EXTERNALLY` indicando el
 * préstamo que la administra (`managedBy`, `managedRef`). Se condiciona al tipo, NO a `managedBy = DEBT`: las
 * ocurrencias `CARD_PAYMENT` de otro change sí se operan desde recurrentes.
 */
export function assertNotLoanPayment(def: RecurringDefinition, scheduleKey?: string | null): void {
  if (def.kind !== 'LOAN_PAYMENT') return;
  const s = def.snapshot;
  throw new DomainError(
    'RECURRING_MANAGED_EXTERNALLY',
    `the occurrence belongs to a loan payment schedule managed by ${s.managedBy}; operate it from there`,
    {
      details: {
        managedBy: s.managedBy,
        managedRef: s.managedRef,
        ...(scheduleKey ? { scheduleKey } : {}),
      },
    },
  );
}
