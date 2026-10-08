import type { AuditChangeInput, LifecycleDto, LifecycleEventRefDto } from '@pf/audit/contracts';
import {
  currency as makeCurrency,
  DomainError,
  jsonPointer,
  Money,
  type FieldViolation,
} from '@pf/shared-kernel';
import { TRANSACTION_EVENTS, type ReconciliationCoverageDto } from '../contracts/index.js';
import {
  Reconciliation,
  ReconciliationCalculator,
  RECONCILIATION_LIFECYCLE,
  Transaction,
  type AccountNature,
  type ReconciliationState,
} from '../domain/index.js';
import {
  legsPayload,
  linkEntry,
  postEntry,
  publishEvent,
  publishPosted,
  transactionSteps,
} from './posting-support.js';
import type { ReconciliationItem, ReconciliationListFilter, TransactionsDeps } from './ports/index.js';
import type { MoneyDto, TransactionsService } from './transactions.service.js';

const MAX_EVENT_TRANSACTION_IDS = 2000;
const MAX_TOGGLE = 500;

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `reconciliation ${id} not found`);
const preconditionFailed = (currentVersion: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    details: { currentVersion },
  });
const concurrencyConflict = () =>
  new DomainError('CONCURRENCY_CONFLICT', 'the reconciliation was modified concurrently');

export interface StartReconciliationCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly accountId: string;
  readonly statementDate: string;
  /** Decimal en la moneda y escala de la cuenta (pasivos: deuda positiva). */
  readonly statementBalance: string;
}

export interface ToggleClearedInSessionCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly reconciliationId: string;
  readonly expectedVersion: number;
  readonly items: readonly { readonly id: string; readonly version: number }[];
  readonly cleared: boolean;
}

export interface CompleteReconciliationCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly reconciliationId: string;
  readonly expectedVersion: number;
  /** Ajuste confirmado explícitamente (motivo obligatorio) para cerrar una diferencia distinta de cero. */
  readonly adjustment?: { readonly reason: string } | null;
}

export interface CancelReconciliationCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly reconciliationId: string;
  readonly expectedVersion: number;
}

export interface ListReconciliationsQuery extends ReconciliationListFilter {
  readonly workspaceId: string;
  readonly offset: number;
  readonly limit: number;
}

/** Sesión con su saldo confirmado y diferencia (en vivo si está en curso, congelados si está completada). */
export interface ReconciliationView {
  readonly reconciliation: ReconciliationState;
  readonly nature: AccountNature;
  readonly currency: string;
  readonly clearedBalance: Money | null;
  readonly difference: Money | null;
  /** Transacciones reconciliadas/cotejadas por la sesión (solo `COMPLETED`). */
  readonly items: readonly ReconciliationItem[] | null;
}

export interface ReconciliationLifecycleView {
  readonly lifecycle: LifecycleDto;
  readonly reconciliation: ReconciliationState;
}

/**
 * Casos de uso de la sesión de reconciliación (openspec add-reconciliation, design decisiones 1–15). Cada comando corre
 * en UNA unidad de trabajo: validación → agregados → persistencia con optimistic locking → outbox → auditoría y
 * recorrido (`LifecyclePort`, INV-029). `CompleteReconciliation` bloquea la sesión y las transacciones incluidas
 * (`FOR UPDATE`) y evalúa su estado vigente en el momento de finalizar; si cualquier paso falla, nada se persiste.
 */
export class ReconciliationsService {
  constructor(
    private readonly deps: TransactionsDeps,
    private readonly transactions: TransactionsService,
  ) {}

  // ------------------------------------------------------------------ comandos

