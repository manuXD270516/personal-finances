import { DomainError } from '@pf/shared-kernel';
import { IMPORT_ROW_NAMESPACE, type ImportedTransactionsCommand } from '../contracts/index.js';
import type { ImportedRefReader, UnitOfWork } from './ports/index.js';
import type { TransactionsService } from './transactions.service.js';

/** Tope de filas por lote (la persistencia de IMPORTS usa 200). */
const MAX_BATCH_ROWS = 1000;

/**
 * Adapter de `ImportedTransactionsCommand` (openspec add-basic-csv-import, decisión 9): reutiliza `recordTransaction`
 * —con su validación de cuenta (activa, moneda), traductor al ledger (periodos cerrados ⇒ `PERIOD_CLOSED`), auditoría,
 * recorrido y outbox— una vez por fila, todas en la unidad de trabajo del llamador (una transacción de BD por lote).
 * Salida ⇒ gasto con la categoría de sistema "sin categoría"; entrada ⇒ ingreso con "ingreso sin categoría" (D9, vía
 * el split por omisión de `recordTransaction`); estado `POSTED`; `source = IMPORT`; sin contraparte ni medio de pago.
 *
 * La idempotencia (INV-014): las filas cuya referencia ya tiene una transacción no anulada se informan en
 * `alreadyExisting` y no se crean; el índice único parcial `transaction_import_ref_uk` cubre la carrera de dos jobs.
 */
export class ImportedTransactionsAdapter implements ImportedTransactionsCommand {
  constructor(
    private readonly service: Pick<TransactionsService, 'recordTransaction'>,
    private readonly refs: ImportedRefReader,
    private readonly uow: UnitOfWork,
  ) {}

  async recordBatch(input: Parameters<ImportedTransactionsCommand['recordBatch']>[0]) {
    if (input.rows.length > MAX_BATCH_ROWS) {
      throw new DomainError('VALIDATION_FAILED', `a batch has at most ${MAX_BATCH_ROWS} rows`);
    }
    return await this.uow.run(input.workspaceId, async () => {
      const ids = input.rows.map((r) => r.externalRef.id);
      const existing = await this.refs.existingByRefs({
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        namespace: IMPORT_ROW_NAMESPACE,
        ids,
      });
      const created: { rowRef: string; transactionId: string }[] = [];
      const alreadyExisting: { rowRef: string; transactionId: string }[] = [];
      const seen = new Set<string>();
      for (const row of input.rows) {
        if (row.externalRef.namespace !== IMPORT_ROW_NAMESPACE) {
          throw new DomainError('VALIDATION_FAILED', 'externalRef.namespace must be imports.csv-row').at(
            '/externalRef/namespace',
          );
        }
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
        const { transaction } = await this.service.recordTransaction({
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          kind: row.direction === 'OUT' ? 'EXPENSE' : 'INCOME',
          status: 'POSTED',
          transactionDate: row.date,
          accountId: input.accountId,
          amount: row.amount,
          description: row.description,
          source: 'IMPORT',
          externalRef: row.externalRef,
          importJobId: input.importJobId,
        });
        created.push({ rowRef: row.rowRef, transactionId: transaction.id });
      }
      return { created, alreadyExisting };
    });
  }
}
