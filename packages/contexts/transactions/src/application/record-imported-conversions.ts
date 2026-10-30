import { DomainError } from '@pf/shared-kernel';
import { isImportRefNamespace, type ImportedConversionsCommand } from '../contracts/index.js';
import type { ConversionsService } from './conversions.service.js';
import type { ImportedRefReader, TransactionsDeps } from './ports/index.js';

/** Tope de conversiones por llamada (las conversiones son pocas: cada una es un asiento y un detalle propios). */
const MAX_CONVERSIONS = 200;

/**
 * `ImportedConversionsCommand.recordBatch` (add-import-pipeline decisión 12; lo comparte `add-banking-providers`):
 * cada conversión corre por `ConversionsService.recordConversion` —referencia de FX resuelta al `executedAt`, detalle
 * inmutable, asiento propio con patas `EQUITY:FX_TRADING`— dentro de la unidad de trabajo del llamador, con
 * `source = IMPORT`, `import_job_id` y la referencia externa en la transacción. Idempotente por `externalRef`
 * (INV-014): una referencia que ya tiene una transacción no anulada en la cuenta origen o destino se informa en
 * `alreadyExisting` y no se crea. Las cuentas de cada conversión son explícitas (origen y destino).
 */
export class RecordImportedConversions implements ImportedConversionsCommand {
  constructor(
    private readonly deps: Pick<TransactionsDeps, 'uow'>,
    private readonly refs: ImportedRefReader,
    private readonly conversions: Pick<ConversionsService, 'recordConversion'>,
  ) {}

  async recordBatch(input: Parameters<ImportedConversionsCommand['recordBatch']>[0]) {
    if (input.rows.length > MAX_CONVERSIONS) {
      throw new DomainError('VALIDATION_FAILED', `a batch has at most ${MAX_CONVERSIONS} conversions`);
    }
    const { workspaceId } = input;
    return await this.deps.uow.run(workspaceId, async () => {
      for (const [i, row] of input.rows.entries()) {
        if (!isImportRefNamespace(row.externalRef.namespace)) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'externalRef.namespace must be imports.csv-row or imports.ext:<FORMAT>',
          ).at(`/rows/${i}/externalRef/namespace`);
        }
      }
      const created: { rowRef: string; transactionId: string }[] = [];
      const alreadyExisting: { rowRef: string; transactionId: string }[] = [];
      const seen = new Set<string>();
      for (const row of input.rows) {
        const key = `${row.externalRef.namespace}|${row.externalRef.id}`;
        if (seen.has(key)) {
          throw new DomainError('VALIDATION_FAILED', 'the batch repeats a row reference').at('/rows');
        }
        seen.add(key);
        // Serializa por cuenta de la conversión y busca la referencia en ambas cuentas.
        let known: string | undefined;
        for (const accountId of [row.sourceAccountId, row.targetAccountId]) {
          await this.refs.lockAccount({ workspaceId, accountId });
          const found = await this.refs.existingByRefs({
            workspaceId,
            accountId,
            namespace: row.externalRef.namespace,
            ids: [row.externalRef.id],
          });
          known ??= found.get(row.externalRef.id);
        }
        if (known !== undefined) {
          alreadyExisting.push({ rowRef: row.rowRef, transactionId: known });
          continue;
        }
        const view = await this.conversions.recordConversion({
          workspaceId,
          userId: input.actorUserId,
          status: 'POSTED',
          transactionDate: row.date,
          sourceAccountId: row.sourceAccountId,
          targetAccountId: row.targetAccountId,
          sourceAmount: row.sourceAmount,
          targetAmount: row.targetAmount,
          ...(row.quotedRate ? { quotedRate: row.quotedRate } : {}),
          ...(row.fee ? { fees: [{ type: 'PROVIDER' as const, amount: row.fee }] } : {}),
          executedAt: row.executedAt,
          externalRef: row.externalRef.id,
          description: row.description,
          origin: 'IMPORT',
          transactionRef: row.externalRef,
          importJobId: input.importJobId,
        });
        created.push({ rowRef: row.rowRef, transactionId: view.transaction.id });
      }
      return { created, alreadyExisting };
    });
  }
}
