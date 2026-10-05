import type { AuditChangeInput, AuditPort } from '@pf/audit/contracts';
import type { ConversionCostDto, ReferenceRateDto } from '@pf/fx/contracts';
import { currency as makeCurrency, DomainError, Money, Rate, type Currency } from '@pf/shared-kernel';
import { TRANSACTION_EVENTS } from '../contracts/index.js';
import {
  deriveConversion,
  displayOrientation,
  priceConversion,
  Transaction,
  type ConversionAccount,
  type ConversionData,
  type ConversionDetail,
  type ConversionFeeSpec,
  type ConversionFeeType,
  type ConversionPricing,
  type CurrencyInfo,
  type ReferenceRateInfo,
  type TransactionState,
  type TransactionStatus,
} from '../domain/index.js';
import {
  legsPayload,
  linkEntry,
  postEntry,
  publishEvent,
  publishPosted,
  rateJson,
  exactRateValue,
  splitsAudit,
  splitsPayload,
  transactionSteps,
} from './posting-support.js';
import type { TransactionsDeps } from './ports/index.js';
import type { MoneyDto } from './transactions.service.js';

export interface RateDto {
  readonly base: string;
  readonly quote: string;
  readonly value: string;
}

export interface ConversionFeeDto {
  readonly type: ConversionFeeType;
  readonly amount: MoneyDto;
  readonly paidFromAccountId?: string | null;
  readonly categoryId?: string | null;
}

/** Cuerpo financiero común de `createConversion` y `amendConversion` (design.md § Contratos). */
export interface ConversionFields {
  readonly transactionDate: string;
  readonly postingDate?: string | null;
  readonly sourceAccountId: string;
  readonly targetAccountId: string;
  readonly sourceAmount: MoneyDto;
  readonly targetAmount: MoneyDto;
  readonly quotedRate?: RateDto | null;
  readonly referenceFxRateId?: string | null;
  readonly fees?: readonly ConversionFeeDto[];
  readonly provider?: { readonly counterpartyId?: string | null; readonly name?: string | null } | null;
  readonly executedAt: string;
  readonly externalRef?: string | null;
  readonly description?: string | null;
  readonly notes?: string | null;
}

export interface RecordConversionCommand extends ConversionFields {
  readonly workspaceId: string;
  readonly userId: string;
  readonly id?: string;
  readonly status?: 'PENDING' | 'POSTED' | 'CLEARED';
}

export interface AmendConversionCommand extends ConversionFields {
  readonly workspaceId: string;
  readonly userId: string;
  readonly transactionId: string;
  readonly expectedVersion: number;
  readonly reason?: string | null;
}

export interface PreviewConversionQuery {
  readonly workspaceId: string;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly sourceAmount?: MoneyDto | null;
  readonly targetAmount?: MoneyDto | null;
  readonly quotedRate?: RateDto | null;
  readonly fees?: readonly ConversionFeeDto[];
  readonly executedAt?: string | null;
  readonly referenceFxRateId?: string | null;
}

export interface ConversionPreview {
  readonly sourceAmount: Money;
  readonly convertedSourceAmount: Money;
  readonly grossTargetAmount: Money;
  readonly targetAmount: Money;
  readonly effectiveRate: Rate;
  readonly quotedRate: Rate | null;
  readonly referenceRate: ReferenceRateInfo | null;
  readonly spread: ConversionPricing['spread'];
  readonly quotedRateDeviation: Money | null;
  readonly totalCost: ConversionCostDto;
}

/** Conversión con su costo total derivado (no persistido; design.md decisión 3). */
export interface ConversionView {
  readonly transaction: TransactionState;
  readonly totalCost: ConversionCostDto | null;
}

export interface ConversionRevisionView {
  readonly revision: number;
  readonly journalEntryId: string | null;
  readonly active: boolean;
  readonly createdAt: string | null;
  readonly detail: ConversionDetail;
}

