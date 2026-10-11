import type { LifecyclePort } from '@pf/audit/contracts';
import { DomainError, Money, dec } from '@pf/shared-kernel';
import {
  GOAL_LIFECYCLE,
  SavingsGoal,
  withdrawal,
  type GoalEdit,
  type GoalFund,
  type GoalStatus,
} from '../domain/index.js';
import { GoalAssembler } from './goal-assembler.js';
import { MovementRecorder } from './movement-recorder.js';
import type { GoalsDeps, MovementRow } from './ports/index.js';
import { goalChanges, goalEntry, goalSteps } from './recorder.js';
import { ReservationWatch } from './reservation-watch.js';
import {
  assertLinkable,
  assertVersion,
  lockGoal,
  parseDate,
  parseMoney,
  withoutAutomation,
} from './support.js';

export interface CreateGoalCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly type: string;
  readonly target: { readonly amount: string; readonly currency: string };
  readonly startDate?: string | undefined;
  readonly targetDate?: string | null | undefined;
  readonly linkedAccountIds?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly icon?: string | null | undefined;
  readonly color?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly tolerancePercent?: string | undefined;
  readonly pacePeriods?: number | undefined;
}

export interface UpdateGoalCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly expectedVersion: number;
  readonly name?: string | undefined;
  readonly type?: string | undefined;
  readonly target?: { readonly amount: string; readonly currency?: string | undefined } | undefined;
  readonly targetDate?: string | null | undefined;
  readonly linkedAccountIds?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly icon?: string | null | undefined;
  readonly color?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly tolerancePercent?: string | undefined;
  readonly pacePeriods?: number | undefined;
}

export interface GoalActionCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly expectedVersion: number;
}

/**
 * Casos de uso del ciclo de vida de la meta (openspec add-savings-goals, decisiones 3, 15 y 23): crear, editar, pausar,
 * reanudar, cerrar, cancelar y archivar. Cada comando corre en UNA unidad de trabajo con la meta bloqueada
 * (`FOR UPDATE`) y deja auditoría, recorrido y outbox en esa misma transacción (INV-029).
 */
export class GoalsService {
  private readonly recorder: MovementRecorder;
  private readonly watch: ReservationWatch;
  private readonly assembler: GoalAssembler;

  /** Auditoría + recorrido en la misma unidad de trabajo del comando (INV-029). */
  private readonly audit: LifecyclePort;

  constructor(private readonly deps: GoalsDeps) {
    this.audit = deps.lifecycle;
    this.assembler = new GoalAssembler(deps);
    this.recorder = new MovementRecorder(deps, this.assembler);
    this.watch = new ReservationWatch(deps);
  }

  // ───────────────────────────────────────────────────────────── crear

