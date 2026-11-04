import { describe, expect, it } from 'vitest';
import {
  paintStatement,
  type EntityId,
  type PaintOptions,
} from '../../../../../tests/fixtures/imports/statements-bo/pdf/paint-statement.js';
import { layoutChecksum, FilePdfLayoutRegistry } from '../infrastructure/pdf/file-pdf-layout-registry.js';
import { layoutFor, REGISTRY } from '../../test/support/pdf-layouts.js';
import type { PdfTextExtractor } from '../application/pdf/ports.js';
import { PdfExtractionError, type PdfExtractionReason, type PdfTextDocument } from '../domain/index.js';
import {
  ACCOUNT,
  USER,
  WS,
  addDocument,
  approveAndPersist,
  codeOf,
  importDocument,
  previewRows,
  setupPipeline,
  type PipelineCtx,
} from './pipeline-harness.js';

/**
 * Pipeline de importación con extractos PDF (openspec add-pdf-statement-parser; `imports/import-pipeline`). El
 * extractor es un doble que devuelve el texto con posiciones pintado en memoria; la extracción real con PDF.js en el
 * hilo aislado se prueba en `infrastructure/pdf`. Los PDF son SINTÉTICOS: ningún dato real.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class FakeExtractor implements PdfTextExtractor {
  readonly docs = new Map<string, PdfTextDocument>();
  failWith: PdfExtractionReason | null = null;
  calls = 0;

  add(key: string, doc: PdfTextDocument): Uint8Array {
    this.docs.set(key, doc);
    return encoder.encode(`%PDF-1.7\n${key}`);
  }

  extract(bytes: Uint8Array): Promise<PdfTextDocument> {
    this.calls += 1;
    if (this.failWith) return Promise.reject(new PdfExtractionError(this.failWith));
    const doc = this.docs.get(decoder.decode(bytes).split('\n')[1] ?? '');
    return doc ? Promise.resolve(doc) : Promise.reject(new PdfExtractionError('MALFORMED'));
  }
}

function setup(options: { last4?: string | null; layouts?: FilePdfLayoutRegistry } = {}) {
  const fake = new FakeExtractor();
  const ctx = setupPipeline(
    {},
    { pdfExtractor: fake, ...(options.layouts ? { pdfLayouts: options.layouts } : {}) },
  );
  const last4 = options.last4 === undefined ? '1000' : options.last4;
  ctx.world.accountLast4.set(ACCOUNT, last4);
  return { ctx, fake };
}

let counter = 0;
function addPdf(
  ctx: PipelineCtx,
  fake: FakeExtractor,
  entity: EntityId,
  paint: PaintOptions = {},
  name?: string,
): string {
  counter += 1;
  const bytes = fake.add(`${entity}-${counter}`, paintStatement(entity, paint));
  return addDocument(ctx, { format: 'PDF', bytes, ...(name ? { name } : {}) });
}

describe('Formatos detectados por contenido: extracto PDF', () => {
  it('[TC-IMPORTS-PDF-001] un extracto PDF disponible se acepta al crear la importación y se procesa con el lector de PDF', async () => {
    const { ctx, fake } = setup();
    const documentId = addPdf(ctx, fake, 'BCP');
    const created = await ctx.service.createFromDocument({
      workspaceId: WS,
      userId: USER,
      accountId: ACCOUNT,
      documentId,
    });
    expect(created).toMatchObject({ status: 'UPLOADED', format: 'PDF', source: 'FILE_PDF' });
    expect(await ctx.process.process({ workspaceId: WS, importId: created.id })).toBe('AWAITING_REVIEW');
    expect(fake.calls).toBe(1);
  });

  it('[TC-IMPORTS-PDF-002] un documento PNG se rechaza con IMPORT_UNSUPPORTED_FORMAT al crear la importación', async () => {
    const { ctx } = setup();
    const png = addDocument(ctx, { format: 'PNG' as never, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
    expect(
      await codeOf(
        ctx.service.createFromDocument({
          workspaceId: WS,
          userId: USER,
          accountId: ACCOUNT,
          documentId: png,
        }),
      ),
    ).toBe('IMPORT_UNSUPPORTED_FORMAT');
  });

  it('sin el lector de PDF configurado un PDF sigue siendo un formato no importable', async () => {
    const ctx = setupPipeline();
    const pdf = addDocument(ctx, { format: 'PDF', text: '%PDF-1.7\nx' });
    expect(
      await codeOf(
        ctx.service.createFromDocument({
          workspaceId: WS,
          userId: USER,
          accountId: ACCOUNT,
          documentId: pdf,
        }),
      ),
    ).toBe('IMPORT_UNSUPPORTED_FORMAT');
  });

  it('[TC-IMPORTS-PDF-003] el extracto sintético de una página queda en revisión con 4 filas y se completa sin duplicar', async () => {
    const { ctx, fake } = setup();
    ctx.world.dynamicBalance = true;
    ctx.world.balance = '155.00';
    const documentId = addPdf(ctx, fake, 'BCP');
    const { job, outcome } = await importDocument(ctx, documentId);
    expect(outcome).toBe('AWAITING_REVIEW');
    expect(job).toMatchObject({ status: 'AWAITING_REVIEW', format: 'PDF', rowCount: 4 });
    expect(job.counters).toMatchObject({ rows: 4, newRows: 4, invalid: 0 });
    expect(job.statement).toMatchObject({
      openingBalance: { amount: '155.00', currency: 'BOB' },
      closingBalance: { amount: '1019.32', currency: 'BOB' },
    });
    expect(job.pdf).toMatchObject({
      layout: { id: 'bo.bcp.cuenta', version: 1 },
      pagesRead: 1,
      pagesDeclared: 1,
      coherence: { totals: 'OK', balanceChain: 'OK', unrecognizedLines: [] },
    });
    const { rows } = await previewRows(ctx, job.id);
    expect(rows.map((r) => [r.date, r.amount?.amount])).toEqual([
      ['2026-03-01', '0.07'],
      ['2026-03-05', '1250.00'],
      ['2026-03-05', '85.50'],
      ['2026-03-12', '300.25'],
    ]);

    // Una reentrega del evento durante la lectura no duplica filas: el job ya salió de PROCESSING.
    expect(await ctx.process.process({ workspaceId: WS, importId: job.id })).toBe('SKIPPED');

    const { job: done } = await approveAndPersist(ctx, job.id);
    expect(done.status).toBe('COMPLETED');
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(4);
  });

  it('[TC-IMPORTS-PDF-010] un PDF de solo imágenes falla con IMPORT_PDF_NO_TEXT y sin filas', async () => {
    const { ctx, fake } = setup();
    const documentId = addPdf(ctx, fake, 'GANADERO', { blankOutPages: [1, 2] });
    const { job, outcome } = await importDocument(ctx, documentId);
    expect(outcome).toBe('PARSE_FAILED');
    expect(job.status).toBe('PARSE_FAILED');
    expect(job.failure).toMatchObject({ code: 'IMPORT_PDF_NO_TEXT' });
    expect(job.pdf).toMatchObject({ pagesWithoutText: [1, 2] });
    expect(ctx.world.staged.filter((s) => s.jobId === job.id)).toHaveLength(0);
    expect(ctx.world.events.find((e) => e.eventType.includes('ImportFailed'))?.payload).toMatchObject({
      code: 'IMPORT_PDF_NO_TEXT',
    });
  });

  it('[TC-IMPORTS-PDF-011] una página de solo imagen entre páginas con texto rechaza el PDF indicando la página', async () => {
    const { ctx, fake } = setup({ last4: '0001' });
    const documentId = addPdf(ctx, fake, 'GANADERO', { blankOutPages: [2] });
    const { job } = await importDocument(ctx, documentId);
    expect(job.failure).toMatchObject({ code: 'IMPORT_PDF_NO_TEXT' });
    expect(job.pdf?.pagesWithoutText).toEqual([2]);
  });

  it('[TC-IMPORTS-PDF-012] el diseño se detecta por los rótulos fijos de la primera página y se registra con su versión', async () => {
    const { ctx, fake } = setup({ last4: '0001' });
    const { job } = await importDocument(ctx, addPdf(ctx, fake, 'GANADERO'));
    expect(job.status).toBe('AWAITING_REVIEW');
    expect(job.pdf?.layout).toEqual({ id: 'bo.ganadero.cuenta', version: 1 });
    expect(job.rowCount).toBe(11);
  });

  it('[TC-IMPORTS-PDF-014] un PDF con texto sin los rótulos de ningún diseño falla con IMPORT_PDF_LAYOUT_UNKNOWN', async () => {
    const { ctx, fake } = setup();
    const doc: PdfTextDocument = {
      pageCount: 1,
      pages: [
        {
          number: 1,
          width: 600,
          height: 800,
          items: [
            {
              text: 'Documento con texto suficiente pero sin tabla conocida',
              x: 10,
              y: 20,
              width: 200,
              height: 8,
            },
          ],
        },
      ],
    };
    const documentId = addDocument(ctx, { format: 'PDF', bytes: fake.add('libre', doc) });
    const { job } = await importDocument(ctx, documentId);
    expect(job.failure).toMatchObject({ code: 'IMPORT_PDF_LAYOUT_UNKNOWN' });
    expect(job.pdf).toMatchObject({ layout: null, pagesRead: 1 });
  });

  it('[TC-IMPORTS-PDF-013] el perfil PDF de la cuenta fija la versión del diseño aunque exista una más reciente', async () => {
    const v1 = layoutFor('GANADERO');
    const v2 = { ...v1, version: 2, volatileFragments: [] };
    const registry = new FilePdfLayoutRegistry([...REGISTRY.candidates(), v2], {
      ...Object.fromEntries(
        REGISTRY.candidates().map((l) => [`${l.id}@${l.version}`, layoutChecksum(l)] as const),
      ),
      'bo.ganadero.cuenta@2': layoutChecksum(v2),
    });
    const { ctx, fake } = setup({ last4: '0001', layouts: registry });
    // Sin perfil, gana la versión más reciente.
    const free = await importDocument(ctx, addPdf(ctx, fake, 'GANADERO'));
    expect(free.job.pdf?.layout).toEqual({ id: 'bo.ganadero.cuenta', version: 2 });

    await ctx.profiles.create({
      workspaceId: WS,
      userId: USER,
      name: 'Ganadero PDF',
      format: 'PDF',
      accountId: ACCOUNT,
      options: { pdfLayout: { id: 'bo.ganadero.cuenta', version: 1 } },
    });
    const pinned = await importDocument(ctx, addPdf(ctx, fake, 'GANADERO', { downloadDate: '05/04/2026' }));
    expect(pinned.job.pdf?.layout).toEqual({ id: 'bo.ganadero.cuenta', version: 1 });
    expect(pinned.job.mappingProfile).toMatchObject({ version: 1 });
  });

  it('[TC-IMPORTS-PDF-004] [TC-IMPORTS-PDF-005] un tiempo o una memoria excedidos fallan la importación sin filas', async () => {
    for (const reason of ['TIMEOUT', 'MEMORY'] as const) {
      const { ctx, fake } = setup();
      fake.failWith = reason;
      const { job } = await importDocument(ctx, addPdf(ctx, fake, 'BCP'));
      expect(job.status).toBe('PARSE_FAILED');
      expect(job.failure).toMatchObject({ code: 'IMPORT_PDF_EXTRACTION_FAILED' });
      expect(job.pdf).toMatchObject({ extractionFailure: reason });
      expect(ctx.world.staged.filter((s) => s.jobId === job.id)).toHaveLength(0);
    }
  });

  it('[TC-IMPORTS-PDF-036] la vista previa muestra la diferencia entre el saldo inicial del extracto y el de la cuenta', async () => {
    const { ctx, fake } = setup({ last4: '0001' });
    ctx.world.balance = '2000.00';
    const { job } = await importDocument(ctx, addPdf(ctx, fake, 'GANADERO'));
    expect(job.status).toBe('AWAITING_REVIEW');
    expect(job.pdf?.openingDifference).toEqual({ amount: '640.00', currency: 'BOB' });
    // La diferencia solo se muestra: la importación se puede aprobar.
    const { job: done } = await approveAndPersist(ctx, job.id);
    expect(['COMPLETED', 'COMPLETED_WITH_DIFFERENCE']).toContain(done.status);
  });

  it('[TC-IMPORTS-PDF-037] con meses consecutivos la diferencia de saldo inicial es cero', async () => {
    const { ctx, fake } = setup({ last4: '0001' });
    ctx.world.balance = '2640.00';
    const { job } = await importDocument(ctx, addPdf(ctx, fake, 'GANADERO'));
    expect(job.pdf?.openingDifference).toEqual({ amount: '0.00', currency: 'BOB' });
  });

  it('[TC-IMPORTS-PDF-038] un extracto de otra cuenta falla con IMPORT_PDF_ACCOUNT_MISMATCH sin filas', async () => {
    const { ctx, fake } = setup({ last4: '0001' });
    const documentId = addPdf(ctx, fake, 'GANADERO', { accountNumber: '0000000002' });
    const { job } = await importDocument(ctx, documentId);
    expect(job.status).toBe('PARSE_FAILED');
    expect(job.failure).toMatchObject({ code: 'IMPORT_PDF_ACCOUNT_MISMATCH' });
    expect(ctx.world.staged.filter((s) => s.jobId === job.id)).toHaveLength(0);
    // El número completo del extracto nunca se guarda: ni en el job ni en la auditoría.
    expect(JSON.stringify([job, ctx.world.audit, ctx.world.events])).not.toContain('0000000002');
  });

  it('[TC-IMPORTS-PDF-039] una cuenta sin dígitos registrados se importa con la advertencia de cuenta no verificada', async () => {
    const { ctx, fake } = setup({ last4: null });
    const { job } = await importDocument(ctx, addPdf(ctx, fake, 'BCP'));
    expect(job.status).toBe('AWAITING_REVIEW');
    expect(job.pdf?.warnings).toEqual(['IMPORT_PDF_ACCOUNT_UNVERIFIED']);
  });

  it('[TC-IMPORTS-PDF-040] un extracto en bolivianos sobre una cuenta en USD deja todas las filas inválidas', async () => {
    const { ctx, fake } = setup();
    ctx.world.addAccount({ accountId: 'acc-usd', currency: 'USD' });
    ctx.world.accountLast4.set('acc-usd', '1000');
    const documentId = addPdf(ctx, fake, 'BCP');
    const { job } = await importDocument(ctx, documentId, { accountId: 'acc-usd' });
    expect(job.status).toBe('AWAITING_REVIEW');
    const { rows } = await previewRows(ctx, job.id);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.classification).toBe('INVALID');
      expect(row.issues.map((i) => i.code)).toContain('IMPORT_CURRENCY_MISMATCH');
    }
  });

  it('[TC-IMPORTS-PDF-042] volver a descargar el mismo mes crea 0 transacciones aunque cambien los bytes del PDF', async () => {
    const { ctx, fake } = setup({ last4: '0001' });
    ctx.world.dynamicBalance = true;
    ctx.world.balance = '2640.00';
    const first = await importDocument(ctx, addPdf(ctx, fake, 'GANADERO'));
    const { job: done } = await approveAndPersist(ctx, first.job.id);
    expect(done.counters.created).toBe(11);
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(11);

    const bytesBefore = ctx.world.documents.get(first.created.documentId as string)?.sha256;
    const again = await importDocument(ctx, addPdf(ctx, fake, 'GANADERO', { downloadDate: '07/04/2026' }));
    expect(ctx.world.documents.get(again.created.documentId as string)?.sha256).not.toBe(bytesBefore);
    expect(again.job.status).toBe('AWAITING_REVIEW');
    expect(again.job.counters).toMatchObject({ rows: 11, alreadyImported: 11, newRows: 0 });
    const second = await approveAndPersist(ctx, again.job.id);
    expect(second.job.counters.created).toBe(0);
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(11);
  });

  it('[TC-IMPORTS-PDF-041] el titular, el operador y el número de cuenta completo no se guardan ni se registran', async () => {
    const { ctx, fake } = setup({ last4: '0001' });
    const { job } = await importDocument(ctx, addPdf(ctx, fake, 'GANADERO'));
    await approveAndPersist(ctx, job.id);
    const everything = JSON.stringify([
      ctx.world.jobs.get(job.id),
      ctx.world.staged,
      ctx.world.audit,
      ctx.world.events,
      ctx.world.lifecycle,
      ctx.world.transactions,
    ]);
    for (const secret of ['TITULAR FICTICIO', 'Procesado por', 'NRO. DE CUENTA', 'CLIENTE']) {
      expect(everything).not.toContain(secret);
    }
  });
});