export interface ListConversionsQuery {
  readonly workspaceId: string;
  readonly sourceCurrency?: string;
  readonly targetCurrency?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly sort?: 'transactionDate' | '-transactionDate' | 'executedAt' | '-executedAt';
  readonly offset: number;
  readonly limit: number;
}

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `conversion ${id} not found`);

/**
 * Casos de uso de conversiones (transactions/conversions + fx/conversion-pricing; design.md decisiones 1–4, 7–10).
 * `RecordConversion` y `AmendConversion` corren en UNA unidad de trabajo: Accounts `FOR SHARE` (INV-026) →
 * Classification → referencia de FX (versión exacta, nunca cruzada) → agregado (INV-010) → ledger (INV-004) →
 * persistencia del `ConversionDetail` → outbox → auditoría (INV-029). `PreviewConversion` no tiene efectos.
 */
export class ConversionsService {
  constructor(
    private readonly deps: TransactionsDeps,
    private readonly audit: AuditPort = deps.audit,
  ) {}

  // ------------------------------------------------------------------ comandos

  recordConversion(cmd: RecordConversionCommand): Promise<ConversionView> {
    const { uow, ids } = this.deps;
    return uow.run(cmd.workspaceId, async () => {
      const data = await this.conversionData(cmd.workspaceId, cmd.userId, cmd);
      const tx = Transaction.recordConversion({
        id: cmd.id ?? ids.next(),
        workspaceId: cmd.workspaceId,
        status: cmd.status ?? 'POSTED',
        ...data,
      });
      let entryId: string | null = null;
      if (tx.needsEntry) {
        entryId = await postEntry(this.deps, tx);
        tx.attachEntry(entryId);
      }
      await this.deps.transactions.insert(tx);
      if (entryId) await linkEntry(this.deps, tx, entryId, 'POSTED');
      const s = tx.snapshot;
      const events = [
        await publishEvent(this.deps, tx, TRANSACTION_EVENTS.created, {
          transactionId: s.id,
          kind: s.kind,
          status: s.status,
          businessDate: s.businessDate,
          description: s.description,
          counterpartyId: s.counterpartyId,
          origin: { type: s.source, refId: null },
          legs: legsPayload(s),
          splits: splitsPayload(s),
          postingDate: s.postingDate,
          refundOfTransactionId: null,
          paymentMethod: null,
          transition: 'RECORD',
        }),
      ];
      if (entryId) events.push(...(await publishPosted(this.deps, tx, entryId, null, null)));
      await this.deps.lifecycle.record(
        {
          workspaceId: s.workspaceId,
          action: 'transactions.conversion.created',
          aggregateType: 'Transaction',
          aggregateId: s.id,
          aggregateVersion: s.version,
          changes: [
            { field: 'kind', before: null, after: s.kind },
            { field: 'status', before: null, after: s.status },
            { field: 'transactionDate', before: null, after: s.businessDate },
            ...detailChanges(null, s.conversion as ConversionDetail),
            ...(s.splits.length > 0 ? [{ field: 'splits', before: null, after: splitsAudit(s) }] : []),
            ...(s.description ? [{ field: 'description', before: null, after: s.description }] : []),
            ...(entryId ? [{ field: 'journalEntryId', before: null, after: entryId }] : []),
          ],
        },
        transactionSteps(tx, { events, journalEntries: { posted: entryId } }),
      );
      // Releer la fila: `created_at` lo fija la base al insertar; sin esto el 201 llevaba `createdAt` nulo (1970-01-01).
      const saved = ((await this.deps.transactions.findById(s.workspaceId, s.id)) ?? tx).snapshot;
      return { transaction: saved, totalCost: await this.totalCost(s.workspaceId, s.conversion ?? null) };
    });
  }

