import { DomainError, Money, type LocalDate } from '@pf/shared-kernel';
import type {
  GoalReachedV1,
  GoalReachedTriggerDto,
  SavingsContributionRecordedV1,
} from '../contracts/index.js';
import { GOALS_EVENTS } from '../contracts/index.js';
import { calculateProgress, type GoalProgress, type SavingsGoal } from '../domain/index.js';
import { type GoalAssembler } from './goal-assembler.js';
import type { GoalsDeps, MovementRow } from './ports/index.js';
import { RateBook } from './rate-book.js';
import { goalAggregate, goalChanges, goalEntry, goalSteps, publishEvent } from './recorder.js';
import { moneyDto } from './views.js';

export interface RecordedOutcome {
  /** `false` si una clave única de transacción rechazó el movimiento (ya vinculada). */
  readonly inserted: boolean;
  readonly reached: boolean;
  readonly reopened: boolean;
}

/**
 * Registra movimientos de una meta (openspec add-savings-goals, decisiones 2, 15 y 16): inserta cada movimiento,
 * sube la versión de la meta (una versión por hecho), publica `SavingsContributionRecorded.v1` con el progreso antes y
 * después, audita con el actor y evalúa `REACH`/`REOPEN`. NO persiste la meta: el comando la guarda una sola vez al
 * terminar (control optimista). Corre en la unidad de trabajo del comando con la meta bloqueada (`FOR UPDATE`).
 */
export class MovementRecorder {
  constructor(
    private readonly deps: GoalsDeps,
    private readonly assembler: GoalAssembler,
  ) {}

  /** Progreso actual de la meta con las tasas vigentes (para antes/después y evaluación). */
  private async progressOf(goal: SavingsGoal, sums: readonly Money[], book: RateBook): Promise<GoalProgress> {
    const target = await this.targetOf(goal);
    return calculateProgress({ target, sums, rateFor: (code) => book.stock(code, target.currency.code) });
  }

  async targetOf(goal: SavingsGoal): Promise<Money> {
    const s = goal.snapshot;
    return Money.parse(s.targetAmount, await this.assembler.currencyOf(s.currency));
  }

  async sumsOf(goal: SavingsGoal): Promise<Money[]> {
    const rows = await this.deps.movements.sums(goal.workspaceId, [goal.id]);
    const out: Money[] = [];
    for (const r of rows) out.push(Money.parse(r.amount, await this.assembler.currencyOf(r.currency)));
    return out;
  }

  async bookFor(goal: SavingsGoal, currencies: readonly string[]): Promise<RateBook> {
    const cal = await this.assembler.calendar(goal.workspaceId);
    const to = goal.snapshot.currency;
    return RateBook.resolve({
      valuation: this.deps.valuation,
      workspaceId: goal.workspaceId,
      needs: {
        stock: [...new Set(currencies)].filter((c) => c !== to).map((from) => ({ from, to })),
        flows: [],
      },
      timeZone: cal.timeZone,
      now: this.deps.clock.now(),
      windowDays: this.deps.settings.rateValidityWindowDays,
    });
  }

