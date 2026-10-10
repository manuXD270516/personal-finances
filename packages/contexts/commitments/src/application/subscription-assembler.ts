import type { LocalDate } from '@pf/shared-kernel';
import type { Subscription } from '../domain/index.js';
import type { SubscriptionListRow, SubscriptionsDeps } from './ports/subscriptions.js';
import { subscriptionDto, type SubscriptionDto } from './subscription-views.js';

/** Nombres de las cuentas del workspace (incluye archivadas) por id. */
export async function accountNames(
  deps: SubscriptionsDeps,
  workspaceId: string,
): Promise<ReadonlyMap<string, string>> {
  const accounts = await deps.accountCatalog.listAccounts({ workspaceId, includeArchived: true });
  return new Map(accounts.map((a) => [a.accountId, a.name]));
}

/** Detalle completo: historial de precios, propuesta pendiente y definición asociada. */
export async function assembleDetail(
  deps: SubscriptionsDeps,
  sub: Subscription,
  today: LocalDate,
): Promise<SubscriptionDto> {
  const workspaceId = sub.workspaceId;
  const [info, names, accounts, proposals] = await Promise.all([
    deps.managed.info(workspaceId, sub.snapshot.definitionId),
    deps.counterpartyNames.namesOf({ workspaceId, counterpartyIds: [sub.snapshot.counterpartyId] }),
    accountNames(deps, workspaceId),
    deps.proposals.listForSubscription(workspaceId, sub.id),
  ]);
  return subscriptionDto(sub, {
    today: today.toString(),
    providerName: names.get(sub.snapshot.counterpartyId) ?? null,
    paymentAccountId: info.accountId,
    paymentAccountName: accounts.get(info.accountId) ?? null,
    accountCurrency: info.accountCurrency,
    cadence: info.cadence,
    interval: info.interval,
    monthDays: info.monthDays,
    rrule: info.rrule,
    detail: { pending: proposals.find((p) => p.status === 'PENDING') ?? null, definition: info },
  });
}

/** Filas de lista: provider y cuenta por lotes. */
export async function assembleRows(
  deps: SubscriptionsDeps,
  workspaceId: string,
  rows: readonly SubscriptionListRow[],
  today: LocalDate,
): Promise<SubscriptionDto[]> {
  if (rows.length === 0) return [];
  const [names, accounts] = await Promise.all([
    deps.counterpartyNames.namesOf({
      workspaceId,
      counterpartyIds: [...new Set(rows.map((r) => r.subscription.snapshot.counterpartyId))],
    }),
    accountNames(deps, workspaceId),
  ]);
  return rows.map((r) =>
    subscriptionDto(r.subscription, {
      today: today.toString(),
      providerName: names.get(r.subscription.snapshot.counterpartyId) ?? null,
      paymentAccountId: r.paymentAccountId,
      paymentAccountName: accounts.get(r.paymentAccountId) ?? null,
      accountCurrency: r.accountCurrency,
      cadence: r.cadence,
      interval: r.interval,
      monthDays: r.monthDays,
      rrule: r.rrule,
    }),
  );
}
