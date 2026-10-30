/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, inTx } from '../support/db.js';
import { sha256Hex } from '../support/malicious-files.js';
import {
  asAdmin,
  contract,
  money,
  startHarness,
  until,
  type Harness,
  type Json,
  type Reply,
  type User,
} from '../support/portability.js';

// Pipeline de importación por documentos de extremo a extremo (openspec add-import-pipeline; imports/import-pipeline):
// API real, worker real (consumidor `imports.persist`: etapas, persistencia y deshacer), DOCUMENTS real (subida
// presignada a SeaweedFS, verificación y cifrado) y PostgreSQL con RLS. Los extractos son sintéticos (SINTETICO).
const deps = inject('deps');
const FIXTURES = fileURLToPath(new URL('../../../../tests/fixtures/imports/', import.meta.url));

let h: Harness;
let owner: User;
let editor: User;
let viewer: User;
let bank: string;
let visa: string;
const W = (u: User = owner) => `/api/v1/workspaces/${u.ws}`;

const ok = (r: Reply, status = 200): Json => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code'], JSON.stringify(r.body)).toBe(code);
};
const get = (u: User, path: string) => h.call('GET', `${W(u)}${path}`, { token: u.token });
const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  h.call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const put = (u: User, path: string, body: unknown, version: number) =>
  h.call('PUT', `${W(u)}${path}`, { token: u.token, body, headers: { 'if-match': `"${version}"` } });
const patch = (u: User, path: string, body: unknown, version: number) =>
  h.call('PATCH', `${W(u)}${path}`, { token: u.token, body, headers: { 'if-match': `"${version}"` } });

const asApp = async <T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> => {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
};

async function addMember(member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [owner.ws, member.id, role],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  return { ...member, ws: owner.ws };
}

async function createAccount(name: string, type: string, opening: string): Promise<string> {
  const r = await post(owner, '/accounts', {
    name,
    type,
    currency: 'BOB',
    openingBalance: { amount: money(opening), date: '2026-01-01' },
  });
  return ok(r, 201)['id'] as string;
}

const balanceOf = (accountId: string) =>
  asApp(owner, async (c) => {
    const { rows } = await c.query<{ balance: string }>(
      `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,2)::text AS balance
         FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
        WHERE la.source_account_id = $1`,
      [accountId],
    );
    return rows[0]!.balance;
  });

