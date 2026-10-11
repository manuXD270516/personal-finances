import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, LocalDate, currency as makeCurrency, type Currency } from '@pf/shared-kernel';
import {
  COMMITMENTS_EVENTS,
  type MoneyDto,
  type RecurringOccurrenceMaterializedV1,
} from '../contracts/index.js';
import {
  OccurrenceClock,
  buildAmountSpec,
  isTransferLike,
  resolveApprovalAmount,
  transactionKindOf,
  type AmountSpec,
  type ExpireReason,
  type RecurringDefinition,
  type RecurringOccurrence,
} from '../domain/index.js';
import type { CommitmentsDeps } from './ports/index.js';
import { assertNotLoanPayment } from './managed-guard.js';
import {
  OCCURRENCE_AGGREGATE,
  occurrenceChanges,
  occurrenceEntry,
  occurrenceSteps,
  publishEvent,
} from './recorder.js';
import { money, occurrenceDto, type OccurrenceDto } from './views.js';

const notFound = (id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `recurring occurrence ${id} not found`);
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

export interface MaterializeCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly occurrenceId: string;
  readonly amount?: MoneyDto | null | undefined;
  readonly businessDate?: string | null | undefined;
  readonly status?: 'PENDING' | 'POSTED' | null | undefined;
}

export interface MaterializeResult {
  readonly occurrence: OccurrenceDto;
  readonly transactionId: string;
}

export type AutoCreateOutcome = 'CREATED' | 'SKIPPED' | 'REJECTED';

/**
 * Casos de uso de la ocurrencia (openspec add-recurrence-engine decisiones 9, 11-13 y 18): aprobar, editar, omitir,
 * vincular una transacción existente y liberar al anularse. Cada comando toma `FOR UPDATE` de la ocurrencia y deja
 * auditoría + recorrido + outbox en la misma transacción que el cambio (y que la transacción creada, INV-029).
 */
export class OccurrencesService {
  constructor(private readonly deps: CommitmentsDeps) {}

  private async clockOf(workspaceId: string): Promise<{ today: LocalDate; at: string }> {
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    const now = this.deps.clock.now();
    return { today: LocalDate.ofInstant(now, calendar.timeZone), at: now.toString() };
  }

  private async lock(workspaceId: string, id: string): Promise<RecurringOccurrence> {
    const occ = await this.deps.occurrences.findById(workspaceId, id, { lock: 'update' });
    if (!occ) throw notFound(id);
    return occ;
  }

  private async persist(occ: RecurringOccurrence): Promise<void> {
    if (!(await this.deps.occurrences.save(occ))) {
      throw preconditionFailed((await this.deps.occurrences.findById(occ.workspaceId, occ.id))?.version);
    }
  }

  private async definitionOf(occ: RecurringOccurrence): Promise<RecurringDefinition> {
    const def = await this.deps.definitions.findById(occ.workspaceId, occ.definitionId);
    if (!def) throw notFound(occ.definitionId);
    return def;
  }