  /** `StartReconciliation` (TC-TRANSACTIONS-RECONCILIATION-001, -002). */
  start(cmd: StartReconciliationCommand): Promise<ReconciliationView> {
    const { workspaceId } = cmd;
    return this.deps.uow.run(workspaceId, async () => {
      const [account] = await this.deps.accounts.assertCanPost({
        workspaceId,
        accounts: [{ accountId: cmd.accountId }],
      });
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/accountId');
      if ((await this.deps.reconciliations.findInProgress(workspaceId, cmd.accountId)) !== null) {
        throw new DomainError(
          'RECONCILIATION_IN_PROGRESS',
          'the account already has a reconciliation in progress',
        ).at('/accountId');
      }
      const last = await this.deps.reconciliations.lastCompleted(workspaceId, cmd.accountId);
      const statementBalance = await this.parseMoney(
        { amount: cmd.statementBalance, currency: account.currency },
        '/statementBalance',
      );
      const r = Reconciliation.start({
        id: this.deps.ids.next(),
        workspaceId,
        accountId: cmd.accountId,
        statementDate: cmd.statementDate,
        statementBalance,
        today: await this.deps.calendar.today(workspaceId),
        lastCompletedStatementDate: last?.snapshot.statementDate ?? null,
        startedBy: cmd.userId,
      });
      await this.deps.reconciliations.insert(r);
      const s = r.snapshot;
      await this.deps.lifecycle.record(
        {
          workspaceId,
          action: 'transactions.reconciliation.started',
          aggregateType: 'Reconciliation',
          aggregateId: s.id,
          aggregateVersion: s.version,
          changes: [
            { field: 'accountId', before: null, after: s.accountId },
            { field: 'statementDate', before: null, after: s.statementDate },
            { field: 'statementBalance', before: null, after: s.statementBalance },
            { field: 'status', before: null, after: s.status },
          ],
        },
        [this.step(r, [])],
      );
      return this.view(r, account.nature);
    });
  }

  /**
   * `ToggleClearedInSession`: es el mismo `CLEAR`/`UNCLEAR` de Phase 1 (todo o nada, versión por ítem) acotado a la
   * cuenta y a la fecha del extracto, con el evento dedicado `TransactionCleared` (que lleva la sesión) y una
   * anotación en el recorrido de la sesión. Sube la versión de la sesión (TC-TRANSACTIONS-RECONCILIATION-005, -013).
   */
  toggleCleared(cmd: ToggleClearedInSessionCommand): Promise<ReconciliationView> {
    const { workspaceId } = cmd;
    return this.deps.uow.run(workspaceId, async () => {
      if (cmd.items.length === 0 || cmd.items.length > MAX_TOGGLE) {
        throw new DomainError('VALIDATION_FAILED', `between 1 and ${MAX_TOGGLE} items`).at('/items');
      }
      const r = await this.loadInProgress(workspaceId, cmd.reconciliationId, cmd.expectedVersion);
      const s = r.snapshot;
      await this.transactions.markCleared(workspaceId, cmd.items, cmd.cleared, {
        reconciliationId: s.id,
        accountId: s.accountId,
        statementDate: s.statementDate,
      });
      r.touch();
      if (!(await this.deps.reconciliations.update(r))) throw concurrencyConflict();
      return this.view(r, await this.natureOf(workspaceId, s.accountId));
    });
  }

