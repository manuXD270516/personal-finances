import { describe, expect, it } from 'vitest';
import {
  ACCOUNT,
  INSTITUTION,
  USER,
  WS,
  addDocument,
  codeOf,
  importDocument,
  jsonStatement,
  ofx,
  previewRows,
  setupPipeline,
} from './pipeline-harness.js';

const OFX_3 = ofx(
  [
    { fitid: '2026030100017', date: '20260301020000[0:UTC]', amount: '-245.30', name: 'COMPRA SUPERMERCADO' },
    { fitid: '2026030500021', date: '20260305', amount: '1500.00', name: 'ABONO SUELDO SINTETICO' },
    { fitid: '2026031000033', date: '20260310120000', amount: '-235.38', name: 'PAGO SERVICIOS' },
  ],
  { closing: { amount: '1019.32', date: '20260331' } },
);

describe('Importación desde un documento', () => {
  it('[TC-IMPORTS-PIPELINE-004] queda subida y vinculada al documento, con su suma, sin transacciones', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, { format: 'OFX', text: OFX_3, name: 'extracto-marzo.ofx' });
    const created = await ctx.service.createFromDocument({
      workspaceId: WS,
      userId: USER,
      accountId: ACCOUNT,
      documentId,
    });
    expect(created).toMatchObject({
      status: 'UPLOADED',
      documentId,
      format: 'OFX',
      source: 'FILE_OFX',
      fileSha256: ctx.world.documents.get(documentId)?.sha256,
    });
    expect(ctx.world.documents.get(documentId)?.linkedTo).toEqual([created.id]);
    expect(ctx.world.transactions).toHaveLength(0);
    expect(ctx.world.events.map((e) => e.eventType)).toEqual(['imports.ImportFileUploaded']);
    expect(ctx.world.lifecycle.at(-1)?.steps[0]).toMatchObject({
      kind: 'TRANSITION',
      transition: 'CREATE_FROM_DOCUMENT',
      fromState: null,
      toState: 'UPLOADED',
    });
  });

  it('[TC-IMPORTS-PIPELINE-005] un documento pendiente de subida se rechaza con DOCUMENT_NOT_AVAILABLE', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, { format: 'OFX', text: OFX_3, status: 'PENDING_UPLOAD' });
    expect(
      await codeOf(
        ctx.service.createFromDocument({ workspaceId: WS, userId: USER, accountId: ACCOUNT, documentId }),
      ),
    ).toBe('DOCUMENT_NOT_AVAILABLE');
    expect(ctx.world.jobs.size).toBe(0);
  });

  it('[TC-IMPORTS-PIPELINE-006] un documento con otro propósito se rechaza con VALIDATION_FAILED', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, { format: 'OFX', text: OFX_3, purpose: 'RECEIPT' });
    expect(
      await codeOf(
        ctx.service.createFromDocument({ workspaceId: WS, userId: USER, accountId: ACCOUNT, documentId }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(ctx.world.jobs.size).toBe(0);
  });

  it('[TC-IMPORTS-PIPELINE-012] un extracto PDF se rechaza con IMPORT_UNSUPPORTED_FORMAT; uno inexistente, REFERENCE_NOT_FOUND', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, { format: 'PDF', text: '%PDF-1.7' });
    expect(
      await codeOf(
        ctx.service.createFromDocument({ workspaceId: WS, userId: USER, accountId: ACCOUNT, documentId }),
      ),
    ).toBe('IMPORT_UNSUPPORTED_FORMAT');
    expect(
      await codeOf(
        ctx.service.createFromDocument({
          workspaceId: WS,
          userId: USER,
          accountId: ACCOUNT,
          documentId: 'nope',
        }),
      ),
    ).toBe('REFERENCE_NOT_FOUND');
    expect(ctx.world.jobs.size).toBe(0);
  });
});

