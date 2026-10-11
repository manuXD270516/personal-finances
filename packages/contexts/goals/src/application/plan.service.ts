import type { LifecyclePort } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import { GOAL_FUNDS, type GoalFund, type SavingsGoal } from '../domain/index.js';
import { GoalAssembler } from './goal-assembler.js';
import type { GoalsDeps, PlanRecord } from './ports/index.js';
import { goalEntry, goalSteps } from './recorder.js';
import { MovementRecorder } from './movement-recorder.js';
import { assertVersion, lockGoal, nextMonthlyDate, parseMoney } from './support.js';

export interface SetPlanCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly expectedVersion: number;
  readonly monthlyAmount: { readonly amount: string; readonly currency: string };
  readonly fund: GoalFund;
  readonly sourceAccountId?: string | null | undefined;
  readonly destinationAccountId?: string | null | undefined;
  readonly dayOfMonth?: number | null | undefined;
  readonly automation: 'NONE' | 'RECURRING';
  readonly materialization?:
    | {
        readonly mode: 'PENDING_APPROVAL' | 'AUTO_CREATE';
        readonly autoCreateStatus?: 'PENDING' | 'POSTED' | undefined;
      }
    | undefined;
}

export interface RemovePlanCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly expectedVersion: number;
}

const planChanges = (before: PlanRecord | null, after: PlanRecord | null) => {
  const money = (p: PlanRecord | null) => (p ? { amount: p.monthlyAmount, currency: p.currency } : null);
  const out: { field: string; before: unknown; after: unknown }[] = [];
  const diff = (field: string, b: unknown, a: unknown) => {
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ field, before: b, after: a });
  };
  diff('planMonthly', money(before), money(after));
  diff('planFund', before?.fund ?? null, after?.fund ?? null);
  diff('planSourceAccountId', before?.sourceAccountId ?? null, after?.sourceAccountId ?? null);
  diff('planDestinationAccountId', before?.destinationAccountId ?? null, after?.destinationAccountId ?? null);
  diff('planDayOfMonth', before?.dayOfMonth ?? null, after?.dayOfMonth ?? null);
  diff('planAutomation', before?.automation ?? null, after?.automation ?? null);
  diff(
    'planMaterialization',
    before?.materializationMode ? `${before.materializationMode}/${before.autoCreateStatus ?? ''}` : null,
    after?.materializationMode ? `${after.materializationMode}/${after.autoCreateStatus ?? ''}` : null,
  );
  diff('planDefinitionId', before?.definitionId ?? null, after?.definitionId ?? null);
  return out;
};

/**
 * Aporte mensual planificado y su programación recurrente (openspec add-savings-goals, decisiones 17 y 18): el plan
 * vive en `goals.goal_plan`; la programación es una definición `TRANSFER` administrada por la meta
 * (`managedBy = GOAL`) que se crea, revisa, pausa y termina en la MISMA unidad de trabajo por el puerto público de
 * COMMITMENTS. Las acciones de usuario sobre esa definición se rechazan con `RECURRING_MANAGED_EXTERNALLY`.
 */
export class PlanService {
  private readonly assembler: GoalAssembler;
  private readonly recorder: MovementRecorder;

  /** Auditoría + recorrido en la misma unidad de trabajo del comando (INV-029). */
  private readonly audit: LifecyclePort;

  constructor(private readonly deps: GoalsDeps) {
    this.audit = deps.lifecycle;
    this.assembler = new GoalAssembler(deps);
    this.recorder = new MovementRecorder(deps, this.assembler);
  }