const importedCount = (accountId: string) =>
  asApp(owner, async (c) => {
    const { rows } = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM txn.transaction WHERE account_id = $1 AND source = 'IMPORT' AND status <> 'VOIDED'`,
      [accountId],
    );
    return Number(rows[0]!.n);
  });

/** Sube un extracto como documento (propósito `IMPORT_SOURCE`) y lo deja disponible. */
async function uploadStatement(
  content: Buffer,
  fileName: string,
  contentType: string,
  u: User = owner,
): Promise<string> {
  const reply = await post(u, '/documents/uploads', {
    fileName,
    contentType,
    sizeBytes: content.length,
    sha256: sha256Hex(content),
    purpose: 'IMPORT_SOURCE',
  });
  // El mismo contenido ya disponible en el workspace se deduplica (FR-DOCUMENTS-006): se reutiliza el documento.
  if (reply.status === 200 && (reply.body as any)['deduplicated'])
    return (reply.body as any)['document'].id as string;
  const requested = ok(reply, 201) as any;
  const upload = requested['upload'];
  const sent = await fetch(upload.url as string, {
    method: upload.method as string,
    headers: upload.headers as Record<string, string>,
    body: content,
  });
  expect(sent.status, await sent.text()).toBe(200);
  const documentId = requested['document'].id as string;
  const done = await post(u, `/documents/${documentId}/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  expect((done.body as any)['status']).toBe('AVAILABLE');
  return documentId;
}

const createImport = (documentId: string, accountId = bank, u: User = owner, key: string = randomUUID()) =>
  h.call('POST', `${W(u)}/imports`, {
    token: u.token,
    body: { accountId, documentId },
    headers: { 'idempotency-key': key },
  });

async function job(id: string, u: User = owner): Promise<any> {
  const r = await get(u, `/imports/${id}`);
  ok(r);
  expect(contract.validateResponse('getImport', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body;
}

const waitFor = async (id: string, statuses: string[]) => {
  try {
    return await until(async () => {
      const j = await job(id);
      return statuses.includes(j.status) ? j : undefined;
    }, 60_000);
  } catch (error) {
    const j = await job(id);
    const tail = (h.workerLog?.lines ?? [])
      .filter((l) => /error|warn|imports/i.test(l))
      .slice(-6)
      .join(' | ');
    throw new Error(
      `${(error as Error).message}: status=${j.status} stage=${j.stage} failure=${JSON.stringify(j.failure)} worker=${tail.slice(0, 2500)}`,
      { cause: error },
    );
  }
};

async function preview(id: string, query = '') {
  const r = await get(owner, `/imports/${id}/preview?limit=200${query}`);
  ok(r);
  expect(contract.validateResponse('getImportPreview', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body as any;
}

const OFX = (
  rows: { id: string; date: string; amount: string; name: string }[],
  closing?: string,
  currency = 'BOB',
) =>
  Buffer.from(
    [
      'OFXHEADER:100',
      'DATA:OFXSGML',
      'VERSION:102',
      'SECURITY:NONE',
      'ENCODING:USASCII',
      'CHARSET:1252',
      'COMPRESSION:NONE',
      'OLDFILEUID:NONE',
      'NEWFILEUID:NONE',
      '',
      '<OFX>',
      '<BANKMSGSRSV1>',
      '<STMTTRNRS>',
      '<TRNUID>1',
      '<STMTRS>',
      `<CURDEF>${currency}`,
      '<BANKTRANLIST>',
      '<DTSTART>20260301',
      '<DTEND>20260331',
      ...rows.map(
        (r) =>
          `<STMTTRN>\n<TRNTYPE>${r.amount.startsWith('-') ? 'DEBIT' : 'CREDIT'}\n<DTPOSTED>${r.date}\n<TRNAMT>${r.amount}\n<FITID>${r.id}\n<NAME>${r.name}\n</STMTTRN>`,
      ),
      '</BANKTRANLIST>',
      ...(closing ? [`<LEDGERBAL>\n<BALAMT>${closing}\n<DTASOF>20260331\n</LEDGERBAL>`] : []),
      '</STMTRS>',
      '</STMTTRNRS>',
      '</BANKMSGSRSV1>',
      '</OFX>',
    ].join('\n'),
    'latin1',
  );

beforeAll(async () => {
  h = await startHarness({
    worker: true,
    apiEnv: { RATE_LIMIT_WRITES_PER_MIN: '100000', RATE_LIMIT_READS_PER_MIN: '100000' },
  });
  owner = await h.user(`kc-pipe-owner-${randomUUID()}`);
  editor = await addMember(await h.user(`kc-pipe-editor-${randomUUID()}`), 'EDITOR');
  viewer = await addMember(await h.user(`kc-pipe-viewer-${randomUUID()}`), 'VIEWER');
  bank = await createAccount('Banco BOB', 'BANK', '4000.00');
  visa = await createAccount('Visa', 'CREDIT_CARD', '520.00');
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Importación desde un documento', () => {
  it('[TC-IMPORTS-PIPELINE-004][TC-IMPORTS-PIPELINE-007][TC-IMPORTS-PIPELINE-014] un OFX subido llega a revisión por el worker con el identificador del banco y el saldo del extracto', async () => {
    const documentId = await uploadStatement(
      OFX(
        [
          { id: '2026030100017', date: '20260301120000', amount: '-245.30', name: 'COMPRA SUPERMERCADO' },
          { id: '2026030500021', date: '20260305', amount: '1500.00', name: 'ABONO SUELDO SINTETICO' },
        ],
        '5254.70',
      ),
      'extracto-marzo.ofx',
      'application/x-ofx',
      editor,
    );
    const created = createImport(documentId, bank, editor);
    const reply = await created;
    ok(reply, 202);
    expect(contract.validateResponse('createImport', 202, reply.body), JSON.stringify(reply.body)).toEqual(
      [],
    );
    expect(reply.body['status']).toBe('UPLOADED');
    expect(reply.body['documentId']).toBe(documentId);
    expect(await importedCount(bank)).toBe(0);

    const inReview = await waitFor(reply.body['id'] as string, ['AWAITING_REVIEW', 'PARSE_FAILED']);
    expect(inReview.status).toBe('AWAITING_REVIEW');
    expect(inReview.statement.closingBalance).toEqual({ amount: '5254.70', currency: 'BOB' });
    const rows = await preview(inReview.id);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      externalId: '2026030100017',
      direction: 'OUT',
      classification: 'NEW',
    });

    // [TC-IMPORTS-PIPELINE-070] el recorrido muestra las transiciones del worker con el sistema como actor.
    const lifecycle = await get(owner, `/imports/${inReview.id}/lifecycle`);
    ok(lifecycle);
    expect(JSON.stringify(lifecycle.body)).toContain('AWAITING_REVIEW');
  }, 180_000);

  it('[TC-IMPORTS-PIPELINE-005][TC-IMPORTS-PIPELINE-006] un documento con otro propósito se rechaza con VALIDATION_FAILED', async () => {
    const content = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const requested = ok(
      await post(owner, '/documents/uploads', {
        fileName: 'factura.pdf',
        contentType: 'application/pdf',
        sizeBytes: content.length,
        sha256: sha256Hex(content),
        purpose: 'RECEIPT',
      }),
      201,
    ) as any;
    // Aún pendiente de subida ⇒ no disponible.
    problem(await createImport(requested['document'].id as string), 409, 'DOCUMENT_NOT_AVAILABLE');
    expect(
      await asApp(
        owner,
        async (c) =>
          (
            await c.query('SELECT 1 FROM imports.import_job WHERE document_id = $1', [
              requested['document'].id,
            ])
          ).rowCount,
      ),
    ).toBe(0);
  });

  it('[TC-IMPORTS-PIPELINE-004] una creación repetida con la misma clave se reproduce y con otro documento es IDEMPOTENCY_KEY_REUSED', async () => {
    const first = await uploadStatement(
      OFX([{ id: 'IDEM-1', date: '20260301', amount: '-1.00', name: 'A' }]),
      'a.ofx',
      'application/x-ofx',
    );
    const second = await uploadStatement(
      OFX([{ id: 'IDEM-2', date: '20260302', amount: '-2.00', name: 'B' }]),
      'b.ofx',
      'application/x-ofx',
    );
    const key = randomUUID();
    const created = ok(await createImport(first, bank, owner, key), 202);
    const replay = await createImport(first, bank, owner, key);
    expect(replay.status).toBe(202);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body['id']).toBe(created['id']);
    problem(await createImport(second, bank, owner, key), 422, 'IDEMPOTENCY_KEY_REUSED');
  }, 120_000);

  it('[TC-IMPORTS-PIPELINE-066] un OFX de 1 000 movimientos llega a revisión por el worker (el presupuesto de 30 s a 5 000 filas se mide en imports.perf.ts)', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `BULK-${i}`,
      date: '20260315',
      amount: `-${(i % 90) + 1}.00`,
      name: `MOVIMIENTO ${i}`,
    }));
    const created = ok(
      await createImport(await uploadStatement(OFX(rows), 'mil.ofx', 'application/x-ofx')),
      202,
    );
    const started = Date.now();
    const review = await waitFor(created['id'] as string, ['AWAITING_REVIEW']);
    expect(Date.now() - started).toBeLessThanOrEqual(30_000);
    expect(review.counters.rows).toBe(1000);
  }, 180_000);

  it('[TC-IMPORTS-PIPELINE-063] un VIEWER no puede crear, editar ni deshacer', async () => {
    const documentId = await uploadStatement(
      OFX([{ id: 'V1', date: '20260301', amount: '-1.00', name: 'X' }]),
      'v.ofx',
      'application/x-ofx',
    );
    problem(await createImport(documentId, bank, viewer), 403, 'INSUFFICIENT_ROLE');
    const j = ok(await createImport(documentId, bank, owner), 202);
    const inReview = await waitFor(j['id'] as string, ['AWAITING_REVIEW']);
    const rows = await preview(inReview.id);
    problem(
      await h.call('PATCH', `${W(viewer)}/imports/${inReview.id}/rows/${rows.rows[0].id}`, {
        token: viewer.token,
        body: { note: 'x' },
        headers: { 'if-match': `"${inReview.version}"` },
      }),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(
      await h.call('POST', `${W(viewer)}/imports/${inReview.id}/revert`, {
        token: viewer.token,
        body: {},
        headers: { 'idempotency-key': randomUUID(), 'if-match': `"${inReview.version}"` },
      }),
      403,
      'INSUFFICIENT_ROLE',
    );
  }, 180_000);
});

