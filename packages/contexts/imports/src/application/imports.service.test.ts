import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { sha256Hex, type CsvMapping } from '../domain/index.js';
import { ImportsMaintenanceService } from './imports-maintenance.service.js';
import { ImportsQueries } from './imports.queries.js';
import { ImportsService, sanitizeFileName } from './imports.service.js';
import { PersistImportService } from './persist-import.service.js';
import { MemoryWorld, createMemoryDeps } from './testing/in-memory.js';

const WS = 'ws-1';
const ACCOUNT = 'acc-bob';
const USER = 'user-ana';

const latin1 = (s: string): Uint8Array => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
const EXTRACTO =
  'Fecha;Descripción;Monto\r\n' +
  '01/10/2026;COMPRA SUPERMERCADO;-245,30\r\n' +
  '02/10/2026;PAGO QR CAFÉ;-18,00\r\n' +
  '02/10/2026;PAGO QR CAFÉ;-18,00\r\n' +
  '05/10/2026;ABONO SUELDO;8.000,00\r\n';

const SIGNED_MAPPING: CsvMapping = {
  hasHeader: true,
  skipRows: 0,
  columns: {
    date: { index: 0 },
    description: { index: 1 },
    amount: { mode: 'SIGNED', index: 2, signConvention: 'NEGATIVE_IS_OUTFLOW' },
  },
  dateFormat: 'dd/MM/yyyy',
  decimalSeparator: ',',
};

function setup(settings: { batchSize?: number } = {}) {
  const world = new MemoryWorld();
  world.addAccount({ accountId: ACCOUNT });
  const deps = createMemoryDeps(world, settings);
  return {
    world,
    deps,
    service: new ImportsService(deps),
    queries: new ImportsQueries(deps),
    persist: new PersistImportService(deps),
    maintenance: new ImportsMaintenanceService(deps),
  };
}
type Ctx = ReturnType<typeof setup>;

const upload = (ctx: Ctx, text = EXTRACTO, accountId = ACCOUNT) =>
  ctx.service.createImport({
    workspaceId: WS,
    userId: USER,
    accountId,
    fileName: 'extracto.csv',
    bytes: latin1(text),
  });

async function mapped(ctx: Ctx, text = EXTRACTO, mapping: unknown = SIGNED_MAPPING) {
  const created = await upload(ctx, text);
  const view = await ctx.service.setMapping({
    workspaceId: WS,
    userId: USER,
    importId: created.id,
    expectedVersion: created.version,
    mapping,
  });
  return { created, view };
}

async function approveAndPersist(ctx: Ctx, importId: string) {
  const current = await ctx.queries.get(WS, importId);
  const approved = await ctx.service.approve({
    workspaceId: WS,
    userId: USER,
    importId,
    expectedVersion: current.version,
  });
  const outcome = await ctx.persist.persist({ workspaceId: WS, importId });
  return { approved, outcome, final: await ctx.queries.get(WS, importId) };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERROR';
  }
  return 'OK';
};

describe('sha256 de dominio vs node:crypto', () => {
  it('coincide con la referencia para tamaños variados', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 100_003]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 256);
      expect(sha256Hex(data)).toBe(createHash('sha256').update(data).digest('hex'));
    }
  });
});

describe('sanitizeFileName', () => {
  it('quita rutas y controles y limita a 255 caracteres', () => {
    expect(sanitizeFileName('C:\\Users\\ana\\extracto.csv')).toBe('extracto.csv');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('a\u0007b.csv')).toBe('ab.csv');
    expect(sanitizeFileName('x'.repeat(300))?.length).toBe(255);
    expect(sanitizeFileName('')).toBeNull();
    expect(sanitizeFileName(null)).toBeNull();
  });
});

