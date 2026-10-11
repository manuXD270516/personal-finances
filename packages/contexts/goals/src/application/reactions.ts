import { DomainError, dec } from '@pf/shared-kernel';
import type { TransactionLinkDto } from '@pf/transactions/contracts';
import { contribution, reversalOf, type SavingsGoal } from '../domain/index.js';
import { GoalAssembler } from './goal-assembler.js';
import { MovementRecorder } from './movement-recorder.js';
import { MovementsService } from './movements.service.js';
import type { GoalsDeps, MovementRow } from './ports/index.js';
import { PROCESS_USER } from './recorder.js';
import { ReservationWatch } from './reservation-watch.js';
import { parseMoney } from './support.js';

export interface DomainEventInput {
  readonly workspaceId: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly payload: unknown;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const money = (v: unknown): { amount: string; currency: string } | null => {
  const o = obj(v);
  const amount = text(o?.['amount']);
  const currency = text(o?.['currency']);
  return amount && currency ? { amount, currency } : null;
};

const POSTED = ['POSTED', 'CLEARED', 'RECONCILED'] as const;

/**
 * Consumidores del worker (openspec add-savings-goals, decisiones 6, 8, 18 y 19). Idempotentes por negocio además del
 * inbox (INV-028): un inverso por movimiento (`reverses_id` único), una sugerencia por `(transacción, revisión)` y un
 * aporte recurrente por `(transacción, revisión)`. Lectura defensiva del payload: lo que no se entiende se ignora.
 */
export class GoalReactions {
  private readonly assembler: GoalAssembler;
  private readonly recorder: MovementRecorder;
  private readonly watch: ReservationWatch;
  private readonly movements: MovementsService;

  constructor(private readonly deps: GoalsDeps) {
    this.assembler = new GoalAssembler(deps);
    this.recorder = new MovementRecorder(deps, this.assembler);
    this.watch = new ReservationWatch(deps);
    this.movements = new MovementsService(deps);
  }

  // ───────────────────────────────────────────────────────────── goals.balance-watch

  /** `ledger.JournalEntryPosted.v1`: reevalúa la sobre-asignación de las cuentas del asiento. */
  async onJournalEntryPosted(event: DomainEventInput): Promise<void> {
    const postings = obj(event.payload)?.['postings'];
    if (!Array.isArray(postings)) return;
    const accountIds = [
      ...new Set(postings.map((p) => text(obj(p)?.['accountId'])).filter((id): id is string => id !== null)),
    ];
    if (accountIds.length === 0) return;
    await this.deps.uow.run(event.workspaceId, () =>
      this.watch.evaluateAccounts(event.workspaceId, accountIds),
    );
  }

  // ───────────────────────────────────────────────────────────── goals.transaction-changes

  /** `TransactionVoided`, `TransferRevised` y `TransactionUpdated`: movimientos inversos (decisión 8). */
  async onTransactionChange(event: DomainEventInput): Promise<void> {
    const payload = obj(event.payload);
    const transactionId = text(payload?.['transactionId']);
    if (!payload || !transactionId) return;
    const { deps } = this;
    const ws = event.workspaceId;
    await deps.uow.run(ws, async () => {
      const live = await deps.movements.liveByTransaction(ws, transactionId);
      if (event.eventType === 'transactions.TransactionVoided') {
        await deps.suggestions.expireForTransaction(ws, transactionId);
        await this.reverse(ws, live, () => true, null);
        await this.releaseMaterialization(ws, transactionId);
        return;
      }
      if (event.eventType === 'transactions.TransferRevised') {
        const revisionTo = Number(payload['revisionTo']);
        if (!Number.isInteger(revisionTo)) return;
        const toAccountId = text(payload['toAccountId']);
        const fromAccountId = text(payload['fromAccountId']);
        const amount = money(payload['amount']);
        const businessDate = text(payload['businessDate']);
        if (!toAccountId || !fromAccountId || !amount || !businessDate) return;
        await deps.suggestions.expireForTransaction(ws, transactionId);
        const pending = live.filter(
          (m) => m.kind === 'WITHDRAWAL' || (m.transactionRevision ?? 0) < revisionTo,
        );
        await this.reverse(
          ws,
          pending,
          (m) =>
            m.kind === 'CONTRIBUTION' ||
            fromAccountId !== m.accountId ||
            dec(amount.amount).lt(m.amount.abs().toDecimal()),
          { toAccountId, amount, businessDate, revision: revisionTo },
        );
        await this.suggestRevised(ws, transactionId, revisionTo);
        return;
      }
      if (event.eventType === 'transactions.TransactionUpdated') {
        const changed = Array.isArray(payload['changedFields'])
          ? (payload['changedFields'] as unknown[])
          : [];
        if (!changed.some((f) => f === 'amount' || f === 'accountId' || f === 'businessDate')) return;
        const withdrawals = live.filter((m) => m.kind === 'WITHDRAWAL');
        if (withdrawals.length === 0) return;
        const link = await deps.links.getForLink({ workspaceId: ws, transactionId });
        await this.reverse(
          ws,
          withdrawals,
          (m) =>
            !link ||
            !(POSTED as readonly string[]).includes(link.status) ||
            link.accountId !== m.accountId ||
            dec(link.amount.amount).lt(m.amount.abs().toDecimal()),
          null,
        );
      }
    });
  }