describe('Lectura de OFX y revisión', () => {
  it('[TC-IMPORTS-PIPELINE-014] el OFX llega a revisión con identificador del banco, fecha de negocio y saldo del extracto', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, { format: 'OFX', text: OFX_3 });
    const { outcome, job } = await importDocument(ctx, documentId);
    expect(outcome).toBe('AWAITING_REVIEW');
    expect(job.status).toBe('AWAITING_REVIEW');
    expect(job.statement?.closingBalance).toEqual({ amount: '1019.32', currency: 'BOB' });
    expect(job.statement?.periodTo ?? job.statement?.periodFrom).toBeTruthy();
    const { rows } = await previewRows(ctx, job.id);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      externalId: '2026030100017',
      // 20260301020000[0:UTC] ⇒ 2026-02-28 22:00 en La Paz.
      date: '2026-02-28',
      direction: 'OUT',
      amount: { amount: '245.30', currency: 'BOB' },
      description: 'COMPRA SUPERMERCADO',
      classification: 'NEW',
      decision: 'CREATE',
    });
  });

  it('[TC-IMPORTS-PIPELINE-016] un OFX en USD para una cuenta en BOB deja todas sus filas inválidas por moneda', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, {
      format: 'OFX',
      text: ofx([{ fitid: 'A1', date: '20260301', amount: '-10.00', name: 'X' }], { currency: 'USD' }),
    });
    const { job } = await importDocument(ctx, documentId);
    const { rows } = await previewRows(ctx, job.id);
    expect(rows.every((r) => r.classification === 'INVALID')).toBe(true);
    expect(rows[0]?.issues.map((i) => i.code)).toContain('IMPORT_CURRENCY_MISMATCH');
  });

  it('[TC-IMPORTS-PIPELINE-009] un OFX con el bloque de movimientos sin cerrar queda en falló la lectura, sin filas', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, {
      format: 'OFX',
      text: ofx([{ fitid: 'A1', date: '20260301', amount: '-10.00', name: 'X' }], { omitClose: true }),
    });
    const { outcome, job } = await importDocument(ctx, documentId);
    expect(outcome).toBe('PARSE_FAILED');
    expect(job.status).toBe('PARSE_FAILED');
    expect(job.failure?.code).toBe('IMPORT_PARSE_FAILED');
    expect(ctx.world.staged).toHaveLength(0);
    expect(ctx.world.events.map((e) => e.eventType)).toContain('imports.ImportFailed');
    // El error no copia texto del archivo (NFR-SEC-015).
    expect(JSON.stringify(job.failure)).not.toContain('SINTETICO');
  });

  it('[TC-IMPORTS-PIPELINE-067] un OFX de 5 001 movimientos falla la lectura con IMPORT_TOO_MANY_ROWS sin filas', async () => {
    const ctx = setupPipeline();
    const movements = Array.from({ length: 5001 }, (_, i) => ({
      fitid: `F${i}`,
      date: '20260301',
      amount: '-1.00',
      name: `MOV ${i}`,
    }));
    const documentId = addDocument(ctx, { format: 'OFX', text: ofx(movements) });
    const { job } = await importDocument(ctx, documentId);
    expect(job.status).toBe('PARSE_FAILED');
    expect(job.failure?.code).toBe('IMPORT_TOO_MANY_ROWS');
    expect(ctx.world.staged).toHaveLength(0);
  }, 30_000);

  it('[TC-IMPORTS-PIPELINE-068] un CSV de 51 columnas falla la lectura con IMPORT_UNSUPPORTED_FORMAT sin filas', async () => {
    const ctx = setupPipeline();
    const header = Array.from({ length: 51 }, (_, i) => `c${i}`).join(';');
    const documentId = addDocument(ctx, { format: 'CSV', text: `${header}\r\n${header}\r\n` });
    const { job } = await importDocument(ctx, documentId);
    expect(job.status).toBe('PARSE_FAILED');
    expect(job.failure?.code).toBe('IMPORT_UNSUPPORTED_FORMAT');
    expect(ctx.world.staged).toHaveLength(0);
  });

  it('[TC-IMPORTS-PIPELINE-007] informa la etapa y las filas procesadas mientras procesa', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, { format: 'OFX', text: OFX_3 });
    const seen: { status: string; stage: string | null }[] = [];
    const base = ctx.deps.rules;
    (ctx.deps as { rules: typeof base }).rules = {
      async evaluate(input) {
        const view = await ctx.queries.get(WS, [...ctx.world.jobs.keys()][0] as string);
        seen.push({ status: view.status, stage: view.stage ?? null });
        return base.evaluate(input);
      },
    };
    const { job } = await importDocument(ctx, documentId);
    expect(seen).toEqual([{ status: 'PROCESSING', stage: 'CLASSIFY' }]);
    expect(job.status).toBe('AWAITING_REVIEW');
    expect(job.stage).toBeNull();
  });

  it('[TC-IMPORTS-PIPELINE-010] cancelar durante el procesamiento deja la importación cancelada, sin filas ni transacciones', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, { format: 'OFX', text: OFX_3 });
    const base = ctx.deps.rules;
    (ctx.deps as { rules: typeof base }).rules = {
      async evaluate(input) {
        await ctx.service.cancel({
          workspaceId: WS,
          userId: USER,
          importId: [...ctx.world.jobs.keys()][0] as string,
        });
        return base.evaluate(input);
      },
    };
    const { outcome, job } = await importDocument(ctx, documentId);
    expect(outcome).toBe('CANCELLED');
    expect(job.status).toBe('CANCELLED');
    expect(ctx.world.staged).toHaveLength(0);
    expect(ctx.world.transactions).toHaveLength(0);
  });

  it('[TC-IMPORTS-PIPELINE-008] una interrupción durante la lectura se reanuda con exactamente una fila por línea', async () => {
    const ctx = setupPipeline();
    const movements = Array.from({ length: 3000 }, (_, i) => ({
      fitid: `F${i}`,
      date: '20260302',
      amount: `-${(i % 90) + 1}.00`,
      name: `MOVIMIENTO ${i}`,
    }));
    const documentId = addDocument(ctx, { format: 'OFX', text: ofx(movements) });
    const created = await ctx.service.createFromDocument({
      workspaceId: WS,
      userId: USER,
      accountId: ACCOUNT,
      documentId,
    });
    const staging = ctx.deps.staging;
    let calls = 0;
    let armed = true;
    (ctx.deps as { staging: typeof staging }).staging = new Proxy(staging, {
      get(target, prop) {
        if (prop === 'insertRecords') {
          return async (...args: Parameters<typeof staging.insertRecords>) => {
            calls += 1;
            // Se interrumpe en el tercer bloque, después de 2000 de 3000 filas.
            if (armed && calls === 3) throw new Error('connection reset');
            return staging.insertRecords(...args);
          };
        }
        const value = (target as unknown as Record<string, unknown>)[prop as string];
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    await expect(ctx.process.process({ workspaceId: WS, importId: created.id })).rejects.toThrow(
      'connection reset',
    );
    expect(ctx.world.staged).toHaveLength(2000);
    armed = false;
    const outcome = await ctx.process.process({ workspaceId: WS, importId: created.id });
    expect(outcome).toBe('AWAITING_REVIEW');
    expect(ctx.world.staged).toHaveLength(3000);
    expect(new Set(ctx.world.staged.map((s) => s.rowNumber)).size).toBe(3000);
  }, 60_000);

  it('una reentrega del evento sobre un job ya en revisión no hace nada', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, { format: 'OFX', text: OFX_3 });
    const { job } = await importDocument(ctx, documentId);
    expect(await ctx.process.process({ workspaceId: WS, importId: job.id })).toBe('SKIPPED');
  });
});