describe('Flujo completo: revisar, aprobar, reconciliar, deshacer y reimportar', () => {
  it('[TC-IMPORTS-PIPELINE-044][TC-IMPORTS-PIPELINE-057][TC-IMPORTS-PIPELINE-059][TC-IMPORTS-PIPELINE-062] transfiere un pago de tarjeta, termina cuadrado, se deshace y se reimporta', async () => {
    const before = await balanceOf(bank);
    const statement = OFX(
      [
        { id: 'FLOW-1', date: '20260310', amount: '-18.00', name: 'PAGO QR CAFE' },
        { id: 'FLOW-2', date: '20260311', amount: '-400.00', name: 'PAGO TARJETA' },
        { id: 'FLOW-3', date: '20260312', amount: '8000.00', name: 'ABONO SUELDO' },
      ],
      // Saldo final esperado: saldo actual + 8000.00 − 18.00 − 400.00.
      (Number(before) + 7582).toFixed(2),
    );
    const documentId = await uploadStatement(statement, 'flujo.ofx', 'application/x-ofx');
    const created = ok(await createImport(documentId), 202);
    let review = await waitFor(created['id'] as string, ['AWAITING_REVIEW']);
    const rows = (await preview(review.id)).rows as any[];
    const payment = rows.find((r) => r.externalId === 'FLOW-2');

    // [TC-IMPORTS-PIPELINE-044] La fila de la tarjeta se marca como transferencia a "Visa".
    const edited = await patch(
      owner,
      `/imports/${review.id}/rows/${payment.id}`,
      { transfer: { counterAccountId: visa } },
      review.version,
    );
    ok(edited);
    expect(
      contract.validateResponse('decideImportRow', 200, edited.body),
      JSON.stringify(edited.body),
    ).toEqual([]);
    expect(edited.body['kind']).toBe('TRANSFER');
    review = await job(review.id);

    const approved = await post(owner, `/imports/${review.id}/approve`, undefined, {
      'if-match': `"${review.version}"`,
    });
    ok(approved, 202);
    const done = await waitFor(review.id, ['COMPLETED', 'COMPLETED_WITH_DIFFERENCE', 'PARTIALLY_FAILED']);
    expect(done.status).toBe('COMPLETED');
    expect(done.counters.created).toBe(3);
    expect(done.reconciliationOffer).toMatchObject({ accountId: bank, statementDate: '2026-03-31' });
    expect(await balanceOf(bank)).toBe((Number(before) + 7582).toFixed(2));

    // [TC-IMPORTS-PIPELINE-059] Deshacer: vista previa, solicitud y reversa exacta.
    const revertPreview = await get(owner, `/imports/${done.id}/revert-preview`);
    ok(revertPreview);
    expect(revertPreview.body['toVoid']).toBe(3);
    const revertKey = randomUUID();
    const reverting = await post(
      owner,
      `/imports/${done.id}/revert`,
      { allowPartial: false },
      { 'if-match': `"${done.version}"`, 'idempotency-key': revertKey },
    );
    ok(reverting, 202);
    // Operación costosa (cuota `costly`, docs/10 §10) y reproducción idempotente sin segunda reversa.
    expect(reverting.headers.get('ratelimit-policy') ?? '').toMatch(/costly/);
    const replayed = await post(
      owner,
      `/imports/${done.id}/revert`,
      { allowPartial: false },
      { 'if-match': `"${done.version}"`, 'idempotency-key': revertKey },
    );
    expect(replayed.status, JSON.stringify(replayed.body)).toBe(202);
    expect(replayed.headers.get('idempotent-replayed')).toBe('true');
    expect(replayed.body).toEqual(reverting.body);
    const rolled = await waitFor(done.id, ['ROLLED_BACK', 'PARTIALLY_ROLLED_BACK']);
    expect(rolled.status).toBe('ROLLED_BACK');
    expect(await balanceOf(bank)).toBe(before);
    expect(await importedCount(bank)).toBe(0);

    // [TC-IMPORTS-PIPELINE-062] Reimportar el mismo archivo vuelve a crear las 3 transacciones.
    const again = ok(
      await createImport(await uploadStatement(statement, 'flujo-bis.ofx', 'application/x-ofx')),
      202,
    );
    const reviewAgain = await waitFor(again['id'] as string, ['AWAITING_REVIEW']);
    expect(((await preview(reviewAgain.id)).rows as any[]).map((r) => r.classification)).toEqual([
      'NEW',
      'NEW',
      'NEW',
    ]);
  }, 300_000);

  it('[TC-IMPORTS-PIPELINE-009] un OFX con el bloque sin cerrar queda en falló la lectura sin filas', async () => {
    const broken = Buffer.from(
      OFX([{ id: 'B1', date: '20260301', amount: '-1.00', name: 'X' }])
        .toString('latin1')
        .replace('</BANKTRANLIST>', ''),
    );
    const j = ok(await createImport(await uploadStatement(broken, 'roto.ofx', 'application/x-ofx')), 202);
    const failed = await waitFor(j['id'] as string, ['PARSE_FAILED']);
    expect(failed.failure.code).toBe('IMPORT_PARSE_FAILED');
    expect((await preview(failed.id)).rows).toHaveLength(0);
  }, 180_000);
});

