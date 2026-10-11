import { DomainError, LocalDate, Money, currency as makeCurrency } from '@pf/shared-kernel';
import { type SavingsGoal } from '../domain/index.js';
import type { AccountInfo, GoalsDeps, PlanRecord } from './ports/index.js';

export const notFound = (what: string, id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `${what} ${id} not found`);

export const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

export function parseDate(value: unknown, pointer: string): LocalDate {
  try {
    return LocalDate.parse(value as string);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'date must be YYYY-MM-DD').at(pointer);
  }
}

/** Monto `{amount, currency}` del contrato → `Money` a la escala del catálogo (`AMOUNT_SCALE_EXCEEDED`, moneda desconocida). */
export async function parseMoney(
  deps: GoalsDeps,
  value: unknown,
  pointer: string,
  options: { readonly positive?: boolean; readonly enabledIn?: string } = {},
): Promise<Money> {
  if (!value || typeof value !== 'object') {
    throw new DomainError('VALIDATION_FAILED', 'a money object {amount, currency} is required').at(pointer);
  }
  const { amount, currency: code } = value as { amount?: unknown; currency?: unknown };
  if (typeof amount !== 'string' || typeof code !== 'string') {
    throw new DomainError('VALIDATION_FAILED', 'amount and currency must be text').at(pointer);
  }
  if (options.enabledIn && !(await deps.currencies.isEnabled(options.enabledIn, code))) {
    throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`).at(
      `${pointer}/currency`,
    );
  }
  const scale = await deps.currencies.scaleOf(code);
  if (scale === null) {
    throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not in the catalog`).at(
      `${pointer}/currency`,
    );
  }
  let money: Money;
  try {
    money = Money.parse(amount, makeCurrency(code, scale));
  } catch (err) {
    if (err instanceof DomainError) throw err.at(`${pointer}/amount`);
    throw err;
  }
  if (options.positive && !money.isPositive()) {
    throw new DomainError('AMOUNT_NOT_POSITIVE', 'the amount must be greater than zero').at(
      `${pointer}/amount`,
    );
  }
  return money;
}

/** Carga la meta con `FOR UPDATE`; 404 si no existe en el workspace. */
export async function lockGoal(deps: GoalsDeps, workspaceId: string, goalId: string): Promise<SavingsGoal> {
  const goal = await deps.goals.findById(workspaceId, goalId, { lock: 'update' });
  if (!goal) throw notFound('goal', goalId);
  return goal;
}

export function assertVersion(goal: SavingsGoal, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && goal.version !== expectedVersion) {
    throw preconditionFailed(goal.version);
  }
}

/**
 * Cuentas vinculables a una meta: activas y de naturaleza activo (`GOAL_ACCOUNT_NOT_ELIGIBLE` para un pasivo,
 * `ACCOUNT_CLOSED`/`ACCOUNT_ARCHIVED`, `REFERENCE_NOT_FOUND`).
 */
export async function assertLinkable(
  deps: GoalsDeps,
  workspaceId: string,
  accountIds: readonly string[],
  pointer = '/linkedAccountIds',
): Promise<ReadonlyMap<string, AccountInfo>> {
  const found = new Map(
    (accountIds.length ? await deps.accounts.find(workspaceId, accountIds) : []).map(
      (a) => [a.accountId, a] as const,
    ),
  );
  accountIds.forEach((id, i) => {
    const account = found.get(id);
    const at = `${pointer}/${i}`;
    if (!account) throw new DomainError('REFERENCE_NOT_FOUND', `account ${id} not found`).at(at);
    if (account.nature !== 'ASSET') {
      throw new DomainError('GOAL_ACCOUNT_NOT_ELIGIBLE', 'a liability account cannot back a savings goal').at(
        at,
      );
    }
    if (account.status === 'ARCHIVED')
      throw new DomainError('ACCOUNT_ARCHIVED', 'the account is archived').at(at);
    if (account.status === 'CLOSED') throw new DomainError('ACCOUNT_CLOSED', 'the account is closed').at(at);
  });
  return found;
}

/** Próxima fecha de un día del mes (1..31, con tope al último día del mes) desde `today` inclusive. */
export function nextMonthlyDate(today: LocalDate, dayOfMonth: number): LocalDate {
  const clamp = (year: number, month: number) =>
    LocalDate.of(year, month, Math.min(dayOfMonth, LocalDate.daysInMonth(year, month)));
  const thisMonth = clamp(today.year, today.month);
  if (thisMonth.compare(today) >= 0) return thisMonth;
  const month = today.month === 12 ? 1 : today.month + 1;
  const year = today.month === 12 ? today.year + 1 : today.year;
  return clamp(year, month);
}

/** El plan sin su programación recurrente (tras terminar la definición administrada). */
export const withoutAutomation = (plan: PlanRecord): PlanRecord => ({
  ...plan,
  automation: 'NONE',
  materializationMode: null,
  autoCreateStatus: null,
  definitionId: null,
  version: plan.version + 1,
});