describe('Otros formatos', () => {
  it('[TC-IMPORTS-PIPELINE-017] un QIF con fecha ambigua queda esperando mapeo y [TC-IMPORTS-PIPELINE-018] con día primero produce la salida', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, {
      format: 'QIF',
      text: "!Type:CCard\nD03/04'26\nT-120.00\nPRESTAURANTE SINTETICO\nMCompra con tarjeta\n^\n",
    });
    const first = await importDocument(ctx, documentId);
    expect(first.outcome).toBe('AWAITING_MAPPING');
    expect(first.job.status).toBe('AWAITING_MAPPING');
    expect(ctx.world.staged).toHaveLength(0);

    await ctx.service.setMapping({
      workspaceId: WS,
      userId: USER,
      importId: first.created.id,
      expectedVersion: first.job.version,
      mapping: { version: 'imports.profile.v1', dateOrder: 'DMY' },
    });
    expect((await ctx.queries.get(WS, first.created.id)).status).toBe('PROCESSING');
    expect(await ctx.process.process({ workspaceId: WS, importId: first.created.id })).toBe(
      'AWAITING_REVIEW',
    );
    const { rows } = await previewRows(ctx, first.created.id);
    expect(rows[0]).toMatchObject({
      date: '2026-04-03',
      direction: 'OUT',
      amount: { amount: '120.00', currency: 'BOB' },
    });
  });

  it('[TC-IMPORTS-PIPELINE-020] un JSON del esquema propio con 3 movimientos llega a revisión con 3 filas', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, {
      format: 'JSON',
      text: jsonStatement([
        {
          date: '2026-05-02',
          time: '09:30',
          amount: '-18.50',
          description: 'COMPRA SINTETICA',
          externalId: 'J-0001',
        },
        { date: '2026-05-10', amount: '500.00', description: 'ABONO SINTETICO' },
        { date: '2026-05-20', amount: '-245.00', description: 'SERVICIOS SINTETICOS' },
      ]),
    });
    const { job } = await importDocument(ctx, documentId);
    expect(job.status).toBe('AWAITING_REVIEW');
    expect((await previewRows(ctx, job.id)).rows).toHaveLength(3);
  });

  it('[TC-IMPORTS-PIPELINE-021] un monto JSON escrito como número hace fallar la lectura con la ubicación del error', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, {
      format: 'JSON',
      text: '{"schema":"pfos.import-file","version":1,"currency":"BOB","movements":[{"date":"2026-05-02","amount":-18.5}]}',
    });
    const { job } = await importDocument(ctx, documentId);
    expect(job.status).toBe('PARSE_FAILED');
    expect(job.failure).toMatchObject({ code: 'IMPORT_PARSE_FAILED', pointer: '/movements/0/amount' });
  });

  it('[TC-IMPORTS-PIPELINE-011] el lector se elige por el formato detectado en el contenido', async () => {
    const ctx = setupPipeline();
    const documentId = addDocument(ctx, {
      format: 'QIF',
      text: '!Type:Bank\nD25/12/2026\nT-10.00\nPCAFE\n^\n',
    });
    const created = await ctx.service.createFromDocument({
      workspaceId: WS,
      userId: USER,
      accountId: ACCOUNT,
      documentId,
    });
    expect(created.source).toBe('FILE_QIF');
    expect(await ctx.process.process({ workspaceId: WS, importId: created.id })).toBe('AWAITING_REVIEW');
    expect((await previewRows(ctx, created.id)).rows[0]).toMatchObject({ date: '2026-12-25' });
  });
});

