import type { AuditEntry, LifecycleEventRefDto, LifecycleStepInput } from '@pf/audit/contracts';
import { currency as makeCurrency, DomainError, Money } from '@pf/shared-kernel';
import {
  isImportRefNamespace,
  TRANSACTION_EVENTS,
  type ImportedTransactionRowDto,
  type ImportedTransactionsCommand,
} from '../contracts/index.js';
import { splitKindOf, Transaction, type CustomFieldValue, type SplitInput } from '../domain/index.js';
import type { ConversionsService } from './conversions.service.js';
import { createdAuditChanges, createdEventPayload } from './created-support.js';
import {
  buildEvent,
  journalCommandOf,
  legsPayload,
  linkEntry,
  publishEvent,
  publishPosted,
  splitsPayload,
  transactionSteps,
} from './posting-support.js';
import type { ImportedRefReader, OutboxEvent, TransactionsDeps } from './ports/index.js';
import type { TransactionsService } from './transactions.service.js';

/** Tope de filas por lote (la persistencia de IMPORTS usa 200). */
const MAX_BATCH_ROWS = 1000;

/**
 * `RecordImportedTransactions` (docs/13 §1 y §4.1; openspec add-bulk-imported-transactions): implementación de
 * `ImportedTransactionsCommand.recordBatch` que escribe POR CONJUNTO en la unidad de trabajo del llamador (una
 * transacción de BD por lote). El efecto observable es el de registrar cada fila con `recordTransaction`
 * (`source = IMPORT`, estado `POSTED`; salida ⇒ gasto «sin categoría», entrada ⇒ ingreso «ingreso sin categoría», D9):
 * mismo agregado `Transaction`, mismo traductor al ledger, mismos eventos, misma auditoría y mismo recorrido. Solo
 * cambia cómo se valida y persiste (decisiones 1–3): una validación de cuenta, moneda, escala, categorías y campos
 * obligatorios por lote; los periodos cerrados los valida el ledger por conjunto; y sentencias multi-fila para
 * transacciones, splits, legs, vínculos, asientos, auditoría, recorrido y outbox.
 *
 * Orden: transacciones (agregados en memoria) → asientos y movimientos (`postJournalEntries`) → transacciones, splits,
 * legs y vínculos (`insertMany`) → eventos propios → auditoría y recorrido. Un error de dominio de cualquier fila
 * rechaza el lote completo con el mismo código que el camino individual.
 *
 * Idempotencia (INV-014): las filas cuya referencia ya tiene una transacción no anulada se informan en
 * `alreadyExisting` y no se crean. Dos lotes de la misma cuenta se serializan con un candado transaccional
 * (`ImportedRefReader.lockAccount`): el segundo ve las referencias del primero (TC-TRANSACTIONS-BULKIMPORT-004); el
 * índice único parcial `transaction_import_ref_uk` sigue como barrera.
 */
/** Servicios que crean transferencias y conversiones dentro del lote (add-import-pipeline decisión 12). */
export interface ImportedMovementServices {
  readonly transfers?: Pick<TransactionsService, 'recordTransfer'>;
  readonly conversions?: Pick<ConversionsService, 'recordConversion'>;
}

const refKey = (ref: { readonly namespace: string; readonly id: string }) => `${ref.namespace}|${ref.id}`;

export class RecordImportedTransactions implements ImportedTransactionsCommand {
  constructor(
    private readonly deps: TransactionsDeps,
    private readonly refs: ImportedRefReader,
    private readonly services: ImportedMovementServices = {},
  ) {}

