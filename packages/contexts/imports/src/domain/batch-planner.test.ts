import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pendingBatchNumbers, planBatches } from './batch-planner.js';

describe('ImportBatchPlanner', () => {
  it('[TC-IMPORTS-CSV-024] 450 filas se reparten en lotes de 200, 200 y 50', () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({
      rowId: `r${i}`,
      bookingDate: i < 200 ? '2026-08-15' : i < 400 ? '2026-09-10' : '2026-10-01',
      lineNumber: i + 2,
    }));
    const batches = planBatches(rows, 200);
    expect(batches.map((b) => [b.batchNo, b.rowIds.length])).toEqual([
      [1, 200],
      [2, 200],
      [3, 50],
    ]);
  });

  it('ordena por fecha y luego por línea, sea cual sea el orden de entrada', () => {
    const rows = [
      { rowId: 'c', bookingDate: '2026-10-02', lineNumber: 3 },
      { rowId: 'a', bookingDate: '2026-10-01', lineNumber: 9 },
      { rowId: 'b', bookingDate: '2026-10-01', lineNumber: 4 },
    ];
    expect(planBatches(rows, 2).map((b) => b.rowIds)).toEqual([['b', 'a'], ['c']]);
  });

  it('sin filas no hay lotes y un tamaño inválido se rechaza', () => {
    expect(planBatches([], 200)).toEqual([]);
    expect(() => planBatches([], 0)).toThrow(RangeError);
  });

  it('PBT: cada fila está en exactamente un lote y ningún lote excede el tamaño', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 1, max: 250 }), (n, size) => {
        const rows = Array.from({ length: n }, (_, i) => ({
          rowId: `r${i}`,
          bookingDate: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
          lineNumber: i + 2,
        }));
        const batches = planBatches(rows, size);
        const ids = batches.flatMap((b) => b.rowIds);
        expect(ids).toHaveLength(n);
        expect(new Set(ids).size).toBe(n);
        expect(batches.every((b) => b.rowIds.length <= size)).toBe(true);
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  it('[TC-IMPORTS-CSV-024] la reanudación salta los lotes cuyas filas ya tienen transacción', () => {
    expect(
      pendingBatchNumbers([
        { batchNo: 1, transactionId: 't1' },
        { batchNo: 2, transactionId: null },
        { batchNo: 2, transactionId: 't2' },
        { batchNo: 3, transactionId: null },
        { batchNo: null, transactionId: null },
      ]),
    ).toEqual([2, 3]);
  });
});