  /**
   * `CompleteReconciliation` (TC-TRANSACTIONS-RECONCILIATION-006…008, -012, -013, -019, -022): recalcula el saldo
   * confirmado con el estado vigente; diferencia ≠ 0 ⇒ `RECONCILIATION_DIFFERENCE_NOT_ZERO` salvo ajuste confirmado
   * con motivo (EQUITY:ADJUSTMENTS, fechado en la fecha del extracto); rechaza con `PERIOD_CLOSED` si una incluida o el
   * ajuste caen en un periodo cerrado; reconcilia (modo contra extracto) las `cleared` ≤ extracto, coteja las
   * conciliadas sin extracto de periodos abiertos y completa la sesión, todo en una sola unidad de trabajo.
   */
  complete(cmd: CompleteReconciliationCommand): Promise<ReconciliationView> {
    const { workspaceId } = cmd;
    // SERIALIZABLE con reintento (docs/08 §11): una edición concurrente de las incluidas o una confirmación nueva dentro
    // del rango entran en conflicto con esta transacción en lugar de escaparse del conjunto evaluado. Por HTTP la abre
    // así el contrato (`x-isolation`); sin transacción previa (jobs, tests) la abre aquí.
    return this.deps.uow.run(
      workspaceId,
      async () => {
        const r = await this.loadInProgress(workspaceId, cmd.reconciliationId, cmd.expectedVersion);
        const s0 = r.snapshot;
        const [account] = await this.deps.accounts.assertCanPost({
          workspaceId,
          accounts: [{ accountId: s0.accountId }],
        });
        if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
        const currency = s0.statementBalance.currency;
        const opening = await this.openingBalance(workspaceId, s0.accountId, s0.statementDate, currency.code);
        // Estado vigente (bloqueado): las `cleared` incluidas y las ya reconciliadas.
        const cleared = await this.deps.reconciliations.lockClearedThrough(
          workspaceId,
          s0.accountId,
          s0.statementDate,
        );
        const reconciledTotal = await this.deps.reconciliations.confirmedLegsTotal({
          workspaceId,
          accountId: s0.accountId,
          currency: currency.code,
          through: s0.statementDate,
          statuses: ['RECONCILED'],
        });
        const clearedLegs = Money.sum(
          cleared.flatMap((t) =>
            t.snapshot.legs.filter((l) => l.accountId === s0.accountId).map((l) => l.amount),
          ),
          currency,
        );
        const balances = ReconciliationCalculator.fromTotals({
          nature: account.nature,
          opening,
          confirmedLegsTotal: reconciledTotal.total.add(clearedLegs),
          statementBalance: s0.statementBalance,
        });
        const adjustmentSpec = ReconciliationCalculator.adjustmentFor(balances.difference);
        // Diferencia ≠ 0: solo se cierra con un ajuste confirmado explícitamente y con motivo (sin diferencia, un
        // ajuste enviado es innecesario y se ignora).
        let adjustmentReason: string | null = null;
        if (adjustmentSpec) {
          if (!cmd.adjustment) throw this.differenceNotZero(balances.difference);
          adjustmentReason = (cmd.adjustment.reason ?? '').trim();
          if (adjustmentReason.length === 0) {
            throw new DomainError('VALIDATION_FAILED', 'the adjustment requires a reason').at(
              '/adjustment/reason',
            );
          }
          if (adjustmentReason.length > 500) {
            throw new DomainError('VALIDATION_FAILED', 'the reason must be at most 500 characters').at(
              '/adjustment/reason',
            );
          }
        }

        // INV-015 (docs/33 D65): ninguna incluida ni el ajuste pueden caer en un periodo cerrado.
        const closed = new Map<string, boolean>();
        const isClosed = async (date: string): Promise<boolean> => {
          const known = closed.get(date);
          if (known !== undefined) return known;
          let value = false;
          try {
            await this.deps.ledger.assertPeriodOpen({ workspaceId, date });
          } catch (err) {
            if (err instanceof DomainError && err.code === 'PERIOD_CLOSED') value = true;
            else throw err;
          }
          closed.set(date, value);
          return value;
        };
        const violations: FieldViolation[] = [];
        for (const t of cleared) {
          if (await isClosed(t.snapshot.businessDate)) {
            violations.push({
              pointer: jsonPointer('transactions', t.id),
              code: 'PERIOD_CLOSED',
              detail: `transaction ${t.id} dated ${t.snapshot.businessDate} is in a closed period`,
            });
          }
        }
        if (adjustmentSpec && (await isClosed(s0.statementDate))) {
          violations.push({
            pointer: '/adjustment',
            code: 'PERIOD_CLOSED',
            detail: `the adjustment dated ${s0.statementDate} would fall in a closed period`,
          });
        }
        if (violations.length > 0) {
          throw new DomainError('PERIOD_CLOSED', 'the reconciliation touches a closed period', {
            violations,
          });
        }

        // Ajuste: asiento contra EQUITY:ADJUSTMENTS, creado como cleared y reconciliado en la sesión.
        const reconciledIds: string[] = [];
        let adjustmentId: string | null = null;
        if (adjustmentSpec && adjustmentReason !== null) {
          adjustmentId = await this.createAdjustment(r, account, adjustmentSpec, adjustmentReason);
          reconciledIds.push(adjustmentId);
        }

        // `RECONCILE` de cada `cleared` incluida (modo contra extracto).
        const items: {
          reconciliationId: string;
          transactionId: string;
          verifiedWithoutStatement: boolean;
        }[] = [];
        for (const tx of cleared) {
          tx.reconcile(r.id);
          await this.persistReconciled(tx, r, 'RECONCILE');
          reconciledIds.push(tx.id);
          items.push({ reconciliationId: r.id, transactionId: tx.id, verifiedWithoutStatement: false });
        }
        if (adjustmentId) {
          items.push({
            reconciliationId: r.id,
            transactionId: adjustmentId,
            verifiedWithoutStatement: false,
          });
        }

        // Cotejo posterior (decisión 14): conciliadas sin extracto ≤ extracto fuera de periodos cerrados.
        const without = await this.deps.reconciliations.lockWithoutStatementThrough(
          workspaceId,
          s0.accountId,
          s0.statementDate,
        );
        for (const tx of without) {
          if (await isClosed(tx.snapshot.businessDate)) continue;
          if (!tx.verifyAgainstStatement(r.id)) continue;
          await this.persistVerified(tx, r);
          items.push({ reconciliationId: r.id, transactionId: tx.id, verifiedWithoutStatement: true });
        }
        await this.deps.reconciliations.insertItems(workspaceId, items);

        // Sesión COMPLETED con el saldo confirmado congelado (= extracto) y diferencia 0.
        r.complete({
          clearedBalance: s0.statementBalance,
          adjustmentTransactionId: adjustmentId,
          completedBy: cmd.userId,
          at: this.deps.clock.now().toString(),
        });
        if (!(await this.deps.reconciliations.update(r))) throw concurrencyConflict();
        const s = r.snapshot;
        const completedRef = await this.publishSessionEvent(r, TRANSACTION_EVENTS.reconciliationCompleted, {
          reconciliationId: s.id,
          accountId: s.accountId,
          currency: currency.code,
          statementDate: s.statementDate,
          statementBalance: s.statementBalance.toJSON(),
          clearedBalance: (s.clearedBalance ?? s.statementBalance).toJSON(),
          transactionCount: reconciledIds.length,
          ...(reconciledIds.length <= MAX_EVENT_TRANSACTION_IDS ? { transactionIds: reconciledIds } : {}),
          adjustmentTransactionId: adjustmentId,
          transition: 'COMPLETE',
        });
        const changes: AuditChangeInput[] = [
          { field: 'status', before: 'IN_PROGRESS', after: 'COMPLETED' },
          { field: 'clearedBalance', before: null, after: s.clearedBalance },
          { field: 'difference', before: null, after: s.difference },
          { field: 'transactionCount', before: null, after: reconciledIds.length },
        ];
        if (adjustmentId) {
          changes.push({ field: 'adjustmentTransactionId', before: null, after: adjustmentId });
          changes.push({ field: 'adjustmentReason', before: null, after: adjustmentReason });
        }
        await this.deps.lifecycle.record(
          {
            workspaceId,
            action: 'transactions.reconciliation.completed',
            aggregateType: 'Reconciliation',
            aggregateId: s.id,
            aggregateVersion: s.version,
            changes,
          },
          [
            this.step(
              r,
              [completedRef],
              adjustmentId ? { adjustmentTransactionId: adjustmentId } : undefined,
            ),
          ],
        );
        return this.view(r, account.nature);
      },
      { isolation: 'SERIALIZABLE' },
    );
  }

