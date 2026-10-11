import type { LifecyclePort } from '@pf/audit/contracts';
import { DomainError, Money, dec, type Decimal, type LocalDate } from '@pf/shared-kernel';
import type { TransactionLinkDto } from '@pf/transactions/contracts';
import {
  assertEarmarkWithinBalance,
  contribution,
  reassignment,
  withdrawal,
  type GoalFund,
  type MovementOrigin,
  type SavingsGoal,
} from '../domain/index.js';
import { GoalAssembler } from './goal-assembler.js';
import { MovementRecorder } from './movement-recorder.js';
import type { GoalsDeps, MovementRow, SuggestionRecord } from './ports/index.js';
import { reservedOf, ReservationWatch } from './reservation-watch.js';
import { PROCESS_USER } from './recorder.js';
import { lockGoal, parseDate, parseMoney } from './support.js';

type MoneyInput = { readonly amount: string; readonly currency: string };

export interface ContributeCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly fund: GoalFund;
  readonly amount: MoneyInput;
  readonly businessDate?: string | undefined;
  readonly sourceAccountId: string;
  readonly destinationAccountId?: string | undefined;
  readonly note?: string | null | undefined;
}

export interface LinkCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly transactionId: string;
}

export type WithdrawMode =
  | { readonly type: 'TRANSFER'; readonly toAccountId: string; readonly businessDate?: string | undefined }
  | { readonly type: 'LINK'; readonly transactionId: string }
  | { readonly type: 'RELEASE' };

export interface WithdrawCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly fund: GoalFund;
  readonly accountId: string;
  readonly amount: MoneyInput;
  readonly mode: WithdrawMode;
  readonly reason?: string | null | undefined;
}

export interface ReassignCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly targetGoalId: string;
  readonly fund: GoalFund;
  readonly accountId: string;
  readonly amount: MoneyInput;
  readonly reason?: string | null | undefined;
}

const ELIGIBLE_STATUSES = ['POSTED', 'CLEARED', 'RECONCILED'] as const;

const asRow = (m: ReturnType<typeof contribution>, at: string, by: string): MovementRow => ({
  ...m,
  recordedAt: at,
  recordedBy: by,
});

/**
 * Movimientos de la meta (openspec add-savings-goals, decisiones 3, 4, 7, 9 y 10): aporte real (transferencia en la
 * misma unidad de trabajo), reserva con su límite, vínculo de una transferencia existente, retiros (transferencia
 * nueva, vínculo parcial o liberación) y reasignaciones entre metas. El saldo acumulado es siempre Σ movimientos.
 */
export class MovementsService {
  private readonly assembler: GoalAssembler;
  private readonly recorder: MovementRecorder;
  private readonly watch: ReservationWatch;

  /** Auditoría + recorrido en la misma unidad de trabajo del comando (INV-029). */
  private readonly audit: LifecyclePort;

  constructor(private readonly deps: GoalsDeps) {
    this.audit = deps.lifecycle;
    this.assembler = new GoalAssembler(deps);
    this.recorder = new MovementRecorder(deps, this.assembler);
    this.watch = new ReservationWatch(deps);
  }

  private async today(workspaceId: string): Promise<LocalDate> {
    return (await this.assembler.calendar(workspaceId)).today;
  }

  /** Fondos de la meta en `(cuenta, fondo)` (Σ de sus movimientos). */
  private async held(
    workspaceId: string,
    goalId: string,
    accountId: string,
    fund: GoalFund,
  ): Promise<Decimal> {
    const rows = await this.deps.movements.funds(workspaceId, { goalIds: [goalId], accountIds: [accountId] });
    return rows.filter((r) => r.fund === fund).reduce((acc, r) => acc.plus(dec(r.amount)), dec('0'));
  }

  private assertHeld(held: Decimal, fund: GoalFund, amount: Money): void {
    if (amount.amount.lte(held)) return;
    throw new DomainError('GOAL_INSUFFICIENT_FUNDS', 'the goal does not hold enough funds in that account', {
      details: {
        fund,
        held: Money.roundToScale(held.isNegative() ? dec('0') : held, amount.currency).toJSON(),
        requested: amount.toJSON(),
      },
    }).at('/amount');
  }

  // ───────────────────────────────────────────────────────────── aportar / reservar