  private async currencyOf(workspaceId: string, code: string): Promise<Currency> {
    const catalog = await this.deps.rates.workspaceCurrencies(workspaceId);
    const found = catalog.find((c) => c.code === code);
    if (!found) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not in the catalog`);
    return makeCurrency(found.code, found.scale);
  }

  private async view(workspaceId: string, id: string): Promise<OccurrenceDto> {
    const view = await this.deps.occurrences.findView(workspaceId, id);
    if (!view) throw notFound(id);
    return occurrenceDto(view);
  }

  // ───────────────────────────────────────────────────────────── aprobar

  /** `MaterializeOccurrence` ("Aprobar"): crea la transacción vía el puerto de TRANSACTIONS y resuelve la ocurrencia. */
  async materialize(cmd: MaterializeCommand): Promise<MaterializeResult> {
    const { deps } = this;
    const { today, at } = await this.clockOf(cmd.workspaceId);
    return deps.uow.run(cmd.workspaceId, async () => {
      const occ = await this.lock(cmd.workspaceId, cmd.occurrenceId);
      const transactionId = await this.createTransaction(occ, {
        today,
        at,
        by: cmd.userId,
        amount: cmd.amount ?? null,
        businessDate: cmd.businessDate ?? null,
        status: cmd.status ?? 'POSTED',
      });
      return { occurrence: await this.view(cmd.workspaceId, occ.id), transactionId };
    });
  }

  /**
   * Creación y resolución en la unidad de trabajo del llamador: monto y fecha por tipo, datos de la plantilla de la
   * versión de la ocurrencia (no la vigente), errores de TRANSACTIONS propagados sin traducir.
   */
  private async createTransaction(
    occ: RecurringOccurrence,
    input: {
      readonly today: LocalDate;
      readonly at: string;
      readonly by: string | null;
      readonly amount: MoneyDto | null;
      readonly businessDate: string | null;
      readonly status: 'PENDING' | 'POSTED';
    },
  ): Promise<string> {
    const { deps } = this;
    const def = await this.definitionOf(occ);
    // N4: las cuotas de préstamo se pagan desde el préstamo; el motor nunca crea su transacción.
    assertNotLoanPayment(def, occ.snapshot.scheduleKey);
    occ.assertCanResolve();
    const s = occ.snapshot;
    const version = def.versionNo(s.definitionVersionNo);
    const currency = await this.currencyOf(s.workspaceId, s.currency);
    if (input.amount && input.amount.currency !== s.currency) {
      throw new DomainError('CURRENCY_MISMATCH', `the amount must be in ${s.currency}`).at(
        '/amount/currency',
      );
    }
    const amount = resolveApprovalAmount(s.expected, input.amount?.amount ?? null, currency);
    let businessDate: LocalDate;
    try {
      businessDate = input.businessDate
        ? LocalDate.parse(input.businessDate)
        : OccurrenceClock.defaultBusinessDate(LocalDate.parse(s.dueDate), input.today);
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'businessDate must be YYYY-MM-DD').at('/businessDate');
    }
    const before = occ.snapshot;
    const txn = await deps.transactions.record({
      workspaceId: s.workspaceId,
      userId: input.by ?? '',
      kind: transactionKindOf(def.kind),
      status: input.status,
      businessDate: businessDate.toString(),
      accountId: version.accountId,
      toAccountId: version.toAccountId,
      amount: money(amount, s.currency),
      categoryId: version.categoryId,
      counterpartyId: version.counterpartyId,
      tagIds: version.tagIds,
      description: def.name,
      paymentMethod: version.paymentMethod,
      occurrenceRef: { occurrenceId: s.id, definitionId: s.definitionId },
    });
    occ.materialize({ transactionId: txn.transactionId, at: input.at, by: input.by });
    await this.persist(occ);
    await this.expireSuggestions(occ.workspaceId, occ.id, 'OCCURRENCE_RESOLVED');
    const after = occ.snapshot;
    const payload: RecurringOccurrenceMaterializedV1 = {
      workspaceId: s.workspaceId,
      occurrenceId: s.id,
      definitionId: s.definitionId,
      occurrenceDate: s.occurrenceDate,
      managedBy: def.snapshot.managedBy,
      transactionId: txn.transactionId,
      mode: 'CREATED',
      matchedBy: null,
      amount: money(amount, s.currency),
      businessDate: txn.businessDate,
    };
    const event = await publishEvent(
      deps,
      {
        workspaceId: s.workspaceId,
        aggregateType: OCCURRENCE_AGGREGATE,
        aggregateId: s.id,
        aggregateVersion: after.version,
      },
      COMMITMENTS_EVENTS.occurrenceMaterialized,
      payload,
    );
    // La diferencia contra lo esperado queda en la auditoría: el usuario confirma lo que realmente pagó.
    const changes: AuditChangeInput[] = [
      ...occurrenceChanges(before, after),
      { field: 'amount', before: null, after: money(amount, s.currency) },
      { field: 'businessDate', before: null, after: txn.businessDate },
    ];
    await deps.lifecycle.record(
      occurrenceEntry(occ, 'materialized', changes),
      occurrenceSteps(occ, [event], { detailRefs: { transactionId: txn.transactionId } }),
    );
    return txn.transactionId;
  }

  /**
   * Creación automática de UNA ocurrencia (`AUTO_CREATE`, decisión 9) en su propia unidad de trabajo: si TRANSACTIONS
   * rechaza (`PERIOD_CLOSED`, `ACCOUNT_CLOSED`…), nada de la transacción se persiste y la ocurrencia queda con el
   * código en `lastAutoCreateError` (D129); el mismo día no se reintenta. Idempotente por estado y por el índice único
   * de `externalRef`: reprocesarla no crea una segunda transacción.
   */
  async autoMaterialize(workspaceId: string, occurrenceId: string): Promise<AutoCreateOutcome> {
    const { deps } = this;
    const { today, at } = await this.clockOf(workspaceId);
    try {
      return await deps.uow.run(workspaceId, async () => {
        const occ = await this.lock(workspaceId, occurrenceId);
        if (!occ.unresolved) return 'SKIPPED';
        const def = await this.definitionOf(occ);
        const version = def.versionNo(occ.snapshot.definitionVersionNo);
        if (def.status !== 'ACTIVE' || version.materialization.mode !== 'AUTO_CREATE') return 'SKIPPED';
        if (!OccurrenceClock.autoCreateDue({ dueDate: LocalDate.parse(occ.dueDate), today }))
          return 'SKIPPED';
        if (occ.snapshot.lastAutoCreateOn === today.toString()) return 'SKIPPED';
        await this.createTransaction(occ, {
          today,
          at,
          by: null,
          amount: null,
          businessDate: null,
          status: version.materialization.autoCreateStatus ?? 'PENDING',
        });
        deps.metrics?.increment('commitments_auto_create_total', { result: 'created' });
        return 'CREATED';
      });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      await deps.uow.run(workspaceId, async () => {
        const occ = await this.lock(workspaceId, occurrenceId);
        if (!occ.unresolved) return;
        const before = occ.snapshot;
        occ.recordAutoCreateFailure(err.code, today);
        await this.persist(occ);
        await deps.lifecycle.record(
          occurrenceEntry(occ, 'auto_create_failed', occurrenceChanges(before, occ.snapshot)),
          [{ kind: 'ANNOTATION', changedFields: ['lastAutoCreateError'] }],
        );
      });
      deps.metrics?.increment('commitments_auto_create_total', { result: 'rejected' });
      return 'REJECTED';
    }
  }

  // ───────────────────────────────────────────────────────────── editar

  /** `EditOccurrence`: cambia monto esperado y/o vencimiento de ESTA ocurrencia; la fecha nominal no cambia. */
  async edit(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly occurrenceId: string;
    readonly expectedVersion: number;
    readonly expectedAmount?: MoneyDto | undefined;
    readonly expectedMin?: MoneyDto | undefined;
    readonly expectedMax?: MoneyDto | undefined;
    readonly dueDate?: string | undefined;
  }): Promise<OccurrenceDto> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const occ = await this.lock(cmd.workspaceId, cmd.occurrenceId);
      assertNotLoanPayment(await this.definitionOf(occ), occ.snapshot.scheduleKey);
      if (occ.version !== cmd.expectedVersion) throw preconditionFailed(occ.version);
      const s = occ.snapshot;
      const currency = await this.currencyOf(cmd.workspaceId, s.currency);
      for (const m of [cmd.expectedAmount, cmd.expectedMin, cmd.expectedMax]) {
        if (m && m.currency !== s.currency) {
          throw new DomainError('CURRENCY_MISMATCH', `the amount must be in ${s.currency}`).at(
            '/expectedAmount',
          );
        }
      }
      let expected: AmountSpec | undefined;
      if (cmd.expectedAmount || cmd.expectedMin || cmd.expectedMax) {
        const type = s.expected.type;
        if (type === 'VARIABLE') {
          throw new DomainError(
            'RECURRING_INVALID_AMOUNT',
            'a VARIABLE occurrence has no expected amount',
          ).at('/expectedAmount');
        }
        expected =
          type === 'MIN_MAX'
            ? buildAmountSpec(
                {
                  type,
                  min: cmd.expectedMin?.amount ?? s.expected.min,
                  max: cmd.expectedMax?.amount ?? s.expected.max,
                },
                currency,
                '/expected',
              )
            : buildAmountSpec({ type, amount: cmd.expectedAmount?.amount }, currency, '/expected');
      }
      const before = occ.snapshot;
      occ.edit({
        ...(expected ? { expected } : {}),
        ...(cmd.dueDate !== undefined ? { dueDate: this.parseDate(cmd.dueDate) } : {}),
      });
      if (occ.changedFields.length === 0) return this.view(cmd.workspaceId, occ.id);
      await this.persist(occ);
      const after = occ.snapshot;
      const def = await this.definitionOf(occ);
      const event = await publishEvent(
        deps,
        {
          workspaceId: s.workspaceId,
          aggregateType: OCCURRENCE_AGGREGATE,
          aggregateId: s.id,
          aggregateVersion: after.version,
        },
        COMMITMENTS_EVENTS.occurrenceChanged,
        {
          workspaceId: s.workspaceId,
          occurrenceId: s.id,
          definitionId: s.definitionId,
          managedBy: def.snapshot.managedBy,
          transition: 'EDIT',
          status: after.status,
          dueDate: after.dueDate,
          expected: {
            type: after.expected.type,
            amount: after.expected.amount,
            min: after.expected.min,
            max: after.expected.max,
          },
          currency: after.currency,
          releasedTransactionId: null,
          reason: null,
        },
      );
      await deps.lifecycle.record(
        occurrenceEntry(occ, 'updated', occurrenceChanges(before, after)),
        occurrenceSteps(occ, [event]),
      );
      return this.view(cmd.workspaceId, occ.id);
    });
  }

  private parseDate(value: string): string {
    try {
      return LocalDate.parse(value).toString();
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'dueDate must be YYYY-MM-DD').at('/dueDate');
    }
  }

  // ───────────────────────────────────────────────────────────── omitir

  /** `SkipOccurrence`: definitivo; no crea transacción, no cuenta como comprometida y no se regenera. */
  async skip(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly occurrenceId: string;
    readonly reason?: string | null | undefined;
  }): Promise<OccurrenceDto> {
    const { deps } = this;
    const { at } = await this.clockOf(cmd.workspaceId);
    return deps.uow.run(cmd.workspaceId, async () => {
      const occ = await this.lock(cmd.workspaceId, cmd.occurrenceId);
      assertNotLoanPayment(await this.definitionOf(occ), occ.snapshot.scheduleKey);
      const before = occ.snapshot;
      occ.skip({ reason: cmd.reason ?? null, at, by: cmd.userId });
      await this.persist(occ);
      await this.expireSuggestions(occ.workspaceId, occ.id, 'OCCURRENCE_RESOLVED');
      const after = occ.snapshot;
      const def = await this.definitionOf(occ);
      const event = await publishEvent(
        deps,
        {
          workspaceId: after.workspaceId,
          aggregateType: OCCURRENCE_AGGREGATE,
          aggregateId: after.id,
          aggregateVersion: after.version,
        },
        COMMITMENTS_EVENTS.occurrenceChanged,
        {
          workspaceId: after.workspaceId,
          occurrenceId: after.id,
          definitionId: after.definitionId,
          managedBy: def.snapshot.managedBy,
          transition: 'SKIP',
          status: after.status,
          dueDate: after.dueDate,
          expected: {
            type: after.expected.type,
            amount: after.expected.amount,
            min: after.expected.min,
            max: after.expected.max,
          },
          currency: after.currency,
          releasedTransactionId: null,
          reason: after.skipReason,
        },
      );
      await deps.lifecycle.record(
        occurrenceEntry(occ, 'skipped', occurrenceChanges(before, after), { reason: after.skipReason }),
        occurrenceSteps(occ, [event], { reason: after.skipReason }),
      );
      return this.view(cmd.workspaceId, occ.id);
    });
  }

  // ───────────────────────────────────────────────────────────── vincular

  /**
   * `LinkOccurrence` ("Marcar pagada"): vincula una transacción existente. Compatibilidad estricta de tipo, cuenta(s)
   * y moneda; sin restricción de monto ni fecha (el usuario decide). Una transacción resuelve a lo sumo una ocurrencia.
   */
  async link(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly occurrenceId: string;
    readonly transactionId: string;
    readonly matchedBy?: 'USER_LINK' | 'SUGGESTION';
    /** Sugerencia que se confirma (add-commitment-matching): queda en el recorrido y se conserva al expirar las demás. */
    readonly suggestionId?: string;
  }): Promise<OccurrenceDto> {
    const { deps } = this;
    const { at } = await this.clockOf(cmd.workspaceId);
    return deps.uow.run(cmd.workspaceId, async () => {
      const occ = await this.lock(cmd.workspaceId, cmd.occurrenceId);
      assertNotLoanPayment(await this.definitionOf(occ), occ.snapshot.scheduleKey);
      occ.assertCanResolve();
      const txn = await deps.links.getForLink({
        workspaceId: cmd.workspaceId,
        transactionId: cmd.transactionId,
      });
      if (!txn) throw new DomainError('REFERENCE_NOT_FOUND', 'transaction not found').at('/transactionId');
      const def = await this.definitionOf(occ);
      const s = occ.snapshot;
      const version = def.versionNo(s.definitionVersionNo);
      const reasons: string[] = [];
      if (txn.status === 'VOIDED') reasons.push('VOIDED');
      if (txn.kind !== (def.kind === 'CARD_PAYMENT' ? 'TRANSFER' : def.kind)) reasons.push('KIND');
      if (
        txn.accountId !== version.accountId ||
        (isTransferLike(def.kind) && txn.toAccountId !== version.toAccountId)
      ) {
        reasons.push('ACCOUNT');
      }
      if (txn.amount.currency !== s.currency) reasons.push('CURRENCY');
      if (reasons.length > 0) {
        throw new DomainError('OCCURRENCE_LINK_MISMATCH', 'the transaction does not match the occurrence', {
          details: { reasons },
        }).at('/transactionId');
      }
      const taken = await deps.occurrences.findByTransaction(cmd.workspaceId, cmd.transactionId);
      if (taken && taken.id !== occ.id) {
        throw new DomainError(
          'TRANSACTION_ALREADY_LINKED',
          'the transaction already resolves another occurrence',
        ).at('/transactionId');
      }
      const before = occ.snapshot;
      const matchedBy = cmd.matchedBy ?? 'USER_LINK';
      occ.link({ transactionId: txn.transactionId, matchedBy, at, by: cmd.userId });
      await this.persist(occ);
      // La bandeja nunca muestra sugerencias obsoletas (design decisión 6): las demás de la ocurrencia y de la
      // transacción expiran en la misma unidad de trabajo (`SUPERSEDED` al confirmar una; resuelta por otra vía si no).
      await this.expireSuggestions(
        occ.workspaceId,
        occ.id,
        cmd.suggestionId ? 'SUPERSEDED' : 'OCCURRENCE_RESOLVED',
        cmd.suggestionId,
      );
      await this.expireTransactionSuggestions(
        occ.workspaceId,
        txn.transactionId,
        'SUPERSEDED',
        cmd.suggestionId,
      );
      const after = occ.snapshot;
      const payload: RecurringOccurrenceMaterializedV1 = {
        workspaceId: s.workspaceId,
        occurrenceId: s.id,
        definitionId: s.definitionId,
        occurrenceDate: s.occurrenceDate,
        managedBy: def.snapshot.managedBy,
        transactionId: txn.transactionId,
        mode: 'MATCHED',
        matchedBy,
        amount: txn.amount,
        businessDate: txn.businessDate,
      };
      const event = await publishEvent(
        deps,
        {
          workspaceId: s.workspaceId,
          aggregateType: OCCURRENCE_AGGREGATE,
          aggregateId: s.id,
          aggregateVersion: after.version,
        },
        COMMITMENTS_EVENTS.occurrenceMaterialized,
        payload,
      );
      await deps.lifecycle.record(
        occurrenceEntry(occ, 'matched', [
          ...occurrenceChanges(before, after),
          { field: 'amount', before: null, after: txn.amount },
          { field: 'businessDate', before: null, after: txn.businessDate },
        ]),
        occurrenceSteps(occ, [event], {
          detailRefs: {
            transactionId: txn.transactionId,
            ...(cmd.suggestionId ? { suggestionId: cmd.suggestionId } : {}),
          },
        }),
      );
      return this.view(cmd.workspaceId, occ.id);
    });
  }

  // ───────────────────────────────────────────────────────────── sugerencias de coincidencia

  /** Expira las propuestas de la ocurrencia (add-commitment-matching), en la unidad de trabajo del llamador. */
  private async expireSuggestions(
    workspaceId: string,
    occurrenceId: string,
    reason: ExpireReason,
    exceptId?: string,
  ): Promise<void> {
    const ids = await this.deps.matching.expireForOccurrences(workspaceId, [occurrenceId], reason, {
      ...(exceptId ? { exceptId } : {}),
    });
    this.deps.metrics?.increment('commitments_match_suggestions_total', { outcome: 'expired' }, ids.length);
  }

  private async expireTransactionSuggestions(
    workspaceId: string,
    transactionId: string,
    reason: ExpireReason,
    exceptId?: string,
  ): Promise<void> {
    const ids = await this.deps.matching.expireForTransaction(workspaceId, transactionId, reason, {
      ...(exceptId ? { exceptId } : {}),
    });
    this.deps.metrics?.increment('commitments_match_suggestions_total', { outcome: 'expired' }, ids.length);
  }

  // ───────────────────────────────────────────────────────────── liberar

  /**
   * Consumidor de `transactions.TransactionVoided.v1` (decisión 13): libera la ocurrencia resuelta con esa transacción
   * (vuelve a próxima o atrasada). Idempotente por estado: un segundo hecho no encuentra ocurrencia vinculada.
   */
  async onTransactionVoided(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
  }): Promise<boolean> {
    const { deps } = this;
    const { today } = await this.clockOf(input.workspaceId);
    return deps.uow.run(input.workspaceId, async () => {
      const found = await deps.occurrences.findByTransaction(input.workspaceId, input.transactionId);
      if (!found) return false;
      const occ = await this.lock(input.workspaceId, found.id);
      if (occ.snapshot.transactionId !== input.transactionId) return false;
      const def = await this.definitionOf(occ);
      // N7: anular desde transacciones no libera la cuota de un préstamo; la libera DEBT con `unsettle`.
      if (def.kind === 'LOAN_PAYMENT') return false;
      const before = occ.snapshot;
      const released = occ.release(today);
      await this.persist(occ);
      const after = occ.snapshot;
      const event = await publishEvent(
        deps,
        {
          workspaceId: after.workspaceId,
          aggregateType: OCCURRENCE_AGGREGATE,
          aggregateId: after.id,
          aggregateVersion: after.version,
        },
        COMMITMENTS_EVENTS.occurrenceChanged,
        {
          workspaceId: after.workspaceId,
          occurrenceId: after.id,
          definitionId: after.definitionId,
          managedBy: def.snapshot.managedBy,
          transition: 'RELEASE',
          status: after.status,
          dueDate: after.dueDate,
          expected: {
            type: after.expected.type,
            amount: after.expected.amount,
            min: after.expected.min,
            max: after.expected.max,
          },
          currency: after.currency,
          releasedTransactionId: released,
          reason: null,
        },
      );
      await deps.lifecycle.record(
        occurrenceEntry(occ, 'released', occurrenceChanges(before, after)),
        occurrenceSteps(occ, [event], { detailRefs: { releasedTransactionId: released } }),
      );
      return true;
    });
  }
}