  /**
   * Invierte los movimientos para los que `shouldReverse` es verdadero (agrupados por meta, metas bloqueadas en orden
   * de id) y, si hay `replacement` y el destino revisado sigue vinculado, registra el aporte nuevo con la revisión nueva.
   */
  private async reverse(
    ws: string,
    movements: readonly MovementRow[],
    shouldReverse: (m: MovementRow) => boolean,
    replacement: {
      readonly toAccountId: string;
      readonly amount: { amount: string; currency: string };
      readonly businessDate: string;
      readonly revision: number;
    } | null,
  ): Promise<void> {
    const { deps } = this;
    const targets = movements.filter(shouldReverse);
    if (targets.length === 0) return;
    const goalIds = [...new Set(targets.map((m) => m.goalId))].sort();
    const goals = await deps.goals.lockMany(ws, goalIds);
    const cal = await this.assembler.calendar(ws);
    const at = deps.clock.now().toString();
    const accounts = new Set<string>();
    for (const goal of goals) {
      const rows: MovementRow[] = [];
      for (const original of targets.filter((m) => m.goalId === goal.id)) {
        if (await deps.movements.isReversed(ws, original.id)) continue;
        rows.push({
          ...reversalOf(original, {
            id: deps.ids.next(),
            occurredOn: cal.today.toString(),
            origin: 'SYSTEM',
          }),
          recordedAt: at,
          recordedBy: PROCESS_USER,
        });
        accounts.add(original.accountId);
        if (
          replacement &&
          original.kind === 'CONTRIBUTION' &&
          goal.isLinked(replacement.toAccountId) &&
          !goal.isTerminal
        ) {
          const amount = await parseMoney(deps, replacement.amount, '/amount', { positive: true });
          rows.push({
            ...contribution({
              id: deps.ids.next(),
              goalId: goal.id,
              fund: 'REAL',
              amount,
              accountId: replacement.toAccountId,
              occurredOn: replacement.businessDate,
              origin: original.origin,
              transactionId: original.transactionId as string,
              transactionRevision: replacement.revision,
            }),
            recordedAt: at,
            recordedBy: PROCESS_USER,
          });
          accounts.add(replacement.toAccountId);
        }
      }
      if (rows.length === 0) continue;
      await this.recorder.record({
        goal,
        movements: rows,
        userId: PROCESS_USER,
        today: cal.today,
        evaluate: true,
      });
      await this.recorder.persist(goal);
    }
    await this.watch.evaluateAccounts(ws, [...accounts]);
  }

  private async releaseMaterialization(ws: string, transactionId: string): Promise<void> {
    const found = await this.deps.materializations.find(ws, transactionId);
    if (found && found.status !== 'RELEASED') {
      await this.deps.materializations.setStatus(
        ws,
        transactionId,
        'RELEASED',
        this.deps.clock.now().toString(),
      );
    }
  }

  // ───────────────────────────────────────────────────────────── goals.recurring-contributions

  /** `commitments.RecurringOccurrenceMaterialized.v1` con `managedBy = GOAL` ⇒ aporte real recurrente (decisión 18). */
  async onOccurrenceMaterialized(event: DomainEventInput): Promise<void> {
    const payload = obj(event.payload);
    if (!payload || payload['managedBy'] !== 'GOAL') return;
    const definitionId = text(payload['definitionId']);
    const transactionId = text(payload['transactionId']);
    const occurrenceId = text(payload['occurrenceId']);
    if (!definitionId || !transactionId || !occurrenceId) return;
    const { deps } = this;
    const ws = event.workspaceId;
    await deps.uow.run(ws, async () => {
      const plan = await deps.plans.findByDefinition(ws, definitionId);
      if (!plan) return;
      const link = await deps.links.getForLink({ workspaceId: ws, transactionId });
      if (!link) return;
      const at = deps.clock.now().toString();
      const waiting = { transactionId, goalId: plan.goalId, definitionId, occurrenceId };
      if (!(POSTED as readonly string[]).includes(link.status)) {
        if (link.status !== 'VOIDED') {
          await deps.materializations.upsert(ws, { ...waiting, status: 'WAITING' }, at);
        }
        return;
      }
      await this.recordRecurring(ws, plan.goalId, link, waiting);
    });
  }