describe('Perfiles de mapeo', () => {
  const CSV =
    'Fecha;Descripción;Importe\r\n01/10/2026;COMPRA SUPERMERCADO;-245,30\r\n05/10/2026;ABONO SUELDO;8.000,00\r\n';
  const PROFILE = {
    version: 'imports.profile.v1',
    mapping: {
      hasHeader: true,
      skipRows: 0,
      dateFormat: 'dd/MM/yyyy',
      decimalSeparator: ',',
      columns: {
        date: { index: 0, header: 'Fecha' },
        description: { index: 1, header: 'Descripción' },
        amount: { mode: 'SIGNED', index: 2, header: 'Importe', signConvention: 'NEGATIVE_IS_OUTFLOW' },
      },
    },
  };
  const latin1 = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

  it('[TC-IMPORTS-PIPELINE-029] el perfil de la institución cuyas columnas coinciden se aplica sin pasar por el mapeo', async () => {
    const ctx = setupPipeline();
    const profile = await ctx.profiles.create({
      workspaceId: WS,
      userId: USER,
      name: 'Cumbre caja de ahorro CSV',
      format: 'CSV',
      institutionId: INSTITUTION,
      options: PROFILE,
    });
    const documentId = addDocument(ctx, { format: 'CSV', bytes: latin1(CSV) });
    const { outcome, job } = await importDocument(ctx, documentId);
    expect(outcome).toBe('AWAITING_REVIEW');
    expect(job.mappingProfile).toEqual({ id: profile.id, version: 1 });
    expect((await previewRows(ctx, job.id)).rows).toHaveLength(2);
    const annotation = ctx.world.lifecycle
      .flatMap((l) => l.steps)
      .find((s) => s.kind === 'ANNOTATION' && s.changedFields.includes('mappingProfile'));
    expect(annotation).toBeTruthy();
  });

  it('[TC-IMPORTS-PIPELINE-031] un encabezado renombrado deja la importación esperando mapeo con la columna faltante', async () => {
    const ctx = setupPipeline();
    await ctx.profiles.create({
      workspaceId: WS,
      userId: USER,
      name: 'Cumbre',
      format: 'CSV',
      institutionId: INSTITUTION,
      options: PROFILE,
    });
    const documentId = addDocument(ctx, {
      format: 'CSV',
      bytes: latin1(CSV.replace('Importe', 'Monto Bs.')),
    });
    const { outcome, job } = await importDocument(ctx, documentId);
    expect(outcome).toBe('AWAITING_MAPPING');
    expect(job.missingColumns).toEqual(['Importe']);
    expect(job.profileCandidates[0]).toMatchObject({ name: 'Cumbre', missingColumns: ['Importe'] });
  });

  it('[TC-IMPORTS-PIPELINE-028] un perfil archivado no se sugiere ni se aplica a importaciones nuevas', async () => {
    const ctx = setupPipeline();
    const profile = await ctx.profiles.create({
      workspaceId: WS,
      userId: USER,
      name: 'Cumbre',
      format: 'CSV',
      institutionId: INSTITUTION,
      options: PROFILE,
    });
    await ctx.profiles.archive({ workspaceId: WS, userId: USER, profileId: profile.id, expectedVersion: 1 });
    const documentId = addDocument(ctx, { format: 'CSV', bytes: latin1(CSV) });
    const { outcome, job } = await importDocument(ctx, documentId);
    expect(outcome).toBe('AWAITING_MAPPING');
    expect(job.profileCandidates).toEqual([]);
  });

  it('[TC-IMPORTS-PIPELINE-026] editar un perfil crea una versión y la importación anterior conserva la que usó', async () => {
    const ctx = setupPipeline();
    const profile = await ctx.profiles.create({
      workspaceId: WS,
      userId: USER,
      name: 'Cumbre',
      format: 'CSV',
      institutionId: INSTITUTION,
      options: PROFILE,
    });
    const first = await importDocument(ctx, addDocument(ctx, { format: 'CSV', bytes: latin1(CSV) }));
    const v2 = await ctx.profiles.createVersion({
      workspaceId: WS,
      userId: USER,
      profileId: profile.id,
      expectedVersion: 1,
      options: { ...PROFILE, mapping: { ...PROFILE.mapping, skipFooterRows: 1 } },
    });
    expect(v2.version).toBe(2);
    expect((await ctx.queries.get(WS, first.created.id)).mappingProfile).toEqual({
      id: profile.id,
      version: 1,
    });
    const second = await importDocument(
      ctx,
      addDocument(ctx, {
        format: 'CSV',
        bytes: latin1(CSV.replace('SUELDO', 'SUELDO 2')),
      }),
    );
    expect(second.job.mappingProfile).toEqual({ id: profile.id, version: 2 });
  });

  it('[TC-IMPORTS-PIPELINE-027] un perfil sin columna de monto se rechaza con IMPORT_MAPPING_INVALID', async () => {
    const ctx = setupPipeline();
    const broken = {
      version: 'imports.profile.v1',
      mapping: { ...PROFILE.mapping, columns: { date: { index: 0 }, description: { index: 1 } } },
    };
    expect(
      await codeOf(
        ctx.profiles.create({
          workspaceId: WS,
          userId: USER,
          name: 'Roto',
          format: 'CSV',
          institutionId: INSTITUTION,
          options: broken,
        }),
      ),
    ).toBe('IMPORT_MAPPING_INVALID');
  });

  it('[TC-IMPORTS-PIPELINE-025] guardar el mapeo de una importación como perfil crea la versión 1 para la institución de la cuenta', async () => {
    const ctx = setupPipeline();
    const { created, job } = await importDocument(
      ctx,
      addDocument(ctx, { format: 'CSV', bytes: latin1(CSV) }),
    );
    expect(job.status).toBe('AWAITING_MAPPING');
    await ctx.service.setMapping({
      workspaceId: WS,
      userId: USER,
      importId: created.id,
      expectedVersion: job.version,
      mapping: {
        hasHeader: true,
        skipRows: 0,
        columns: {
          date: { index: 0 },
          description: { index: 1 },
          amount: { mode: 'SIGNED', index: 2, signConvention: 'NEGATIVE_IS_OUTFLOW' },
        },
        dateFormat: 'dd/MM/yyyy',
        decimalSeparator: ',',
      },
    });
    expect(await ctx.process.process({ workspaceId: WS, importId: created.id })).toBe('AWAITING_REVIEW');
    const profile = await ctx.profiles.create({
      workspaceId: WS,
      userId: USER,
      name: 'Cumbre caja de ahorro CSV',
      fromImportId: created.id,
    });
    expect(profile).toMatchObject({ version: 1, format: 'CSV', institutionId: INSTITUTION, accountId: null });
    // Dos registros de auditoría de perfil por dos versiones (TC-IMPORTS-PIPELINE-065).
    await ctx.profiles.createVersion({
      workspaceId: WS,
      userId: USER,
      profileId: profile.id,
      expectedVersion: 1,
      name: 'Cumbre v2',
    });
    expect(ctx.world.audit.filter((a) => a.aggregateType === 'ImportProfile').map((a) => a.action)).toEqual([
      'imports.profile.created',
      'imports.profile.versioned',
    ]);
  });
});
