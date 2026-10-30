import type { AuditEntry, LifecycleEventRefDto, LifecycleStepInput } from '@pf/audit/contracts';
import { currency as makeCurrency, DomainError, Money } from '@pf/shared-kernel';
import {
  IMPORT_ROW_NAMESPACE,
  TRANSACTION_EVENTS,
  type ImportedTransactionRowDto,
  type ImportedTransactionsCommand,
} from '../contracts/index.js';
import { Transaction } from '../domain/index.js';
import { createdAuditChanges, createdEventPayload } from './created-support.js';
import { journalCommandOf, publishEvent, publishPosted, transactionSteps } from './posting-support.js';
import type { ImportedRefReader, OutboxEvent, TransactionsDeps } from './ports/index.js';

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
export class RecordImportedTransactions implements ImportedTransactionsCommand {
  constructor(
    private readonly deps: TransactionsDeps,
    private readonly refs: ImportedRefReader,
  ) {}

  async recordBatch(input: Parameters<ImportedTransactionsCommand['recordBatch']>[0]) {
    if (input.rows.length > MAX_BATCH_ROWS) {
      throw new DomainError('VALIDATION_FAILED', `a batch has at most ${MAX_BATCH_ROWS} rows`);
    }
    const { workspaceId, accountId } = input;
    return await this.deps.uow.run(workspaceId, async () => {
      for (const row of input.rows) {
        if (row.externalRef.namespace !== IMPORT_ROW_NAMESPACE) {
          throw new DomainError('VALIDATION_FAILED', 'externalRef.namespace must be imports.csv-row').at(
            '/externalRef/namespace',
          );
        }
      }
      await this.refs.lockAccount({ workspaceId, accountId });
      const existing = await this.refs.existingByRefs({
        workspaceId,
        accountId,
        namespace: IMPORT_ROW_NAMESPACE,
        ids: input.rows.map((r) => r.externalRef.id),
      });
      const alreadyExisting: { rowRef: string; transactionId: string }[] = [];
      const fresh: ImportedTransactionRowDto[] = [];
      const seen = new Set<string>();
      for (const row of input.rows) {
        const known = existing.get(row.externalRef.id);
        if (known !== undefined) {
          alreadyExisting.push({ rowRef: row.rowRef, transactionId: known });
          continue;
        }
        // Dos filas del mismo lote con la misma huella no existen (el ordinal de ocurrencia las distingue).
        if (seen.has(row.externalRef.id)) {
          throw new DomainError('VALIDATION_FAILED', 'the batch repeats a row reference').at('/rows');
        }
        seen.add(row.externalRef.id);
        fresh.push(row);
      }
      if (fresh.length === 0) return { created: [], alreadyExisting };

      const txs = await this.build(input, fresh);
      await this.persist(txs);
      return {
        created: fresh.map((row, i) => ({ rowRef: row.rowRef, transactionId: (txs[i] as Transaction).id })),
        alreadyExisting,
      };
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
    // Campos personalizados obligatorios (FR-TRANSACTIONS-026): el mismo resultado para todas las filas (ninguna
    // trae valores), así que se valida una vez con la forma de un split sin valores.
    await classification.validateCustomFieldValues({
      userId: input.actorUserId,
      workspaceId,
      target: 'TRANSACTION',
      requireMandatory: true,
      items: [{ pointer: '/splits/0/customFields', values: [], existingFieldIds: [] }],
    });
    // Categorías de sistema (D9): una lectura por tipo presente en el lote.
    const defaults = new Map<'EXPENSE' | 'INCOME', string | null>();
    for (const kind of new Set<'EXPENSE' | 'INCOME'>(
      rows.map((r) => (r.direction === 'OUT' ? 'EXPENSE' : 'INCOME')),
    )) {
      defaults.set(kind, await categories.uncategorized(workspaceId, kind));
    }
    return rows.map((row) => {
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
