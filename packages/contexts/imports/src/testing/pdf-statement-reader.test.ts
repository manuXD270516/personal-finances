import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  loadExpected,
  paintStatement,
  type EntityId,
  type ExpectedMovement,
} from '../../../../../tests/fixtures/imports/statements-bo/pdf/paint-statement.js';
import { layoutFor, REGISTRY } from '../../test/support/pdf-layouts.js';
import { rowFingerprint } from '../domain/row-fingerprint.js';
import { runLayoutEngine } from '../domain/pdf/layout-engine.js';
import type { PdfTextDocument } from '../domain/pdf/text-document.js';
import {
  detectLayout,
  findPagesWithoutText,
  buildStatementRow,
  readPdfStatement,
  type PdfReadResult,
} from '../domain/pdf/statement-reader.js';
import { stripVolatileFragments } from '../domain/pdf/volatile-fragments.js';

/** Lectura de un extracto pintado en memoria (sin PDF) con el diseño publicado de la entidad. */
const read = (entity: EntityId, options: Parameters<typeof paintStatement>[1] = {}): PdfReadResult =>
  readPdfStatement(paintStatement(entity, options), layoutFor(entity), { scale: 2, maxRows: 5000 });

function ok(result: PdfReadResult) {
  if (!result.ok) throw new Error(`lectura fallida: ${result.code}`);
  return result;
}

const timeOf = (t: string): string => (t.length === 5 ? `${t}:00` : t);
const signed = (m: ExpectedMovement): string => m.amount;
/** BNB conserva solo la primera línea de la glosa (la contraparte va aparte). */
const ENTITIES: readonly EntityId[] = ['BCP', 'GANADERO', 'BNB'];