describe('CreateCsvImport', () => {
  it('[TC-IMPORTS-CSV-001] espera mapeo con codificación, delimitador, columnas y 4 filas de muestra, sin transacciones', async () => {
    const ctx = setup();
    const created = await upload(ctx);
    expect(created.status).toBe('AWAITING_MAPPING');
    expect(created.detected).toEqual({ encoding: 'windows-1252', delimiter: ';' });
    expect(created.header).toEqual(['Fecha', 'Descripción', 'Monto']);
    expect(created.sampleRows).toHaveLength(4);
    expect(created.rowCount).toBe(4);
    expect(created.warnings).toEqual([]);
    expect(created.originalName).toBe('extracto.csv');
    expect(ctx.world.transactions).toHaveLength(0);
    expect(ctx.world.audit.map((a) => a.action)).toEqual(['imports.import.created']);
    expect(ctx.world.events).toEqual([]);
  });

  it('[TC-IMPORTS-CSV-002] una cuenta cerrada o archivada se rechaza y no crea nada', async () => {
    const ctx = setup();
    ctx.world.addAccount({ accountId: 'closed', status: 'CLOSED' });
    ctx.world.addAccount({ accountId: 'archived', status: 'ARCHIVED' });
    expect(await codeOf(upload(ctx, EXTRACTO, 'closed'))).toBe('ACCOUNT_CLOSED');
    expect(await codeOf(upload(ctx, EXTRACTO, 'archived'))).toBe('ACCOUNT_ARCHIVED');
    expect(await codeOf(upload(ctx, EXTRACTO, 'missing'))).toBe('REFERENCE_NOT_FOUND');
    expect(ctx.world.jobs.size).toBe(0);
    expect(ctx.world.staged).toHaveLength(0);
  });

  it('[TC-IMPORTS-CSV-003] un archivo mayor que el tope es UPLOAD_TOO_LARGE', async () => {
    const ctx = setup();
    const big = new Uint8Array(2_621_440).fill(65);
    expect(
      await codeOf(
        ctx.service.createImport({ workspaceId: WS, userId: USER, accountId: ACCOUNT, bytes: big }),
      ),
    ).toBe('UPLOAD_TOO_LARGE');
    expect(ctx.world.jobs.size).toBe(0);
  });

  it('[TC-IMPORTS-CSV-004][TC-IMPORTS-CSV-005] demasiadas filas y binario no crean la importación', async () => {
    const ctx = setup();
    const many = 'Fecha,D,M\n' + Array.from({ length: 5001 }, () => '01/10/2026,x,-1.00').join('\n');
    expect(await codeOf(upload(ctx, many))).toBe('IMPORT_TOO_MANY_ROWS');
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    expect(
      await codeOf(
        ctx.service.createImport({ workspaceId: WS, userId: USER, accountId: ACCOUNT, bytes: png }),
      ),
    ).toBe('IMPORT_UNSUPPORTED_FORMAT');
    expect(ctx.world.jobs.size).toBe(0);
  });

  it('[TC-IMPORTS-CSV-019] volver a subir un archivo ya importado advierte sin bloquear', async () => {
    const ctx = setup();
    const { created } = await mapped(ctx);
    await approveAndPersist(ctx, created.id);
    const again = await upload(ctx);
    expect(again.warnings).toEqual([
      {
        code: 'IMPORT_FILE_ALREADY_IMPORTED',
        previousImportId: created.id,
        previousImportedAt: '2026-10-20',
      },
    ]);
    expect(again.status).toBe('AWAITING_MAPPING');
    // Sugiere el último mapeo de la cuenta.
    expect(again.suggestedMapping).toEqual(SIGNED_MAPPING);
  });
});