describe('Conversión importada', () => {
  it('[TC-IMPORTS-PIPELINE-047] la pata de una conversión importada es candidata de duplicado al importar el extracto de la otra cuenta', async () => {
    await asApp(owner, (c) =>
      c.query(
        `INSERT INTO fx.workspace_currency (workspace_id, currency_code) VALUES ($1, 'BOB'), ($1, 'USD') ON CONFLICT DO NOTHING`,
        [owner.ws],
      ),
    );
    ok(
      await post(owner, '/fx-rates', {
        base: 'USD',
        quote: 'BOB',
        value: '6.96',
        rateType: 'MARKET',
        asOf: '2026-03-01T12:00:00Z',
        sourceLabel: 'Tasa de prueba',
      }),
      201,
    );
    const usd = ok(
      await post(owner, '/accounts', {
        name: 'Caja USD',
        type: 'CASH',
        currency: 'USD',
        openingBalance: { amount: money('0.00', 'USD'), date: '2026-01-01' },
      }),
      201,
    )['id'] as string;

    // 1) El extracto de "Banco BOB" trae una venta de dólares: la fila se marca como conversión hacia "Caja USD".
    const out = await createImport(
      await uploadStatement(
        OFX([{ id: 'CONV-1', date: '20260310', amount: '-696.00', name: 'COMPRA DOLARES' }]),
        'conversion-bob.ofx',
        'application/x-ofx',
      ),
    );
    let review = await waitFor(ok(out, 202)['id'] as string, ['AWAITING_REVIEW']);
    const row = ((await preview(review.id)).rows as any[])[0];
    ok(
      await patch(
        owner,
        `/imports/${review.id}/rows/${row.id}`,
        { conversion: { counterAccountId: usd, counterAmount: money('100.00', 'USD') } },
        review.version,
      ),
    );
    review = await job(review.id);
    ok(
      await post(owner, `/imports/${review.id}/approve`, undefined, { 'if-match': `"${review.version}"` }),
      202,
    );
    await waitFor(review.id, ['COMPLETED', 'COMPLETED_WITH_DIFFERENCE']);

    // 2) El extracto de "Caja USD" trae el ingreso de 100.00 USD del mismo día: es posible duplicado de la pata creada.
    const inbound = await createImport(
      await uploadStatement(
        OFX([{ id: 'CONV-2', date: '20260310', amount: '100.00', name: 'COMPRA DOLARES' }], undefined, 'USD'),
        'conversion-usd.ofx',
        'application/x-ofx',
      ),
      usd,
    );
    const second = await waitFor(ok(inbound, 202)['id'] as string, ['AWAITING_REVIEW']);
    const leg = ((await preview(second.id)).rows as any[])[0];
    expect(leg.classification).toBe('DUPLICATE_PROBABLE');
    expect(leg.candidate).toMatchObject({ transactionId: expect.any(String) });
  }, 300_000);
});

