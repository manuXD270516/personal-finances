import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { FileInfo } from './FileInfo';
import { EMPTY_MAPPING_FORM, type MappingForm } from './logic';
import { MappingStep } from './MappingStep';
import { PreviewTable } from './PreviewTable';
import {
  ApproveBar,
  ApproveSummary,
  FilterBar,
  SummaryCounts,
  TotalsCard,
  TransferNotice,
} from './ReviewPanels';
import { AlreadyImportedWarning, ProgressPanel, ResultStep } from './ResultPanels';
import { StepIndicator } from './StepIndicator';
import { ImportsTable } from './ImportsList';
import { UploadStep } from './UploadStep';
import type { ImportJob, ImportPreviewRow, ImportPreviewSummary, ImportRowDecision } from './types';
import { problemMessage } from '../../errors/error-messages';

const f = esContext('Imports');
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const noop = () => undefined;

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: '0198f0aa-0000-7000-8000-0000000000c1',
    accountId: '0198f0aa-0000-7000-8000-0000000000a1',
    status: 'AWAITING_MAPPING',
    originalName: 'input.csv',
    fileSha256: 'a'.repeat(64),
    fileSizeBytes: 163,
    detected: { encoding: 'windows-1252', delimiter: ';' },
    rowCount: 4,
    columnCount: 3,
    header: ['Fecha', 'Descripción', 'Monto'],
    mapping: null,
    counters: {
      rows: 4,
      newRows: 3,
      alreadyImported: 0,
      probableDuplicates: 1,
      invalid: 0,
      toCreate: 3,
      skipped: 1,
      excluded: 0,
      created: 0,
      failed: 0,
    },
    progress: { attempt: 0, batchCount: 0, batchesDone: 0 },
    errors: [],
    warnings: [],
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    expiresAt: null,
    createdBy: '0198f0aa-0000-7000-8000-0000000000b1',
    createdAt: '2026-10-20T14:00:00Z',
    updatedAt: '2026-10-20T14:00:00Z',
    version: 1,
    ...over,
  };
}

function row(over: Partial<ImportPreviewRow> = {}): ImportPreviewRow {
  return {
    id: 'row-1',
    lineNumber: 2,
    date: '2026-10-01',
    description: 'COMPRA SUPERMERCADO',
    amount: bob('245.30'),
    direction: 'OUT',
    classification: 'NEW',
    decision: 'CREATE',
    issues: [],
    candidate: null,
    transactionId: null,
    failure: null,
    ...over,
  };
}

const duplicate = (over: Partial<ImportPreviewRow> = {}): ImportPreviewRow =>
  row({
    id: 'row-dup',
    lineNumber: 3,
    classification: 'DUPLICATE_PROBABLE',
    decision: null,
    candidate: {
      transactionId: 'tx-1',
      kind: 'EXPENSE',
      date: '2026-10-02',
      amount: bob('245.30'),
      description: 'Supermercado',
    },
    ...over,
  });

function summary(over: Partial<ImportPreviewSummary['counts']> = {}): ImportPreviewSummary {
  return {
    counts: {
      rows: 4,
      new: 3,
      alreadyImported: 0,
      probableDuplicates: 1,
      invalid: 0,
      pendingDecisions: 1,
      toCreate: 3,
      skipped: 0,
      excluded: 0,
      ...over,
    },
    outflows: bob('36.00'),
    inflows: bob('8000.00'),
    currentBalance: bob('4000.00'),
    resultingBalance: bob('11964.00'),
  };
}

const sampleRows = [
  ['01/10/2026', 'COMPRA SUPERMERCADO', '-245,30'],
  ['02/10/2026', 'PAGO QR CAFÉ', '-18,00'],
];

const renderMapping = (
  over: Partial<Parameters<typeof MappingStep>[0]> = {},
  form: MappingForm = EMPTY_MAPPING_FORM,
) =>
  renderToStaticMarkup(
    <MappingStep
      f={f}
      header={['Fecha', 'Descripción', 'Monto']}
      sampleRows={sampleRows}
      columnCount={3}
      form={form}
      errors={{}}
      busy={false}
      canEdit
      onChange={noop}
      onApply={noop}
      {...over}
    />,
  );