describe('SetImportMapping y vista previa', () => {
  it('[TC-IMPORTS-CSV-006][TC-IMPORTS-CSV-015] 3 salidas por 281.30 y 1 entrada de 8000.00; saldo resultante 11718.70', async () => {
    const ctx = setup();
    const { view, created } = await mapped(ctx);
    expect(view.status).toBe('AWAITING_REVIEW');
    expect(view.previewSummary).toEqual({
      counts: {
        rows: 4,
        new: 4,
        alreadyImported: 0,
        probableDuplicates: 0,
        invalid: 0,
        pendingDecisions: 0,
        toCreate: 4,
        skipped: 0,
        excluded: 0,
      },
      outflows: { amount: '281.30', currency: 'BOB' },
      inflows: { amount: '8000.00', currency: 'BOB' },
      currentBalance: { amount: '4000.00', currency: 'BOB' },
      resultingBalance: { amount: '11718.70', currency: 'BOB' },
    });
    // Sin efectos financieros hasta aprobar.
    expect(ctx.world.transactions).toHaveLength(0);
    const preview = await ctx.queries.preview(WS, created.id, { limit: 50 });
    expect(
      preview.rows.map((r) => [r.lineNumber, r.date, r.direction, r.amount?.amount, r.classification]),
    ).toEqual([
      [2, '2026-10-01', 'OUT', '245.30', 'NEW'],
      [3, '2026-10-02', 'OUT', '18.00', 'NEW'],
      [4, '2026-10-02', 'OUT', '18.00', 'NEW'],
      [5, '2026-10-05', 'IN', '8000.00', 'NEW'],
    ]);
    expect(preview.nextCursor).toBeNull();
  });

  it('[TC-IMPORTS-CSV-015] volver a enviar el mapeo recalcula las fechas sin crear nada', async () => {
    const ctx = setup();
    const { created, view } = await mapped(ctx);
    const again = await ctx.service.setMapping({
      workspaceId: WS,
      userId: USER,
      importId: created.id,
      expectedVersion: view.version,
      mapping: { ...SIGNED_MAPPING, dateFormat: 'MM/dd/yyyy' },
    });
    expect(again.status).toBe('AWAITING_REVIEW');
    const preview = await ctx.queries.preview(WS, created.id, { limit: 50 });
    // 01/10 con MM/dd es 10 de enero de 2026; 05/10 es 10 de mayo.
    expect(preview.rows.map((r) => r.date)).toEqual(['2026-01-10', '2026-02-10', '2026-02-10', '2026-05-10']);
    expect(ctx.world.transactions).toHaveLength(0);
  });

  it('[TC-IMPORTS-CSV-009] un mapeo inválido es IMPORT_MAPPING_INVALID y la importación sigue esperando mapeo', async () => {
    const ctx = setup();
    const created = await upload(ctx);
    const bad = {
      ...SIGNED_MAPPING,
      columns: {
        ...SIGNED_MAPPING.columns,
        amount: { mode: 'SIGNED', index: 7, signConvention: 'NEGATIVE_IS_OUTFLOW' },
      },
    };
    expect(
      await codeOf(
        ctx.service.setMapping({
          workspaceId: WS,
          userId: USER,
          importId: created.id,
          expectedVersion: created.version,
          mapping: bad,
        }),
      ),
    ).toBe('IMPORT_MAPPING_INVALID');
    expect((await ctx.queries.get(WS, created.id)).status).toBe('AWAITING_MAPPING');
  });

  it('exige la versión vigente (If-Match) y el estado correcto', async () => {
    const ctx = setup();
    const { created } = await mapped(ctx);
    expect(
      await codeOf(
        ctx.service.setMapping({
          workspaceId: WS,
          userId: USER,
          importId: created.id,
          expectedVersion: 1,
          mapping: SIGNED_MAPPING,
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
    expect(
      await codeOf(
        ctx.service.setMapping({
          workspaceId: WS,
          userId: USER,
          importId: 'nope',
          expectedVersion: 1,
          mapping: SIGNED_MAPPING,
        }),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
  });

  it('[TC-IMPORTS-CSV-007] débito y crédito: una fila con ambos valores es inválida', async () => {
    const ctx = setup();
    const text =
      'Fecha;Descripción;Débito;Crédito\n01/10/2026;A;100,00;\n02/10/2026;B;245,30;\n03/10/2026;C;5,00;7,00\n';
    const { view, created } = await mapped(ctx, text, {
      ...SIGNED_MAPPING,
      columns: {
        date: { index: 0 },
        description: { index: 1 },
        amount: { mode: 'DEBIT_CREDIT', debitIndex: 2, creditIndex: 3 },
      },
    });
    expect(view.previewSummary.counts).toMatchObject({ rows: 3, new: 2, invalid: 1 });
    const invalid = await ctx.queries.preview(WS, created.id, { limit: 50, classification: 'INVALID' });
    expect(invalid.rows.map((r) => [r.lineNumber, r.issues.map((i) => i.code), r.decision])).toEqual([
      [4, ['IMPORT_INVALID_AMOUNT'], 'EXCLUDE'],
    ]);
  });

  it('[TC-IMPORTS-CSV-013][TC-IMPORTS-CSV-014] monto cero, fecha futura y periodo cerrado son inválidos', async () => {
    const ctx = setup();
    ctx.world.closed = [{ start: '2026-08-01', end: '2026-08-31' }];
    const text =
      'Fecha;Descripción;Monto\n10/10/2026;CERO;0,00\n25/10/2026;FUTURO;-50,00\n22/10/2026;OK;-30,00\n15/08/2026;AGOSTO;-75,00\n';
    const { created } = await mapped(ctx, text);
    const preview = await ctx.queries.preview(WS, created.id, { limit: 50 });
    expect(preview.rows.map((r) => [r.lineNumber, r.classification, r.issues.map((i) => i.code)])).toEqual([
      [2, 'INVALID', ['IMPORT_INVALID_AMOUNT']],
      [3, 'INVALID', ['IMPORT_FUTURE_DATE']],
      [4, 'NEW', []],
      [5, 'INVALID', ['PERIOD_CLOSED']],
    ]);
  });

  it('el encabezado y las filas saltadas quedan fuera de los datos', async () => {
    const ctx = setup();
    const text = 'BANCO XYZ\nCuenta 123\nFecha;Descripción;Monto\n01/10/2026;A;-1,00\n';
    const { view, created } = await mapped(ctx, text, { ...SIGNED_MAPPING, skipRows: 2 });
    expect(view.previewSummary.counts.rows).toBe(1);
    const preview = await ctx.queries.preview(WS, created.id, { limit: 50 });
    expect(preview.rows.map((r) => r.lineNumber)).toEqual([4]);
  });
});

describe('Idempotencia y deduplicación', () => {
  it('[TC-IMPORTS-CSV-023] aprobar crea gastos e ingresos posteados sin categoría y deja 2 eventos propios', async () => {
    const ctx = setup();
    const { created } = await mapped(ctx);
    const { approved, outcome, final } = await approveAndPersist(ctx, created.id);
    expect(approved.status).toBe('APPROVED');
    expect(outcome).toEqual({ status: 'DONE', batches: 1, failedBatches: 0 });
    expect(final.status).toBe('COMPLETED');
    expect(final.counters).toMatchObject({ rows: 4, created: 4, failed: 0, invalid: 0 });
    expect(final.completedAt).toBe('2026-10-20T14:00:00.000Z');
    expect(
      ctx.world.transactions.map((t) => [t.signed, t.source, t.categoryName, t.importJobId === created.id]),
    ).toEqual([
      ['-245.30', 'IMPORT', 'UNCATEGORIZED', true],
      ['-18.00', 'IMPORT', 'UNCATEGORIZED', true],
      ['-18.00', 'IMPORT', 'UNCATEGORIZED', true],
      ['8000.00', 'IMPORT', 'UNCATEGORIZED_INCOME', true],
    ]);
    // Imports no emite eventos por fila: solo la aprobación y el fin.
    expect(ctx.world.events.map((e) => e.eventType)).toEqual([
      'imports.ImportApproved',
      'imports.ImportCompleted',
    ]);
    expect(ctx.world.events[0]?.payload).toMatchObject({
      importJobId: created.id,
      accountId: ACCOUNT,
      attempt: 1,
    });
    expect(ctx.world.events[1]?.payload).toMatchObject({
      status: 'COMPLETED',
      sourceType: 'FILE_CSV',
      stats: { total: 4, imported: 4, duplicates: 0, ignored: 0, errors: 0 },
      dateRange: { from: '2026-10-01', to: '2026-10-05' },
    });
    expect(ctx.world.audit.map((a) => a.action)).toEqual([
      'imports.import.created',
      'imports.import.approved',
      'imports.import.completed',
    ]);
    // Los logs de auditoría no llevan descripciones ni montos de filas.
    expect(JSON.stringify(ctx.world.audit)).not.toMatch(/SUPERMERCADO|245/);
  });

  it('[TC-IMPORTS-CSV-016] reimportar el mismo archivo clasifica 4 ya importadas y crea 0 transacciones', async () => {
    const ctx = setup();
    const first = await mapped(ctx);
    await approveAndPersist(ctx, first.created.id);
    expect(ctx.world.transactions).toHaveLength(4);

    const second = await mapped(ctx);
    expect(second.view.previewSummary.counts).toMatchObject({
      rows: 4,
      new: 0,
      alreadyImported: 4,
      toCreate: 0,
    });
    expect(second.view.previewSummary.outflows.amount).toBe('0.00');
    const { final } = await approveAndPersist(ctx, second.created.id);
    expect(final.status).toBe('COMPLETED');
    expect(final.counters).toMatchObject({ created: 0, alreadyImported: 4 });
    expect(ctx.world.transactions).toHaveLength(4);
  });

  it('[TC-IMPORTS-CSV-017] un archivo solapado crea solo las filas nuevas', async () => {
    const ctx = setup();
    const head = 'Fecha;Descripción;Monto\n';
    const first = Array.from(
      { length: 10 },
      (_, i) => `${String(i + 1).padStart(2, '0')}/09/2026;GASTO ${i};-${i + 1},00`,
    );
    const all = Array.from(
      { length: 25 },
      (_, i) => `${String((i % 25) + 1).padStart(2, '0')}/09/2026;GASTO ${i};-${i + 1},00`,
    );
    const a = await mapped(ctx, head + first.join('\n'));
    await approveAndPersist(ctx, a.created.id);
    const b = await mapped(ctx, head + all.join('\n'));
    expect(b.view.previewSummary.counts).toMatchObject({ rows: 25, alreadyImported: 10, new: 15 });
    await approveAndPersist(ctx, b.created.id);
    expect(ctx.world.transactions).toHaveLength(25);
  });

  it('[TC-IMPORTS-CSV-018] una compra anulada vuelve a ser importable y las otras 3 siguen ya importadas', async () => {
    const ctx = setup();
    const first = await mapped(ctx);
    await approveAndPersist(ctx, first.created.id);
    const cafes = ctx.world.transactions.filter((t) => t.signed === '-18.00');
    expect(cafes).toHaveLength(2);
    (cafes[1] as { status: string }).status = 'VOIDED';

    const second = await mapped(ctx);
    expect(second.view.previewSummary.counts).toMatchObject({ alreadyImported: 3, new: 1 });
    const links = ctx.world.links.filter((l) => l.status === 'SUPERSEDED');
    expect(links).toHaveLength(1);
    await approveAndPersist(ctx, second.created.id);
    expect(ctx.world.transactions.filter((t) => t.status === 'POSTED')).toHaveLength(4);
  });

  it('[TC-IMPORTS-CSV-020] gasto manual y transferencia registrada son posibles duplicados con candidato', async () => {
    const ctx = setup();
    ctx.world.addTransaction({
      accountId: ACCOUNT,
      date: '2026-10-02',
      signed: '-245.30',
      description: 'Supermercado',
    });
    ctx.world.addTransaction({
      accountId: ACCOUNT,
      kind: 'TRANSFER',
      date: '2026-10-10',
      signed: '-400.00',
      description: 'Pago Visa',
    });
    const text =
      'Fecha;Descripción;Monto\n01/10/2026;COMPRA SUPERMERCADO;-245,30\n10/10/2026;PAGO TARJETA;-400,00\n';
    const { created, view } = await mapped(ctx, text);
    expect(view.previewSummary.counts).toMatchObject({ probableDuplicates: 2, pendingDecisions: 2, new: 0 });
    const preview = await ctx.queries.preview(WS, created.id, { limit: 50 });
    expect(
      preview.rows.map((r) => [r.classification, r.decision, r.candidate?.kind, r.candidate?.description]),
    ).toEqual([
      ['DUPLICATE_PROBABLE', null, 'EXPENSE', 'Supermercado'],
      ['DUPLICATE_PROBABLE', null, 'TRANSFER', 'Pago Visa'],
    ]);
  });

  it('[TC-IMPORTS-CSV-020] fuera de la ventana de ±3 días la fila es nueva', async () => {
    const ctx = setup();
    ctx.world.addTransaction({
      accountId: ACCOUNT,
      date: '2026-10-06',
      signed: '-245.30',
      description: 'Super',
    });
    const { view } = await mapped(ctx, 'Fecha;Descripción;Monto\n01/10/2026;COMPRA SUPERMERCADO;-245,30\n');
    expect(view.previewSummary.counts).toMatchObject({ new: 1, probableDuplicates: 0 });
  });

  it('[TC-IMPORTS-CSV-022] aprobar con un posible duplicado sin decidir es IMPORT_REVIEW_INCOMPLETE', async () => {
    const ctx = setup();
    ctx.world.addTransaction({ accountId: ACCOUNT, date: '2026-10-02', signed: '-245.30' });
    const { created, view } = await mapped(ctx);
    let details: unknown;
    try {
      await ctx.service.approve({
        workspaceId: WS,
        userId: USER,
        importId: created.id,
        expectedVersion: view.version,
      });
    } catch (e) {
      expect((e as { code: string }).code).toBe('IMPORT_REVIEW_INCOMPLETE');
      details = (e as { details: unknown }).details;
    }
    expect(details).toEqual({ pendingDecisions: 1 });
    expect((await ctx.queries.get(WS, created.id)).status).toBe('AWAITING_REVIEW');
    expect(ctx.world.transactions).toHaveLength(1);
  });

  it('[TC-IMPORTS-CSV-021][TC-IMPORTS-CSV-023] omitir un duplicado lo vincula; una reimportación lo reconoce', async () => {
    const ctx = setup();
    const manual = ctx.world.addTransaction({
      accountId: ACCOUNT,
      date: '2026-10-02',
      signed: '-245.30',
      description: 'Supermercado',
    });
    const { created, view } = await mapped(ctx);
    const rows = await ctx.queries.preview(WS, created.id, {
      limit: 50,
      classification: 'DUPLICATE_PROBABLE',
    });
    const decided = await ctx.service.decideRow({
      workspaceId: WS,
      userId: USER,
      importId: created.id,
      rowId: rows.rows[0]?.id as string,
      expectedVersion: view.version,
      decision: 'SKIP',
    });
    expect(decided.row.decision).toBe('SKIP');
    expect(decided.counters).toMatchObject({ skipped: 1, probableDuplicates: 1, toCreate: 3 });

    const { final } = await approveAndPersist(ctx, created.id);
    expect(final.counters).toMatchObject({ created: 3, skipped: 1, rows: 4 });
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(3);
    const skipLinks = ctx.world.links.filter((l) => l.kind === 'SKIPPED_AS_DUPLICATE');
    expect(skipLinks.map((l) => l.transactionId)).toEqual([manual.id]);

    const again = await mapped(ctx);
    expect(again.view.previewSummary.counts).toMatchObject({ alreadyImported: 4, new: 0 });
  });

  it('las decisiones de fila respetan las reglas: SKIP solo en duplicados; inválidas y ya importadas son fijas', async () => {
    const ctx = setup();
    const text = 'Fecha;Descripción;Monto\n01/10/2026;A;-1,00\n31/02/2026;B;-1,00\n';
    const { created, view } = await mapped(ctx, text);
    const all = await ctx.queries.preview(WS, created.id, { limit: 50 });
    const [newRow, invalidRow] = all.rows;
    const decide = (rowId: string, decision: 'CREATE' | 'SKIP' | 'EXCLUDE', expectedVersion: number) =>
      ctx.service.decideRow({
        workspaceId: WS,
        userId: USER,
        importId: created.id,
        rowId,
        expectedVersion,
        decision,
      });
    expect(await codeOf(decide(newRow?.id as string, 'SKIP', view.version))).toBe('VALIDATION_FAILED');
    expect(await codeOf(decide(invalidRow?.id as string, 'CREATE', view.version))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    const excluded = await decide(newRow?.id as string, 'EXCLUDE', view.version);
    expect(excluded.counters).toMatchObject({ excluded: 1, toCreate: 0 });
    expect(await codeOf(decide(newRow?.id as string, 'CREATE', view.version))).toBe('PRECONDITION_FAILED');
    expect(await codeOf(decide('nope', 'CREATE', excluded.version))).toBe('RESOURCE_NOT_FOUND');
  });

  it('re-mapear conserva la decisión de la fila cuya huella no cambió', async () => {
    const ctx = setup();
    const { created, view } = await mapped(ctx);
    const rows = await ctx.queries.preview(WS, created.id, { limit: 50 });
    const decided = await ctx.service.decideRow({
      workspaceId: WS,
      userId: USER,
      importId: created.id,
      rowId: rows.rows[3]?.id as string,
      expectedVersion: view.version,
      decision: 'EXCLUDE',
    });
    const again = await ctx.service.setMapping({
      workspaceId: WS,
      userId: USER,
      importId: created.id,
      expectedVersion: decided.version,
      mapping: SIGNED_MAPPING,
    });
    expect(again.previewSummary.counts).toMatchObject({ excluded: 1, toCreate: 3 });
  });
});

describe('Idempotencia (propiedades, INV-014)', () => {
  const rowArb = fc.record({
    day: fc.integer({ min: 1, max: 28 }),
    description: fc.constantFrom('CAFE', 'TAXI', 'SUPERMERCADO', 'FARMACIA'),
    cents: fc.integer({ min: 1, max: 3 }),
  });
  const line = (r: { day: number; description: string; cents: number }) =>
    `${String(r.day).padStart(2, '0')}/09/2026;${r.description};-${r.cents},50`;
  const file = (rows: readonly { day: number; description: string; cents: number }[]) =>
    ['Fecha;Descripción;Monto', ...rows.map(line)].join(String.fromCharCode(13, 10)) +
    String.fromCharCode(13, 10);

  it('[TC-IMPORTS-CSV-016] PBT: import(f); import(f) crea lo mismo que import(f) una vez, aunque haya filas idénticas', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(rowArb, { minLength: 1, maxLength: 12 }), async (rows) => {
        const ctx = setup();
        const text = file(rows);
        await approveAndPersist(ctx, (await mapped(ctx, text)).created.id);
        expect(ctx.world.transactions).toHaveLength(rows.length);
        await approveAndPersist(ctx, (await mapped(ctx, text)).created.id);
        expect(ctx.world.transactions).toHaveLength(rows.length);
      }),
      { numRuns: 40 },
    );
  }, 60_000);

  it('[TC-IMPORTS-CSV-017] PBT: importar un rango y luego uno que lo contiene crea exactamente las filas nuevas', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(rowArb, { minLength: 2, maxLength: 12 }), fc.nat(), async (rows, seed) => {
        const cut = 1 + (seed % (rows.length - 1));
        const ctx = setup();
        await approveAndPersist(ctx, (await mapped(ctx, file(rows.slice(0, cut)))).created.id);
        expect(ctx.world.transactions).toHaveLength(cut);
        await approveAndPersist(ctx, (await mapped(ctx, file(rows))).created.id);
        expect(ctx.world.transactions).toHaveLength(rows.length);
      }),
      { numRuns: 40 },
    );
  }, 60_000);
});

describe('Fallo parcial, reintento y reanudación', () => {
  const fourSeptemberRows = () =>
    'Fecha;Descripción;Monto\n' +
    ['01/09/2026', '02/09/2026', '03/10/2026', '04/10/2026']
      .map((d, i) => `${d};GASTO ${i};-${i + 1},00`)
      .join('\n');

  it('[TC-IMPORTS-CSV-024] un lote rechazado por periodo cerrado deja el import parcial y el reintento crea las faltantes', async () => {
    const ctx = setup({ batchSize: 2 });
    const { created } = await mapped(ctx, fourSeptemberRows());
    const current = await ctx.queries.get(WS, created.id);
    await ctx.service.approve({
      workspaceId: WS,
      userId: USER,
      importId: created.id,
      expectedVersion: current.version,
    });
    // El periodo de septiembre se cierra entre la vista previa y la persistencia: el lote 1 (septiembre) falla.
    ctx.world.lockedDates = new Set(['2026-09-01', '2026-09-02']);
    const outcome = await ctx.persist.persist({ workspaceId: WS, importId: created.id });
    expect(outcome).toEqual({ status: 'DONE', batches: 2, failedBatches: 1 });
    const partial = await ctx.queries.get(WS, created.id);
    expect(partial.status).toBe('PARTIALLY_FAILED');
    expect(partial.counters).toMatchObject({ created: 2, failed: 2 });
    expect(partial.errors).toEqual([{ code: 'PERIOD_CLOSED', count: 2, lines: [2, 3] }]);
    expect(ctx.world.transactions).toHaveLength(2);

    // El OWNER reabre el periodo y se reintenta: se crean las 2 restantes sin duplicar las ya creadas.
    ctx.world.lockedDates = new Set();
    await ctx.service.retry({ workspaceId: WS, userId: USER, importId: created.id });
    expect((await ctx.queries.get(WS, created.id)).status).toBe('PERSISTING');
    await ctx.persist.persist({ workspaceId: WS, importId: created.id });
    const done = await ctx.queries.get(WS, created.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.counters).toMatchObject({ created: 4, failed: 0 });
    expect(done.errors).toEqual([]);
    expect(ctx.world.transactions).toHaveLength(4);
    expect(ctx.world.events.map((e) => e.eventType)).toEqual([
      'imports.ImportApproved',
      'imports.ImportCompleted',
      'imports.ImportApproved',
      'imports.ImportCompleted',
    ]);
    expect(ctx.world.events[2]?.payload).toMatchObject({ attempt: 2 });
  });

  it('[TC-IMPORTS-CSV-024] aceptar el resultado parcial termina completada con errores', async () => {
    const ctx = setup({ batchSize: 2 });
    const { created } = await mapped(ctx, fourSeptemberRows());
    const current = await ctx.queries.get(WS, created.id);
    await ctx.service.approve({
      workspaceId: WS,
      userId: USER,
      importId: created.id,
      expectedVersion: current.version,
    });
    ctx.world.lockedDates = new Set(['2026-09-01', '2026-09-02']);
    await ctx.persist.persist({ workspaceId: WS, importId: created.id });
    const accepted = await ctx.service.acceptErrors({ workspaceId: WS, userId: USER, importId: created.id });
    expect(accepted.status).toBe('COMPLETED_WITH_ERRORS');
    expect(accepted.counters).toMatchObject({ created: 2, failed: 2 });
    expect(ctx.world.events.at(-1)).toMatchObject({
      eventType: 'imports.ImportCompleted',
      payload: { status: 'COMPLETED_WITH_ERRORS', stats: { imported: 2, errors: 2 } },
    });
    expect(ctx.world.audit.map((a) => a.action)).toContain('imports.import.errors_accepted');
    expect(await codeOf(ctx.service.retry({ workspaceId: WS, userId: USER, importId: created.id }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });

  it('una caída transitoria a mitad de la persistencia se reanuda sin duplicados', async () => {
    const ctx = setup({ batchSize: 2 });
    const { created } = await mapped(ctx, fourSeptemberRows());
    const current = await ctx.queries.get(WS, created.id);
    await ctx.service.approve({
      workspaceId: WS,
      userId: USER,
      importId: created.id,
      expectedVersion: current.version,
    });
    ctx.world.transientFailureAt = 2;
    await expect(ctx.persist.persist({ workspaceId: WS, importId: created.id })).rejects.toThrow(
      'connection reset',
    );
    expect((await ctx.queries.get(WS, created.id)).status).toBe('PERSISTING');
    expect(ctx.world.transactions).toHaveLength(2);

    // El consumidor reintenta: el lote 1 ya tiene transacciones y se salta.
    ctx.world.transientFailureAt = null;
    const outcome = await ctx.persist.persist({ workspaceId: WS, importId: created.id });
    expect(outcome.status).toBe('DONE');
    expect(ctx.world.transactions).toHaveLength(4);
    expect((await ctx.queries.get(WS, created.id)).status).toBe('COMPLETED');
  });

  it('[TC-IMPORTS-CSV-024] dos aprobaciones paralelas no duplican: la segunda ve las filas como existentes', async () => {
    const ctx = setup();
    const a = await mapped(ctx);
    const b = await mapped(ctx);
    await ctx.service.approve({
      workspaceId: WS,
      userId: USER,
      importId: a.created.id,
      expectedVersion: a.view.version,
    });
    await ctx.service.approve({
      workspaceId: WS,
      userId: USER,
      importId: b.created.id,
      expectedVersion: b.view.version,
    });
    await ctx.persist.persist({ workspaceId: WS, importId: a.created.id });
    await ctx.persist.persist({ workspaceId: WS, importId: b.created.id });
    expect(ctx.world.transactions).toHaveLength(4);
    const second = await ctx.queries.get(WS, b.created.id);
    expect(second.status).toBe('COMPLETED');
    expect(second.counters).toMatchObject({ created: 0, alreadyImported: 4 });
  });

  it('re-entregar el evento de un import terminado o cancelado es un no-op', async () => {
    const ctx = setup();
    const { created } = await mapped(ctx);
    await approveAndPersist(ctx, created.id);
    const events = ctx.world.events.length;
    expect(await ctx.persist.persist({ workspaceId: WS, importId: created.id })).toEqual({
      status: 'SKIPPED',
      batches: 0,
      failedBatches: 0,
    });
    expect(await ctx.persist.persist({ workspaceId: WS, importId: 'missing' })).toMatchObject({
      status: 'SKIPPED',
    });
    expect(ctx.world.events).toHaveLength(events);
  });

  it('aprobar una importación sin filas a crear termina completada con 0 transacciones', async () => {
    const ctx = setup();
    const first = await mapped(ctx);
    await approveAndPersist(ctx, first.created.id);
    const second = await mapped(ctx);
    const { approved, final } = await approveAndPersist(ctx, second.created.id);
    expect(approved.progress.batchCount).toBe(0);
    expect(final.status).toBe('COMPLETED');
  });
});

describe('CancelImport y retención', () => {
  it('[TC-IMPORTS-CSV-025] cancelar en revisión descarta el staging; una completada no se puede cancelar', async () => {
    const ctx = setup();
    const { created } = await mapped(ctx);
    const cancelled = await ctx.service.cancel({ workspaceId: WS, userId: USER, importId: created.id });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledBy).toBe(USER);
    expect(ctx.world.staged).toHaveLength(0);
    expect(ctx.world.transactions).toHaveLength(0);
    expect(ctx.world.audit.map((a) => a.action)).toContain('imports.import.cancelled');

    const other = await mapped(ctx);
    await approveAndPersist(ctx, other.created.id);
    expect(
      await codeOf(ctx.service.cancel({ workspaceId: WS, userId: USER, importId: other.created.id })),
    ).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-IMPORTS-CSV-030] purga el staging a los 90 días y expira la revisión abandonada a los 30', async () => {
    const ctx = setup();
    const done = await mapped(ctx);
    await approveAndPersist(ctx, done.created.id);
    const waiting = await mapped(ctx);

    // 2026-11-19: la revisión abandonada (creada el 2026-10-20) expira; el completado conserva su staging.
    ctx.world.clock.set(Instant.parse('2026-11-19T14:00:00.000Z'));
    expect(await ctx.maintenance.expireReviews(WS)).toBe(1);
    const expired = await ctx.queries.get(WS, waiting.created.id);
    expect(expired.status).toBe('CANCELLED');
    expect(expired.cancelledBy).toBe('SYSTEM');
    expect(ctx.world.staged.some((s) => s.jobId === waiting.created.id)).toBe(false);
    expect(ctx.world.staged.some((s) => s.jobId === done.created.id)).toBe(true);
    const expiredAudit = ctx.world.audit.find((a) => a.action === 'imports.import.expired');
    expect(expiredAudit?.actor).toEqual({ type: 'SYSTEM', process: 'imports.expire-reviews' });
    expect(await ctx.maintenance.expireReviews(WS)).toBe(0);

    // 2027-01-18: 90 días tras terminar el import del 2026-10-20.
    expect(await ctx.maintenance.purgeStaging(WS)).toBe(0);
    ctx.world.clock.set(Instant.parse('2027-01-18T14:00:00.000Z'));
    expect(await ctx.maintenance.purgeStaging(WS)).toBe(5);
    expect(ctx.world.staged.some((s) => s.jobId === done.created.id)).toBe(false);
    expect((await ctx.queries.get(WS, done.created.id)).counters.created).toBe(4);
    expect(ctx.world.links.filter((l) => l.status === 'ACTIVE')).toHaveLength(4);

    // Reimportar el mismo archivo sigue dando 0 nuevas.
    const again = await mapped(ctx);
    expect(again.view.previewSummary.counts).toMatchObject({ alreadyImported: 4, new: 0 });
  });
});