  /** `CancelReconciliation`: las marcas `cleared` se conservan (TC-TRANSACTIONS-RECONCILIATION-009). */
  cancel(cmd: CancelReconciliationCommand): Promise<ReconciliationView> {
    const { workspaceId } = cmd;
    return this.deps.uow.run(workspaceId, async () => {
      const r = await this.deps.reconciliations.findById(workspaceId, cmd.reconciliationId, {
        forUpdate: true,
      });
      if (!r) throw notFound(cmd.reconciliationId);
      if (r.version !== cmd.expectedVersion) throw preconditionFailed(r.version);
      r.cancel({ cancelledBy: cmd.userId, at: this.deps.clock.now().toString() });
      if (!(await this.deps.reconciliations.update(r))) throw concurrencyConflict();
      const s = r.snapshot;
      await this.deps.lifecycle.record(
        {
          workspaceId,
          action: 'transactions.reconciliation.cancelled',
          aggregateType: 'Reconciliation',
          aggregateId: s.id,
          aggregateVersion: s.version,
          changes: [{ field: 'status', before: 'IN_PROGRESS', after: 'CANCELLED' }],
        },
        [this.step(r, [])],
      );
      return this.view(r, await this.natureOf(workspaceId, s.accountId));
    });
  }

  // ------------------------------------------------------------------ consultas

