import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  classifyRows,
  type ClassifiableRow,
  type DuplicateCandidate,
  type ExistingLink,
} from './duplicate-classifier.js';

const row = (
  n: number,
  date: string,
  description: string | null,
  fingerprint = `fp${n}`,
): ClassifiableRow => ({
  rowRef: `r${n}`,
  lineNumber: n + 1,
  bookingDate: date,
  direction: 'OUT',
  description,
  fingerprint,
});
const cand = (id: string, date: string, description: string | null = null): DuplicateCandidate => ({
  transactionId: id,
  kind: 'EXPENSE',
  date,
  description,
});
const none = new Map<string, ExistingLink>();

describe('DuplicateClassifier', () => {
  it('[TC-IMPORTS-CSV-020] una fila con un candidato en la ventana es DUPLICATE_PROBABLE', () => {
    const result = classifyRows({
      rows: [row(1, '2026-10-01', 'COMPRA SUPERMERCADO')],
      links: none,
      candidates: new Map([['r1', [cand('t-super', '2026-10-02', 'Supermercado')]]]),
    });
    expect(result.rows).toEqual([
      { rowRef: 'r1', classification: 'DUPLICATE_PROBABLE', matchedTransactionId: 't-super' },
    ]);
  });

  it('sin candidatos la fila es NEW', () => {
    const result = classifyRows({ rows: [row(1, '2026-10-01', 'X')], links: none, candidates: new Map() });
    expect(result.rows[0]).toEqual({ rowRef: 'r1', classification: 'NEW', matchedTransactionId: null });
  });

  it('[TC-IMPORTS-CSV-016] un vínculo activo a una transacción viva es DUPLICATE_EXACT', () => {
    const links = new Map<string, ExistingLink>([
      ['fp1', { fingerprint: 'fp1', transactionId: 't1', transactionStatus: 'POSTED' }],
    ]);
    const result = classifyRows({
      rows: [row(1, '2026-10-01', 'X')],
      links,
      // Aunque haya un candidato probable, el vínculo exacto manda.
      candidates: new Map([['r1', [cand('t9', '2026-10-01')]]]),
    });
    expect(result.rows[0]).toEqual({
      rowRef: 'r1',
      classification: 'DUPLICATE_EXACT',
      matchedTransactionId: 't1',
    });
    expect(result.supersededFingerprints).toEqual([]);
  });

  it('[TC-IMPORTS-CSV-018] un vínculo a una transacción anulada queda superado y la fila vuelve a ser NEW', () => {
    const links = new Map<string, ExistingLink>([
      ['fp1', { fingerprint: 'fp1', transactionId: 't1', transactionStatus: 'VOIDED' }],
    ]);
    const result = classifyRows({ rows: [row(1, '2026-10-02', 'CAFE')], links, candidates: new Map() });
    expect(result.rows[0]?.classification).toBe('NEW');
    expect(result.supersededFingerprints).toEqual(['fp1']);
  });

  it('cada movimiento existente se empareja con una sola fila (la más cercana en fecha)', () => {
    const shared = [cand('t1', '2026-10-05')];
    const result = classifyRows({
      rows: [row(1, '2026-10-02', 'A'), row(2, '2026-10-04', 'B'), row(3, '2026-10-08', 'C')],
      links: none,
      candidates: new Map([
        ['r1', shared],
        ['r2', shared],
        ['r3', shared],
      ]),
    });
    expect(result.rows.map((r) => [r.rowRef, r.classification, r.matchedTransactionId])).toEqual([
      ['r1', 'NEW', null],
      ['r2', 'DUPLICATE_PROBABLE', 't1'],
      ['r3', 'NEW', null],
    ]);
  });

  it('empate de fecha: gana la descripción más parecida y luego el id', () => {
    const result = classifyRows({
      rows: [row(1, '2026-10-05', 'PAGO TARJETA VISA')],
      links: none,
      candidates: new Map([
        [
          'r1',
          [
            cand('t2', '2026-10-05', 'Otro'),
            cand('t3', '2026-10-05', 'Pago tarjeta Visa'),
            cand('t1', '2026-10-05', 'Otro'),
          ],
        ],
      ]),
    });
    expect(result.rows[0]?.matchedTransactionId).toBe('t3');
  });

  it('empate total: el id de transacción menor y la línea menor', () => {
    const candidates = new Map([
      ['r1', [cand('tb', '2026-10-05'), cand('ta', '2026-10-05')]],
      ['r2', [cand('tb', '2026-10-05'), cand('ta', '2026-10-05')]],
    ]);
    const result = classifyRows({
      rows: [row(1, '2026-10-05', null), row(2, '2026-10-05', null)],
      links: none,
      candidates,
    });
    expect(result.rows.map((r) => r.matchedTransactionId)).toEqual(['ta', 'tb']);
  });

  it('PBT: determinista (independiente del orden de los candidatos) y 1:1', () => {
    const date = fc.constantFrom('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04');
    fc.assert(
      fc.property(
        fc.array(date, { minLength: 1, maxLength: 6 }),
        fc.array(fc.tuple(fc.constantFrom('t1', 't2', 't3', 't4'), date), { minLength: 0, maxLength: 5 }),
        (rowDates, candidateSpecs) => {
          const rows = rowDates.map((d, i) => row(i, d, 'X'));
          const uniqueCandidates = [...new Map(candidateSpecs.map(([id, d]) => [id, cand(id, d)])).values()];
          const build = (list: readonly DuplicateCandidate[]) =>
            new Map(rows.map((r) => [r.rowRef, list] as const));
          const a = classifyRows({ rows, links: none, candidates: build(uniqueCandidates) });
          const b = classifyRows({ rows, links: none, candidates: build([...uniqueCandidates].reverse()) });
          expect(b).toEqual(a);
          const matched = a.rows.map((r) => r.matchedTransactionId).filter((id) => id !== null);
          expect(new Set(matched).size).toBe(matched.length);
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);
});
