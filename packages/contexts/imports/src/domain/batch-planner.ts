/**
 * `ImportBatchPlanner` (decisión 10 de add-basic-csv-import): reparte las filas a crear en lotes de tamaño fijo
 * (200 por defecto) ordenadas por fecha y línea, de modo que un lote cubra un rango de fechas contiguo y el reparto sea
 * determinista. La reanudación salta las filas que ya tienen transacción: el `batch_no` queda fijo desde la aprobación.
 */

export interface PlannableRow {
  readonly rowId: string;
  readonly bookingDate: string;
  readonly lineNumber: number;
}

export interface PlannedBatch {
  /** 1-based. */
  readonly batchNo: number;
  readonly rowIds: readonly string[];
}

export function planBatches(rows: readonly PlannableRow[], batchSize: number): PlannedBatch[] {
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new RangeError('batchSize must be a positive integer');
  const ordered = [...rows].sort(
    (a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.lineNumber - b.lineNumber,
  );
  const batches: PlannedBatch[] = [];
  for (let i = 0; i < ordered.length; i += batchSize) {
    batches.push({
      batchNo: batches.length + 1,
      rowIds: ordered.slice(i, i + batchSize).map((r) => r.rowId),
    });
  }
  return batches;
}

/** Lotes con filas todavía sin transacción, en orden: lo que falta persistir tras una caída o un reintento. */
export function pendingBatchNumbers(
  rows: readonly { readonly batchNo: number | null; readonly transactionId: string | null }[],
): number[] {
  const pending = new Set<number>();
  for (const row of rows) if (row.batchNo !== null && row.transactionId === null) pending.add(row.batchNo);
  return [...pending].sort((a, b) => a - b);
}