  async set(cmd: SetPlanCommand): Promise<SavingsGoal> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    const today = (await this.assembler.calendar(workspaceId)).today;
    return deps.uow.run(workspaceId, async () => {
      const goal = await lockGoal(deps, workspaceId, cmd.goalId);
      assertVersion(goal, cmd.expectedVersion);
      goal.assertAcceptsMovements();
      const monthly = await parseMoney(deps, cmd.monthlyAmount, '/monthlyAmount', { positive: true });
      if (monthly.currency.code !== goal.snapshot.currency) {
        throw new DomainError('CURRENCY_MISMATCH', `the plan must be in ${goal.snapshot.currency}`).at(
          '/monthlyAmount/currency',
        );
      }
      if (!(GOAL_FUNDS as readonly string[]).includes(cmd.fund)) {
        throw new DomainError('VALIDATION_FAILED', 'fund must be REAL or EARMARK').at('/fund');
      }
      const day = cmd.dayOfMonth ?? null;
      if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) {
        throw new DomainError('VALIDATION_FAILED', 'dayOfMonth must be between 1 and 31').at('/dayOfMonth');
      }
      const recurring = cmd.automation === 'RECURRING';
      if (cmd.automation !== 'NONE' && !recurring) {
        throw new DomainError('VALIDATION_FAILED', 'automation must be NONE or RECURRING').at('/automation');
      }
      const source = cmd.sourceAccountId ?? null;
      const destination = cmd.destinationAccountId ?? null;
      await this.assertAccounts(goal, { recurring, fund: cmd.fund, source, destination, day });

      const existing = await deps.plans.get(workspaceId, goal.id);
      const materializationMode = recurring ? (cmd.materialization?.mode ?? 'PENDING_APPROVAL') : null;
      const autoCreateStatus =
        recurring && materializationMode === 'AUTO_CREATE'
          ? (cmd.materialization?.autoCreateStatus ?? 'POSTED')
          : null;
      let definitionId = existing?.definitionId ?? null;
      const materialization = {
        mode: materializationMode ?? 'PENDING_APPROVAL',
        ...(autoCreateStatus ? { autoCreateStatus } : {}),
      };
      if (recurring && existing?.automation === 'RECURRING' && definitionId) {
        await deps.recurring.reviseManaged({
          workspaceId,
          userId,
          definitionId,
          name: this.nameOf(goal),
          accountId: source as string,
          toAccountId: destination as string,
          amount: monthly.toFixed(),
          monthDays: [day as number],
          weekendAdjustment: 'NONE',
          materialization,
          effectiveFrom: today.toString(),
        });
      } else if (recurring) {
        const created = await deps.recurring.createManaged({
          workspaceId,
          userId,
          managedBy: 'GOAL',
          managedRef: goal.id,
          name: this.nameOf(goal),
          kind: 'TRANSFER',
          accountId: source as string,
          toAccountId: destination as string,
          currency: monthly.currency.code,
          amount: monthly.toFixed(),
          monthlyRule: {
            monthDays: [day as number],
            startDate: nextMonthlyDate(today, day as number).toString(),
            weekendAdjustment: 'NONE',
          },
          materialization,
        });
        definitionId = created.definitionId;
        if (goal.status === 'PAUSED')
          await deps.recurring.pauseManaged({ workspaceId, userId, definitionId });
      } else if (existing?.automation === 'RECURRING' && definitionId) {
        await deps.recurring.end({ workspaceId, userId, definitionId, from: today.toString() });
        definitionId = null;
      }
      const next: PlanRecord = {
        goalId: goal.id,
        monthlyAmount: monthly.toFixed(),
        currency: monthly.currency.code,
        fund: cmd.fund,
        sourceAccountId: source,
        destinationAccountId: destination,
        dayOfMonth: day,
        automation: cmd.automation,
        materializationMode,
        autoCreateStatus,
        definitionId: recurring ? definitionId : null,
        version: (existing?.version ?? 0) + 1,
      };
      await deps.plans.upsert(workspaceId, next);
      goal.touch(['plan'], at, userId);
      await deps.lifecycle.record(
        goalEntry(goal, 'plan_set', planChanges(existing, next)),
        goalSteps(goal, [], { changedFields: ['plan'] }),
      );
      await this.recorder.persist(goal);
      return goal;
    });
  }

  async remove(cmd: RemovePlanCommand): Promise<SavingsGoal> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    const today = (await this.assembler.calendar(workspaceId)).today;
    return deps.uow.run(workspaceId, async () => {
      const goal = await lockGoal(deps, workspaceId, cmd.goalId);
      assertVersion(goal, cmd.expectedVersion);
      const existing = await deps.plans.get(workspaceId, goal.id);
      if (!existing) throw new DomainError('RESOURCE_NOT_FOUND', `the goal ${goal.id} has no plan`);
      if (existing.automation === 'RECURRING' && existing.definitionId) {
        await deps.recurring.end({
          workspaceId,
          userId,
          definitionId: existing.definitionId,
          from: today.toString(),
        });
      }
      await deps.plans.remove(workspaceId, goal.id);
      goal.touch(['plan'], at, userId);
      await deps.lifecycle.record(
        goalEntry(goal, 'plan_removed', planChanges(existing, null)),
        goalSteps(goal, [], { changedFields: ['plan'] }),
      );
      await this.recorder.persist(goal);
      return goal;
    });
  }

  private nameOf(goal: SavingsGoal): string {
    return `Aporte · ${goal.snapshot.name}`.slice(0, 120);
  }

  private async assertAccounts(
    goal: SavingsGoal,
    input: {
      readonly recurring: boolean;
      readonly fund: GoalFund;
      readonly source: string | null;
      readonly destination: string | null;
      readonly day: number | null;
    },
  ): Promise<void> {
    const { deps } = this;
    const currency = goal.snapshot.currency;
    if (input.recurring) {
      if (input.fund !== 'REAL') {
        throw new DomainError('VALIDATION_FAILED', 'a recurring contribution must be a real one').at('/fund');
      }
      if (!input.source) {
        throw new DomainError('VALIDATION_FAILED', 'sourceAccountId is required').at('/sourceAccountId');
      }
      if (!input.destination) {
        throw new DomainError('VALIDATION_FAILED', 'destinationAccountId is required').at(
          '/destinationAccountId',
        );
      }
      if (input.day === null) {
        throw new DomainError('VALIDATION_FAILED', 'dayOfMonth is required').at('/dayOfMonth');
      }
      if (input.source === input.destination) {
        throw new DomainError('VALIDATION_FAILED', 'source and destination must differ').at(
          '/destinationAccountId',
        );
      }
    }
    if (input.destination && !goal.isLinked(input.destination)) {
      throw new DomainError(
        'GOAL_ACCOUNT_NOT_LINKED',
        'the destination account is not linked to the goal',
      ).at('/destinationAccountId');
    }
    const ids = [input.source, input.destination].filter((id): id is string => id !== null);
    if (ids.length === 0) return;
    const found = new Map(
      (await deps.accounts.find(goal.workspaceId, ids)).map((a) => [a.accountId, a] as const),
    );
    for (const [pointer, id] of [
      ['/sourceAccountId', input.source],
      ['/destinationAccountId', input.destination],
    ] as const) {
      if (!id) continue;
      const account = found.get(id);
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at(pointer);
      if (account.status === 'ARCHIVED')
        throw new DomainError('ACCOUNT_ARCHIVED', 'the account is archived').at(pointer);
      if (account.status === 'CLOSED')
        throw new DomainError('ACCOUNT_CLOSED', 'the account is closed').at(pointer);
      if (account.nature !== 'ASSET') {
        throw new DomainError('GOAL_ACCOUNT_NOT_ELIGIBLE', 'a liability account cannot be used').at(pointer);
      }
      if (input.recurring && account.currency !== currency) {
        throw new DomainError('CURRENCY_MISMATCH', `the account must be in ${currency}`).at(pointer);
      }
    }
  }
}