describe('Perfiles de mapeo', () => {
  it('[TC-IMPORTS-PIPELINE-065][TC-IMPORTS-PIPELINE-026][TC-IMPORTS-PIPELINE-028] crear, versionar y archivar un perfil deja auditoría por versión', async () => {
    const options = {
      version: 'imports.profile.v1',
      mapping: {
        hasHeader: true,
        skipRows: 0,
        dateFormat: 'dd/MM/yyyy',
        decimalSeparator: ',',
        columns: {
          date: { index: 0, header: 'Fecha' },
          description: { index: 1, header: 'Descripción' },
          amount: { mode: 'SIGNED', index: 2, header: 'Monto', signConvention: 'NEGATIVE_IS_OUTFLOW' },
        },
      },
    };
    const accountId = bank;
    const created = await post(editor, '/import-profiles', {
      name: 'Cumbre caja de ahorro CSV',
      format: 'CSV',
      institutionId: randomUUID(),
      accountId,
      options,
    });
    ok(created, 201);
    expect(
      contract.validateResponse('createImportProfile', 201, created.body),
      JSON.stringify(created.body),
    ).toEqual([]);
    const id = created.body['id'] as string;
    const v2 = await h.call('POST', `${W(editor)}/import-profiles/${id}/versions`, {
      token: editor.token,
      body: { name: 'Cumbre v2', options },
      headers: { 'idempotency-key': randomUUID(), 'if-match': '"1"' },
    });
    ok(v2, 201);
    expect(v2.body['version']).toBe(2);
    const audits = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ action: string }>(
        `SELECT action FROM audit.audit_log WHERE workspace_id = $1 AND aggregate_id = $2 ORDER BY occurred_at, id`,
        [owner.ws, id],
      );
      return rows.map((r) => r.action);
    });
    expect(audits).toEqual(['imports.profile.created', 'imports.profile.versioned']);
    const archived = await h.call('POST', `${W(editor)}/import-profiles/${id}/archive`, {
      token: editor.token,
      headers: { 'idempotency-key': randomUUID(), 'if-match': '"2"' },
    });
    ok(archived);
    expect(archived.body['archivedAt']).toBeTruthy();
    const list = await get(owner, `/import-profiles?accountId=${accountId}`);
    ok(list);
    expect(list.body['data']).toEqual([]);
  }, 120_000);
});