  async contribute(cmd: ContributeCommand): Promise<MovementRow> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    const today = await this.today(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const goal = await lockGoal(deps, workspaceId, cmd.goalId);
      goal.assertAcceptsMovements();
      const amount = await parseMoney(deps, cmd.amount, '/amount', { positive: true });
      const occurredOn = cmd.businessDate ? parseDate(cmd.businessDate, '/businessDate') : today;
      let row: MovementRow;
      const accountsToWatch: string[] = [];
      if (cmd.fund === 'REAL') {
        const destination = cmd.destinationAccountId;
        if (!destination) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'destinationAccountId is required for a real contribution',
          ).at('/destinationAccountId');
        }
        if (!goal.isLinked(destination)) {
          throw new DomainError(
            'GOAL_ACCOUNT_NOT_LINKED',
            'the destination account is not linked to the goal',
          ).at('/destinationAccountId');
        }
        const movementId = deps.ids.next();
        const transfer = await deps.transfers.recordTransfer({
          workspaceId,
          userId,
          businessDate: occurredOn.toString(),
          fromAccountId: cmd.sourceAccountId,
          toAccountId: destination,
          amount: { amount: amount.toFixed(), currency: amount.currency.code },
          description: `Aporte a ${goal.snapshot.name}`,
          goalRef: { goalId: goal.id, movementId },
        });
        row = asRow(
          contribution({
            id: movementId,
            goalId: goal.id,
            fund: 'REAL',
            amount,
            accountId: destination,
            occurredOn: occurredOn.toString(),
            origin: 'USER',
            note: cmd.note,
            transactionId: transfer.transactionId,
            transactionRevision: transfer.revision,
          }),
          at,
          userId,
        );
        accountsToWatch.push(cmd.sourceAccountId, destination);
      } else {
        const [account] = await deps.accounts.find(workspaceId, [cmd.sourceAccountId]);
        if (!account) {
          throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/sourceAccountId');
        }
        if (account.nature !== 'ASSET') {
          throw new DomainError('GOAL_ACCOUNT_NOT_ELIGIBLE', 'a liability account cannot be earmarked').at(
            '/sourceAccountId',
          );
        }
        if (account.status === 'ARCHIVED') {
          throw new DomainError('ACCOUNT_ARCHIVED', 'the account is archived').at('/sourceAccountId');
        }
        if (account.status === 'CLOSED') {
          throw new DomainError('ACCOUNT_CLOSED', 'the account is closed').at('/sourceAccountId');
        }
        if (account.currency !== amount.currency.code) {
          throw new DomainError('CURRENCY_MISMATCH', `the account holds ${account.currency}`).at(
            '/amount/currency',
          );
        }
        // Serializa reservas concurrentes sobre la misma cuenta (decisión 4) antes de leer saldo y reservado.
        await deps.reservations.lock(workspaceId, account.accountId);
        const funds = await deps.movements.funds(workspaceId, { accountIds: [account.accountId] });
        const { reserved } = reservedOf(funds);
        const balances = await deps.balances.presentedBalances(workspaceId, [account.accountId]);
        assertEarmarkWithinBalance({
          balance: dec(balances.get(account.accountId) ?? '0'),
          reserved,
          amount: amount.amount,
          currency: amount.currency,
        });
        row = asRow(
          contribution({
            id: deps.ids.next(),
            goalId: goal.id,
            fund: 'EARMARK',
            amount,
            accountId: account.accountId,
            occurredOn: occurredOn.toString(),
            origin: 'USER',
            note: cmd.note,
          }),
          at,
          userId,
        );
      }
      const outcome = await this.recorder.record({ goal, movements: [row], userId, today, evaluate: true });
      if (!outcome.inserted) {
        throw new DomainError('GOAL_TRANSACTION_ALREADY_LINKED', 'the transaction already backs a movement');
      }
      await this.recorder.persist(goal);
      await this.watch.evaluateAccounts(workspaceId, accountsToWatch);
      return row;
    });
  }

  // ───────────────────────────────────────────────────────────── vincular una transferencia

  async link(
    cmd: LinkCommand & { readonly origin?: MovementOrigin; readonly expectedRevision?: number },
  ): Promise<MovementRow> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const today = await this.today(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const goal = await lockGoal(deps, workspaceId, cmd.goalId);
      return this.linkLocked(goal, cmd, userId, today);
    });
  }

  /** Vincula con la meta ya bloqueada (lo reutilizan la confirmación de sugerencias y el aporte recurrente). */
  async linkLocked(
    goal: SavingsGoal,
    cmd: {
      readonly transactionId: string;
      readonly origin?: MovementOrigin;
      readonly expectedRevision?: number;
    },
    userId: string,
    today: LocalDate,
  ): Promise<MovementRow> {
    const { deps } = this;
    const workspaceId = goal.workspaceId;
    goal.assertAcceptsMovements();
    const link = await deps.links.getForLink({ workspaceId, transactionId: cmd.transactionId });
    if (!link) {
      throw new DomainError('REFERENCE_NOT_FOUND', 'transaction not found').at('/transactionId');
    }
    if (cmd.expectedRevision !== undefined && link.revision !== cmd.expectedRevision) {
      throw new DomainError(
        'GOAL_SUGGESTION_NOT_PENDING',
        'the transaction was revised after the suggestion',
      );
    }
    const reasons: string[] = [];
    if (link.kind !== 'TRANSFER') reasons.push('KIND');
    if (!(ELIGIBLE_STATUSES as readonly string[]).includes(link.status)) reasons.push('STATUS');
    if (link.kind === 'TRANSFER' && (link.toAccountId === null || !goal.isLinked(link.toAccountId))) {
      reasons.push('ACCOUNT');
    }
    if (reasons.length > 0) {
      throw new DomainError(
        'GOAL_TRANSACTION_NOT_ELIGIBLE',
        'the transaction cannot be registered as a contribution',
        { details: { reasons } },
      ).at('/transactionId');
    }
    const live = await deps.movements.liveByTransaction(workspaceId, link.transactionId);
    if (live.some((m) => m.kind === 'CONTRIBUTION' && m.transactionRevision === link.revision)) {
      throw new DomainError(
        'GOAL_TRANSACTION_ALREADY_LINKED',
        'the transfer already backs a contribution of a goal',
      ).at('/transactionId');
    }
    const amount = await parseMoney(deps, link.amount, '/transactionId', { positive: true });
    const at = deps.clock.now().toString();
    const row = asRow(
      contribution({
        id: deps.ids.next(),
        goalId: goal.id,
        fund: 'REAL',
        amount,
        accountId: link.toAccountId as string,
        occurredOn: link.businessDate,
        origin: cmd.origin ?? 'USER',
        transactionId: link.transactionId,
        transactionRevision: link.revision,
      }),
      at,
      userId,
    );
    const outcome = await this.recorder.record({ goal, movements: [row], userId, today, evaluate: true });
    if (!outcome.inserted) {
      throw new DomainError(
        'GOAL_TRANSACTION_ALREADY_LINKED',
        'the transfer already backs a contribution of a goal',
      ).at('/transactionId');
    }
    await this.recorder.persist(goal);
    return row;
  }

  // ───────────────────────────────────────────────────────────── retirar

  async withdraw(cmd: WithdrawCommand): Promise<MovementRow> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    const today = await this.today(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const goal = await lockGoal(deps, workspaceId, cmd.goalId);
      goal.assertAcceptsMovements();
      const amount = await parseMoney(deps, cmd.amount, '/amount', { positive: true });
      const mode = cmd.mode;
      if (!mode || typeof mode !== 'object') {
        throw new DomainError('VALIDATION_FAILED', 'mode is required').at('/mode');
      }
      if (mode.type === 'RELEASE' && cmd.fund !== 'EARMARK') {
        throw new DomainError('VALIDATION_FAILED', 'only a reservation can be released').at('/mode');
      }
      if (mode.type !== 'RELEASE' && cmd.fund !== 'REAL') {
        throw new DomainError(
          'VALIDATION_FAILED',
          'a real withdrawal needs a transfer or a linked transaction',
        ).at('/fund');
      }
      if (cmd.fund === 'REAL' && !goal.isLinked(cmd.accountId)) {
        throw new DomainError('GOAL_ACCOUNT_NOT_LINKED', 'the account is not linked to the goal').at(
          '/accountId',
        );
      }
      this.assertHeld(await this.held(workspaceId, goal.id, cmd.accountId, cmd.fund), cmd.fund, amount);
      const watch = [cmd.accountId];
      let transactionId: string | null = null;
      let revision: number | null = null;
      let occurredOn = today.toString();
      const movementId = deps.ids.next();
      if (mode.type === 'TRANSFER') {
        const date = mode.businessDate ? parseDate(mode.businessDate, '/mode/businessDate') : today;
        const transfer = await deps.transfers.recordTransfer({
          workspaceId,
          userId,
          businessDate: date.toString(),
          fromAccountId: cmd.accountId,
          toAccountId: mode.toAccountId,
          amount: { amount: amount.toFixed(), currency: amount.currency.code },
          description: `Retiro de ${goal.snapshot.name}`,
          goalRef: { goalId: goal.id, movementId },
        });
        transactionId = transfer.transactionId;
        revision = transfer.revision;
        occurredOn = date.toString();
        watch.push(mode.toAccountId);
      } else if (mode.type === 'LINK') {
        const link = await this.eligibleWithdrawal(goal, mode.transactionId, cmd.accountId, amount);
        transactionId = link.transactionId;
        revision = link.revision;
        occurredOn = link.businessDate;
      }
      const row = asRow(
        withdrawal({
          id: movementId,
          goalId: goal.id,
          fund: cmd.fund,
          amount,
          accountId: cmd.accountId,
          occurredOn,
          origin: 'USER',
          note: cmd.reason,
          ...(cmd.fund === 'REAL' ? { transactionId, transactionRevision: revision } : {}),
        }),
        at,
        userId,
      );
      const outcome = await this.recorder.record({ goal, movements: [row], userId, today, evaluate: true });
      if (!outcome.inserted) {
        throw new DomainError(
          'GOAL_TRANSACTION_ALREADY_LINKED',
          'the transaction already backs a withdrawal',
        );
      }
      await this.recorder.persist(goal);
      await this.watch.evaluateAccounts(workspaceId, watch);
      return row;
    });
  }

  /** Gasto o transferencia posteada que SALE de la cuenta, con monto ≤ al de la transacción (pregunta 11). */
  private async eligibleWithdrawal(
    goal: SavingsGoal,
    transactionId: string,
    accountId: string,
    amount: Money,
  ): Promise<TransactionLinkDto> {
    const { deps } = this;
    const link = await deps.links.getForLink({ workspaceId: goal.workspaceId, transactionId });
    if (!link)
      throw new DomainError('REFERENCE_NOT_FOUND', 'transaction not found').at('/mode/transactionId');
    const reasons: string[] = [];
    if (link.kind !== 'TRANSFER' && link.kind !== 'EXPENSE') reasons.push('KIND');
    if (!(ELIGIBLE_STATUSES as readonly string[]).includes(link.status)) reasons.push('STATUS');
    if (link.accountId !== accountId) reasons.push('ACCOUNT');
    if (link.amount.currency !== amount.currency.code) reasons.push('AMOUNT');
    else {
      const total = dec(link.amount.amount);
      const already = dec(await deps.movements.withdrawnFromTransaction(goal.workspaceId, transactionId));
      if (amount.amount.plus(already).gt(total)) reasons.push('AMOUNT');
    }
    if (reasons.length > 0) {
      throw new DomainError('GOAL_TRANSACTION_NOT_ELIGIBLE', 'the transaction cannot back that withdrawal', {
        details: { reasons },
      }).at('/mode/transactionId');
    }
    return link;
  }

  // ───────────────────────────────────────────────────────────── reasignar

  async reassign(cmd: ReassignCommand): Promise<{
    readonly reassignmentId: string;
    readonly source: MovementRow;
    readonly target: MovementRow;
  }> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    const today = await this.today(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      if (cmd.goalId === cmd.targetGoalId) {
        throw new DomainError('VALIDATION_FAILED', 'the target goal must differ from the source goal').at(
          '/targetGoalId',
        );
      }
      const locked = await deps.goals.lockMany(workspaceId, [cmd.goalId, cmd.targetGoalId]);
      const source = locked.find((g) => g.id === cmd.goalId);
      const target = locked.find((g) => g.id === cmd.targetGoalId);
      if (!source) throw new DomainError('RESOURCE_NOT_FOUND', `goal ${cmd.goalId} not found`);
      if (!target) throw new DomainError('REFERENCE_NOT_FOUND', 'target goal not found').at('/targetGoalId');
      source.assertAcceptsMovements();
      target.assertAcceptsMovements();
      const amount = await parseMoney(deps, cmd.amount, '/amount', { positive: true });
      this.assertHeld(await this.held(workspaceId, source.id, cmd.accountId, cmd.fund), cmd.fund, amount);
      if (cmd.fund === 'REAL' && !target.isLinked(cmd.accountId)) {
        throw new DomainError('GOAL_ACCOUNT_NOT_LINKED', 'the account is not linked to the target goal').at(
          '/accountId',
        );
      }
      const pair = reassignment({
        reassignmentId: deps.ids.next(),
        outId: deps.ids.next(),
        inId: deps.ids.next(),
        fromGoalId: source.id,
        toGoalId: target.id,
        fund: cmd.fund,
        accountId: cmd.accountId,
        amount,
        occurredOn: today.toString(),
        note: cmd.reason,
      });
      const out: MovementRow = { ...pair.out, recordedAt: at, recordedBy: userId };
      const incoming: MovementRow = { ...pair.in, recordedAt: at, recordedBy: userId };
      await this.recorder.record({ goal: source, movements: [out], userId, today, evaluate: true });
      await this.recorder.record({ goal: target, movements: [incoming], userId, today, evaluate: true });
      await this.recorder.persist(source);
      await this.recorder.persist(target);
      return { reassignmentId: out.reassignmentId as string, source: out, target: incoming };
    });
  }

  // ───────────────────────────────────────────────────────────── sugerencias

  async confirmSuggestion(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly suggestionId: string;
    readonly goalId?: string | undefined;
  }): Promise<MovementRow> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    const today = await this.today(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const suggestion = await deps.suggestions.find(workspaceId, cmd.suggestionId, { lock: 'update' });
      if (!suggestion)
        throw new DomainError('RESOURCE_NOT_FOUND', `suggestion ${cmd.suggestionId} not found`);
      if (suggestion.status !== 'PENDING') {
        throw new DomainError('GOAL_SUGGESTION_NOT_PENDING', 'the suggestion was already decided or expired');
      }
      const goalId = cmd.goalId ?? suggestion.goalId;
      if (!goalId) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'goalId is required: the account is linked to several goals',
        ).at('/goalId');
      }
      const goal = await lockGoal(deps, workspaceId, goalId);
      const row = await this.linkLocked(
        goal,
        {
          transactionId: suggestion.transactionId,
          origin: 'SUGGESTION',
          expectedRevision: suggestion.transactionRevision,
        },
        userId,
        today,
      );
      await deps.suggestions.decide(workspaceId, suggestion.id, {
        status: 'CONFIRMED',
        at,
        by: userId,
        movementId: row.id,
      });
      await deps.audit.append({
        workspaceId,
        action: 'goals.suggestion.confirmed',
        aggregateType: 'ContributionSuggestion',
        aggregateId: suggestion.id,
        changes: [
          { field: 'status', before: 'PENDING', after: 'CONFIRMED' },
          { field: 'goalId', before: suggestion.goalId, after: goalId },
          { field: 'transactionId', before: null, after: suggestion.transactionId },
        ],
      });
      return row;
    });
  }

  async dismissSuggestion(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly suggestionId: string;
  }): Promise<SuggestionRecord> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const at = deps.clock.now().toString();
    return deps.uow.run(workspaceId, async () => {
      const suggestion = await deps.suggestions.find(workspaceId, cmd.suggestionId, { lock: 'update' });
      if (!suggestion)
        throw new DomainError('RESOURCE_NOT_FOUND', `suggestion ${cmd.suggestionId} not found`);
      if (suggestion.status !== 'PENDING') {
        throw new DomainError('GOAL_SUGGESTION_NOT_PENDING', 'the suggestion was already decided or expired');
      }
      await deps.suggestions.decide(workspaceId, suggestion.id, {
        status: 'DISMISSED',
        at,
        by: userId,
        movementId: null,
      });
      await deps.audit.append({
        workspaceId,
        action: 'goals.suggestion.dismissed',
        aggregateType: 'ContributionSuggestion',
        aggregateId: suggestion.id,
        changes: [
          { field: 'status', before: 'PENDING', after: 'DISMISSED' },
          { field: 'transactionId', before: null, after: suggestion.transactionId },
        ],
      });
      return { ...suggestion, status: 'DISMISSED', decidedAt: at, decidedBy: userId };
    });
  }
}

export { PROCESS_USER };