describe('PdfLayoutEngine y lectura del extracto (oráculo: expected.json sintético)', () => {
  it.each(ENTITIES)(
    '[TC-IMPORTS-PDF-045] el extracto %s se lee exactamente igual a su expected.json',
    (entity) => {
      const expected = loadExpected(entity);
      const result = ok(read(entity));
      expect(result.statement).toEqual({
        openingBalance: expected.statement.openingBalance,
        closingBalance: expected.statement.closingBalance,
        closingDate: expected.statement.periodTo,
        periodFrom: expected.statement.periodFrom,
        periodTo: expected.statement.periodTo,
      });
      expect(result.records).toHaveLength(expected.movements.length);
      result.records.forEach((record, i) => {
        const m = expected.movements[i] as ExpectedMovement;
        expect(record.bookingDate).toBe(m.date);
        expect(record.time).toBe(timeOf(m.time));
        expect(record.amount).toBe(signed(m));
        expect(record.description).toBe(m.description);
        expect(record.runningBalance).toBe(m.balance);
        if (m.reference !== undefined) expect(record.reference).toBe(m.reference);
        expect(record.issues).toEqual([]);
      });
    },
  );

  it('[TC-IMPORTS-PDF-032] un extracto coherente registra su saldo inicial, final y periodo', () => {
    const result = ok(read('BCP'));
    expect(result.statement).toMatchObject({
      openingBalance: '155.00',
      closingBalance: '1019.32',
      periodFrom: '2026-03-01',
      periodTo: '2026-03-31',
    });
    expect(result.info.coherence).toMatchObject({ totals: 'OK', runningBalance: 'OK', recognizedRows: 4 });
    expect(result.info.coherence?.unrecognizedLines).toEqual([]);
    // El encabezado solo aporta moneda, últimos 4 dígitos y páginas.
    expect(result.info).toMatchObject({
      currency: 'BOB',
      accountLast4: '1000',
      pagesRead: 1,
      pagesDeclared: 1,
    });
  });

  it('[TC-IMPORTS-PDF-017] las líneas de continuación de una glosa se unen a su movimiento con un espacio', () => {
    const result = ok(read('BCP'));
    expect(result.records[1]?.description).toBe(
      'Transferencia Qr Sin Referencia - Banco Pampa Demo - Persona Ficticia Alfa - 0000000001',
    );
  });

  it('[TC-IMPORTS-PDF-019] un fragmento que cruza dos columnas invalida solo su fila con IMPORT_PDF_AMBIGUOUS_CELL', () => {
    const doc = paintStatement('GANADERO', { crossColumnRow: 0 });
    const engine = runLayoutEngine(doc, layoutFor('GANADERO'));
    expect(engine.rows.map((r) => r.ambiguous)).toEqual([true, ...Array<boolean>(10).fill(false)]);
    // La fila afectada queda inválida con su ubicación (página:línea) y las demás son válidas.
    const built = engine.rows.map((r, i) => buildStatementRow(r, i + 1, layoutFor('GANADERO'), 2, 'BOB'));
    expect(built[0]?.record.issues).toEqual([
      { code: 'IMPORT_PDF_AMBIGUOUS_CELL', severity: 'ERROR', detail: expect.stringMatching(/^p1:l\d+$/u) },
    ]);
    expect(built.slice(1).every((b) => b.record.issues.length === 0)).toBe(true);
    // La lectura completa falla cerrada: el monto de esa fila no se leyó.
    const result = read('GANADERO', { crossColumnRow: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('IMPORT_PDF_TOTALS_MISMATCH');
    }
  });

  it('[TC-IMPORTS-PDF-020] las filas no cronológicas conservan el orden impreso y el saldo corrido cuadra', () => {
    const result = ok(read('GANADERO'));
    const dates = result.records.map((r) => `${r.bookingDate} ${r.time}`);
    expect(dates.slice(-3)).toEqual(['2026-03-31 23:10:00', '2026-03-31 03:12:07', '2026-03-31 03:12:07']);
    expect(result.info.coherence?.runningBalance).toBe('OK');
    expect(result.records.map((r) => r.reference).slice(-2)).toEqual(['517000001', '517000001']);
  });

  it.each([{}, { timeBelow: true }, { shuffleSeed: 7 }])(
    '[TC-IMPORTS-PDF-021] con el monto como ancla, la fecha y la hora de otra línea se asignan a su movimiento (%j)',
    (options) => {
      const result = ok(read('BNB', options));
      const row = result.records.find((r) => r.reference === '2D0000004');
      expect(row).toMatchObject({
        bookingDate: '2026-03-21',
        time: '13:40:00',
        amount: '-1325.00',
        description: 'DEBITO EN CUENTA POR TRANS. INTERBANC. - DEMO NET',
      });
      // El orden de las secciones es el impreso: depósitos y luego retiros.
      expect(result.records.map((r) => r.reference)).toEqual([
        '2D0000001',
        '2D0000002',
        '2D0000003',
        '2D0000004',
        '2D0000005',
        '2D0000001',
      ]);
      // La contraparte no entra a la glosa y los datos del titular no se guardan en ningún campo.
      expect(JSON.stringify(result.records)).not.toContain('TITULAR');
    },
  );

  it('[TC-IMPORTS-PDF-022] una glosa cortada por el salto de página se une al último movimiento de la página anterior', () => {
    const result = ok(read('GANADERO'));
    expect(result.records[3]?.description).toBe(
      'Transferencia de 0000000002. PERSONA FICTICIA BETA Completado',
    );
    // La continuación no creó una fila propia.
    expect(result.records).toHaveLength(11);
    expect(result.info.pagesRead).toBe(2);
  });

  it('[TC-IMPORTS-PDF-023] los pies de página y los totales no aparecen como filas ni como inválidas', () => {
    const doc = paintStatement('GANADERO');
    const engine = runLayoutEngine(doc, layoutFor('GANADERO'));
    expect(engine.unrecognized).toEqual([]);
    const text = JSON.stringify(engine.rows);
    expect(text).not.toMatch(/P[áa]gina|TOTAL SALDO|FONDOS RESERVADOS|DISPONIBLE|CONFIRMAR/u);
    const result = ok(read('GANADERO'));
    expect(result.records.every((r) => r.issues.length === 0)).toBe(true);
  });

  it('[TC-IMPORTS-PDF-024] leer menos páginas que las declaradas falla con IMPORT_PDF_PAGE_COUNT_MISMATCH', () => {
    const result = read('GANADERO', { declaredPages: 3 });
    expect(result).toMatchObject({ ok: false, code: 'IMPORT_PDF_PAGE_COUNT_MISMATCH' });
    if (!result.ok) expect(result.info).toMatchObject({ pagesRead: 2, pagesDeclared: 3 });
  });

  it('[TC-IMPORTS-PDF-025] la página en blanco declarada por el diseño se omite sin advertencias', () => {
    const doc = paintStatement('BNB');
    const engine = runLayoutEngine(doc, layoutFor('BNB'));
    expect(engine.pagesRead).toBe(4);
    expect(engine.unrecognized).toEqual([]);
    const result = ok(read('BNB'));
    expect(result.records).toHaveLength(6);
    expect(result.info.coherence?.unrecognizedLines).toEqual([]);
  });

  it('[TC-IMPORTS-PDF-029] una fila con débito y crédito distintos de cero queda inválida', () => {
    const result = read('GANADERO', { bothDebitCredit: { row: 0, debit: '26.00', credit: '5.00' } });
    // El neto (−21.00) no cuadra con el saldo corrido: la fila inválida y la coherencia lo detectan.
    expect(result.ok).toBe(false);
    const engine = runLayoutEngine(
      paintStatement('GANADERO', { bothDebitCredit: { row: 0, debit: '26.00', credit: '5.00' } }),
      layoutFor('GANADERO'),
    );
    expect(engine.rows[0]).toMatchObject({ debit: '26.00', credit: '5.00' });
    const row = buildStatementRow(engine.rows[0] as never, 1, layoutFor('GANADERO'), 2, 'BOB');
    expect(row.record.issues.map((i) => i.code)).toEqual(['IMPORT_PDF_BOTH_DEBIT_AND_CREDIT']);
    expect(row.record.amount).toBeNull();
  });

  it('[TC-IMPORTS-PDF-028] un monto impreso con más decimales que la escala invalida la fila sin redondear', () => {
    const engine = runLayoutEngine(paintStatement('BCP', { amountText: { 2: '-12.345' } }), layoutFor('BCP'));
    const row = buildStatementRow(engine.rows[2] as never, 3, layoutFor('BCP'), 2, 'BOB');
    expect(row.record.issues.map((i) => i.code)).toEqual(['IMPORT_INVALID_AMOUNT']);
    expect(row.record.amount).toBeNull();
    expect(row.exact?.toFixed(3)).toBe('-12.345');
  });

  it('[TC-IMPORTS-PDF-033] un movimiento no leído rompe la coherencia y falla la importación con la diferencia', () => {
    const result = read('BCP', { drop: [3] });
    expect(result).toMatchObject({ ok: false, code: 'IMPORT_PDF_TOTALS_MISMATCH' });
    if (!result.ok) {
      expect(result.info.coherence).toMatchObject({
        totals: 'MISMATCH',
        difference: '300.25',
        recognizedRows: 3,
      });
      expect(result.info.coherence?.unrecognizedLines).toEqual([]);
    }
  });

  it('[TC-IMPORTS-PDF-034] un total de sección distinto de la suma de sus filas falla la importación', () => {
    const result = read('BNB', { sectionTotals: { WITHDRAWALS: '4510.79' } });
    expect(result).toMatchObject({ ok: false, code: 'IMPORT_PDF_TOTALS_MISMATCH' });
    if (!result.ok) expect(result.info.coherence).toMatchObject({ totals: 'MISMATCH', difference: '9.00' });
  });

  it('[TC-IMPORTS-PDF-035] la fila de saldo anterior y el total del pie son saldos del extracto y no movimientos', () => {
    const result = ok(read('GANADERO'));
    expect(result.records).toHaveLength(11);
    expect(result.statement.openingBalance).toBe('2640.00');
    expect(result.statement.closingBalance).toBe('12050.66');
    expect(result.records.some((r) => /saldo anterior/iu.test(r.description ?? ''))).toBe(false);
    const sum = result.records.reduce((acc, r) => acc.plus(dec(r.amount ?? '0')), dec('0'));
    expect(sum.toFixed(2)).toBe('9410.66');
  });

  it.each(ENTITIES)(
    '[TC-IMPORTS-PDF-016] dibujar los fragmentos en orden aleatorio produce los mismos movimientos (%s)',
    (entity) => {
      const base = ok(read(entity));
      for (const shuffleSeed of [1, 2, 3, 99]) {
        const shuffled = ok(read(entity, { shuffleSeed }));
        expect(shuffled.records).toEqual(base.records);
        expect(shuffled.statement).toEqual(base.statement);
      }
    },
  );

  it.each(ENTITIES)(
    '[TC-IMPORTS-PDF-018] texto carácter por carácter y espacios como separación producen los mismos movimientos (%s)',
    (entity) => {
      const base = ok(read(entity));
      const chars = ok(read(entity, { charByChar: true }));
      expect(chars.records).toEqual(base.records);
      expect(chars.statement).toEqual(base.statement);
      expect(ok(read(entity, { charByChar: true, shuffleSeed: 5 })).records).toEqual(base.records);
    },
  );

  it('[TC-IMPORTS-PDF-012] el diseño se detecta por los rótulos fijos de la primera página', () => {
    const candidates = REGISTRY.candidates();
    for (const entity of ENTITIES) {
      const detected = detectLayout(paintStatement(entity), candidates);
      expect(detected?.id).toBe(layoutFor(entity).id);
      expect(detected?.version).toBe(1);
    }
  });

  it('[TC-IMPORTS-PDF-014] un PDF con texto sin los rótulos de ningún diseño no se reconoce', () => {
    const doc: PdfTextDocument = {
      pageCount: 1,
      pages: [
        {
          number: 1,
          width: 600,
          height: 800,
          items: [
            {
              text: 'Documento cualquiera sin ninguna tabla de movimientos conocida',
              x: 40,
              y: 40,
              width: 200,
              height: 8,
            },
          ],
        },
      ],
    };
    expect(detectLayout(doc, REGISTRY.candidates())).toBeNull();
  });

  it('[TC-IMPORTS-PDF-011] una página sin texto entre páginas con texto se informa con su número', () => {
    const doc = paintStatement('GANADERO', { blankOutPages: [2] });
    expect(findPagesWithoutText(doc, 20, [])).toEqual([2]);
    expect(findPagesWithoutText(paintStatement('GANADERO'), 20, [])).toEqual([]);
  });

  it('[TC-IMPORTS-PDF-043] una anotación de estado declarada variable no cambia la huella de la fila', () => {
    const layout = layoutFor('GANADERO');
    const base = {
      workspaceId: 'w',
      accountId: 'a',
      bookingDate: '2026-03-03',
      signedAmount: '350.00',
      currency: 'BOB',
      occurrenceIndex: 0,
    };
    const fingerprint = (description: string) =>
      rowFingerprint({
        ...base,
        description: stripVolatileFragments(description, layout.volatileFragments),
      });
    const a = fingerprint('Transferencia de 0000000002. PERSONA FICTICIA BETA Aún falta 350');
    const b = fingerprint('Transferencia de 0000000002. PERSONA FICTICIA BETA Completado');
    const c = fingerprint('Transferencia de 0000000002. PERSONA FICTICIA BETA');
    expect(a).toBe(b);
    expect(a).toBe(c);
    // Sin la lista del diseño, la anotación sí cambia la huella.
    expect(rowFingerprint({ ...base, description: 'X Completado' })).not.toBe(
      rowFingerprint({ ...base, description: 'X' }),
    );
  });

  it('[TC-IMPORTS-PDF-041] del encabezado solo salen moneda, saldos, periodo, páginas y 4 dígitos de la cuenta', () => {
    for (const entity of ENTITIES) {
      const result = ok(read(entity));
      const dump = JSON.stringify({
        records: result.records,
        statement: result.statement,
        info: result.info,
      });
      for (const secret of [
        'TITULAR',
        'FICTICIO UNO',
        'Procesado por',
        '00000001-0',
        '000-0000001',
        '0000000001',
      ]) {
        // 0000000001 aparece en glosas de transferencias (datos de terceros del fixture); el titular, no.
        if (secret === '0000000001') continue;
        expect(dump).not.toContain(secret);
      }
      expect(result.info.accountLast4).toMatch(/^[0-9]{4}$/u);
    }
  });
});