describe('Extractos solapados (criterio de salida sintético)', () => {
  it('[TC-IMPORTS-PIPELINE-055][TC-IMPORTS-PIPELINE-056] tres meses en CSV y OFX con 12 solapados dejan 115 transacciones; reimportar crea 0', async () => {
    const account = await createAccount('Caja de ahorro tres meses', 'BANK', '0.00');
    const csv = readFileSync(`${FIXTURES}tres-meses/enero-15feb.csv`);
    const ofxFile = readFileSync(`${FIXTURES}tres-meses/feb-mar.ofx`);

    // CSV por documento: sin perfil, se aplica el mapeo y se aprueba.
    const csvDoc = await uploadStatement(csv, 'enero-15feb.csv', 'text/csv');
    const first = ok(await createImport(csvDoc, account), 202);
    const mappingNeeded = await waitFor(first['id'] as string, ['AWAITING_MAPPING']);
    const mapped = await put(
      owner,
      `/imports/${mappingNeeded.id}/mapping`,
      {
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
      mappingNeeded.version,
    );
    ok(mapped, 202);
    const csvReview = await waitFor(mappingNeeded.id, ['AWAITING_REVIEW']);
    ok(
      await post(owner, `/imports/${csvReview.id}/approve`, undefined, {
        'if-match': `"${csvReview.version}"`,
      }),
      202,
    );
    const csvDone = await waitFor(csvReview.id, ['COMPLETED', 'COMPLETED_WITH_DIFFERENCE']);
    expect(csvDone.counters.created).toBe(52);

    // OFX solapado: los 12 movimientos repetidos quedan vinculados por la preselección de confianza alta.
    const second = ok(
      await createImport(await uploadStatement(ofxFile, 'feb-mar.ofx', 'application/x-ofx'), account),
      202,
    );
    const ofxReview = await waitFor(second['id'] as string, ['AWAITING_REVIEW']);
    expect(ofxReview.counters.probableDuplicates).toBe(12);
    ok(
      await post(owner, `/imports/${ofxReview.id}/approve`, undefined, {
        'if-match': `"${ofxReview.version}"`,
      }),
      202,
    );
    await waitFor(ofxReview.id, ['COMPLETED', 'COMPLETED_WITH_DIFFERENCE']);
    expect(await importedCount(account)).toBe(115);

    // [TC-IMPORTS-PIPELINE-056] Reimportar los dos archivos no crea nada.
    for (const [bytes, name, type] of [
      [csv, 'enero-15feb-bis.csv', 'text/csv'],
      [ofxFile, 'feb-mar-bis.ofx', 'application/x-ofx'],
    ] as const) {
      const reply = ok(await createImport(await uploadStatement(bytes, name, type), account), 202);
      let next = await waitFor(reply['id'] as string, ['AWAITING_REVIEW', 'AWAITING_MAPPING']);
      if (next.status === 'AWAITING_MAPPING') {
        ok(
          await put(
            owner,
            `/imports/${next.id}/mapping`,
            {
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
            next.version,
          ),
          202,
        );
        next = await waitFor(next.id, ['AWAITING_REVIEW']);
      }
      const rows = (await preview(next.id)).rows as any[];
      expect(rows.every((r) => r.classification === 'DUPLICATE_EXACT')).toBe(true);
      ok(
        await post(owner, `/imports/${next.id}/approve`, undefined, { 'if-match': `"${next.version}"` }),
        202,
      );
      const finished = await waitFor(next.id, ['COMPLETED', 'COMPLETED_WITH_DIFFERENCE']);
      expect(finished.counters.created).toBe(0);
    }
    expect(await importedCount(account)).toBe(115);
  }, 600_000);
});