  /**
   * Registra `movements` en orden. `evaluate`: tras el último movimiento, `REACH` si la meta `ACTIVE`/`PAUSED` alcanza
   * el objetivo y `REOPEN` si una meta `ACHIEVED` que lo había alcanzado queda por debajo (nunca por tipo de cambio:
   * el antes y el después se miden con las MISMAS tasas).
   */
  async record(input: {
    readonly goal: SavingsGoal;
    readonly movements: readonly MovementRow[];
    readonly userId: string;
    readonly today: LocalDate;
    readonly evaluate: boolean;
  }): Promise<RecordedOutcome> {
    const { deps } = this;
    const { goal, userId } = input;
    const ws = goal.workspaceId;
    const at = deps.clock.now().toString();
    const sums = await this.sumsOf(goal);
    const currencies = [
      ...sums.map((m) => m.currency.code),
      ...input.movements.map((m) => m.amount.currency.code),
    ];
    const book = await this.bookFor(goal, currencies);
    const target = await this.targetOf(goal);
    const initial = await this.progressOf(goal, sums, book);
    let before = initial;
    const running = [...sums];
    for (const movement of input.movements) {
      const stored = await deps.movements.insert(ws, movement);
      if (!stored) return { inserted: false, reached: false, reopened: false };
      running.push(movement.amount);
      const after = await this.progressOf(goal, running, book);
      goal.touch(['movement'], at, userId);
      const payload: SavingsContributionRecordedV1 = {
        goalId: goal.id,
        goalName: goal.snapshot.name,
        goalStatus: goal.status,
        movementId: movement.id,
        fund: movement.fund,
        movement: movement.kind,
        amount: moneyDto(movement.amount),
        accountId: movement.accountId,
        occurredOn: movement.occurredOn,
        transactionId: movement.transactionId,
        reversesId: movement.reversesId,
        reassignmentId: movement.reassignmentId,
        origin: movement.origin,
        target: moneyDto(target),
        progressBefore: moneyDto(before.total),
        progressAfter: moneyDto(after.total),
        percentBefore: before.percent,
        percentAfter: after.percent,
        progressComplete: before.complete && after.complete,
      };
      await publishEvent(deps, goalAggregate(goal), GOALS_EVENTS.savingsContributionRecorded, payload);
      await deps.audit.append({
        workspaceId: ws,
        action: 'goals.movement.recorded',
        aggregateType: 'SavingsGoal',
        aggregateId: goal.id,
        aggregateVersion: goal.version,
        changes: [
          { field: 'movementKind', before: null, after: movement.kind },
          { field: 'fund', before: null, after: movement.fund },
          { field: 'accountId', before: null, after: movement.accountId },
          { field: 'amount', before: null, after: moneyDto(movement.amount) },
          { field: 'occurredOn', before: null, after: movement.occurredOn },
          { field: 'transactionId', before: null, after: movement.transactionId },
          { field: 'reversesId', before: null, after: movement.reversesId },
          { field: 'reassignmentId', before: null, after: movement.reassignmentId },
          { field: 'origin', before: null, after: movement.origin },
          { field: 'note', before: null, after: movement.note },
        ].filter((c) => c.after !== null),
      });
      before = after;
    }
    if (!input.evaluate) return { inserted: true, reached: false, reopened: false };
    const outcome = await this.applyState(goal, before, {
      reach: true,
      reopen: initial.totalExact.gte(target.toDecimal()),
      trigger: 'MOVEMENT',
      today: input.today,
      userId,
    });
    return { inserted: true, ...outcome };
  }

  /**
   * `REACH` (`ACTIVE`/`PAUSED` con acumulado ≥ objetivo) y `REOPEN` (`ACHIEVED` por debajo) según `progress`. Publica
   * `GoalReached.v1` en cada alcance y registra la transición en el recorrido. Devuelve qué ocurrió.
   */
  async applyState(
    goal: SavingsGoal,
    progress: GoalProgress,
    options: {
      readonly reach: boolean;
      readonly reopen: boolean;
      readonly trigger: GoalReachedTriggerDto;
      readonly today: LocalDate;
      readonly userId: string;
    },
  ): Promise<{ reached: boolean; reopened: boolean }> {
    const { deps } = this;
    const target = await this.targetOf(goal);
    const reachedNow = progress.totalExact.gte(target.toDecimal());
    const at = deps.clock.now().toString();
    if (options.reach && reachedNow && (goal.status === 'ACTIVE' || goal.status === 'PAUSED')) {
      const before = goal.snapshot;
      goal.reach(options.today.toString(), at, options.userId);
      const payload: GoalReachedV1 = {
        goalId: goal.id,
        goalName: goal.snapshot.name,
        target: moneyDto(target),
        progress: moneyDto(progress.total),
        reachedOn: options.today.toString(),
        trigger: options.trigger,
      };
      const event = await publishEvent(deps, goalAggregate(goal), GOALS_EVENTS.goalReached, payload);
      await deps.lifecycle.record(
        goalEntry(goal, 'reached', goalChanges(before, goal.snapshot)),
        goalSteps(goal, [event]),
      );
      return { reached: true, reopened: false };
    }
    if (options.reopen && !reachedNow && goal.status === 'ACHIEVED') {
      const before = goal.snapshot;
      goal.reopen(at, options.userId);
      await deps.lifecycle.record(
        goalEntry(goal, 'reopened', goalChanges(before, goal.snapshot)),
        goalSteps(goal, []),
      );
      return { reached: false, reopened: true };
    }
    return { reached: false, reopened: false };
  }

  /** Guarda la meta con control optimista (`CONCURRENCY_CONFLICT` si otro cambio ganó). */
  async persist(goal: SavingsGoal): Promise<void> {
    if (!(await this.deps.goals.save(goal))) {
      throw new DomainError('CONCURRENCY_CONFLICT', `goal ${goal.id} changed concurrently`);
    }
  }

  /** Progreso actual de la meta (movimientos persistidos) con las tasas vigentes. */
  async currentProgress(goal: SavingsGoal): Promise<GoalProgress> {
    const sums = await this.sumsOf(goal);
    const book = await this.bookFor(
      goal,
      sums.map((m) => m.currency.code),
    );
    return this.progressOf(goal, sums, book);
  }
}
