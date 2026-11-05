import {
  mapExternalRecord,
  type ExternalRecord,
  type MappedAccount,
  type MappedRow,
} from '../../domain/index.js';
import type { ImportsDeps, StagedInsert } from '../ports/index.js';

/**
 * `ImportStagingPort.stageExternalRecords` (openspec add-banking-providers, § Dependencias a; add-import-pipeline
 * decisión «Contrato que ofrece a add-banking-providers»): entrega los registros del proveedor a la etapa de
 * normalización del pipeline como filas del staging, independientemente del formato. La fila lleva su cuenta, su
 * referencia externa, la señal y, si es un trade, la conversión propuesta; las etapas siguientes (validación,
 * clasificación, duplicados, coincidencias) son las MISMAS que las de un archivo.
 */
export interface ImportStagingPort {
  /** Escribe las filas en el staging del job (en la unidad de trabajo del llamador). Devuelve cuántas escribió. */
  stageExternalRecords(input: {
    readonly workspaceId: string;
    readonly importJobId: string;
    readonly records: readonly ExternalRecord[];
    readonly context: {
      readonly providerId: string;
      readonly exchange: string;
      readonly timeZone: string;
      readonly resolve: (asset: string) => MappedAccount | null;
    };
  }): Promise<number>;
}

export class ExternalRecordStager implements ImportStagingPort {
  constructor(private readonly deps: Pick<ImportsDeps, 'staging' | 'ids'>) {}

  async stageExternalRecords(
    input: Parameters<ImportStagingPort['stageExternalRecords']>[0],
  ): Promise<number> {
    const mapped: MappedRow[] = input.records.flatMap((r) => [...mapExternalRecord(r, input.context)]);
    if (mapped.length === 0) return 0;
    // La numeración continúa desde lo ya escrito en el job: la página y su cursor provisional van en una misma
    // transacción, así que una reanudación nunca repite ni deja huecos.
    const base = await this.deps.staging.countRows(input.workspaceId, input.importJobId);
    const inserts: StagedInsert[] = mapped.map((row, i) => ({
      id: this.deps.ids.next(),
      rowNumber: base + i + 1,
      raw: [],
      accountId: row.external.accountId,
      external: row.external,
      record: {
        bookingDate: row.bookingDate,
        bookingTime: row.bookingTime,
        valueDate: null,
        signedAmount: row.signedAmount,
        currency: row.currency,
        description: row.description,
        externalId: row.externalId,
        reference: null,
        counterpartyText: null,
        runningBalance: null,
        issues: row.issues,
      },
    }));
    await this.deps.staging.insertRecords(input.workspaceId, input.importJobId, inserts);
    return inserts.length;
  }
}