  /**
   * `AmendConversion` (FR-TRANSACTIONS-024, D11): reversa exacta del asiento activo + asiento nuevo + detalle con
   * `revision + 1`, en la misma transacción BD; el detalle y el asiento anteriores siguen consultables y la corrección
   * queda auditada con su motivo.
   */
  amendConversion(cmd: AmendConversionCommand): Promise<ConversionView> {
    const { workspaceId } = cmd;
    return this.deps.uow.run(workspaceId, async () => {
      const tx = await this.deps.transactions.findById(workspaceId, cmd.transactionId, { forUpdate: true });
      if (!tx || tx.snapshot.kind !== 'CONVERSION') throw notFound(cmd.transactionId);
      if (tx.version !== cmd.expectedVersion) {
        throw new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
          details: { currentVersion: tx.version },
        });
      }
      const reason = cmd.reason?.trim() || null;
      if (reason && reason.length > 500) {
        throw new DomainError('VALIDATION_FAILED', 'reason must be at most 500 characters').at('/reason');
      }
      const before = tx.snapshot;
      // INV-026: las cuentas del asiento vigente deben seguir activas para revertirlo.
      if (tx.needsEntry) {
        await this.deps.accounts.assertCanPost({
          workspaceId,
          accounts: [...new Set(before.legs.map((l) => l.accountId))].map((accountId) => ({ accountId })),
        });
      }
      const data = await this.conversionData(workspaceId, cmd.userId, cmd);
      const result = tx.amendConversion(data);
      let newEntryId: string | null = null;
      let reversalId: string | null = null;
      if (result.ledgerImpact && result.previousEntryId) {
        const reversal = await this.deps.ledger.reverseJournalEntry({
          workspaceId,
          journalEntryId: result.previousEntryId,
          reverseDate: before.businessDate,
          reason: reason ?? `conversion ${before.id} amended to revision ${tx.revision}`,
        });
        reversalId = reversal.journalEntryId;
        await this.deps.transactions.linkEntry({
          workspaceId,
          transactionId: before.id,
          revision: before.revision,
          journalEntryId: reversal.journalEntryId,
          linkType: 'REVERSAL',
        });
        newEntryId = await postEntry(this.deps, tx);
        tx.attachEntry(newEntryId);
      }
      if (!(await this.deps.transactions.update(tx))) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the transaction was modified concurrently');
      }
      if (newEntryId) await linkEntry(this.deps, tx, newEntryId, 'POSTED');
      const after = tx.snapshot;
      const transition = tx.lastTransition?.transition;
      const events = [
        await publishEvent(this.deps, tx, TRANSACTION_EVENTS.updated, {
          transactionId: after.id,
          revision: after.revision,
          status: after.status,
          previousStatus: after.status !== result.previousStatus ? result.previousStatus : null,
          changedFields: [...result.changedFields],
          ledgerImpact: result.ledgerImpact,
          reason,
          paymentMethod: after.paymentMethod,
          ...(transition ? { transition } : {}),
        }),
      ];
      if (newEntryId) {
        events.push(
          ...(await publishPosted(this.deps, tx, newEntryId, result.previousStatus, result.previousEntryId)),
        );
      }
      const auditEntry = {
        workspaceId,
        action: 'transactions.conversion.amended',
        aggregateType: 'Transaction',
        aggregateId: after.id,
        aggregateVersion: after.version,
        reason,
        changes: [
          { field: 'revision', before: before.revision, after: after.revision },
          ...(before.businessDate !== after.businessDate
            ? [{ field: 'transactionDate', before: before.businessDate, after: after.businessDate }]
            : []),
          ...(after.status !== before.status
            ? [{ field: 'status', before: before.status, after: after.status }]
            : []),
          ...detailChanges(before.conversion ?? null, after.conversion as ConversionDetail),
          { field: 'splits', before: splitsAudit(before), after: splitsAudit(after) },
          ...(newEntryId
            ? [{ field: 'journalEntryId', before: before.activeEntryId, after: newEntryId }]
            : []),
          ...(reversalId ? [{ field: 'reversalJournalEntryId', before: null, after: reversalId }] : []),
        ],
      };
      // Una conversión PENDING corregida incrementa la revisión sin asiento: anotación (no REVISE).
      await this.deps.lifecycle.record(
        auditEntry,
        transactionSteps(tx, {
          events,
          journalEntries: {
            reversed: reversalId ? result.previousEntryId : null,
            reversal: reversalId,
            posted: newEntryId,
          },
          changedFields: ['amount', 'transactionDate', 'accountId', 'splits'],
          revisionBefore: before.revision,
        }),
      );
      return { transaction: after, totalCost: await this.totalCost(workspaceId, after.conversion ?? null) };
    });
  }

  // ------------------------------------------------------------------ consultas

  /**
   * `PreviewConversion` (FR-TRANSACTIONS-025, Should): con dos de {entregado, recibido, cotizada} + fees calcula el
   * tercero, la efectiva, la referencia, el spread y el costo total con los MISMOS cálculos del registro. Sin efectos.
   */
  previewConversion(q: PreviewConversionQuery): Promise<ConversionPreview> {
    return this.deps.uow.run(q.workspaceId, async () => {
      const src = await this.currencyInfo(q.sourceCurrency, '/sourceCurrency');
      const tgt = await this.currencyInfo(q.targetCurrency, '/targetCurrency');
      const display = displayOrientation(src, tgt);
      const scale = (code: string) => this.scaleFor(code, [src, tgt]);
      const fees = [];
      for (const [i, f] of (q.fees ?? []).entries()) {
        fees.push({
          type: f.type,
          amount: await this.money(f.amount, `/fees/${i}/amount`, scale),
          paidFromAccountId: f.paidFromAccountId ?? null,
        });
      }
      const quoted = q.quotedRate ? await this.rate(q.quotedRate, '/quotedRate', scale) : null;
      const derived = deriveConversion({
        sourceCurrency: src.currency,
        targetCurrency: tgt.currency,
        sourceAmount: q.sourceAmount ? await this.money(q.sourceAmount, '/sourceAmount', scale) : null,
        targetAmount: q.targetAmount ? await this.money(q.targetAmount, '/targetAmount', scale) : null,
        quotedRate: quoted,
        fees,
        display,
      });
      const executedAt = q.executedAt ?? this.deps.clock.now().toString();
      const reference = await this.reference(
        q.workspaceId,
        src.currency.code,
        tgt.currency.code,
        executedAt,
        q.referenceFxRateId ?? null,
        scale,
      );
      const pricing = priceConversion({
        sourceAmount: derived.sourceAmount,
        targetAmount: derived.targetAmount,
        fees,
        quotedRate: derived.quotedRate,
        referenceRate: reference?.info.rate ?? null,
        display,
      });
      const totalCost = await this.deps.fx.conversionCost({
        workspaceId: q.workspaceId,
        executedAt,
        components: [
          ...fees.map((f) => f.amount.toJSON()),
          ...(pricing.spread ? [pricing.spread.amount.toJSON()] : []),
        ],
        reference: reference?.dto ?? null,
      });
      return {
        sourceAmount: derived.sourceAmount,
        convertedSourceAmount: pricing.convertedSource,
        grossTargetAmount: pricing.grossTarget,
        targetAmount: derived.targetAmount,
        effectiveRate: pricing.effectiveRate,
        quotedRate: derived.quotedRate,
        referenceRate: reference?.info ?? null,
        spread: pricing.spread,
        quotedRateDeviation: pricing.quotedRateDeviation,
        totalCost,
      };
    });
  }

  getConversion(workspaceId: string, transactionId: string): Promise<ConversionView> {
    return this.deps.uow.run(workspaceId, async () => {
      const tx = await this.deps.transactions.findById(workspaceId, transactionId);
      if (!tx || tx.snapshot.kind !== 'CONVERSION') throw notFound(transactionId);
      const s = tx.snapshot;
      return { transaction: s, totalCost: await this.totalCost(workspaceId, s.conversion ?? null) };
    });
  }

  listConversions(q: ListConversionsQuery): Promise<TransactionState[]> {
    return this.deps.uow.run(q.workspaceId, async () => {
      const found = await this.deps.transactions.list(
        q.workspaceId,
        {
          kinds: ['CONVERSION'],
          ...(q.sourceCurrency ? { currency: q.sourceCurrency } : {}),
          ...(q.targetCurrency ? { targetCurrency: q.targetCurrency } : {}),
          ...(q.dateFrom ? { dateFrom: q.dateFrom } : {}),
          ...(q.dateTo ? { dateTo: q.dateTo } : {}),
          // `executedAt` ordena como la fecha de negocio (design.md decisión 19).
          sort:
            q.sort === 'transactionDate' || q.sort === 'executedAt' ? 'transactionDate' : '-transactionDate',
        },
        { offset: q.offset, limit: q.limit },
      );
      return found.map((t) => t.snapshot);
    });
  }

  /** Revisiones del detalle (la más antigua primero), con el asiento POSTED de cada una y la vigente marcada. */
  listRevisions(workspaceId: string, transactionId: string): Promise<ConversionRevisionView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const tx = await this.deps.transactions.findById(workspaceId, transactionId);
      if (!tx || tx.snapshot.kind !== 'CONVERSION') throw notFound(transactionId);
      const revisions = await this.deps.transactions.conversionRevisions(workspaceId, transactionId);
      const entries = await this.deps.transactions.postedEntriesByRevision(workspaceId, transactionId);
      return revisions.map((r) => ({
        revision: r.detail.revision,
        journalEntryId: entries.get(r.detail.revision) ?? null,
        active: r.detail.revision === tx.revision,
        createdAt: r.createdAt,
        detail: r.detail,
      }));
    });
  }

  // ------------------------------------------------------------------ helpers

  /** Costo total derivado con la referencia REGISTRADA (nunca con tasas nuevas; INV-012). */
  private async totalCost(
    workspaceId: string,
    d: ConversionDetail | null,
  ): Promise<ConversionCostDto | null> {
    if (!d) return null;
    return this.deps.fx.conversionCost({
      workspaceId,
      executedAt: d.executedAt,
      components: [...d.fees.map((f) => f.amount.toJSON()), ...(d.spread ? [d.spread.amount.toJSON()] : [])],
      reference: d.referenceRate
        ? {
            fxRateId: d.referenceRate.fxRateId,
            rate: rateJson(d.referenceRate.rate, exactRateValue(d.referenceRate.rate)),
            rateType: (d.referenceRate.rateType ?? 'CUSTOM') as ReferenceRateDto['rateType'],
            source: d.referenceRate.source as ReferenceRateDto['source'],
            sourceLabel: null,
            asOf: d.referenceRate.asOf ?? d.executedAt,
          }
        : null,
    });
  }

  /** Valida cuentas, monedas, fees y clasificación y arma los datos financieros del agregado. */
  private async conversionData(
    workspaceId: string,
    userId: string,
    cmd: ConversionFields,
  ): Promise<ConversionData> {
    if (cmd.sourceAccountId === cmd.targetAccountId) {
      throw new DomainError('CONVERSION_SAME_CURRENCY', 'source and target are the same account').at(
        '/targetAccountId',
      );
    }
    const feeDtos = cmd.fees ?? [];
    const payers = [...new Set(feeDtos.flatMap((f) => (f.paidFromAccountId ? [f.paidFromAccountId] : [])))];
    const eligibility = await this.deps.accounts.assertCanPost({
      workspaceId,
      accounts: [cmd.sourceAccountId, cmd.targetAccountId, ...payers]
        .filter((id, i, all) => all.indexOf(id) === i)
        .map((accountId) => ({ accountId })),
    });
    const account = (id: string, pointer: string): ConversionAccount => {
      const a = eligibility.find((e) => e.accountId === id);
      if (!a) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at(pointer);
      return { accountId: a.accountId, nature: a.nature, currency: a.currency };
    };
    const sourceAccount = account(cmd.sourceAccountId, '/sourceAccountId');
    const targetAccount = account(cmd.targetAccountId, '/targetAccountId');
    if (sourceAccount.currency === targetAccount.currency) {
      throw new DomainError(
        'CONVERSION_SAME_CURRENCY',
        `both accounts are in ${sourceAccount.currency}; record a transfer instead`,
      ).at('/targetAccountId');
    }
    const src = await this.currencyInfo(sourceAccount.currency, '/sourceAccountId');
    const tgt = await this.currencyInfo(targetAccount.currency, '/targetAccountId');
    const scale = (code: string) => this.scaleFor(code, [src, tgt]);
    const sourceAmount = await this.money(cmd.sourceAmount, '/sourceAmount', scale);
    const targetAmount = await this.money(cmd.targetAmount, '/targetAmount', scale);
    let feesCategory: string | null = null;
    const explicitCategories = feeDtos.flatMap((f) => (f.categoryId ? [f.categoryId] : []));
    const counterpartyId = cmd.provider?.counterpartyId ?? null;
    if (explicitCategories.length > 0 || counterpartyId) {
      await this.deps.classification.validate({
        userId,
        workspaceId,
        ...(explicitCategories.length > 0
          ? {
              categoryIds: explicitCategories.map((categoryId) => ({
                categoryId,
                splitKind: 'EXPENSE' as const,
              })),
            }
          : {}),
        ...(counterpartyId ? { counterpartyId } : {}),
      });
    }
    const fees: ConversionFeeSpec[] = [];
    for (const [i, f] of feeDtos.entries()) {
      let categoryId = f.categoryId ?? null;
      if (!categoryId) {
        feesCategory ??= await this.deps.categories.fees(workspaceId);
        if (!feesCategory) {
          throw new DomainError('REFERENCE_NOT_FOUND', 'system category Fees is not provisioned').at(
            `/fees/${i}/categoryId`,
          );
        }
        categoryId = feesCategory;
      }
      fees.push({
        type: f.type,
        amount: await this.money(f.amount, `/fees/${i}/amount`, scale),
        paidFrom: f.paidFromAccountId ? account(f.paidFromAccountId, `/fees/${i}/paidFromAccountId`) : null,
        categoryId,
        splitId: this.deps.ids.next(),
      });
    }
    const quotedRate = cmd.quotedRate ? await this.rate(cmd.quotedRate, '/quotedRate', scale) : null;
    const reference = await this.reference(
      workspaceId,
      src.currency.code,
      tgt.currency.code,
      cmd.executedAt,
      cmd.referenceFxRateId ?? null,
      scale,
    );
    return {
      businessDate: cmd.transactionDate,
      ...(cmd.postingDate !== undefined ? { postingDate: cmd.postingDate } : {}),
      sourceAccount,
      targetAccount,
      sourceAmount,
      targetAmount,
      fees,
      quotedRate,
      referenceRate: reference?.info ?? null,
      display: displayOrientation(src, tgt),
      provider: { counterpartyId, name: cmd.provider?.name?.trim() || null },
      executedAt: cmd.executedAt,
      externalRef: cmd.externalRef ?? null,
      ...(cmd.description !== undefined ? { description: cmd.description } : {}),
      ...(cmd.notes !== undefined ? { notes: cmd.notes } : {}),
    };
  }

  /** Referencia de FX (versión exacta explícita o resuelta al `executedAt`; nunca cruzada). */
  private async reference(
    workspaceId: string,
    base: string,
    quote: string,
    executedAt: string,
    fxRateId: string | null,
    scale: (code: string) => Promise<Currency>,
  ): Promise<{ readonly info: ReferenceRateInfo; readonly dto: ReferenceRateDto } | null> {
    let dto: ReferenceRateDto | null;
    try {
      dto = await this.deps.fx.referenceForConversion({ workspaceId, base, quote, executedAt, fxRateId });
    } catch (err) {
      // Instante inválido: lo reporta la validación del agregado con su puntero (`/executedAt`).
      if (err instanceof DomainError && err.code === 'VALIDATION_FAILED') return null;
      throw err;
    }
    if (!dto) return null;
    return {
      dto,
      info: {
        fxRateId: dto.fxRateId,
        rate: Rate.of(await scale(dto.rate.base), await scale(dto.rate.quote), dto.rate.value),
        rateType: dto.rateType,
        source: dto.source,
        asOf: dto.asOf,
      },
    };
  }

  private async currencyInfo(code: string, pointer: string): Promise<CurrencyInfo> {
    const found = await this.deps.fx.currency(code);
    if (!found) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`).at(pointer);
    }
    return { currency: makeCurrency(found.code, found.scale), kind: found.kind };
  }

  private async scaleFor(code: string, known: readonly CurrencyInfo[]): Promise<Currency> {
    const hit = known.find((k) => k.currency.code === code);
    if (hit) return hit.currency;
    const scale = await this.deps.currencies.scaleOf(code);
    if (scale === null) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`);
    return makeCurrency(code, scale);
  }

  private async money(
    dto: MoneyDto,
    pointer: string,
    scale: (code: string) => Promise<Currency>,
  ): Promise<Money> {
    let cur: Currency;
    try {
      cur = await scale(dto.currency);
    } catch (err) {
      throw err instanceof DomainError ? err.at(`${pointer}/currency`) : err;
    }
    try {
      return Money.parse(dto.amount, cur);
    } catch (err) {
      throw err instanceof DomainError ? err.at(`${pointer}/amount`) : err;
    }
  }

  private async rate(
    dto: RateDto,
    pointer: string,
    scale: (code: string) => Promise<Currency>,
  ): Promise<Rate> {
    let base: Currency;
    let quote: Currency;
    try {
      base = await scale(dto.base);
      quote = await scale(dto.quote);
    } catch (err) {
      throw err instanceof DomainError ? err.at(pointer) : err;
    }
    try {
      return Rate.of(base, quote, dto.value);
    } catch (err) {
      // INVALID_RATE del shared-kernel (≤ 0 o base = quote) ⇒ error de validación del contrato.
      if (err instanceof DomainError) throw new DomainError('VALIDATION_FAILED', err.message).at(pointer);
      throw err;
    }
  }
}