  /** Registra el aporte recurrente de una transferencia posteada (la meta se bloquea aquí). */
  private async recordRecurring(
    ws: string,
    goalId: string,
    link: TransactionLinkDto,
    waiting: { transactionId: string; goalId: string; definitionId: string; occurrenceId: string },
  ): Promise<void> {
    const { deps } = this;
    const at = deps.clock.now().toString();
    const cal = await this.assembler.calendar(ws);
    const goal = await deps.goals.findById(ws, goalId, { lock: 'update' });
    if (!goal) return;
    try {
      await this.movements.linkLocked(
        goal,
        { transactionId: link.transactionId, origin: 'RECURRING' },
        PROCESS_USER,
        cal.today,
      );
      await deps.materializations.upsert(ws, { ...waiting, status: 'RECORDED' }, at);
    } catch (err) {
      if (!(err instanceof DomainError) || !err.code.startsWith('GOAL_')) throw err;
      // Ya registrado, meta terminal o destino desvinculado: no hay aporte que registrar.
      const already = err.code === 'GOAL_TRANSACTION_ALREADY_LINKED';
      await deps.materializations.upsert(ws, { ...waiting, status: already ? 'RECORDED' : 'RELEASED' }, at);
    }
    await deps.suggestions.expireForTransaction(ws, link.transactionId);
  }

  // ───────────────────────────────────────────────────────────── goals.contribution-suggestions

  /** `transactions.TransferCompleted.v1`: completa aportes recurrentes en espera o propone un aporte (decisión 19). */
  async onTransferCompleted(event: DomainEventInput): Promise<void> {
    const payload = obj(event.payload);
    const transactionId = text(payload?.['transactionId']);
    if (!payload || !transactionId) return;
    const { deps } = this;
    const ws = event.workspaceId;
    await deps.uow.run(ws, async () => {
      const materialization = await deps.materializations.find(ws, transactionId);
      if (materialization) {
        if (materialization.status === 'WAITING') {
          const link = await deps.links.getForLink({ workspaceId: ws, transactionId });
          if (link && (POSTED as readonly string[]).includes(link.status)) {
            await this.recordRecurring(ws, materialization.goalId, link, materialization);
          }
        }
        return;
      }
      await this.suggest(ws, transactionId);
    });
  }

  private async suggestRevised(ws: string, transactionId: string, revision: number): Promise<void> {
    const link = await this.deps.links.getForLink({ workspaceId: ws, transactionId });
    if (!link || link.revision !== revision) return;
    if (await this.deps.materializations.find(ws, transactionId)) return;
    await this.suggest(ws, transactionId, link);
  }

  private async suggest(ws: string, transactionId: string, known?: TransactionLinkDto): Promise<void> {
    const { deps } = this;
    const link = known ?? (await deps.links.getForLink({ workspaceId: ws, transactionId }));
    if (!link || link.kind !== 'TRANSFER' || link.toAccountId === null) return;
    if (!(POSTED as readonly string[]).includes(link.status)) return;
    if (link.source === 'GOAL') return;
    const backed = await deps.movements.byTransactions(ws, [transactionId]);
    if (backed.length > 0) return;
    const goals = (await deps.goals.linkedToAccounts(ws, [link.toAccountId])).filter(
      (g) => g.status === 'ACTIVE' || g.status === 'PAUSED',
    );
    if (goals.length === 0) return;
    const goalIds = [...new Set(goals.map((g) => g.goalId))];
    const amount = await parseMoney(deps, link.amount, '/amount', { positive: true });
    await deps.suggestions.insertIfAbsent(ws, {
      id: deps.ids.next(),
      transactionId,
      transactionRevision: link.revision,
      accountId: link.toAccountId,
      amount,
      goalId: goalIds.length === 1 ? (goalIds[0] as string) : null,
      status: 'PENDING',
      businessDate: link.businessDate,
      decidedAt: null,
      decidedBy: null,
      movementId: null,
      createdAt: deps.clock.now().toString(),
    });
  }

  // ───────────────────────────────────────────────────────────── goals.daily-evaluation

  /**
   * Reevaluación diaria de un workspace (decisiones 6 y 15): las metas con fondos en otra moneda pueden alcanzarse
   * por el tipo de cambio (`REACH`, `trigger = RATE_CHANGE`) pero NUNCA se reabren por él; el barrido de
   * sobre-asignación cubre eventos perdidos y asientos de reversa.
   */
  async runDaily(workspaceId: string): Promise<{ reached: number; accounts: number }> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const cal = await this.assembler.calendar(workspaceId);
      const candidates = await deps.goals.withForeignFunds(workspaceId);
      let reached = 0;
      for (const goalId of candidates) {
        const goal: SavingsGoal | null = await deps.goals.findById(workspaceId, goalId, { lock: 'update' });
        if (!goal || (goal.status !== 'ACTIVE' && goal.status !== 'PAUSED')) continue;
        const progress = await this.recorder.currentProgress(goal);
        const outcome = await this.recorder.applyState(goal, progress, {
          reach: true,
          reopen: false,
          trigger: 'RATE_CHANGE',
          today: cal.today,
          userId: PROCESS_USER,
        });
        if (outcome.reached) {
          reached += 1;
          await this.recorder.persist(goal);
        }
      }
      const accounts = await deps.movements.accountsWithMovements(workspaceId);
      await this.watch.evaluateAccounts(workspaceId, accounts);
      return { reached, accounts: accounts.length };
    });
  }
}