  async recordBatch(input: Parameters<ImportedTransactionsCommand['recordBatch']>[0]) {
    if (input.rows.length > MAX_BATCH_ROWS) {
      throw new DomainError('VALIDATION_FAILED', `a batch has at most ${MAX_BATCH_ROWS} rows`);
    }
    const { workspaceId, accountId } = input;
    return await this.deps.uow.run(workspaceId, async () => {
      for (const [i, row] of input.rows.entries()) this.assertRow(row, `/rows/${i}`);
      await this.refs.lockAccount({ workspaceId, accountId });
      // Una lectura por espacio de nombres distinto (`imports.csv-row`, `imports.ext:<FORMAT>`).
      const existing = new Map<string, string>();
      for (const namespace of new Set(input.rows.map((r) => r.externalRef.namespace))) {
        const found = await this.refs.existingByRefs({
          workspaceId,
          accountId,
          namespace,
          ids: input.rows.filter((r) => r.externalRef.namespace === namespace).map((r) => r.externalRef.id),
        });
        for (const [id, transactionId] of found) existing.set(`${namespace}|${id}`, transactionId);
      }
      const alreadyExisting: { rowRef: string; transactionId: string }[] = [];
      const fresh: ImportedTransactionRowDto[] = [];
      const seen = new Set<string>();
      for (const row of input.rows) {
        const key = refKey(row.externalRef);
        const known = existing.get(key);
        if (known !== undefined) {
          alreadyExisting.push({ rowRef: row.rowRef, transactionId: known });
          continue;
        }
        // Dos filas del mismo lote con la misma referencia no existen (el ordinal de ocurrencia las distingue).
        if (seen.has(key)) {
          throw new DomainError('VALIDATION_FAILED', 'the batch repeats a row reference').at('/rows');
        }
        seen.add(key);
        fresh.push(row);
      }
      if (fresh.length === 0) return { created: [], alreadyExisting };

      const simple = fresh.filter((r) => r.kind !== 'TRANSFER' && r.kind !== 'CONVERSION');
      const txs = simple.length > 0 ? await this.build(input, simple) : [];
      if (txs.length > 0) await this.persist(txs);
      const createdOf = new Map(simple.map((row, i) => [row.rowRef, (txs[i] as Transaction).id] as const));
      // Transferencias y conversiones: por los servicios existentes, dentro de la misma unidad de trabajo.
      for (const row of fresh) {
        if (row.kind === 'TRANSFER') createdOf.set(row.rowRef, await this.recordTransfer(input, row));
        else if (row.kind === 'CONVERSION')
          createdOf.set(row.rowRef, await this.recordConversion(input, row));
      }
      return {
        created: fresh.map((row) => ({
          rowRef: row.rowRef,
          transactionId: createdOf.get(row.rowRef) as string,
        })),
        alreadyExisting,
      };
    });
  }

