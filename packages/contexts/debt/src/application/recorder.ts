import type {
  AuditChangeInput,
  AuditEntry,
  LifecycleEventRefDto,
  LifecycleStepInput,
} from '@pf/audit/contracts';
import { LOAN_LIFECYCLE, type Loan, type LoanState } from '../domain/index.js';
import type { DebtDeps } from './ports/index.js';

export const LOAN_AGGREGATE = 'Loan';

interface EventKind {
  readonly eventType: string;
  readonly eventVersion: number;
}

/** Escribe un hecho en el outbox (misma unidad de trabajo) y devuelve su referencia para el recorrido. */
export async function publishLoanEvent(
  deps: DebtDeps,
  loan: Loan,
  kind: EventKind,
  payload: object,
): Promise<LifecycleEventRefDto> {
  const eventId = deps.ids.next();
  await deps.outbox.append({
    eventId,
    eventType: kind.eventType,
    eventVersion: kind.eventVersion,
    occurredAt: deps.clock.now().toString(),
    workspaceId: loan.workspaceId,
    aggregateType: LOAN_AGGREGATE,
    aggregateId: loan.id,
    aggregateVersion: loan.version,
    payload,
  });
  return { eventId, eventType: `${kind.eventType}.v${kind.eventVersion}` };
}

const FIELD_ORDER: readonly (keyof LoanState)[] = [
  'name',
  'status',
  'origin',
  'method',
  'rateType',
  'dayCount',
  'frequency',
  'termInstallments',
  'annualRate',
  'disbursementDate',
  'firstDueDate',
  'accountId',
  'disbursementAccountId',
  'paymentAccountId',
  'lenderCounterpartyId',
  'currentScheduleVersion',
  'recurringDefinitionId',
  'disbursementTransactionId',
];

/** Cambios de auditoría de la cabecera (alta: `before = null`). Los valores compuestos van como texto JSON. */
export function loanChanges(before: LoanState | null, after: LoanState): AuditChangeInput[] {
  const out: AuditChangeInput[] = [];
  const diff = (field: string, b: unknown, a: unknown) => {
    if (before === null || JSON.stringify(b) !== JSON.stringify(a)) {
      out.push({ field, before: before === null ? null : b, after: a });
    }
  };
  for (const k of FIELD_ORDER) diff(k, before?.[k], after[k]);
  diff('principal', before && { amount: before.principal, currency: before.currency }, {
    amount: after.principal,
    currency: after.currency,
  });
  diff('charges', before && JSON.stringify(before.charges), JSON.stringify(after.charges));
  diff('retainedFee', before && { amount: before.retainedFee, currency: before.currency }, {
    amount: after.retainedFee,
    currency: after.currency,
  });
  if (after.existing) {
    diff('existingAsOf', before?.existing?.asOf, after.existing.asOf);
    diff(
      'existingOutstanding',
      before?.existing && { amount: before.existing.outstanding, currency: before.currency },
      { amount: after.existing.outstanding, currency: after.currency },
    );
    diff('nextInstallmentNo', before?.existing?.nextInstallmentNo, after.existing.nextInstallmentNo);
  }
  diff('reason', before?.cancelledReason, after.cancelledReason);
  return out.filter((c) => c.before !== undefined || c.after !== undefined);
}

export function loanEntry(
  loan: Loan,
  action: string,
  changes: readonly AuditChangeInput[],
  reason?: string | null,
): AuditEntry {
  return {
    workspaceId: loan.workspaceId,
    action: `debt.loan.${action}`,
    aggregateType: LOAN_AGGREGATE,
    aggregateId: loan.id,
    aggregateVersion: loan.version,
    changes,
    ...(reason ? { reason } : {}),
  };
}

/** Pasos del recorrido: la transición aplicada o una anotación con los campos cambiados. */
export function loanSteps(
  loan: Loan,
  events: readonly LifecycleEventRefDto[],
  extra: {
    readonly changedFields?: readonly string[];
    readonly detailRefs?: Record<string, string | number>;
    readonly reason?: string | null;
  } = {},
): LifecycleStepInput[] {
  const t = loan.lastTransition;
  if (t) {
    return [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: LOAN_LIFECYCLE.version,
        events,
        ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
      },
    ];
  }
  return [
    {
      kind: 'ANNOTATION',
      changedFields: [...(extra.changedFields ?? loan.changedFields)],
      events,
      ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
    },
  ];
}