const renderTable = (
  rows: ImportPreviewRow[],
  canEdit = true,
  status: ImportJob['status'] = 'AWAITING_REVIEW',
) =>
  renderToStaticMarkup(
    <PreviewTable
      rows={rows}
      f={f}
      status={status}
      canEdit={canEdit}
      onDecide={noop as (r: ImportPreviewRow, d: ImportRowDecision) => void}
    />,
  );

describe('Asistente Importar CSV: pasos y archivo (docs/28 §4.7)', () => {
  it('[TC-IMPORTS-CSV-001] el indicador marca el paso actual con aria-current="step" y rotula los hechos', () => {
    const html = renderToStaticMarkup(<StepIndicator current={3} f={f} />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/data-step="3"[^>]*aria-current="step"|aria-current="step"[^>]*data-step="3"/);
    const text = textOf(html);
    expect(text).toContain('Archivo (completado)');
    expect(text).toContain('Columnas (completado)');
    expect(text).toContain('Revisar (paso actual)');
    expect(text).not.toContain('Resultado (');
  });

  it('[TC-IMPORTS-CSV-001] muestra la codificación y el separador detectados, el nombre del archivo y las columnas', () => {
    const text = textOf(renderToStaticMarkup(<FileInfo job={job()} f={f} accountName="Banco BOB" />));
    expect(text).toContain('input.csv');
    expect(text).toContain('Banco BOB');
    expect(text).toContain('Windows-1252, separador punto y coma, 3 columnas');
    expect(text).toContain('Esperando las columnas');
    const utf8 = textOf(
      renderToStaticMarkup(
        <FileInfo job={job({ detected: { encoding: 'utf-8', delimiter: '\t' } })} f={f} accountName="x" />,
      ),
    );
    expect(utf8).toContain('UTF-8, separador tabulación');
  });

  it('[TC-IMPORTS-CSV-001] la subida pide cuenta y archivo y avisa del tope de 2 MiB', () => {
    const accounts = [
      { id: 'a1', name: 'Banco BOB', currency: 'BOB' },
      { id: 'a2', name: 'Ahorro USD', currency: 'USD' },
    ] as never;
    const html = renderToStaticMarkup(
      <UploadStep f={f} accounts={accounts} initialAccountId="a2" busy={false} onSubmit={noop} />,
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".csv,.txt,.tsv,text/csv,text/plain"');
    expect(html).toMatch(/<option value="a2" selected="">Ahorro USD \(USD\)<\/option>/);
    expect(textOf(html)).toContain('hasta 2.0 MiB');
    expect(html).toContain('<label');
    expect(html).not.toContain('Imports.');
  });
});

describe('Asistente Importar CSV: mapeo (TC-IMPORTS-CSV-006, -007, -008)', () => {
  it('[TC-IMPORTS-CSV-006] ofrece un select por dato con el encabezado, formato de fecha, separador, signo y filas a saltar', () => {
    const html = renderMapping();
    const text = textOf(html);
    expect(html).toContain('data-testid="mapping-date"');
    expect(html).toContain('data-testid="mapping-description"');
    expect(html).toContain('data-testid="mapping-amount"');
    expect(html).toContain('data-testid="mapping-sign"');
    expect(html).toContain('data-testid="mapping-date-format"');
    expect(html).toContain('data-testid="mapping-decimal"');
    expect(html).toContain('data-testid="mapping-skip-rows"');
    expect(text).toContain('Columna 1: Fecha');
    expect(text).toContain('Columna 3: Monto');
    expect(text).toContain('Negativo es salida (gasto)');
    expect(text).toContain('Positivo es salida (p. ej. tarjeta de crédito)');
    for (const fmt of ['dd/MM/yyyy', 'dd-MM-yyyy', 'dd/MM/yy', 'yyyy-MM-dd', 'MM/dd/yyyy'])
      expect(text).toContain(fmt);
    // La muestra del archivo.
    expect(text).toContain('COMPRA SUPERMERCADO');
    expect(text).toContain('-245,30');
    // Sin adivinar: ningún formato ni separador viene elegido de antemano.
    expect(html).not.toMatch(/<option value="dd\/MM\/yyyy" selected/);
    expect(html).not.toContain('Imports.');
  });

  it('[TC-IMPORTS-CSV-007] con débito y crédito muestra las dos columnas y no la del monto ni el signo', () => {
    const html = renderMapping(
      {},
      { ...EMPTY_MAPPING_FORM, amountMode: 'DEBIT_CREDIT', debitIndex: '2', creditIndex: '' },
    );
    expect(html).toContain('data-testid="mapping-debit"');
    expect(html).toContain('data-testid="mapping-credit"');
    expect(html).not.toContain('data-testid="mapping-amount"');
    expect(html).not.toContain('data-testid="mapping-sign"');
    expect(html).toMatch(/<option value="2" selected="">Columna 3: Monto<\/option>/);
  });

  it('[TC-IMPORTS-CSV-008] precarga el mapeo sugerido y rotula el papel de cada columna en la muestra', () => {
    const html = renderMapping(
      {},
      {
        ...EMPTY_MAPPING_FORM,
        dateIndex: '0',
        descriptionIndex: '1',
        amountIndex: '2',
        signConvention: 'NEGATIVE_IS_OUTFLOW',
        dateFormat: 'dd/MM/yyyy',
        decimalSeparator: ',',
      },
    );
    expect(html).toMatch(/<option value="NEGATIVE_IS_OUTFLOW" selected="">/);
    expect(html).toMatch(/<option value="dd\/MM\/yyyy" selected="">/);
    expect(html).toMatch(/<option value="," selected="">/);
    expect(html).toContain('data-role="date"');
    expect(html).toContain('data-role="description"');
    expect(html).toContain('data-role="amount"');
  });

  it('[TC-IMPORTS-CSV-008] los errores de mapeo se listan con el campo y el motivo y se asocian al control', () => {
    const html = renderMapping({ errors: { dateIndex: 'required', amountIndex: 'range' } });
    const text = textOf(html);
    expect(html).toContain('data-testid="mapping-errors"');
    expect(text).toContain('Columna de la fecha: Es obligatorio.');
    expect(text).toContain('Columna del monto: La columna no existe en el archivo.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby=');
  });

  it('[TC-IMPORTS-CSV-026] el encabezado y las celdas del archivo se muestran como texto, nunca como HTML', () => {
    const html = renderMapping({
      header: ['<img src=x onerror=alert(1)>', '=HYPERLINK("http://x","clic")', 'Monto'],
      sampleRows: [['<script>alert(1)</script>', '@SUM(1+1)', '-1,00']],
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('=HYPERLINK(&quot;http://x&quot;,&quot;clic&quot;)');
    expect(html).not.toMatch(/<a [^>]*HYPERLINK/);
  });

  it('retomar sin muestra lo avisa y VIEWER no ve el botón de aplicar', () => {
    const resumed = renderMapping({ sampleRows: undefined });
    expect(resumed).toContain('data-testid="mapping-no-sample"');
    const viewer = renderMapping({ canEdit: false });
    expect(viewer).not.toContain('data-testid="mapping-apply"');
    expect(viewer).toContain('disabled');
  });
});

describe('Asistente Importar CSV: vista previa y duplicados (TC-IMPORTS-CSV-015, -020, -021)', () => {
  it('[TC-IMPORTS-CSV-015] muestra los conteos, los totales y el saldo resultante con formato es-BO', () => {
    const s = summary();
    const counts = textOf(renderToStaticMarkup(<SummaryCounts summary={s} f={f} />));
    expect(counts).toContain('4 filas · 3 nuevas · 0 ya importadas · 1 posibles duplicados · 0 con errores');
    expect(counts).toContain('Falta decidir 1 posible duplicado.');
    const totals = textOf(renderToStaticMarkup(<TotalsCard summary={s} f={f} />));
    expect(totals).toContain('36,00 BOB');
    expect(totals).toContain('8.000,00 BOB');
    expect(totals).toContain('4.000,00 BOB');
    expect(totals).toContain('11.964,00 BOB');
    const filters = renderToStaticMarkup(<FilterBar summary={s} f={f} value="" onChange={noop} />);
    expect(filters).toContain('aria-pressed="true"');
    expect(textOf(filters)).toContain('Posibles duplicados (1)');
  });

  it('[TC-IMPORTS-CSV-020] el posible duplicado muestra su candidato y los tres botones de decisión', () => {
    const html = renderTable([duplicate()]);
    const text = textOf(html);
    expect(html).toContain('data-classification="DUPLICATE_PROBABLE"');
    expect(html).toContain('data-testid="import-candidate"');
    expect(text).toContain('Coincide con un movimiento ya registrado:');
    expect(text).toContain('02/10/2026');
    expect(text).toContain('01/10/2026');
    expect(text).toContain('245,30 BOB');
    expect(text).toContain('gasto');
    expect(text).toContain('Supermercado');
    expect(text).toContain('Crear de todos modos');
    expect(text).toContain('Omitir, es el mismo');
    expect(text).toContain('Excluir');
    expect(html).toContain('data-testid="import-row-pending"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    // Los botones se identifican por línea para lectores de pantalla.
    expect(html).toContain('aria-label="Omitir la línea 3, es el mismo movimiento"');
  });

  it('[TC-IMPORTS-CSV-021] tras omitir, la decisión queda marcada (aria-pressed) y ya no falta decidir', () => {
    const html = renderTable([duplicate({ decision: 'SKIP' })]);
    expect(html).not.toContain('import-row-pending');
    expect(textOf(html)).toContain('Se omite (es el mismo)');
    expect(html).toMatch(
      /aria-pressed="true"[^>]*data-testid="import-decide-SKIP"|data-testid="import-decide-SKIP"[^>]*aria-pressed="true"|id="import-decide-row-dup-SKIP"[^>]*aria-pressed="true"/,
    );
  });

  it('[TC-IMPORTS-CSV-021] el candidato que es una transferencia advierte de pago de tarjeta o transferencia propia', () => {
    const html = renderTable([
      duplicate({
        candidate: {
          transactionId: 't',
          kind: 'TRANSFER',
          date: '2026-10-02',
          amount: bob('300.00'),
          description: null,
        },
      }),
    ]);
    expect(html).toContain('data-testid="import-candidate-transfer"');
    expect(textOf(html)).toContain('Posible pago de tarjeta o transferencia propia');
    expect(textOf(html)).toContain('transferencia');
    const notice = textOf(renderToStaticMarkup(<TransferNotice f={f} />));
    expect(notice).toContain('no deben importarse como gasto o ingreso');
  });

  it('una fila nueva solo admite incluir o excluir; una ya importada o inválida no admite decisión', () => {
    const nueva = renderTable([row()]);
    expect(nueva).toContain('data-testid="import-decide-CREATE"');
    expect(nueva).toContain('data-testid="import-decide-EXCLUDE"');
    expect(nueva).not.toContain('data-testid="import-decide-SKIP"');
    const fixed = renderTable([
      row({ id: 'r-exact', classification: 'DUPLICATE_EXACT', decision: 'SKIP' }),
      row({
        id: 'r-bad',
        classification: 'INVALID',
        decision: null,
        date: null,
        amount: null,
        direction: null,
      }),
    ]);
    expect(fixed).not.toContain('data-testid="import-decide-');
  });

  it('las filas inválidas muestran su número de línea y el motivo traducido', () => {
    const html = renderTable([
      row({
        id: 'r-bad',
        lineNumber: 7,
        classification: 'INVALID',
        decision: null,
        date: null,
        amount: null,
        direction: null,
        description: 'PAGO ???',
        issues: [
          { code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' },
          { code: 'IMPORT_INVALID_DATE', severity: 'ERROR' },
          { code: 'IMPORT_DESCRIPTION_TRUNCATED', severity: 'WARNING' },
        ],
      }),
    ]);
    const text = textOf(html);
    expect(html).toContain('data-line="7"');
    expect(text).toContain('El monto no es válido');
    expect(text).toContain('La fecha no coincide con el formato elegido.');
    expect(text).toContain('La descripción era muy larga y se recortó.');
    expect(text).toContain('Con error');
    expect(html).not.toContain('Imports.');
  });

  it('[TC-IMPORTS-CSV-026] la descripción importada se muestra literal: sin HTML, sin enlaces ni fórmulas activas', () => {
    const html = renderTable([
      row({ id: 'r1', description: '<img src=x onerror=alert(1)>' }),
      row({ id: 'r2', lineNumber: 3, description: '=HYPERLINK("http://x","clic")' }),
      row({ id: 'r3', lineNumber: 4, description: '<a href="javascript:alert(1)">pagar</a>' }),
    ]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a href');
    expect(html).not.toContain('javascript:alert(1)">');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('=HYPERLINK(&quot;http://x&quot;,&quot;clic&quot;)');
    expect(html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;pagar&lt;/a&gt;');
  });

  it('[TC-IMPORTS-CSV-027] un VIEWER ve la vista previa sin botones de decisión', () => {
    const html = renderTable([duplicate(), row()], false);
    expect(html).not.toContain('data-testid="import-decide-');
    expect(html).not.toContain('<button');
    expect(html).toContain('data-testid="import-candidate"');
  });
});

describe('Asistente Importar CSV: aprobación (TC-IMPORTS-CSV-022, -027)', () => {
  const bar = (over: Partial<Parameters<typeof ApproveBar>[0]> = {}) =>
    renderToStaticMarkup(
      <ApproveBar f={f} canEdit approvable pending={0} toCreate={3} onApprove={noop} {...over} />,
    );

  it('[TC-IMPORTS-CSV-022] "Aprobar" queda deshabilitado con decisiones pendientes y dice cuántas faltan', () => {
    const html = bar({ approvable: false, pending: 2 });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="import-approve"/);
    expect(html).toContain('aria-describedby="import-approve-blocked"');
    expect(textOf(html)).toContain('Aprobar 3 transacciones');
    expect(textOf(html)).toContain('Decide los 2 posibles duplicados pendientes para poder aprobar.');
  });

  it('[TC-IMPORTS-CSV-022] sin pendientes el botón queda habilitado', () => {
    const html = bar();
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain('import-approve-blocked');
  });

  it('[TC-IMPORTS-CSV-027] un VIEWER no ve "Aprobar" ni las acciones de escritura', () => {
    const html = bar({ canEdit: false, actions: <button type="button">Cancelar importación</button> });
    expect(html).not.toContain('data-testid="import-approve"');
    expect(html).not.toContain('Cancelar importación');
    expect(html).toContain('data-testid="import-viewer-note"');
  });

  it('el resumen previo muestra filas a crear, totales, saldo actual → resultante y que quedan sin categoría', () => {
    const html = renderToStaticMarkup(
      <ApproveSummary
        summary={summary({ pendingDecisions: 0, skipped: 1 })}
        f={f}
        transactionsHref="/transacciones?cuenta=a1"
      />,
    );
    const text = textOf(html);
    expect(text).toContain('Se crearán 3 transacciones.');
    expect(text).toContain('1 omitidas como duplicado');
    expect(text).toContain('Salidas: 36,00 BOB. Entradas: 8.000,00 BOB.');
    expect(text).toContain('Saldo actual 4.000,00 BOB, saldo resultante 11.964,00 BOB.');
    expect(text).toContain('quedan sin categoría');
    expect(html).toContain('href="/transacciones?cuenta=a1"');
  });
});

describe('Asistente Importar CSV: progreso y resultado (TC-IMPORTS-CSV-023, -024, -025)', () => {
  const resultProps = {
    f,
    canEdit: true,
    busy: false,
    messageOf: (code: string) => problemMessage({ code }, 'es'),
    transactionsHref: '/transacciones?cuenta=a1',
    newHref: '/imports/nueva?cuenta=a1',
    listHref: '/imports',
    onRetry: noop,
    onAccept: noop,
  };

  it('[TC-IMPORTS-CSV-023] el progreso se anuncia en una región aria-live="polite" con lotes y creadas', () => {
    const j = job({
      status: 'PERSISTING',
      progress: { attempt: 1, batchCount: 5, batchesDone: 2 },
      counters: { ...job().counters, created: 400 },
    });
    const html = renderToStaticMarkup(<ProgressPanel job={j} f={f} />);
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
    expect(textOf(html)).toContain('Lote 2 de 5: 400 transacciones creadas.');
    expect(html).toContain('<progress');
    expect(html).toContain('aria-label="Progreso de la importación"');
    // El paso de resultado muestra el progreso mientras persiste y no ofrece acciones todavía.
    const step = renderToStaticMarkup(<ResultStep job={j} {...resultProps} />);
    expect(step).toContain('data-testid="import-progress-panel"');
    expect(step).not.toContain('import-retry');
    expect(step).not.toContain('result-transactions-link');
  });

  it('[TC-IMPORTS-CSV-023] completada: resumen de filas, creadas, omitidas, ya importadas, inválidas y enlace a Transacciones', () => {
    const j = job({
      status: 'COMPLETED',
      counters: { ...job().counters, created: 3, skipped: 1, alreadyImported: 0, invalid: 0 },
    });
    const html = renderToStaticMarkup(<ResultStep job={j} {...resultProps} />);
    const text = textOf(html);
    expect(text).toContain('Importación completada: se crearon 3 transacciones sin categoría.');
    expect(html).toContain('data-testid="result-created"');
    expect(html).toContain('href="/transacciones?cuenta=a1"');
    expect(text).toContain('Ya importadas');
    expect(html).not.toContain('import-retry');
  });

  it('[TC-IMPORTS-CSV-024] con fallo parcial lista los errores y ofrece reintentar o aceptar el resultado parcial', () => {
    const j = job({
      status: 'PARTIALLY_FAILED',
      counters: { ...job().counters, created: 2, failed: 3 },
      errors: [{ code: 'PERIOD_CLOSED', count: 3, lines: [4, 5, 9] }],
    });
    const html = renderToStaticMarkup(<ResultStep job={j} {...resultProps} />);
    const text = textOf(html);
    expect(html).toContain('data-testid="import-partial"');
    expect(text).toContain('2 transacciones creadas y 3 sin crear');
    expect(text).toContain(problemMessage({ code: 'PERIOD_CLOSED' }, 'es'));
    expect(text).toContain('3 filas');
    expect(text).toContain('Líneas del archivo: 4, 5, 9');
    expect(html).toContain('data-testid="import-retry"');
    expect(html).toContain('data-testid="import-accept-errors"');
    expect(text).toContain('Reintentar');
    expect(text).toContain('Aceptar el resultado parcial');
  });

  it('[TC-IMPORTS-CSV-027] un VIEWER ve el fallo parcial sin reintentar ni aceptar', () => {
    const j = job({
      status: 'PARTIALLY_FAILED',
      errors: [{ code: 'PERIOD_CLOSED', count: 1, lines: [4] }],
    });
    const html = renderToStaticMarkup(<ResultStep job={j} {...resultProps} canEdit={false} />);
    expect(html).not.toContain('import-retry');
    expect(html).not.toContain('import-accept-errors');
    expect(html).toContain('data-testid="import-errors"');
  });

  it('completada con errores y cancelada tienen su aviso', () => {
    const accepted = textOf(
      renderToStaticMarkup(
        <ResultStep
          job={job({
            status: 'COMPLETED_WITH_ERRORS',
            counters: { ...job().counters, created: 2, failed: 1 },
          })}
          {...resultProps}
        />,
      ),
    );
    expect(accepted).toContain('Resultado parcial aceptado: 2 transacciones creadas y 1 sin crear.');
    const cancelled = renderToStaticMarkup(
      <ResultStep job={job({ status: 'CANCELLED' })} {...resultProps} />,
    );
    expect(textOf(cancelled)).toContain('La importación se canceló');
    expect(cancelled).not.toContain('data-testid="import-result-summary"');
  });

  it('[TC-IMPORTS-CSV-025] el archivo ya importado avisa sin bloquear y enlaza la importación anterior', () => {
    const html = renderToStaticMarkup(
      <AlreadyImportedWarning
        warning={{
          code: 'IMPORT_FILE_ALREADY_IMPORTED',
          previousImportId: 'prev-1',
          previousImportedAt: '2026-10-05',
        }}
        f={f}
        href="/imports/prev-1"
      />,
    );
    expect(textOf(html)).toContain('ya se importó en esta cuenta el 05/10/2026');
    expect(html).toContain('href="/imports/prev-1"');
    expect(html).toContain('role="status"');
  });

  it('la lista de importaciones permite retomar las pendientes y escapa el nombre del archivo', () => {
    const html = renderToStaticMarkup(
      <ImportsTable
        items={[
          job({ originalName: '<b>x</b>.csv', status: 'AWAITING_REVIEW' }),
          job({ id: 'j2', status: 'COMPLETED' }),
        ]}
        f={f}
        accountName={() => 'Banco BOB'}
        href={(p) => `/es/w1${p}`}
        timeZone="America/La_Paz"
      />,
    );
    expect(html).not.toContain('<b>x');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;.csv');
    expect(textOf(html)).toContain('Retomar');
    expect(textOf(html)).toContain('Ver');
    expect(html).toContain('href="/es/w1/imports/0198f0aa-0000-7000-8000-0000000000c1"');
  });
});

describe('Asistente Importar CSV: i18n y mensajes de error (es / en / pt)', () => {
  type Tree = { [key: string]: string | Tree };
  const load = (file: string): Tree =>
    JSON.parse(readFileSync(new URL(`../../../messages/${file}.json`, import.meta.url), 'utf8')) as Tree;
  const leaves = (tree: Tree, prefix = ''): Record<string, string> =>
    Object.fromEntries(
      Object.entries(tree).flatMap(([k, v]) =>
        typeof v === 'string' ? [[`${prefix}${k}`, v]] : Object.entries(leaves(v, `${prefix}${k}.`)),
      ),
    );

  it('el espacio de nombres Imports tiene las mismas claves en es, en y pt, traducidas', () => {
    const es = leaves(load('es')['Imports'] as Tree);
    const en = leaves(load('en')['Imports'] as Tree);
    const pt = leaves(load('pt')['Imports'] as Tree);
    expect(Object.keys(es).length).toBeGreaterThan(150);
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    expect(Object.keys(pt).sort()).toEqual(Object.keys(es).sort());
    // No son copias del español: todo texto largo difiere en inglés y portugués.
    for (const [key, value] of Object.entries(es)) {
      if (value.length < 25) continue;
      expect(en[key], `en ${key}`).not.toBe(value);
      expect(pt[key], `pt ${key}`).not.toBe(value);
    }
  });

  it('los códigos nuevos tienen mensaje en los tres idiomas y los de fila/advertencia tienen texto traducido', () => {
    for (const code of [
      'IMPORT_UNSUPPORTED_FORMAT',
      'IMPORT_TOO_MANY_ROWS',
      'IMPORT_MAPPING_INVALID',
      'IMPORT_REVIEW_INCOMPLETE',
    ]) {
      const es = problemMessage({ code }, 'es');
      expect(es).not.toBe(problemMessage({}, 'es'));
      expect(problemMessage({ code }, 'en')).not.toBe(es);
      expect(problemMessage({ code }, 'pt')).not.toBe(es);
    }
    for (const locale of ['es', 'en', 'pt']) {
      const issues = (load(locale)['Imports'] as Tree)['issues'] as Tree;
      for (const code of [
        'IMPORT_INVALID_DATE',
        'IMPORT_INVALID_AMOUNT',
        'IMPORT_FUTURE_DATE',
        'PERIOD_CLOSED',
        'IMPORT_DESCRIPTION_TRUNCATED',
      ])
        expect(String(issues[code]).trim(), `${locale} ${code}`).not.toBe('');
      const warnings = (load(locale)['Imports'] as Tree)['warnings'] as Tree;
      expect(String(warnings['IMPORT_FILE_ALREADY_IMPORTED']).trim()).not.toBe('');
    }
  });
});