  async create(cmd: CreateGoalCommand): Promise<SavingsGoal> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const cal = await this.assembler.calendar(workspaceId);
    const at = deps.clock.now().toString();
    return deps.uow.run(workspaceId, async () => {
      const target = await parseMoney(deps, cmd.target, '/target', { enabledIn: workspaceId });
      const linked = [...new Set(cmd.linkedAccountIds ?? [])];
      const goal = SavingsGoal.create({
        id: deps.ids.next(),
        workspaceId,
        name: cmd.name,
        type: cmd.type,
        target: { amount: cmd.target.amount, currency: target.currency.code },
        currencyScale: target.currency.scale,
        startDate: cmd.startDate ? parseDate(cmd.startDate, '/startDate').toString() : cal.today.toString(),
        targetDate: cmd.targetDate ?? null,
        linkedAccountIds: linked,
        priority: cmd.priority,
        icon: cmd.icon,
        color: cmd.color,
        notes: cmd.notes,
        tolerancePercent: cmd.tolerancePercent,
        pacePeriods: cmd.pacePeriods,
        at,
        by: userId,
      });
      if (await deps.goals.nameTaken(workspaceId, goal.snapshot.name)) {
        throw new DomainError('NAME_TAKEN', 'a goal with that name already exists').at('/name');
      }
      await assertLinkable(deps, workspaceId, linked);
      await deps.goals.insert(goal);
      await deps.lifecycle.record(
        goalEntry(goal, 'created', goalChanges(null, goal.snapshot)),
        goalSteps(goal, []),
      );
      return goal;
    });
  }

  // ───────────────────────────────────────────────────────────── editar

  async update(cmd: UpdateGoalCommand): Promise<SavingsGoal> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    const cal = await this.assembler.calendar(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const goal = await lockGoal(deps, workspaceId, cmd.goalId);
      assertVersion(goal, cmd.expectedVersion);
      goal.assertAcceptsMovements();
      const before = goal.snapshot;
      const changes: GoalEdit = {
        name: cmd.name,
        type: cmd.type,
        target: cmd.target,
        targetDate: cmd.targetDate,
        linkedAccountIds: cmd.linkedAccountIds,
        priority: cmd.priority,
        icon: cmd.icon,
        color: cmd.color,
        notes: cmd.notes,
        tolerancePercent: cmd.tolerancePercent,
        pacePeriods: cmd.pacePeriods,
      };
      if (cmd.name !== undefined) {
        const name = cmd.name.trim();
        if (name && (await deps.goals.nameTaken(workspaceId, name, goal.id))) {
          throw new DomainError('NAME_TAKEN', 'a goal with that name already exists').at('/name');
        }
      }
      const plan = await deps.plans.get(workspaceId, goal.id);
      const hasMovements = await deps.movements.hasAny(workspaceId, goal.id);
      const newCurrency = cmd.target?.currency ?? before.currency;
      if (cmd.target !== undefined && newCurrency !== before.currency && plan) {
        throw new DomainError(
          'GOAL_CURRENCY_LOCKED',
          'remove the plan before changing the target currency',
        ).at('/target/currency');
      }
      if (cmd.target !== undefined && newCurrency !== before.currency) {
        if (!(await deps.currencies.isEnabled(workspaceId, newCurrency))) {
          throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${newCurrency} is not enabled`).at(
            '/target/currency',
          );
        }
      }
      const scale = await deps.currencies.scaleOf(newCurrency);
      if (scale === null) {
        throw new DomainError('CURRENCY_NOT_ENABLED', `unknown currency ${newCurrency}`).at(
          '/target/currency',
        );
      }
      if (cmd.linkedAccountIds !== undefined) {
        const next = new Set(cmd.linkedAccountIds);
        const added = [...next].filter((id) => !before.linkedAccountIds.includes(id));
        const removed = before.linkedAccountIds.filter((id) => !next.has(id));
        if (added.length > 0) await assertLinkable(deps, workspaceId, added);
        if (removed.length > 0) {
          const funds = await deps.movements.funds(workspaceId, { goalIds: [goal.id] });
          for (const accountId of removed) {
            const real = funds
              .filter((f) => f.accountId === accountId && f.fund === 'REAL')
              .reduce((acc, f) => acc.plus(dec(f.amount)), dec('0'));
            if (!real.isZero()) {
              throw new DomainError(
                'GOAL_ACCOUNT_HAS_FUNDS',
                'the goal still holds real funds in that account',
              ).at('/linkedAccountIds');
            }
            if (plan?.destinationAccountId === accountId && plan.automation === 'RECURRING') {
              throw new DomainError(
                'VALIDATION_FAILED',
                'the account backs the recurring contribution; remove the plan first',
              ).at('/linkedAccountIds');
            }
          }
        }
      }
      goal.update(changes, { hasMovements, currencyScale: scale, at, by: userId });
      if (goal.changedFields.length === 0) return goal;
      const targetChanged =
        goal.changedFields.includes('targetAmount') || goal.changedFields.includes('currency');
      await deps.lifecycle.record(
        goalEntry(goal, 'updated', goalChanges(before, goal.snapshot)),
        goalSteps(goal, []),
      );
      if (targetChanged) {
        const progress = await this.recorder.currentProgress(goal);
        await this.recorder.applyState(goal, progress, {
          reach: true,
          reopen: true,
          trigger: 'TARGET_CHANGE',
          today: cal.today,
          userId,
        });
      }
      await this.recorder.persist(goal);
      return goal;
    });
  }

  // ───────────────────────────────────────────────────────────── pausar / reanudar

  async pause(cmd: GoalActionCommand): Promise<SavingsGoal> {
    return this.toggle(cmd, 'pause');
  }

  async resume(cmd: GoalActionCommand): Promise<SavingsGoal> {
    return this.toggle(cmd, 'resume');
  }

  private async toggle(cmd: GoalActionCommand, kind: 'pause' | 'resume'): Promise<SavingsGoal> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    return deps.uow.run(workspaceId, async () => {
      const goal = await lockGoal(deps, workspaceId, cmd.goalId);
      assertVersion(goal, cmd.expectedVersion);
      const before = goal.snapshot;
      if (kind === 'pause') goal.pause(at, userId);
      else goal.resume(at, userId);
      const plan = await deps.plans.get(workspaceId, goal.id);
      if (plan?.automation === 'RECURRING' && plan.definitionId) {
        const port = { workspaceId, userId, definitionId: plan.definitionId };
        if (kind === 'pause') await deps.recurring.pauseManaged(port);
        else await deps.recurring.resumeManaged(port);
      }
      await deps.lifecycle.record(
        goalEntry(goal, kind === 'pause' ? 'paused' : 'resumed', goalChanges(before, goal.snapshot)),
        goalSteps(goal, []),
      );
      await this.recorder.persist(goal);
      return goal;
    });
  }

  // ───────────────────────────────────────────────────────────── cerrar / cancelar

  async close(cmd: GoalActionCommand): Promise<SavingsGoal> {
    return this.finish(cmd, 'CLOSE', null);
  }

  async cancel(
    cmd: GoalActionCommand & { readonly reason?: string | null | undefined },
  ): Promise<SavingsGoal> {
    return this.finish(cmd, 'CANCEL', cmd.reason ?? null);
  }

  /**
   * `CLOSE` y `CANCEL` (decisión 15): liberan las reservas vigentes con movimientos `EARMARK/WITHDRAWAL` (origen
   * `SYSTEM`, nota `CLOSE`/`CANCEL`), terminan el aporte programado y reevalúan la sobre-asignación de las cuentas.
   */
  private async finish(
    cmd: GoalActionCommand,
    transition: 'CLOSE' | 'CANCEL',
    reason: string | null,
  ): Promise<SavingsGoal> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    const cal = await this.assembler.calendar(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const goal = await lockGoal(deps, workspaceId, cmd.goalId);
      assertVersion(goal, cmd.expectedVersion);
      const target: GoalStatus = transition === 'CLOSE' ? 'CLOSED' : 'CANCELLED';
      // Valida la transición ANTES de liberar nada.
      GOAL_LIFECYCLE.transition(transition, goal.status, target);
      const before = goal.snapshot;
      const funds = await deps.movements.funds(workspaceId, { goalIds: [goal.id] });
      const releases: MovementRow[] = [];
      const touched = new Set<string>(funds.map((f) => f.accountId));
      for (const row of funds.filter((f) => f.fund === 'EARMARK')) {
        const held = dec(row.amount);
        if (!held.gt(0)) continue;
        const currency = await this.assembler.currencyOf(row.currency);
        const m = withdrawal({
          id: deps.ids.next(),
          goalId: goal.id,
          fund: 'EARMARK' as GoalFund,
          amount: Money.roundToScale(held, currency),
          accountId: row.accountId,
          occurredOn: cal.today.toString(),
          origin: 'SYSTEM',
          note: transition,
        });
        releases.push({ ...m, recordedAt: at, recordedBy: userId });
      }
      if (releases.length > 0) {
        await this.recorder.record({ goal, movements: releases, userId, today: cal.today, evaluate: false });
      }
      const plan = await deps.plans.get(workspaceId, goal.id);
      if (plan?.automation === 'RECURRING' && plan.definitionId) {
        await deps.recurring.end({
          workspaceId,
          userId,
          definitionId: plan.definitionId,
          from: cal.today.toString(),
        });
        await deps.plans.upsert(workspaceId, withoutAutomation(plan));
      }
      if (transition === 'CLOSE') goal.close(cal.today.toString(), at, userId);
      else goal.cancel(cal.today.toString(), reason, at, userId);
      await deps.lifecycle.record(
        goalEntry(
          goal,
          transition === 'CLOSE' ? 'closed' : 'cancelled',
          goalChanges(before, goal.snapshot),
          reason,
        ),
        goalSteps(goal, [], { reason }),
      );
      await this.recorder.persist(goal);
      await this.watch.evaluateAccounts(workspaceId, [...touched]);
      return goal;
    });
  }

  // ───────────────────────────────────────────────────────────── archivar

  async archive(cmd: GoalActionCommand): Promise<SavingsGoal> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    return deps.uow.run(workspaceId, async () => {
      const goal = await lockGoal(deps, workspaceId, cmd.goalId);
      assertVersion(goal, cmd.expectedVersion);
      const before = goal.snapshot;
      goal.archive(at, userId);
      await deps.lifecycle.record(
        goalEntry(goal, 'archived', goalChanges(before, goal.snapshot)),
        goalSteps(goal, [], { changedFields: ['archivedAt'] }),
      );
      await this.recorder.persist(goal);
      return goal;
    });
  }
}