/** Cambios auditables de un `ConversionDetail` (allow-list `TRANSACTIONS_AUDIT_POLICY`). */
function detailChanges(before: ConversionDetail | null, after: ConversionDetail): AuditChangeInput[] {
  const view = (d: ConversionDetail | null) =>
    d && {
      accountId: d.sourceAccountId,
      toAccountId: d.targetAccountId,
      amount: d.sourceAmount,
      targetAmount: d.targetAmount,
      convertedSourceAmount: d.convertedSourceAmount,
      grossTargetAmount: d.grossTargetAmount,
      // Objetos como JSON canónico: la auditoría solo admite valores planos o `Money`.
      quotedRate: d.quotedRate ? JSON.stringify(rateJson(d.quotedRate, exactRateValue(d.quotedRate))) : null,
      effectiveRate: JSON.stringify(rateJson(d.effectiveRate)),
      referenceFxRateId: d.referenceRate?.fxRateId ?? null,
      spread: d.spread
        ? JSON.stringify({ percentage: d.spread.percentage, amount: d.spread.amount.toJSON() })
        : null,
      quotedRateDeviation: d.quotedRateDeviation,
      conversionFees: JSON.stringify(
        d.fees.map((f) => ({
          type: f.type,
          amount: f.amount.toJSON(),
          paidFromAccountId: f.paidFromAccountId,
        })),
      ),
      provider: JSON.stringify(d.provider),
      executedAt: d.executedAt,
      externalRef: d.externalRef,
    };
  const a = view(after) as NonNullable<ReturnType<typeof view>>;
  const b = view(before);
  const same = (x: unknown, y: unknown) =>
    JSON.stringify(x, (_k, v: unknown) => (v instanceof Money ? v.toJSON() : v)) ===
    JSON.stringify(y, (_k, v: unknown) => (v instanceof Money ? v.toJSON() : v));
  return (Object.keys(a) as (keyof typeof a)[]).flatMap((field) => {
    const prev = b ? b[field] : null;
    if (b && same(prev, a[field])) return [];
    if (!b && (a[field] === null || a[field] === undefined)) return [];
    return [{ field, before: prev ?? null, after: a[field] }];
  });
}

export type { TransactionStatus };