  get(workspaceId: string, reconciliationId: string): Promise<ReconciliationView> {
    return this.deps.uow.run(workspaceId, async () => {
      const r = await this.deps.reconciliations.findById(workspaceId, reconciliationId);
      if (!r) throw notFound(reconciliationId);
      return this.view(r, await this.natureOf(workspaceId, r.snapshot.accountId));
    });
  }

  list(query: ListReconciliationsQuery): Promise<ReconciliationView[]> {
    const { workspaceId, offset, limit, ...filter } = query;
    return this.deps.uow.run(workspaceId, async () => {
      const found = await this.deps.reconciliations.list(workspaceId, filter, { offset, limit });
      const natures = new Map<string, AccountNature>();
      const out: ReconciliationView[] = [];
      for (const r of found) {
        let nature = natures.get(r.snapshot.accountId);
        if (!nature) {
          nature = await this.natureOf(workspaceId, r.snapshot.accountId);
          natures.set(r.snapshot.accountId, nature);
        }
        // El listado no calcula el saldo en vivo de cada sesión en curso: usa el detalle (`get`).
        out.push(await this.view(r, nature, { live: false }));
      }
      return out;
    });
  }

  /**
   * `GetLifecycle` de la sesión (TC-AUDIT-LIFECYCLE-025): máquina `RECONCILIATION_LIFECYCLE`, transiciones START/
   * COMPLETE/CANCEL y anotaciones (confirmaciones y des-reconciliaciones posteriores). Otro workspace ⇒ 404.
   */
  lifecycle(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly reconciliationId: string;
  }): Promise<ReconciliationLifecycleView> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const r = await this.deps.reconciliations.findById(input.workspaceId, input.reconciliationId);
      if (!r) throw notFound(input.reconciliationId);
      const lifecycle = await this.deps.lifecycleQuery.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: 'Reconciliation',
        aggregateId: r.id,
        currentState: r.status,
      });
      return { lifecycle, reconciliation: r.snapshot };
    });
  }

  /** `getReconciliationStatus`: el estado de UNA cuenta; `asOf` por omisión es hoy en la zona del workspace. */
  accountStatus(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly asOf?: string;
    readonly from?: string;
  }): Promise<ReconciliationCoverageDto> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const [account] = await this.deps.accounts.getPostingEligibility({
        workspaceId: input.workspaceId,
        accountIds: [input.accountId],
      });
      if (!account) throw new DomainError('RESOURCE_NOT_FOUND', `account ${input.accountId} not found`);
      const through = input.asOf ?? (await this.deps.calendar.today(input.workspaceId));
      const [status] = await this.getCoverage({
        workspaceId: input.workspaceId,
        accountIds: [input.accountId],
        through,
        ...(input.from ? { from: input.from } : {}),
      });
      if (!status) throw new DomainError('INTERNAL_ERROR', 'coverage without a result');
      return status;
    });
  }

  /**
   * `ReconciliationStatusQuery.getCoverage` (decisión 9, docs/33 D111): estado por cuenta a un corte. Regla única:
   * `reconciledThrough = (posted + cleared hasta el corte = 0) ∧ (extracto completado ≥ corte ∨ ∃ conciliada sin
   * extracto posterior al último extracto)`; la base es `WITHOUT_STATEMENT` si hay conciliadas sin extracto en el rango.
   */
  getCoverage(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
    readonly from?: string;
    readonly through: string;
  }): Promise<readonly ReconciliationCoverageDto[]> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const out: ReconciliationCoverageDto[] = [];
      for (const accountId of [...new Set(input.accountIds)]) {
        const last = await this.deps.reconciliations.lastCompleted(input.workspaceId, accountId);
        const inProgress = await this.deps.reconciliations.findInProgress(input.workspaceId, accountId);
        const counts = await this.deps.reconciliations.coverageCounts({
          workspaceId: input.workspaceId,
          accountId,
          from: input.from ?? null,
          through: input.through,
          afterDate: last?.snapshot.statementDate ?? null,
        });
        const noneOpen = counts.unreconciledPostedCount + counts.unreconciledClearedCount === 0;
        const statementCovers = last !== null && last.snapshot.statementDate >= input.through;
        const reconciledThrough = noneOpen && (statementCovers || counts.withoutStatementAfterLastStatement);
        const l = last?.snapshot;
        out.push({
          accountId,
          lastCompleted:
            l && l.completedAt && l.difference
              ? {
                  reconciliationId: l.id,
                  statementDate: l.statementDate,
                  statementBalance: l.statementBalance.toJSON(),
                  difference: l.difference.toJSON(),
                  completedAt: l.completedAt,
                }
              : null,
          inProgressReconciliationId: inProgress?.id ?? null,
          unreconciledPostedCountThrough: counts.unreconciledPostedCount,
          unreconciledClearedCountThrough: counts.unreconciledClearedCount,
          reconciledWithoutStatementCount: counts.withoutStatementInRange,
          reconciledThrough,
          reconciliationBasis: !reconciledThrough
            ? null
            : counts.withoutStatementInRange > 0
              ? 'WITHOUT_STATEMENT'
              : 'STATEMENT',
        });
      }
      return out;
    });
  }

  // ------------------------------------------------------------------ helpers

  private async loadInProgress(
    workspaceId: string,
    reconciliationId: string,
    expectedVersion: number,
  ): Promise<Reconciliation> {
    const r = await this.deps.reconciliations.findById(workspaceId, reconciliationId, { forUpdate: true });
    if (!r) throw notFound(reconciliationId);
    if (r.version !== expectedVersion) throw preconditionFailed(r.version);
    if (r.status !== 'IN_PROGRESS') {
      throw new DomainError('INVALID_STATUS_TRANSITION', `the reconciliation is ${r.status}`);
    }
    return r;
  }

  private async natureOf(workspaceId: string, accountId: string): Promise<AccountNature> {
    const [account] = await this.deps.accounts.getPostingEligibility({
      workspaceId,
      accountIds: [accountId],
    });
    if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
    return account.nature;
  }

  private differenceNotZero(difference: Money): DomainError {
    return new DomainError(
      'RECONCILIATION_DIFFERENCE_NOT_ZERO',
      `the difference is ${difference.toFixed()} ${difference.currency.code}`,
      { details: { difference: difference.toJSON() } },
    );
  }

  /** Saldo inicial de la cuenta (asiento de apertura, signo contable) a la fecha del extracto; cero si no hay. */
  private async openingBalance(
    workspaceId: string,
    accountId: string,
    asOf: string,
    currencyCode: string,
  ): Promise<Money> {
    const found = await this.deps.openingBalances.openingBalance({ workspaceId, accountId, asOf });
    return this.parseMoney(found ?? { amount: '0', currency: currencyCode }, '/openingBalance');
  }

  private async view(
    r: Reconciliation,
    nature: AccountNature,
    options: { readonly live?: boolean } = {},
  ): Promise<ReconciliationView> {
    const s = r.snapshot;
    const currency = s.statementBalance.currency;
    let clearedBalance = s.clearedBalance;
    let difference = s.difference;
    if (s.status === 'IN_PROGRESS' && options.live !== false) {
      const opening = await this.openingBalance(s.workspaceId, s.accountId, s.statementDate, currency.code);
      const confirmed = await this.deps.reconciliations.confirmedLegsTotal({
        workspaceId: s.workspaceId,
        accountId: s.accountId,
        currency: currency.code,
        through: s.statementDate,
        statuses: ['CLEARED', 'RECONCILED'],
      });
      const live = ReconciliationCalculator.fromTotals({
        nature,
        opening,
        confirmedLegsTotal: confirmed.total,
        statementBalance: s.statementBalance,
      });
      clearedBalance = live.clearedBalance;
      difference = live.difference;
    }
    const items =
      s.status === 'COMPLETED' ? await this.deps.reconciliations.itemsOf(s.workspaceId, s.id) : null;
    return { reconciliation: s, nature, currency: currency.code, clearedBalance, difference, items };
  }

  /** Paso `TRANSITION` de la sesión (START/COMPLETE/CANCEL) validado por la máquina del agregado. */
  private step(
    r: Reconciliation,
    events: readonly LifecycleEventRefDto[],
    detailRefs?: Readonly<Record<string, string | number>>,
  ) {
    const t = r.lastTransition;
    if (!t) throw new DomainError('INTERNAL_ERROR', 'reconciliation without a transition');
    return {
      kind: 'TRANSITION' as const,
      transition: t.transition,
      fromState: t.from,
      toState: t.to,
      machineVersion: RECONCILIATION_LIFECYCLE.version,
      events,
      ...(detailRefs ? { detailRefs } : {}),
    };
  }

  private async publishSessionEvent(
    r: Reconciliation,
    event: { readonly eventType: string; readonly eventVersion: number },
    payload: object,
  ): Promise<LifecycleEventRefDto> {
    const eventId = this.deps.ids.next();
    await this.deps.outbox.append({
      eventId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: r.workspaceId,
      aggregateType: 'Reconciliation',
      aggregateId: r.id,
      aggregateVersion: r.version,
      payload,
    });
    return { eventId, eventType: `${event.eventType}.v${event.eventVersion}` };
  }

  /**
   * Crea el ajuste de la sesión (decisión 4.e): `ADJUSTMENT` contra `EQUITY:ADJUSTMENTS:<CCY>` fechado en la fecha del
   * extracto, registrado `cleared` y reconciliado (modo contra extracto) en la misma operación, con las transiciones
   * RECORD y RECONCILE que referencian la sesión.
   */
  private async createAdjustment(
    r: Reconciliation,
    account: { readonly accountId: string; readonly nature: AccountNature; readonly currency: string },
    spec: NonNullable<ReturnType<typeof ReconciliationCalculator.adjustmentFor>>,
    reason: string,
  ): Promise<string> {
    const s = r.snapshot;
    const tx = Transaction.record({
      id: this.deps.ids.next(),
      workspaceId: s.workspaceId,
      kind: 'ADJUSTMENT',
      status: 'CLEARED',
      businessDate: s.statementDate,
      accountId: account.accountId,
      accountNature: account.nature,
      accountCurrency: account.currency,
      amount: spec.amount,
      direction: spec.direction,
      reason,
      source: 'SYSTEM',
      reconciliationId: s.id,
      defaultSplitId: this.deps.ids.next(),
    });
    const recordStep = tx.lastTransition;
    const entryId = await postEntry(this.deps, tx);
    tx.attachEntry(entryId);
    const created = tx.snapshot;
    const events: LifecycleEventRefDto[] = [
      await publishEvent(this.deps, tx, TRANSACTION_EVENTS.created, {
        transactionId: created.id,
        kind: created.kind,
        status: created.status,
        businessDate: created.businessDate,
        description: created.description,
        counterpartyId: created.counterpartyId,
        origin: { type: created.source, refId: null },
        legs: legsPayload(created),
        splits: [],
        postingDate: created.postingDate,
        refundOfTransactionId: null,
        paymentMethod: null,
        reconciliationId: s.id,
        transition: 'RECORD',
      }),
      ...(await publishPosted(this.deps, tx, entryId, null, null)),
    ];
    tx.reconcile(s.id);
    await this.deps.transactions.insert(tx);
    await linkEntry(this.deps, tx, entryId, 'POSTED');
    const done = tx.snapshot;
    const updated = await publishEvent(this.deps, tx, TRANSACTION_EVENTS.updated, {
      transactionId: done.id,
      revision: done.revision,
      status: done.status,
      previousStatus: 'CLEARED',
      changedFields: ['status', 'reconciliationMode'],
      ledgerImpact: false,
      reason: null,
      paymentMethod: null,
      transition: 'RECONCILE',
    });
    const refs = { reconciliationId: s.id };
    await this.deps.lifecycle.record(
      {
        workspaceId: s.workspaceId,
        action: 'transactions.transaction.created',
        aggregateType: 'Transaction',
        aggregateId: done.id,
        aggregateVersion: done.version,
        changes: [
          { field: 'kind', before: null, after: done.kind },
          { field: 'status', before: null, after: done.status },
          { field: 'transactionDate', before: null, after: done.businessDate },
          { field: 'accountId', before: null, after: done.accountId },
          { field: 'amount', before: null, after: done.amount },
          { field: 'adjustmentDirection', before: null, after: done.direction },
          { field: 'adjustmentReason', before: null, after: done.adjustmentReason },
          { field: 'reconciliationMode', before: null, after: done.reconciliationMode },
          { field: 'reconciliationId', before: null, after: s.id },
          { field: 'journalEntryId', before: null, after: entryId },
        ],
      },
      [
        ...transactionSteps(tx, {
          events,
          transition: recordStep,
          journalEntries: { posted: entryId },
          detailRefs: refs,
        }),
        ...transactionSteps(tx, { events: [updated], detailRefs: refs }),
      ],
    );
    return done.id;
  }

  /** Persiste y registra un `RECONCILE` de una transacción existente (estado, evento, auditoría y recorrido). */
  private async persistReconciled(
    tx: Transaction,
    r: Reconciliation,
    transition: 'RECONCILE',
  ): Promise<void> {
    if (!(await this.deps.transactions.updateStatus(tx))) throw concurrencyConflict();
    const s = tx.snapshot;
    const updated = await publishEvent(this.deps, tx, TRANSACTION_EVENTS.updated, {
      transactionId: s.id,
      revision: s.revision,
      status: s.status,
      previousStatus: 'CLEARED',
      changedFields: ['status', 'reconciliationMode'],
      ledgerImpact: false,
      reason: null,
      paymentMethod: s.paymentMethod,
      transition,
    });
    await this.deps.lifecycle.record(
      {
        workspaceId: s.workspaceId,
        action: 'transactions.transaction.reconciled',
        aggregateType: 'Transaction',
        aggregateId: s.id,
        aggregateVersion: s.version,
        changes: [
          { field: 'status', before: 'CLEARED', after: 'RECONCILED' },
          { field: 'reconciliationMode', before: null, after: 'STATEMENT' },
          { field: 'reconciliationId', before: null, after: r.id },
        ],
      },
      transactionSteps(tx, { events: [updated], detailRefs: { reconciliationId: r.id } }),
    );
  }

  /** Cotejo posterior: anotación del recorrido (sin transición nueva) y `TransactionUpdated` con el modo. */
  private async persistVerified(tx: Transaction, r: Reconciliation): Promise<void> {
    if (!(await this.deps.transactions.updateStatus(tx))) throw concurrencyConflict();
    const s = tx.snapshot;
    const updated = await publishEvent(this.deps, tx, TRANSACTION_EVENTS.updated, {
      transactionId: s.id,
      revision: s.revision,
      status: s.status,
      previousStatus: s.status,
      changedFields: ['reconciliationMode'],
      ledgerImpact: false,
      reason: null,
      paymentMethod: s.paymentMethod,
    });
    await this.deps.lifecycle.record(
      {
        workspaceId: s.workspaceId,
        action: 'transactions.transaction.reconciliation_verified',
        aggregateType: 'Transaction',
        aggregateId: s.id,
        aggregateVersion: s.version,
        changes: [
          { field: 'reconciliationMode', before: 'WITHOUT_STATEMENT', after: 'STATEMENT' },
          { field: 'reconciliationId', before: null, after: r.id },
        ],
      },
      transactionSteps(tx, {
        events: [updated],
        changedFields: ['RECONCILIATION_VERIFIED'],
        detailRefs: { reconciliationId: r.id },
      }),
    );
  }

  private async parseMoney(dto: MoneyDto, pointer: string): Promise<Money> {
    const scale = await this.deps.currencies.scaleOf(dto.currency);
    if (scale === null) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${dto.currency} is not enabled`).at(
        `${pointer}/currency`,
      );
    }
    try {
      return Money.parse(dto.amount, makeCurrency(dto.currency, scale));
    } catch (err) {
      throw err instanceof DomainError ? err.at(pointer) : err;
    }
  }
}