  private assertRow(row: ImportedTransactionRowDto, pointer: string): void {
    if (!isImportRefNamespace(row.externalRef.namespace)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'externalRef.namespace must be imports.csv-row or imports.ext:<FORMAT>',
      ).at(`${pointer}/externalRef/namespace`);
    }
    const kind = row.kind;
    if (kind === undefined) return;
    if (kind === 'EXPENSE' && row.direction !== 'OUT') {
      throw new DomainError('VALIDATION_FAILED', 'an EXPENSE row must be an outflow').at(`${pointer}/kind`);
    }
    if (kind === 'INCOME' && row.direction !== 'IN') {
      throw new DomainError('VALIDATION_FAILED', 'an INCOME row must be an inflow').at(`${pointer}/kind`);
    }
    if (kind === 'TRANSFER' && !row.transfer) {
      throw new DomainError('VALIDATION_FAILED', 'a TRANSFER row needs transfer.counterAccountId').at(
        `${pointer}/transfer`,
      );
    }
    if (kind === 'CONVERSION' && !row.conversion) {
      throw new DomainError('VALIDATION_FAILED', 'a CONVERSION row needs conversion data').at(
        `${pointer}/conversion`,
      );
    }
  }

  private async recordTransfer(
    input: Parameters<ImportedTransactionsCommand['recordBatch']>[0],
    row: ImportedTransactionRowDto,
  ): Promise<string> {
    const transfers = this.services.transfers;
    if (!transfers) throw new DomainError('INTERNAL_ERROR', 'transfers are not wired for imports');
    const counter = (row.transfer as { counterAccountId: string }).counterAccountId;
    const out = row.direction === 'OUT';
    const created = await transfers.recordTransfer({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      status: 'POSTED',
      transactionDate: row.date,
      fromAccountId: out ? input.accountId : counter,
      toAccountId: out ? counter : input.accountId,
      amount: row.amount,
      description: row.classification?.description ?? row.description,
      ...(row.classification?.notes !== undefined ? { notes: row.classification.notes } : {}),
      source: 'IMPORT',
      externalRef: row.externalRef,
      importJobId: input.importJobId,
    });
    return created.id;
  }

  private async recordConversion(
    input: Parameters<ImportedTransactionsCommand['recordBatch']>[0],
    row: ImportedTransactionRowDto,
  ): Promise<string> {
    const conversions = this.services.conversions;
    if (!conversions) throw new DomainError('INTERNAL_ERROR', 'conversions are not wired for imports');
    const conv = row.conversion as NonNullable<ImportedTransactionRowDto['conversion']>;
    const out = row.direction === 'OUT';
    const view = await conversions.recordConversion({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      status: 'POSTED',
      transactionDate: row.date,
      sourceAccountId: out ? input.accountId : conv.counterAccountId,
      targetAccountId: out ? conv.counterAccountId : input.accountId,
      sourceAmount: out ? row.amount : conv.counterAmount,
      targetAmount: out ? conv.counterAmount : row.amount,
      ...(conv.quotedRate ? { quotedRate: conv.quotedRate } : {}),
      ...(conv.fee ? { fees: [{ type: 'PROVIDER' as const, amount: conv.fee }] } : {}),
      executedAt: conv.executedAt,
      externalRef: row.externalRef.id,
      description: row.classification?.description ?? row.description,
      ...(row.classification?.notes !== undefined ? { notes: row.classification.notes } : {}),
      origin: 'IMPORT',
      transactionRef: row.externalRef,
      importJobId: input.importJobId,
    });
    return view.transaction.id;
  }

  /**
   * Deshacer (add-import-pipeline decisión 15): anula por conjunto las transacciones del import. Las ya anuladas se
   * informan; las reconciliadas, en periodo cerrado o de cuenta cerrada quedan `blocked` (con `allowBlocked`) o
   * rechazan el conjunto con el primer error. La reversa de los asientos es exacta y por conjunto (INV-008).
   */
  async voidBatch(input: Parameters<ImportedTransactionsCommand['voidBatch']>[0]) {
    if (input.transactionIds.length > MAX_BATCH_ROWS) {
      throw new DomainError('VALIDATION_FAILED', `a batch has at most ${MAX_BATCH_ROWS} transactions`);
    }
    const { workspaceId } = input;
    return await this.deps.uow.run(workspaceId, async () => {
      const { transactions, ledger, accounts, outbox, lifecycle } = this.deps;
      const found = await transactions.findMany(workspaceId, input.transactionIds);
      const alreadyVoided: string[] = [];
      const blocked: { transactionId: string; code: string }[] = [];
      const candidates: Transaction[] = [];
      const block = (transactionId: string, code: string) => {
        if (!input.allowBlocked) throw new DomainError(code, `transaction ${transactionId} cannot be voided`);
        blocked.push({ transactionId, code });
      };
      for (const id of input.transactionIds) {
        const tx = found.get(id);
        if (!tx || tx.snapshot.importJobId !== input.importJobId) {
          throw new DomainError('REFERENCE_NOT_FOUND', `transaction ${id} does not belong to the import`);
        }
        if (tx.snapshot.status === 'VOIDED') alreadyVoided.push(id);
        else if (tx.snapshot.status === 'RECONCILED') block(id, 'TRANSACTION_RECONCILED');
        else candidates.push(tx);
      }
      // Cuentas activas (INV-026) y periodos abiertos: una comprobación por cuenta y por fecha distintas.
      const closedAccounts = new Map<string, string>();
      for (const accountId of new Set(candidates.flatMap((t) => t.snapshot.legs.map((l) => l.accountId)))) {
        try {
          await accounts.assertCanPost({ workspaceId, accounts: [{ accountId }] });
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
          closedAccounts.set(accountId, err.code);
        }
      }
      const closedDates = new Set<string>();
      for (const date of new Set(candidates.map((t) => t.snapshot.businessDate))) {
        try {
          await ledger.assertPeriodOpen({ workspaceId, date });
        } catch (err) {
          if (!(err instanceof DomainError) || err.code !== 'PERIOD_CLOSED') throw err;
          closedDates.add(date);
        }
      }
      const toVoid: Transaction[] = [];
      for (const tx of candidates) {
        const s = tx.snapshot;
        const accountCode = s.legs.map((l) => closedAccounts.get(l.accountId)).find((c) => c !== undefined);
        if (accountCode) block(s.id, accountCode);
        else if (closedDates.has(s.businessDate)) block(s.id, 'PERIOD_CLOSED');
        else toVoid.push(tx);
      }
      if (toVoid.length === 0) return { voided: [], alreadyVoided, blocked };

      const reason = input.reason.trim();
      const now = this.deps.clock.now().toString();
      const outcomes = toVoid.map((tx) => ({ tx, ...tx.void(reason, now) }));
      const withEntry = outcomes.filter((o) => o.entryToReverse !== null);
      const reversals = await ledger.reverseJournalEntries(
        withEntry.map((o) => ({
          workspaceId,
          journalEntryId: o.entryToReverse as string,
          reverseDate: o.tx.snapshot.businessDate,
          reason,
        })),
      );
      const reversalOf = new Map(
        withEntry.map((o, i) => [o.tx.id, (reversals[i] as { journalEntryId: string }).journalEntryId]),
      );
      const collected: OutboxEvent[] = [];
      const items: { entry: AuditEntry; steps: LifecycleStepInput[] }[] = [];
      for (const o of outcomes) {
        const reversalId = reversalOf.get(o.tx.id) ?? null;
        if (!(await transactions.update(o.tx))) {
          throw new DomainError('CONCURRENCY_CONFLICT', 'the transaction was modified concurrently');
        }
        if (reversalId) await linkEntry(this.deps, o.tx, reversalId, 'REVERSAL');
        const s = o.tx.snapshot;
        const built = buildEvent(this.deps, o.tx, TRANSACTION_EVENTS.voided, {
          transactionId: s.id,
          kind: s.kind,
          businessDate: s.businessDate,
          previousStatus: o.previousStatus,
          reversalJournalEntryId: reversalId,
          reason: s.voidReason,
          legs: legsPayload(s),
          splits: splitsPayload(s),
          transition: 'VOID',
        });
        collected.push(built.record);
        items.push({
          entry: {
            workspaceId,
            action: 'transactions.transaction.voided',
            aggregateType: 'Transaction',
            aggregateId: s.id,
            aggregateVersion: s.version,
            reason: s.voidReason,
            changes: [
              { field: 'status', before: o.previousStatus, after: 'VOIDED' },
              ...(reversalId
                ? [{ field: 'journalEntryId', before: o.entryToReverse, after: reversalId }]
                : []),
            ],
          },
          steps: transactionSteps(o.tx, {
            events: [built.ref],
            journalEntries: { reversed: reversalId ? o.entryToReverse : null, reversal: reversalId },
          }),
        });
      }
      if (outbox.appendMany) await outbox.appendMany(collected);
      else for (const e of collected) await outbox.append(e);
      if (lifecycle.recordMany) await lifecycle.recordMany(items);
      else for (const item of items) await lifecycle.record(item.entry, item.steps);
      return { voided: toVoid.map((t) => t.id), alreadyVoided, blocked };
    });
  }

  /** Validación por conjunto y agregados en memoria, con las mismas reglas de dominio que `recordTransaction`. */
  private async build(
    input: Parameters<ImportedTransactionsCommand['recordBatch']>[0],
    rows: readonly ImportedTransactionRowDto[],
  ): Promise<Transaction[]> {
    const { accounts, currencies, classification, categories, ids } = this.deps;
    const { workspaceId, accountId } = input;
    // Una elegibilidad por moneda distinta (cuenta activa, no archivada, moneda de la cuenta; INV-026).
    const currencyCodes = [...new Set(rows.map((r) => r.amount.currency))];
    const eligibilities = await accounts.assertCanPost({
      workspaceId,
      accounts: currencyCodes.map((currency) => ({ accountId, currency })),
    });
    const eligibilityOf = new Map(currencyCodes.map((code, i) => [code, eligibilities[i]] as const));
    if ([...eligibilityOf.values()].some((e) => !e)) {
      throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/accountId');
    }
    // Escala de cada moneda (una consulta por moneda distinta).
    const scales = new Map<string, number>();
    for (const code of currencyCodes) {
      const scale = await currencies.scaleOf(code);
      if (scale === null) {
        throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`).at(
          '/amount/currency',
        );
      }
      scales.set(code, scale);
    }
    // Campos personalizados obligatorios (FR-TRANSACTIONS-026): el mismo resultado para todas las filas sin valores, así
    // que se valida una vez con la forma de un split sin valores.
    if (rows.some((r) => !r.classification)) {
      await classification.validateCustomFieldValues({
        userId: input.actorUserId,
        workspaceId,
        target: 'TRANSACTION',
        requireMandatory: true,
        items: [{ pointer: '/splits/0/customFields', values: [], existingFieldIds: [] }],
      });
    }
    // Clasificación decidida de las filas (add-rule-engine decisión 4): referencias validadas UNA vez por lote.
    const customFieldsOf = await this.validateClassifications(input, rows);
    // Categorías de sistema (D9): una lectura por tipo presente en el lote.
    const defaults = new Map<'EXPENSE' | 'INCOME', string | null>();
    for (const kind of new Set<'EXPENSE' | 'INCOME'>(
      rows.map((r) => (r.direction === 'OUT' ? 'EXPENSE' : 'INCOME')),
    )) {
      defaults.set(kind, await categories.uncategorized(workspaceId, kind));
    }
    return rows.map((row, index) => {
      const eligibility = eligibilityOf.get(row.amount.currency)!;
      const kind = row.direction === 'OUT' ? 'EXPENSE' : 'INCOME';
      let amount: Money;
      try {
        amount = Money.parse(
          row.amount.amount,
          makeCurrency(row.amount.currency, scales.get(row.amount.currency) as number),
        );
      } catch (err) {
        throw err instanceof DomainError ? err.at('/amount/amount') : err;
      }
      const c = row.classification;
      if (c) {
        const categoryId = c.categoryId ?? defaults.get(kind) ?? null;
        if (!categoryId) {
          throw new DomainError('REFERENCE_NOT_FOUND', 'system category Uncategorized is not provisioned').at(
            `/rows/${index}/classification/categoryId`,
          );
        }
        const split: SplitInput = {
          id: ids.next(),
          amount,
          categoryId,
          tagIds: c.tagIds,
          customFields: customFieldsOf.get(index) ?? [],
          categoryOrigin: c.categoryOrigin,
          categoryRule: c.categoryOrigin === 'RULE' ? (c.categoryRule ?? null) : null,
          ruleRefs: c.ruleRefs,
        };
        return Transaction.record({
          id: ids.next(),
          workspaceId,
          kind,
          status: 'POSTED',
          businessDate: row.date,
          accountId,
          accountNature: eligibility.nature,
          accountCurrency: eligibility.currency,
          amount,
          description: c.description ?? row.description ?? null,
          notes: c.notes ?? null,
          counterpartyId: c.counterpartyId,
          source: 'IMPORT',
          externalRef: row.externalRef,
          importJobId: input.importJobId,
          splits: [split],
          ...(c.needsReview
            ? {
                review: {
                  reason: 'RULE' as const,
                  rule: c.needsReview,
                  at: this.deps.clock.now().toString(),
                },
              }
            : {}),
        });
      }
      return Transaction.record({
        id: ids.next(),
        workspaceId,
        kind,
        status: 'POSTED',
        businessDate: row.date,
        accountId,
        accountNature: eligibility.nature,
        accountCurrency: eligibility.currency,
        amount,
        description: row.description ?? null,
        source: 'IMPORT',
        externalRef: row.externalRef,
        importJobId: input.importJobId,
        defaultCategoryId: defaults.get(kind) ?? null,
        defaultSplitId: ids.next(),
      });
    });
  }

  /**
   * Valida por CONJUNTO las referencias de la clasificación de todas las filas (una llamada de categorías y etiquetas,
   * una por contraparte distinta y una de campos personalizados) y devuelve los valores de campos de cada fila (por
   * índice). Un error de dominio rechaza el lote con el mismo código que el camino individual.
   */
  private async validateClassifications(
    input: Parameters<ImportedTransactionsCommand['recordBatch']>[0],
    rows: readonly ImportedTransactionRowDto[],
  ): Promise<Map<number, readonly CustomFieldValue[]>> {
    const { classification } = this.deps;
    const { workspaceId, actorUserId: userId } = input;
    const classified = rows.flatMap((row, index) =>
      row.classification ? [{ row, index, c: row.classification }] : [],
    );
    const out = new Map<number, readonly CustomFieldValue[]>();
    if (classified.length === 0) return out;
    for (const { c, index } of classified) {
      if (c.categoryId === null && c.categoryOrigin !== 'SYSTEM_DEFAULT') {
        throw new DomainError('VALIDATION_FAILED', 'a classified category needs its categoryId').at(
          `/rows/${index}/classification/categoryId`,
        );
      }
      if (c.categoryId !== null && c.categoryOrigin === 'SYSTEM_DEFAULT') {
        throw new DomainError('VALIDATION_FAILED', 'SYSTEM_DEFAULT means no category').at(
          `/rows/${index}/classification/categoryOrigin`,
        );
      }
      if (c.categoryOrigin === 'RULE' && !c.categoryRule) {
        throw new DomainError('VALIDATION_FAILED', 'a rule category needs its rule and version').at(
          `/rows/${index}/classification/categoryRule`,
        );
      }
    }
    const categories = new Map<string, { categoryId: string; splitKind: 'EXPENSE' | 'INCOME' }>();
    for (const { row, c } of classified) {
      if (c.categoryId === null) continue;
      const splitKind = splitKindOf(row.direction === 'OUT' ? 'EXPENSE' : 'INCOME') as 'EXPENSE' | 'INCOME';
      categories.set(`${c.categoryId}:${splitKind}`, { categoryId: c.categoryId, splitKind });
    }
    const tagIds = [...new Set(classified.flatMap(({ c }) => c.tagIds))];
    if (categories.size > 0 || tagIds.length > 0) {
      await classification.validate({
        userId,
        workspaceId,
        ...(categories.size > 0 ? { categoryIds: [...categories.values()] } : {}),
        ...(tagIds.length > 0 ? { tagIds } : {}),
      });
    }
    for (const counterpartyId of new Set(
      classified.flatMap(({ c }) => (c.counterpartyId ? [c.counterpartyId] : [])),
    )) {
      await classification.validate({ userId, workspaceId, counterpartyId });
    }
    const results = await classification.validateCustomFieldValues({
      userId,
      workspaceId,
      target: 'TRANSACTION',
      requireMandatory: true,
      items: classified.map(({ index, c }) => ({
        pointer: `/rows/${index}/classification/customFields`,
        values: c.customFields,
        existingFieldIds: [],
      })),
    });
    classified.forEach(({ index }, i) => {
      out.set(
        index,
        (results[i]?.set ?? []).map((v): CustomFieldValue => ({
          fieldId: v.fieldId,
          key: v.key,
          valueType: v.valueType,
          value: v.value,
        })),
      );
    });
    return out;
  }

  private async persist(txs: readonly Transaction[]): Promise<void> {
    const { ledger, transactions, lifecycle, outbox } = this.deps;
    // Asientos de todo el lote en una llamada: el ledger valida cuadre, escala, moneda y periodos cerrados.
    const posted = await ledger.postJournalEntries(txs.map((tx) => journalCommandOf(tx)));
    const links = txs.map((tx, i) => {
      const entryId = (posted[i] as { journalEntryId: string }).journalEntryId;
      tx.attachEntry(entryId);
      return {
        transactionId: tx.id,
        revision: tx.revision,
        journalEntryId: entryId,
        linkType: 'POSTED' as const,
      };
    });
    await transactions.insertMany(txs, links);

    // Eventos: se reúnen con los mismos constructores del camino individual y se escriben en una sola operación.
    const collected: OutboxEvent[] = [];
    const collector = { ...this.deps, outbox: { append: async (e: OutboxEvent) => void collected.push(e) } };
    const items: { entry: AuditEntry; steps: LifecycleStepInput[] }[] = [];
    for (const tx of txs) {
      const s = tx.snapshot;
      const entryId = s.activeEntryId;
      const events: LifecycleEventRefDto[] = [
        await publishEvent(collector, tx, TRANSACTION_EVENTS.created, createdEventPayload(s)),
      ];
      if (entryId) events.push(...(await publishPosted(collector, tx, entryId, null, null)));
      items.push({
        entry: {
          workspaceId: s.workspaceId,
          action: 'transactions.transaction.created',
          aggregateType: 'Transaction',
          aggregateId: s.id,
          aggregateVersion: s.version,
          changes: createdAuditChanges(s, entryId),
          reason: s.adjustmentReason,
        },
        steps: transactionSteps(tx, { events, journalEntries: { posted: entryId } }),
      });
    }
    if (outbox.appendMany) await outbox.appendMany(collected);
    else for (const e of collected) await outbox.append(e);
    if (lifecycle.recordMany) await lifecycle.recordMany(items);
    else for (const item of items) await lifecycle.record(item.entry, item.steps);
  }
}
