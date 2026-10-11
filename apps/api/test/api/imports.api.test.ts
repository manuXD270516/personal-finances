import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZipReader } from '@pf/identity/interface/identity.module';
import type { FixedClock } from '@pf/shared-kernel';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, inTx } from '../support/db.js';
import {
  asAdmin,
  contract,
  downloadExport,
  exportAndWait,
  importAndWait,
  money,
  startHarness,
  until,
  type Harness,
  type Json,
  type Reply,
  type User,
} from '../support/portability.js';

// Importación CSV básica de extremo a extremo (openspec add-basic-csv-import; imports/import-pipeline): API real,
// worker real (consumidor `imports.persist` sobre pg-boss) y PostgreSQL con RLS. Los archivos son golden files
// anonimizados de tests/fixtures/imports/csv. Reloj fijo 2026-11-03 11:00 (America/La_Paz).
const deps = inject('deps');
const FIXTURES = fileURLToPath(new URL('../../../../tests/fixtures/imports/csv/', import.meta.url));
const fixture = (name: string): Buffer => readFileSync(`${FIXTURES}${name}`);

let h: Harness;
let owner: User;
let editor: User;
let viewer: User;
let bank: string;
let visa: string;
const W = (u: User = owner) => `/api/v1/workspaces/${u.ws}`;

const SIGNED = {
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
const mapping = (over: Json = {}): Json => ({ ...SIGNED, ...over });

const apiErrors = () =>
  JSON.stringify(
    h.apiLog
      .records()
      .filter((r) => Number(r['level']) >= 50 || r['level'] === 'error')
      .slice(-2),
  ).slice(0, 3000);
const ok = (r: Reply, status = 200): Json => {
  expect(r.status, `${JSON.stringify(r.body)} ${r.status >= 500 ? apiErrors() : ''}`).toBe(status);
  return r.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code'], JSON.stringify(r.body)).toBe(code);
};

const asApp = async <T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> => {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
};

/** Saldo contable (Σ postings) de una cuenta del usuario. */
const balanceOf = (accountId: string, u: User = owner) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{ balance: string }>(
      `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,2)::text AS balance
         FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
        WHERE la.source_account_id = $1`,
      [accountId],
    );
    return rows[0]!.balance;
  });

/** Transacciones creadas por importaciones en una cuenta (más antiguas primero). */
const importedTransactions = (accountId: string, u: User = owner) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{
      id: string;
      kind: string;
      status: string;
      amount: string;
      description: string | null;
      source: string;
      import_job_id: string | null;
      transaction_date: string;
      category: string;
      ref: string | null;
    }>(
      `SELECT t.id, t.kind, t.status, t.amount::numeric(38,2)::text AS amount, t.description, t.source, t.import_job_id,
              t.transaction_date::text, t.external_ref_namespace AS ref,
              (SELECT cat.system_code FROM txn.transaction_split s JOIN classification.category cat ON cat.id = s.category_id
                WHERE s.transaction_id = t.id AND s.superseded_in_revision IS NULL LIMIT 1) AS category
         FROM txn.transaction t
        WHERE t.account_id = $1 AND t.source = 'IMPORT'
        ORDER BY t.transaction_date, t.created_at, t.id`,
      [accountId],
    );
    return rows;
  });

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

function uploadForm(bytes: Buffer | Uint8Array, accountId: string, name = 'extracto.csv'): FormData {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(bytes)], { type: 'text/csv' }), name);
  form.append('accountId', accountId);
  return form;
}
const upload = (
  u: User,
  bytes: Buffer | Uint8Array,
  accountId = bank,
  key: string = randomUUID(),
  name?: string,
) =>
  h.call('POST', `${W(u)}/imports`, {
    token: u.token,
    form: uploadForm(bytes, accountId, name),
    headers: { 'idempotency-key': key },
  });

interface ImportBody {
  id: string;
  status: string;
  version: number;
  counters: Record<string, number>;
  progress: Record<string, number>;
  warnings: { code: string; previousImportId: string; previousImportedAt: string }[];
  errors: { code: string; count: number; lines: number[] }[];
  detected: { encoding: string; delimiter: string };
  header: string[];
  rowCount: number;
  sampleRows: string[][];
  suggestedMapping: Json | null;
  previewSummary: {
    counts: Record<string, number>;
    outflows: { amount: string };
    inflows: { amount: string };
    currentBalance: { amount: string };
    resultingBalance: { amount: string };
  };
}

async function uploaded(bytes: Buffer | Uint8Array, accountId = bank, u: User = owner): Promise<ImportBody> {
  const body = ok(await upload(u, bytes, accountId), 201);
  expect(contract.validateResponse('createImport', 201, body), JSON.stringify(body)).toEqual([]);
  return body as unknown as ImportBody;
}

async function mapImport(job: { id: string; version: number }, m: Json = mapping(), u: User = owner) {
  const r = await put(u, `/imports/${job.id}/mapping`, m, job.version);
  ok(r);
  expect(contract.validateResponse('setImportMapping', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body as unknown as ImportBody;
}

async function previewRows(id: string, query = '') {
  const r = await get(owner, `/imports/${id}/preview?limit=200${query}`);
  ok(r);
  expect(contract.validateResponse('getImportPreview', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body as unknown as {
    summary: ImportBody['previewSummary'];
    rows: {
      id: string;
      lineNumber: number;
      date: string | null;
      description: string | null;
      amount: { amount: string } | null;
      direction: string | null;
      classification: string;
      decision: string | null;
      issues: { code: string; severity: string }[];
      candidate: { transactionId: string; kind: string | null; description: string | null } | null;
      transactionId: string | null;
    }[];
    nextCursor: string | null;
  };
}

const getImport = async (id: string, u: User = owner): Promise<ImportBody> => {
  const r = await get(u, `/imports/${id}`);
  ok(r);
  expect(contract.validateResponse('getImport', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body as unknown as ImportBody;
};

const TERMINAL = ['COMPLETED', 'PARTIALLY_FAILED', 'COMPLETED_WITH_ERRORS', 'CANCELLED'];
async function settled(id: string, statuses: string[] = TERMINAL): Promise<ImportBody> {
  return until(async () => {
    const job = await getImport(id);
    return statuses.includes(job.status) ? job : undefined;
  }, 120_000);
}

async function approve(job: { id: string; version: number }, key: string = randomUUID(), u: User = owner) {
  return post(u, `/imports/${job.id}/approve`, undefined, {
    'if-match': `"${job.version}"`,
    'idempotency-key': key,
  });
}

/** Sube, mapea, aprueba y espera el fin de la persistencia. */
async function importFile(
  bytes: Buffer | Uint8Array,
  m: Json = mapping(),
  accountId = bank,
): Promise<ImportBody> {
  const created = await uploaded(bytes, accountId);
  const mapped = await mapImport(created, m);
  ok(await approve(mapped), 202);
  return settled(created.id);
}

const csv = (rows: string[], header = 'Fecha;Descripción;Monto'): Buffer =>
  Buffer.from(`${header}\r\n${rows.join('\r\n')}\r\n`, 'latin1');

async function outboxTypes(): Promise<string[]> {
  return asAdmin(h, async (c) => {
    const { rows } = await c.query<{ event_type: string }>(
      `SELECT event_type FROM platform.outbox WHERE workspace_id = $1 AND event_type LIKE 'imports.%' ORDER BY sequence`,
      [owner.ws],
    );
    return rows.map((r) => r.event_type);
  });
}

const auditRows = (where: string, params: unknown[] = []) =>
  asAdmin(h, async (c) => {
    const { rows } = await c.query<{
      action: string;
      aggregate_id: string;
      actor_type: string;
      actor_id: string | null;
      actor_process: string | null;
      origin: string;
      changes: unknown;
    }>(
      `SELECT action, aggregate_id::text, actor_type, actor_user_id::text AS actor_id, actor_process, origin, changes
         FROM audit.audit_log WHERE workspace_id = $1 AND ${where} ORDER BY occurred_at, id`,
      [owner.ws, ...params],
    );
    return rows;
  });

async function createAccount(
  name: string,
  type: string,
  opening: string,
  date = '2026-09-01',
): Promise<string> {
  const r = await post(owner, '/accounts', {
    name,
    type,
    currency: 'BOB',
    openingBalance: { amount: money(opening), date },
  });
  return ok(r, 201)['id'] as string;
}

beforeAll(async () => {
  h = await startHarness({
    worker: true,
    apiEnv: { RATE_LIMIT_WRITES_PER_MIN: '100000', RATE_LIMIT_READS_PER_MIN: '100000' },
  });
  owner = await h.user(`kc-imp-owner-${randomUUID()}`);
  editor = await addMember(await h.user(`kc-imp-editor-${randomUUID()}`), 'EDITOR');
  viewer = await addMember(await h.user(`kc-imp-viewer-${randomUUID()}`), 'VIEWER');
  bank = await createAccount('Banco BOB', 'BANK', '4000.00');
  visa = await createAccount('Visa', 'CREDIT_CARD', '520.00');
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Subida del archivo', () => {
  it('[TC-IMPORTS-CSV-001] detecta windows-1252, punto y coma, encabezado y 4 filas; no crea transacciones', async () => {
    const r = await upload(
      editor,
      fixture('extracto-octubre/input.csv'),
      bank,
      randomUUID(),
      'C:\\fakepath\\extracto-octubre.csv',
    );
    const body = ok(r, 201) as unknown as ImportBody & { originalName: string };
    expect(contract.validateResponse('createImport', 201, body), JSON.stringify(body)).toEqual([]);
    expect(body.status).toBe('AWAITING_MAPPING');
    expect(body.detected).toEqual({ encoding: 'windows-1252', delimiter: ';' });
    expect(body.header).toEqual(['Fecha', 'Descripción', 'Monto']);
    expect(body.sampleRows).toHaveLength(4);
    expect(body.sampleRows[3]).toEqual(['05/10/2026', 'ABONO SUELDO', '8.000,00']);
    expect(body.originalName).toBe('extracto-octubre.csv');
    expect(body.warnings).toEqual([]);
    expect(r.headers.get('location')).toBe(`${W(editor)}/imports/${body.id}`);
    expect(r.headers.get('etag')).toBe(`"${String((body as { version: number }).version)}"`);
    expect(await importedTransactions(bank)).toEqual([]);
    expect(await balanceOf(bank)).toBe('4000.00');
    // El archivo no se guarda: el staging solo conserva celdas.
    const cells = await asAdmin(h, (c) =>
      c.query(`SELECT count(*)::int AS n FROM imports.staged_transaction WHERE import_job_id = $1`, [
        body.id,
      ]),
    );
    expect(cells.rows[0]!.n).toBe(5);
  });

  it('[TC-IMPORTS-CSV-001] UTF-8 con BOM y windows-1252 con acentos', async () => {
    const bom = await uploaded(fixture('utf8-bom/input.csv'));
    expect(bom.detected).toEqual({ encoding: 'utf-8', delimiter: ',' });
    expect(bom.header).toEqual(['Fecha', 'Descripción', 'Monto']);
    const latin = await uploaded(fixture('latin1-accents/input.csv'));
    expect(latin.detected.encoding).toBe('windows-1252');
    expect(latin.sampleRows[0]?.[1]).toBe('ÁRBOL ÑANDÚ SERVICIÓ');
  });

  it('[TC-IMPORTS-CSV-002] una cuenta cerrada o archivada se rechaza y no crea la importación', async () => {
    const closed = await createAccount('Banco Viejo', 'BANK', '0.00');
    const archived = await createAccount('Banco Archivado', 'BANK', '0.00');
    const v = (id: string) => get(owner, `/accounts/${id}`).then((r) => r.body['version'] as number);
    ok(
      await h.call('POST', `${W()}/accounts/${closed}/close`, {
        token: owner.token,
        body: { closedOn: '2026-10-01' },
        headers: { 'if-match': `"${await v(closed)}"` },
      }),
    );
    ok(
      await h.call('POST', `${W()}/accounts/${archived}/archive`, {
        token: owner.token,
        headers: { 'if-match': `"${await v(archived)}"` },
      }),
    );
    const before = await asAdmin(h, (c) => c.query(`SELECT count(*)::int AS n FROM imports.import_job`));
    problem(await upload(editor, fixture('extracto-octubre/input.csv'), closed), 409, 'ACCOUNT_CLOSED');
    problem(await upload(editor, fixture('extracto-octubre/input.csv'), archived), 409, 'ACCOUNT_ARCHIVED');
    problem(
      await upload(editor, fixture('extracto-octubre/input.csv'), randomUUID()),
      422,
      'REFERENCE_NOT_FOUND',
    );
    const after = await asAdmin(h, (c) => c.query(`SELECT count(*)::int AS n FROM imports.import_job`));
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('[TC-IMPORTS-CSV-003] un CSV de 2.5 MiB es 413 UPLOAD_TOO_LARGE y no crea la importación', async () => {
    const big = Buffer.alloc(2_621_440, 'a');
    const r = await upload(editor, big);
    problem(r, 413, 'UPLOAD_TOO_LARGE');
    expect(contract.validateResponse('createImport', 413, r.body, 'application/problem+json')).toEqual([]);
  });

  it('[TC-IMPORTS-CSV-003] un archivo de 2.01 MiB sin Content-Length declarado también se corta al leer', async () => {
    // Un archivo apenas sobre el tope (con el margen del multipart ya dentro del Content-Length) se rechaza por el límite.
    const justOver = Buffer.alloc(2_097_153, 'b');
    problem(await upload(editor, justOver), 413, 'UPLOAD_TOO_LARGE');
  });

  it('[TC-IMPORTS-CSV-004] 5 001 filas de datos es 422 IMPORT_TOO_MANY_ROWS; 5 000 se aceptan', async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => `01/10/2026;GASTO ${i};-1,00`);
    problem(await upload(editor, csv(rows(5001))), 422, 'IMPORT_TOO_MANY_ROWS');
    const accepted = await uploaded(csv(rows(5000)));
    expect(accepted.rowCount).toBe(5000);
  }, 120_000);

  it('[TC-IMPORTS-CSV-005] una imagen renombrada como CSV es 422 IMPORT_UNSUPPORTED_FORMAT', async () => {
    const r = await upload(editor, fixture('edge/png-renamed.csv'), bank, randomUUID(), 'extracto.csv');
    problem(r, 422, 'IMPORT_UNSUPPORTED_FORMAT');
    problem(await upload(editor, Buffer.alloc(0)), 422, 'IMPORT_UNSUPPORTED_FORMAT');
  });

  it('exige la clave de idempotencia y rechaza partes inesperadas del multipart', async () => {
    const noKey = await h.call('POST', `${W(editor)}/imports`, {
      token: editor.token,
      form: uploadForm(fixture('extracto-octubre/input.csv'), bank),
    });
    expect(noKey.status).toBe(428);
    const form = uploadForm(fixture('extracto-octubre/input.csv'), bank);
    form.append('otro', 'x');
    const extra = await h.call('POST', `${W(editor)}/imports`, {
      token: editor.token,
      form,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(extra.status).toBe(400);
    const missing = new FormData();
    missing.append('accountId', bank);
    const noFile = await h.call('POST', `${W(editor)}/imports`, {
      token: editor.token,
      form: missing,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(noFile.status).toBe(400);
  });

  it('una subida repetida con la misma clave y el mismo archivo se reproduce; con otro archivo es IDEMPOTENCY_KEY_REUSED', async () => {
    const key = randomUUID();
    const first = await upload(editor, fixture('extracto-octubre/input.csv'), bank, key);
    expect(first.status).toBe(201);
    const replay = await upload(editor, fixture('extracto-octubre/input.csv'), bank, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body['id']).toBe(first.body['id']);
    problem(
      await upload(editor, fixture('latin1-accents/input.csv'), bank, key),
      422,
      'IDEMPOTENCY_KEY_REUSED',
    );
    problem(
      await upload(editor, fixture('extracto-octubre/input.csv'), visa, key),
      422,
      'IDEMPOTENCY_KEY_REUSED',
    );
  });
});

describe('Mapeo y vista previa', () => {
  it('[TC-IMPORTS-CSV-006][TC-IMPORTS-CSV-015] 4 filas nuevas, salidas 281.30, entradas 8000.00 y saldo resultante 11718.70 sin efectos', async () => {
    const created = await uploaded(fixture('extracto-octubre/input.csv'));
    const mapped = await mapImport(created);
    expect(mapped.status).toBe('AWAITING_REVIEW');
    expect(mapped.previewSummary).toEqual({
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
    const preview = await previewRows(created.id);
    expect(preview.summary).toEqual(mapped.previewSummary);
    expect(
      preview.rows.map((r) => [r.lineNumber, r.date, r.direction, r.amount?.amount, r.classification]),
    ).toEqual([
      [2, '2026-10-01', 'OUT', '245.30', 'NEW'],
      [3, '2026-10-02', 'OUT', '18.00', 'NEW'],
      [4, '2026-10-02', 'OUT', '18.00', 'NEW'],
      [5, '2026-10-05', 'IN', '8000.00', 'NEW'],
    ]);
    // Re-enviar el mapeo con MM/dd/yyyy recalcula las fechas; nada financiero existe en ningún momento.
    const again = await mapImport(mapped, mapping({ dateFormat: 'MM/dd/yyyy' }));
    const recalculated = await previewRows(created.id);
    expect(recalculated.rows.map((r) => r.date)).toEqual([
      '2026-01-10',
      '2026-02-10',
      '2026-02-10',
      '2026-05-10',
    ]);
    expect(again.version).toBeGreaterThan(mapped.version);
    expect(await importedTransactions(bank)).toEqual([]);
    expect(await balanceOf(bank)).toBe('4000.00');
  });

  it('el cursor de la vista previa pagina por línea y el filtro por clasificación funciona', async () => {
    const created = await uploaded(
      csv(Array.from({ length: 7 }, (_, i) => `0${i + 1}/10/2026;GASTO ${i};-1,0${i}`)),
    );
    await mapImport(created);
    const first = ok(await get(owner, `/imports/${created.id}/preview?limit=3`));
    expect((first['rows'] as unknown[]).length).toBe(3);
    expect(first['nextCursor']).toEqual(expect.any(String));
    const second = ok(
      await get(owner, `/imports/${created.id}/preview?limit=3&cursor=${first['nextCursor'] as string}`),
    );
    expect((second['rows'] as { lineNumber: number }[]).map((r) => r.lineNumber)).toEqual([5, 6, 7]);
    const none = ok(await get(owner, `/imports/${created.id}/preview?classification=INVALID`));
    expect(none['rows']).toEqual([]);
  });

  it('[TC-IMPORTS-CSV-007] débito y crédito: la fila con ambos valores es inválida; el resto se interpreta', async () => {
    const created = await uploaded(fixture('debito-credito/input.csv'));
    const mapped = await mapImport(created, {
      hasHeader: true,
      skipRows: 0,
      columns: {
        date: { index: 0 },
        description: { index: 1 },
        amount: { mode: 'DEBIT_CREDIT', debitIndex: 2, creditIndex: 3 },
      },
      dateFormat: 'dd/MM/yyyy',
      decimalSeparator: ',',
    });
    expect(mapped.previewSummary.counts).toMatchObject({ rows: 4, new: 3, invalid: 1 });
    const preview = await previewRows(created.id);
    const byLine = new Map(preview.rows.map((r) => [r.lineNumber, r]));
    expect([byLine.get(3)?.direction, byLine.get(3)?.amount?.amount]).toEqual(['OUT', '245.30']);
    expect(byLine.get(4)?.issues.map((i) => i.code)).toEqual(['IMPORT_INVALID_AMOUNT']);
    expect(byLine.get(4)?.decision).toBe('EXCLUDE');
    expect([byLine.get(5)?.direction, byLine.get(5)?.amount?.amount]).toEqual(['IN', '8000.00']);
  });

  it('[TC-IMPORTS-CSV-008] cargos positivos de una tarjeta (pasivo): salidas que aumentan la deuda', async () => {
    const created = await uploaded(fixture('tarjeta-cargos-positivos/input.csv'), visa);
    const mapped = await mapImport(created, {
      hasHeader: true,
      skipRows: 0,
      columns: {
        date: { index: 0 },
        description: { index: 1 },
        amount: { mode: 'SIGNED', index: 2, signConvention: 'POSITIVE_IS_OUTFLOW' },
      },
      dateFormat: 'dd/MM/yyyy',
      decimalSeparator: ',',
    });
    const preview = await previewRows(created.id);
    expect(preview.rows.map((r) => [r.direction, r.amount?.amount])).toEqual([
      ['OUT', '120.00'],
      ['OUT', '85.50'],
      ['IN', '200.00'],
    ]);
    // Deuda presentada: 520.00 + 205.50 − 200.00.
    expect(mapped.previewSummary.currentBalance.amount).toBe('520.00');
    expect(mapped.previewSummary.resultingBalance.amount).toBe('525.50');
  });

  it('[TC-IMPORTS-CSV-009] una columna inexistente es 422 IMPORT_MAPPING_INVALID y la importación sigue esperando mapeo', async () => {
    const created = await uploaded(fixture('extracto-octubre/input.csv'));
    const bad = mapping({
      columns: {
        ...SIGNED.columns,
        amount: { mode: 'SIGNED', index: 7, signConvention: 'NEGATIVE_IS_OUTFLOW' },
      },
    });
    const r = await put(owner, `/imports/${created.id}/mapping`, bad, created.version);
    problem(r, 422, 'IMPORT_MAPPING_INVALID');
    expect((await getImport(created.id)).status).toBe('AWAITING_MAPPING');
    // Mapeo sin la fecha: rechazado por el contrato (400) y también el que repite columnas (422).
    const noDate = await put(
      owner,
      `/imports/${created.id}/mapping`,
      { ...SIGNED, columns: { description: { index: 1 }, amount: SIGNED.columns.amount } },
      created.version,
    );
    expect([400, 422]).toContain(noDate.status);
    const repeated = await put(
      owner,
      `/imports/${created.id}/mapping`,
      mapping({ columns: { ...SIGNED.columns, description: { index: 0 } } }),
      created.version,
    );
    problem(repeated, 422, 'IMPORT_MAPPING_INVALID');
    expect((await getImport(created.id)).status).toBe('AWAITING_MAPPING');
  });

  it('exige If-Match y rechaza una versión vencida (412)', async () => {
    const created = await uploaded(fixture('extracto-octubre/input.csv'));
    const noMatch = await h.call('PUT', `${W()}/imports/${created.id}/mapping`, {
      token: owner.token,
      body: mapping(),
    });
    expect(noMatch.status).toBe(428);
    const stale = await put(owner, `/imports/${created.id}/mapping`, mapping(), created.version + 5);
    problem(stale, 412, 'PRECONDITION_FAILED');
  });

  it('[TC-IMPORTS-CSV-010][TC-IMPORTS-CSV-011][TC-IMPORTS-CSV-012] montos y fechas se interpretan con el formato elegido, sin redondear', async () => {
    const created = await uploaded(
      csv(
        [
          '03/04/2026;FECHA OK;-1.000,00',
          '31/02/2026;FECHA ROTA;-5,00',
          '04/04/2026;TRES DECIMALES;-1,234',
          '05/04/2026;MILES;8.000,00',
        ],
        'Fecha;Descripción;Monto',
      ),
    );
    await mapImport(created);
    const rows = await previewRows(created.id);
    expect(
      rows.rows.map((r) => [
        r.lineNumber,
        r.classification,
        r.amount?.amount ?? null,
        r.issues.map((i) => i.code),
      ]),
    ).toEqual([
      [2, 'NEW', '1000.00', []],
      [3, 'INVALID', '5.00', ['IMPORT_INVALID_DATE']],
      [4, 'INVALID', null, ['IMPORT_INVALID_AMOUNT']],
      [5, 'NEW', '8000.00', []],
    ]);
    expect(rows.rows[0]?.date).toBe('2026-04-03');
  });

  it('[TC-IMPORTS-CSV-013][TC-IMPORTS-CSV-014] monto cero, fecha futura y periodo cerrado son inválidos con su motivo', async () => {
    await asAdmin(h, (c) =>
      c.query(
        `INSERT INTO planning.financial_period
           (id, workspace_id, label, period_start, period_end, start_day, status, close_count, latest_close_no, activated_at)
         VALUES (gen_random_uuid(), $1, '2026-08', '2026-08-01', '2026-08-31', 1, 'CLOSED', 1, 1, now())
         ON CONFLICT (workspace_id, label) DO UPDATE SET status = 'CLOSED'`,
        [owner.ws],
      ),
    );
    const created = await uploaded(
      csv([
        '10/10/2026;CERO;0,00',
        '10/11/2026;FUTURO;-50,00',
        '06/11/2026;LIMITE;-30,00',
        '15/08/2026;AGOSTO;-75,00',
      ]),
    );
    await mapImport(created);
    const preview = await previewRows(created.id);
    expect(
      preview.rows.map((r) => [r.lineNumber, r.classification, r.decision, r.issues.map((i) => i.code)]),
    ).toEqual([
      [2, 'INVALID', 'EXCLUDE', ['IMPORT_INVALID_AMOUNT']],
      [3, 'INVALID', 'EXCLUDE', ['IMPORT_FUTURE_DATE']],
      [4, 'NEW', 'CREATE', []],
      [5, 'INVALID', 'EXCLUDE', ['PERIOD_CLOSED']],
    ]);
  });
});

describe('Aprobación y persistencia', () => {
  it('[TC-IMPORTS-CSV-022] aprobar con un posible duplicado sin decidir es 409 IMPORT_REVIEW_INCOMPLETE', async () => {
    const acct = await createAccount('Banco duplicados', 'BANK', '1000.00');
    const manual = ok(
      await post(owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-02',
        accountId: acct,
        amount: money('245.30'),
        description: 'Supermercado',
      }),
      201,
    );
    const created = await uploaded(fixture('extracto-octubre/input.csv'), acct);
    const mapped = await mapImport(created);
    expect(mapped.previewSummary.counts).toMatchObject({
      probableDuplicates: 1,
      pendingDecisions: 1,
      new: 3,
    });
    const r = await approve(mapped);
    problem(r, 409, 'IMPORT_REVIEW_INCOMPLETE');
    expect(r.body['pendingDecisions']).toBe(1);
    expect((await getImport(created.id)).status).toBe('AWAITING_REVIEW');
    expect(await importedTransactions(acct)).toEqual([]);
    // Y la fila trae el candidato (el gasto manual) para decidir.
    const dup = (await previewRows(created.id, '&classification=DUPLICATE_PROBABLE')).rows[0]!;
    expect(dup.candidate).toMatchObject({
      transactionId: manual['id'],
      kind: 'EXPENSE',
      description: 'Supermercado',
    });
    expect(dup.decision).toBeNull();
  });

  it('[TC-IMPORTS-CSV-020][TC-IMPORTS-CSV-021][TC-IMPORTS-CSV-023] omitir un duplicado lo vincula; 2 cafés y un sueldo se crean sin categoría; el saldo queda en 11964.00', async () => {
    const acct = await createAccount('Banco BOB 2', 'BANK', '4000.00');
    ok(
      await post(owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-02',
        accountId: acct,
        amount: money('245.30'),
        description: 'Supermercado',
      }),
      201,
    );
    // El gasto manual de 245.30 deja el saldo en 3754.70; las 3 filas a crear suman +7964.00.
    expect(await balanceOf(acct)).toBe('3754.70');
    const created = await uploaded(fixture('extracto-octubre/input.csv'), acct, editor);
    const mapped = await mapImport(created, mapping(), editor);
    const dup = (await previewRows(created.id, '&classification=DUPLICATE_PROBABLE')).rows[0]!;
    const decided = await patch(
      editor,
      `/imports/${created.id}/rows/${dup.id}`,
      { decision: 'SKIP' },
      mapped.version,
    );
    ok(decided);
    expect(
      contract.validateResponse('decideImportRow', 200, decided.body),
      JSON.stringify(decided.body),
    ).toEqual([]);
    expect(decided.body['decision']).toBe('SKIP');
    expect(decided.headers.get('etag')).toBe(`"${String(decided.body['version'])}"`);
    const version = decided.body['version'] as number;

    const key = randomUUID();
    const approved = await h.call('POST', `${W(editor)}/imports/${created.id}/approve`, {
      token: editor.token,
      headers: { 'idempotency-key': key, 'if-match': `"${version}"` },
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(202);
    expect(
      contract.validateResponse('approveImport', 202, approved.body),
      JSON.stringify(approved.body),
    ).toEqual([]);
    expect(approved.body['status']).toBe('APPROVED');

    const done = await settled(created.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.counters).toMatchObject({
      rows: 4,
      created: 3,
      skipped: 1,
      invalid: 0,
      failed: 0,
      alreadyImported: 0,
    });
    expect(done.progress).toMatchObject({ attempt: 1, batchCount: 1, batchesDone: 1 });

    const txns = await importedTransactions(acct, editor);
    expect(
      txns.map((t) => [
        t.kind,
        t.status,
        t.amount,
        t.category,
        t.source,
        t.import_job_id === created.id,
        t.ref,
      ]),
    ).toEqual([
      ['EXPENSE', 'POSTED', '18.00', 'UNCATEGORIZED', 'IMPORT', true, 'imports.csv-row'],
      ['EXPENSE', 'POSTED', '18.00', 'UNCATEGORIZED', 'IMPORT', true, 'imports.csv-row'],
      ['INCOME', 'POSTED', '8000.00', 'UNCATEGORIZED_INCOME', 'IMPORT', true, 'imports.csv-row'],
    ]);
    // Cada asiento balancea por moneda (INV-004): 3754.70 − 36.00 + 8000.00.
    expect(await balanceOf(acct, editor)).toBe('11718.70');
    const unbalanced = await asAdmin(h, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM (
           SELECT je.id FROM ledger.journal_entry je JOIN ledger.posting p ON p.journal_entry_id = je.id
            WHERE je.workspace_id = $1 AND je.source_id IN (SELECT id FROM txn.transaction WHERE import_job_id = $2::uuid)
            GROUP BY je.id, p.currency HAVING sum(p.amount) <> 0) x`,
        [owner.ws, created.id],
      ),
    );
    expect(unbalanced.rows[0]!.n).toBe(0);
  });

  it('[TC-IMPORTS-CSV-023] la aprobación repetida con la misma clave devuelve la misma respuesta; auditoría con actor y origen import', async () => {
    const acct = await createAccount('Banco BOB 3', 'BANK', '4000.00');
    const created = await uploaded(fixture('extracto-octubre/input.csv'), acct, editor);
    // Una fila del archivo se excluye: 2 cafés (18.00) + sueldo = 3 creaciones; el supermercado no se crea.
    const mapped = await mapImport(created, mapping(), editor);
    const rows = (await previewRows(created.id)).rows;
    const supermarket = rows.find((r) => r.lineNumber === 2)!;
    const excluded = await patch(
      editor,
      `/imports/${created.id}/rows/${supermarket.id}`,
      { decision: 'EXCLUDE' },
      mapped.version,
    );
    ok(excluded);
    const key = randomUUID();
    const headers = { 'idempotency-key': key, 'if-match': `"${String(excluded.body['version'])}"` };
    const first = await h.call('POST', `${W(editor)}/imports/${created.id}/approve`, {
      token: editor.token,
      headers,
    });
    expect(first.status).toBe(202);
    const replay = await h.call('POST', `${W(editor)}/imports/${created.id}/approve`, {
      token: editor.token,
      headers,
    });
    expect(replay.status).toBe(202);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body['id']).toBe(first.body['id']);
    expect(replay.body['version']).toBe(first.body['version']);

    const done = await settled(created.id);
    expect(done.counters).toMatchObject({ created: 3, excluded: 1, rows: 4 });
    expect((await importedTransactions(acct)).length).toBe(3);
    // 4000.00 − 18.00 − 18.00 + 8000.00
    expect(await balanceOf(acct)).toBe('11964.00');

    const imports = await auditRows(`aggregate_type = 'ImportJob' AND aggregate_id = $2::uuid`, [created.id]);
    expect(imports.map((a) => [a.action, a.actor_type, a.actor_id]).sort()).toEqual([
      ['imports.import.approved', 'USER', editor.id],
      ['imports.import.completed', 'WORKER', null],
      ['imports.import.created', 'USER', editor.id],
    ]);
    const txnAudit = await auditRows(
      `action = 'transactions.transaction.created' AND aggregate_id IN (SELECT id FROM txn.transaction WHERE import_job_id = $2::uuid)`,
      [created.id],
    );
    expect(txnAudit).toHaveLength(3);
    for (const a of txnAudit) {
      expect(a.origin).toBe('import');
      expect(a.actor_type).toBe('USER');
      expect(a.actor_id).toBe(editor.id);
    }
    // Recorrido de creación de cada transacción.
    const lifecycle = await asAdmin(h, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM audit.lifecycle_transition l
          WHERE l.workspace_id = $1 AND l.aggregate_id IN (SELECT id FROM txn.transaction WHERE import_job_id = $2::uuid)`,
        [owner.ws, created.id],
      ),
    );
    expect(lifecycle.rows[0]!.n).toBeGreaterThanOrEqual(3);
    // Los hechos propios del import: exactamente la aprobación y el fin, nunca por fila.
    const types = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ event_type: string }>(
        `SELECT event_type FROM platform.outbox WHERE workspace_id = $1 AND aggregate_id = $2::uuid AND event_type LIKE 'imports.%' ORDER BY sequence`,
        [owner.ws, created.id],
      );
      return rows.map((r) => r.event_type);
    });
    expect(types).toEqual(['imports.ImportApproved', 'imports.ImportCompleted']);
  });

  it('[TC-IMPORTS-CSV-016][TC-IMPORTS-CSV-019] reimportar el mismo archivo da 4 ya importadas y 0 creaciones; el segundo upload advierte', async () => {
    const acct = await createAccount('Banco reimport', 'BANK', '4000.00');
    const first = await importFile(fixture('extracto-octubre/input.csv'), mapping(), acct);
    expect(first.status).toBe('COMPLETED');
    expect(first.counters).toMatchObject({ created: 4 });
    expect(await balanceOf(acct)).toBe('11718.70');

    const again = await uploaded(fixture('extracto-octubre/input.csv'), acct);
    expect(again.warnings).toEqual([
      { code: 'IMPORT_FILE_ALREADY_IMPORTED', previousImportId: first.id, previousImportedAt: '2026-11-03' },
    ]);
    expect(again.suggestedMapping).toMatchObject({ dateFormat: 'dd/MM/yyyy', decimalSeparator: ',' });
    const mapped = await mapImport(again, mapping());
    expect(mapped.previewSummary.counts).toMatchObject({ rows: 4, new: 0, alreadyImported: 4, toCreate: 0 });
    expect(mapped.previewSummary.resultingBalance.amount).toBe('11718.70');
    ok(await approve(mapped), 202);
    const second = await settled(again.id);
    expect(second.status).toBe('COMPLETED');
    expect(second.counters).toMatchObject({ created: 0, alreadyImported: 4 });
    expect((await importedTransactions(acct)).length).toBe(4);
    expect(await balanceOf(acct)).toBe('11718.70');
    const listed = ok(await get(owner, `/imports?accountId=${acct}&limit=1`));
    expect(contract.validateResponse('listImports', 200, listed), JSON.stringify(listed)).toEqual([]);
    expect((listed['data'] as { id: string }[])[0]?.id).toBe(again.id);
  });

  it('[TC-IMPORTS-CSV-017] un archivo solapado crea solo las filas nuevas', async () => {
    const acct = await createAccount('Banco solapado', 'BANK', '100000.00');
    const day = (i: number) => String(i + 1).padStart(2, '0');
    const row = (i: number) => `${day(i % 28)}/09/2026;GASTO ${i};-${i + 1},00`;
    await importFile(csv(Array.from({ length: 10 }, (_, i) => row(i))), mapping(), acct);
    const created = await uploaded(csv(Array.from({ length: 25 }, (_, i) => row(i))), acct);
    const mapped = await mapImport(created);
    expect(mapped.previewSummary.counts).toMatchObject({ rows: 25, alreadyImported: 10, new: 15 });
    ok(await approve(mapped), 202);
    const done = await settled(created.id);
    expect(done.counters).toMatchObject({ created: 15, alreadyImported: 10 });
    expect((await importedTransactions(acct)).length).toBe(25);
  });

  it('[TC-IMPORTS-CSV-018] tres compras idénticas el mismo día crean tres gastos; una anulada vuelve a ser importable', async () => {
    const acct = await createAccount('Banco cafés', 'BANK', '1000.00');
    const file = fixture('identical-rows-same-day/input.csv');
    const first = await importFile(file, mapping(), acct);
    expect(first.counters).toMatchObject({ created: 3 });
    const txns = await importedTransactions(acct);
    expect(txns.map((t) => t.amount)).toEqual(['18.00', '18.00', '18.00']);
    const detail = await get(owner, `/transactions/${txns[2]!.id}`);
    ok(detail);
    ok(
      await post(
        owner,
        `/transactions/${txns[2]!.id}/void`,
        { reason: 'Cargo duplicado del banco' },
        { 'if-match': `"${String(detail.body['version'])}"` },
      ),
    );
    const created = await uploaded(file, acct);
    const mapped = await mapImport(created);
    expect(mapped.previewSummary.counts).toMatchObject({ alreadyImported: 2, new: 1 });
    ok(await approve(mapped), 202);
    await settled(created.id);
    expect((await importedTransactions(acct)).filter((t) => t.status === 'POSTED')).toHaveLength(3);
  });

  it('[TC-IMPORTS-CSV-020] una transferencia ya registrada y el gasto manual a ±3 días son duplicados; a 5 días la fila es nueva', async () => {
    const acct = await createAccount('Banco transferencias', 'BANK', '5000.00');
    ok(
      await post(owner, '/transfers', {
        fromAccountId: acct,
        toAccountId: visa,
        transactionDate: '2026-10-10',
        amount: money('400.00'),
        description: 'Pago Visa',
      }),
      201,
    );
    ok(
      await post(owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-06',
        accountId: acct,
        amount: money('245.30'),
        description: 'Super lejano',
      }),
      201,
    );
    const created = await uploaded(
      csv(['01/10/2026;COMPRA SUPERMERCADO;-245,30', '10/10/2026;PAGO TARJETA;-400,00']),
      acct,
    );
    await mapImport(created);
    const preview = await previewRows(created.id);
    expect(preview.rows.map((r) => [r.classification, r.candidate?.kind ?? null])).toEqual([
      ['NEW', null],
      ['DUPLICATE_PROBABLE', 'TRANSFER'],
    ]);
  });

  it('[TC-IMPORTS-CSV-021] omitir un duplicado deja un vínculo y la reimportación lo reconoce como ya importado', async () => {
    const acct = await createAccount('Banco omitir', 'BANK', '1000.00');
    const manual = ok(
      await post(owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-02',
        accountId: acct,
        amount: money('245.30'),
        description: 'Supermercado',
      }),
      201,
    );
    const file = csv(['01/10/2026;COMPRA SUPERMERCADO;-245,30']);
    const created = await uploaded(file, acct);
    const mapped = await mapImport(created);
    const row = (await previewRows(created.id)).rows[0]!;
    const decided = ok(
      await patch(owner, `/imports/${created.id}/rows/${row.id}`, { decision: 'SKIP' }, mapped.version),
    );
    ok(await approve({ id: created.id, version: decided['version'] as number }), 202);
    const done = await settled(created.id);
    expect(done.counters).toMatchObject({ created: 0, skipped: 1 });
    const links = await asAdmin(h, (c) =>
      c.query(`SELECT kind, status, transaction_id FROM imports.row_link WHERE account_id = $1`, [acct]),
    );
    expect(links.rows).toEqual([
      { kind: 'SKIPPED_AS_DUPLICATE', status: 'ACTIVE', transaction_id: manual['id'] },
    ]);
    expect(await importedTransactions(acct)).toEqual([]);

    const again = await uploaded(file, acct);
    const remapped = await mapImport(again);
    expect(remapped.previewSummary.counts).toMatchObject({
      alreadyImported: 1,
      new: 0,
      probableDuplicates: 0,
    });
    const exact = (await previewRows(again.id)).rows[0]!;
    expect([exact.classification, exact.decision]).toEqual(['DUPLICATE_EXACT', 'SKIP']);
    // Una fila ya importada o inválida tiene decisión fija (409).
    problem(
      await patch(owner, `/imports/${again.id}/rows/${exact.id}`, { decision: 'CREATE' }, remapped.version),
      409,
      'INVALID_STATUS_TRANSITION',
    );
  });

  it('[TC-IMPORTS-CSV-024] un periodo cerrado entre la vista previa y la persistencia deja el import parcial; reintentar crea solo las faltantes', async () => {
    const acct = await createAccount('Banco parcial', 'BANK', '100000.00');
    // 450 filas: 200 de julio (lote 1), 200 de septiembre (lote 2, se cierra) y 50 de octubre (lote 3).
    const rows = [
      ...Array.from(
        { length: 200 },
        (_, i) => `${String((i % 28) + 1).padStart(2, '0')}/07/2026;JULIO ${i};-${i + 1},00`,
      ),
      ...Array.from(
        { length: 200 },
        (_, i) => `${String((i % 28) + 1).padStart(2, '0')}/09/2026;SEPTIEMBRE ${i};-${i + 1},00`,
      ),
      ...Array.from(
        { length: 50 },
        (_, i) => `${String((i % 28) + 1).padStart(2, '0')}/10/2026;OCTUBRE ${i};-${i + 1},00`,
      ),
    ];
    const created = await uploaded(csv(rows), acct);
    const mapped = await mapImport(created);
    expect(mapped.previewSummary.counts).toMatchObject({ rows: 450, new: 450 });

    // Sin worker: se aprueba, se cierra septiembre en el ledger y recién entonces se procesa el evento.
    await h.stopWorker();
    ok(await approve(mapped), 202);
    await asAdmin(h, (c) =>
      c.query(
        `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end)
         VALUES ($1, '2026-09', '2026-09-01', '2026-09-30')`,
        [owner.ws],
      ),
    );
    await h.startWorker({}, { discardBacklog: false });
    const partial = await settled(created.id);
    expect(partial.status).toBe('PARTIALLY_FAILED');
    expect(partial.counters).toMatchObject({ created: 250, failed: 200 });
    expect(partial.errors).toHaveLength(1);
    expect(partial.errors[0]).toMatchObject({ code: 'PERIOD_CLOSED', count: 200 });
    expect(partial.errors[0]!.lines).toHaveLength(100);
    expect((await importedTransactions(acct)).length).toBe(250);

    // Aceptar el resultado parcial sin reintentar es otra rama: aquí se reintenta tras reabrir septiembre.
    problem(await post(owner, `/imports/${created.id}/cancel`), 409, 'INVALID_STATUS_TRANSITION');
    await asAdmin(h, (c) => c.query(`DELETE FROM ledger.period_lock WHERE workspace_id = $1`, [owner.ws]));
    const retried = await post(owner, `/imports/${created.id}/retry`);
    expect(retried.status, JSON.stringify(retried.body)).toBe(202);
    expect(contract.validateResponse('retryImport', 202, retried.body), JSON.stringify(retried.body)).toEqual(
      [],
    );
    const done = await settled(created.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.counters).toMatchObject({ created: 450, failed: 0 });
    expect(done.errors).toEqual([]);
    expect((await importedTransactions(acct)).length).toBe(450);
    // Ninguna duplicada: 450 huellas distintas.
    const distinct = await asAdmin(h, (c) =>
      c.query(
        `SELECT count(DISTINCT external_ref_id)::int AS n FROM txn.transaction WHERE account_id = $1 AND source = 'IMPORT'`,
        [acct],
      ),
    );
    expect(distinct.rows[0]!.n).toBe(450);
  }, 240_000);

  it('[TC-IMPORTS-CSV-024] aceptar el resultado parcial termina completada con errores y 250 creadas', async () => {
    const acct = await createAccount('Banco aceptar', 'BANK', '100000.00');
    const rows = [
      ...Array.from(
        { length: 200 },
        (_, i) => `${String((i % 28) + 1).padStart(2, '0')}/07/2026;JULIO ${i};-${i + 1},00`,
      ),
      ...Array.from(
        { length: 200 },
        (_, i) => `${String((i % 28) + 1).padStart(2, '0')}/09/2026;SEPTIEMBRE ${i};-${i + 1},00`,
      ),
      ...Array.from(
        { length: 50 },
        (_, i) => `${String((i % 28) + 1).padStart(2, '0')}/10/2026;OCTUBRE ${i};-${i + 1},00`,
      ),
    ];
    const created = await uploaded(csv(rows), acct);
    const mapped = await mapImport(created);
    await h.stopWorker();
    ok(await approve(mapped), 202);
    await asAdmin(h, (c) =>
      c.query(
        `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end)
         VALUES ($1, '2026-09', '2026-09-01', '2026-09-30')`,
        [owner.ws],
      ),
    );
    try {
      await h.startWorker({}, { discardBacklog: false });
      await settled(created.id);
    } finally {
      await asAdmin(h, (c) => c.query(`DELETE FROM ledger.period_lock WHERE workspace_id = $1`, [owner.ws]));
    }
    const accepted = await post(owner, `/imports/${created.id}/accept-errors`);
    ok(accepted);
    expect(
      contract.validateResponse('acceptImportErrors', 200, accepted.body),
      JSON.stringify(accepted.body),
    ).toEqual([]);
    expect(accepted.body['status']).toBe('COMPLETED_WITH_ERRORS');
    expect((accepted.body['counters'] as Record<string, number>)['created']).toBe(250);
    expect((accepted.body['counters'] as Record<string, number>)['failed']).toBe(200);
    expect((await auditRows(`action = 'imports.import.errors_accepted'`)).length).toBeGreaterThan(0);
    problem(await post(owner, `/imports/${created.id}/retry`), 409, 'INVALID_STATUS_TRANSITION');
    expect(await outboxTypes()).toContain('imports.ImportCompleted');
  }, 240_000);
});

describe('Cancelación, seguridad y roles', () => {
  it('[TC-IMPORTS-CSV-025] cancelar en revisión descarta las celdas y no crea transacciones; una completada no se cancela', async () => {
    const acct = await createAccount('Banco cancelar', 'BANK', '1000.00');
    const created = await uploaded(fixture('extracto-octubre/input.csv'), acct);
    await mapImport(created);
    const cancelled = await post(owner, `/imports/${created.id}/cancel`);
    ok(cancelled);
    expect(
      contract.validateResponse('cancelImport', 200, cancelled.body),
      JSON.stringify(cancelled.body),
    ).toEqual([]);
    expect(cancelled.body['status']).toBe('CANCELLED');
    expect(cancelled.body['cancelledBy']).toBe(owner.id);
    expect(await importedTransactions(acct)).toEqual([]);
    const cells = await asAdmin(h, (c) =>
      c.query(`SELECT count(*)::int AS n FROM imports.staged_transaction WHERE import_job_id = $1`, [
        created.id,
      ]),
    );
    expect(cells.rows[0]!.n).toBe(0);
    expect(
      (await auditRows(`action = 'imports.import.cancelled' AND aggregate_id = $2::uuid`, [created.id]))
        .length,
    ).toBe(1);
    problem(
      await put(owner, `/imports/${created.id}/mapping`, mapping(), cancelled.body['version'] as number),
      409,
      'INVALID_STATUS_TRANSITION',
    );

    const done = await importFile(fixture('extracto-octubre/input.csv'), mapping(), acct);
    problem(await post(owner, `/imports/${done.id}/cancel`), 409, 'INVALID_STATUS_TRANSITION');
  });

  it('[TC-IMPORTS-CSV-026] una descripción con fórmula se guarda literal y el CSV del export la neutraliza', async () => {
    const acct = await createAccount('Banco fórmulas', 'BANK', '1000.00');
    const long = `${'COMPRA  '.repeat(10)}\tTIENDA ${'X'.repeat(560)}`;
    const file = Buffer.concat([
      fixture('formula-description/input.csv'),
      Buffer.from(`06/10/2026;"${long}";-9,00\r\n`, 'utf8'),
    ]);
    const created = await uploaded(file, acct);
    const mapped = await mapImport(created);
    const truncated = (await previewRows(created.id)).rows.find((r) => r.lineNumber === 5)!;
    expect(truncated.issues).toEqual([{ code: 'IMPORT_DESCRIPTION_TRUNCATED', severity: 'WARNING' }]);
    ok(await approve(mapped), 202);
    const done = await settled(created.id);
    expect(done.counters).toMatchObject({ created: 4 });
    const txns = await importedTransactions(acct);
    const formula = txns.find((t) => t.description?.startsWith('=HYPERLINK'));
    expect(formula?.description).toBe('=HYPERLINK("http://example.test","clic")');
    const longTxn = txns.find((t) => t.description?.startsWith('COMPRA'))!;
    expect(Array.from(longTxn.description as string)).toHaveLength(500);
    expect(longTxn.description).not.toMatch(/\t| {2}/);

    // El CSV del export neutraliza las celdas que empiezan con = + - @ (apóstrofo inicial).
    const exported = await exportAndWait(h, owner, owner.ws);
    const dl = await downloadExport(h, owner, owner.ws, exported['id'] as string);
    expect(dl.status).toBe(200);
    const csvText = ZipReader.open(dl.raw).read('csv/transactions.csv').toString('utf8');
    expect(csvText).toContain(`'=HYPERLINK`);
    expect(csvText).not.toMatch(/(^|[,"\n])=HYPERLINK/);
    expect(csvText).toContain(`'+SUMA(1+1)`);
    expect(csvText).toContain(`'@CMD`);
  }, 240_000);

  it('[TC-IMPORTS-CSV-026] los logs del import no contienen montos ni descripciones', async () => {
    const marker = `MARCADOR-SECRETO-${randomUUID().slice(0, 8)}`;
    const acct = await createAccount('Banco logs', 'BANK', '1000.00');
    const done = await importFile(csv([`02/10/2026;${marker};-18,31`]), mapping(), acct);
    expect(done.status).toBe('COMPLETED');
    const apiLogs = JSON.stringify(h.apiLog.records());
    expect(apiLogs).not.toContain(marker);
    // Con límites: `18.31` también aparece en marcas de tiempo (`…:18.313Z`), que no son montos.
    expect(apiLogs).not.toMatch(/(?<![\d:.])18[.,]31(?!\d)/u);
  });

  it('[TC-IMPORTS-CSV-027] un VIEWER no puede importar y la aprobación queda auditada con el actor y origen import', async () => {
    const before = await asAdmin(h, (c) => c.query(`SELECT count(*)::int AS n FROM imports.import_job`));
    problem(await upload(viewer, fixture('extracto-octubre/input.csv')), 403, 'INSUFFICIENT_ROLE');
    const after = await asAdmin(h, (c) => c.query(`SELECT count(*)::int AS n FROM imports.import_job`));
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);

    const created = await uploaded(fixture('extracto-octubre/input.csv'));
    const mapped = await mapImport(created, mapping(), editor);
    // El VIEWER lee pero no modifica.
    expect((await get(viewer, `/imports/${created.id}`)).status).toBe(200);
    expect((await get(viewer, `/imports/${created.id}/preview`)).status).toBe(200);
    expect((await get(viewer, '/imports')).status).toBe(200);
    problem(
      await put(viewer, `/imports/${created.id}/mapping`, mapping(), mapped.version),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(await approve(mapped, randomUUID(), viewer), 403, 'INSUFFICIENT_ROLE');
    problem(await post(viewer, `/imports/${created.id}/cancel`), 403, 'INSUFFICIENT_ROLE');
    problem(await post(viewer, `/imports/${created.id}/retry`), 403, 'INSUFFICIENT_ROLE');
    problem(await post(viewer, `/imports/${created.id}/accept-errors`), 403, 'INSUFFICIENT_ROLE');
  });

  it('aísla los imports por workspace: otro workspace recibe 404', async () => {
    const created = await uploaded(fixture('extracto-octubre/input.csv'));
    const other = await h.user(`kc-imp-other-${randomUUID()}`);
    const r = await h.call('GET', `/api/v1/workspaces/${other.ws}/imports/${created.id}`, {
      token: other.token,
    });
    expect(r.status).toBe(404);
    const crossWs = await h.call('GET', `/api/v1/workspaces/${owner.ws}/imports/${created.id}`, {
      token: other.token,
    });
    expect([403, 404]).toContain(crossWs.status);
  });
});

describe('Portabilidad del workspace', () => {
  it('[TC-IDENTITY-EXPORT-010] el export incluye jobs y vínculos (sin el staging) y la restauración remapea cuentas, transacciones y jobs', async () => {
    const acct = await createAccount('Banco portabilidad', 'BANK', '4000.00');
    const done = await importFile(fixture('extracto-octubre/input.csv'), mapping(), acct);
    expect(done.counters).toMatchObject({ created: 4 });
    const exported = await exportAndWait(h, owner, owner.ws);
    const dl = await downloadExport(h, owner, owner.ws, exported['id'] as string);
    expect(dl.status).toBe(200);
    const zip = ZipReader.open(dl.raw);
    expect(zip.has('json/import-jobs.jsonl')).toBe(true);
    expect(zip.has('json/import-row-links.jsonl')).toBe(true);
    expect(zip.names().some((n) => n.includes('staged'))).toBe(false);
    const jobs = zip
      .read('json/import-jobs.jsonl')
      .toString('utf8')
      .trim()
      .split(String.fromCharCode(10))
      .map((l) => JSON.parse(l) as Json);
    expect(jobs.find((j) => j['id'] === done.id)).toMatchObject({
      status: 'COMPLETED',
      target_account_id: acct,
    });

    const restored = await importAndWait(h, owner, dl.raw);
    expect(restored['status'], JSON.stringify(restored)).toBe('SUCCEEDED');
    const newWs = restored['workspaceId'] as string;
    expect(newWs).not.toBe(owner.ws);
    const check = await asAdmin(h, async (c) => {
      const q = async (sql: string) => (await c.query(sql, [newWs])).rows[0] as Record<string, number>;
      return {
        jobs: await q(`SELECT count(*)::int AS n FROM imports.import_job WHERE workspace_id = $1`),
        staged: await q(`SELECT count(*)::int AS n FROM imports.staged_transaction WHERE workspace_id = $1`),
        links: await q(`SELECT count(*)::int AS n FROM imports.row_link WHERE workspace_id = $1`),
        danglingLinks: await q(
          `SELECT count(*)::int AS n FROM imports.row_link l WHERE l.workspace_id = $1
              AND NOT EXISTS (SELECT 1 FROM txn.transaction t WHERE t.workspace_id = l.workspace_id AND t.id = l.transaction_id)`,
        ),
        danglingAccounts: await q(
          `SELECT count(*)::int AS n FROM imports.import_job j WHERE j.workspace_id = $1
              AND NOT EXISTS (SELECT 1 FROM accounts.account a WHERE a.workspace_id = j.workspace_id AND a.id = j.target_account_id)`,
        ),
        danglingJobRefs: await q(
          `SELECT count(*)::int AS n FROM txn.transaction t WHERE t.workspace_id = $1 AND t.import_job_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM imports.import_job j WHERE j.workspace_id = t.workspace_id AND j.id = t.import_job_id)`,
        ),
        stagedLinks: await q(
          `SELECT count(*)::int AS n FROM imports.row_link WHERE workspace_id = $1 AND staged_transaction_id IS NOT NULL`,
        ),
      };
    });
    expect(check.staged.n).toBe(0);
    expect(check.jobs.n).toBeGreaterThan(0);
    expect(check.links.n).toBeGreaterThanOrEqual(4);
    expect(check.danglingLinks.n).toBe(0);
    expect(check.danglingAccounts.n).toBe(0);
    expect(check.danglingJobRefs.n).toBe(0);
    expect(check.stagedLinks.n).toBe(0);
  }, 300_000);
});

describe('Volumen y cuota', () => {
  it('[TC-IMPORTS-CSV-028] la subida 11 en un minuto es 429 RATE_LIMITED con Retry-After y la reproducción de una aprobación no consume cuota', async () => {
    const limited = await startHarness({
      worker: true,
      apiEnv: { RATE_LIMIT_COSTLY_PER_MIN: '10', RATE_LIMIT_WRITES_PER_MIN: '100000' },
    });
    try {
      const u = await limited.user(`kc-imp-rate-${randomUUID()}`);
      const create = await limited.call('POST', `/api/v1/workspaces/${u.ws}/accounts`, {
        token: u.token,
        body: {
          name: 'Banco cuota',
          type: 'BANK',
          currency: 'BOB',
          openingBalance: { amount: money('100.00'), date: '2026-09-01' },
        },
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(create.status).toBe(201);
      const acct = create.body['id'] as string;
      const up = (key: string = randomUUID()) =>
        limited.call('POST', `/api/v1/workspaces/${u.ws}/imports`, {
          token: u.token,
          form: uploadForm(fixture('extracto-octubre/input.csv'), acct),
          headers: { 'idempotency-key': key },
        });
      const firstKey = randomUUID();
      const first = await up(firstKey);
      expect(first.status).toBe(201);
      // La reproducción idempotente no consume cuota.
      for (let i = 0; i < 3; i += 1) expect((await up(firstKey)).status).toBe(201);
      for (let i = 0; i < 9; i += 1) expect((await up()).status, `subida ${i + 2}`).toBe(201);
      const eleventh = await up();
      problem(eleventh, 429, 'RATE_LIMITED');
      expect(Number(eleventh.headers.get('retry-after'))).toBeGreaterThan(0);
      const count = await asAdmin(limited, (c) =>
        c.query(`SELECT count(*)::int AS n FROM imports.import_job WHERE workspace_id = $1`, [u.ws]),
      );
      expect(count.rows[0]!.n).toBe(10);
    } finally {
      await limited.close();
    }
  }, 240_000);

  it('[TC-IMPORTS-CSV-029] un extracto de 1 000 filas se mapea, aprueba y persiste; solo hay 2 eventos propios', async () => {
    const acct = await createAccount('Banco volumen', 'BANK', '1000000.00');
    const rows = Array.from({ length: 1000 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, '0');
      return `${day}/10/2026;COMPRA ${i};-${(i % 90) + 1},${String(i % 100).padStart(2, '0')}`;
    });
    const started = Date.now();
    const created = await uploaded(csv(rows), acct);
    const mapped = await mapImport(created);
    const previewMs = Date.now() - started;
    expect(mapped.previewSummary.counts).toMatchObject({ rows: 1000, new: 1000 });
    expect(previewMs).toBeLessThan(30_000);
    const approvedAt = Date.now();
    ok(await approve(mapped), 202);
    const done = await settled(created.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.counters.created).toBe(1000);
    expect(done.progress).toMatchObject({ batchCount: 5, batchesDone: 5 });
    expect(Date.now() - approvedAt).toBeLessThan(120_000);
    const events = await asAdmin(h, async (c) => {
      const { rows: r } = await c.query<{ event_type: string }>(
        `SELECT event_type FROM platform.outbox WHERE workspace_id = $1 AND aggregate_id = $2::uuid AND event_type LIKE 'imports.%'`,
        [owner.ws, created.id],
      );
      return r.map((x) => x.event_type).sort();
    });
    expect(events).toEqual(['imports.ImportApproved', 'imports.ImportCompleted']);
  }, 300_000);
});

describe('Retención', () => {
  it('[TC-IMPORTS-CSV-030] las celdas se purgan a los 90 días y una revisión abandonada expira a los 30', async () => {
    const clock = h.clock as FixedClock;
    const start = clock.now();
    const acct = await createAccount('Banco retención', 'BANK', '1000.00');
    const done = await importFile(fixture('extracto-octubre/input.csv'), mapping(), acct);
    const waiting = await uploaded(fixture('latin1-accents/input.csv'), acct);
    const stagedOf = async (id: string) => {
      const r = await asAdmin(h, (c) =>
        c.query(`SELECT count(*)::int AS n FROM imports.staged_transaction WHERE import_job_id = $1`, [id]),
      );
      return r.rows[0]!.n as number;
    };
    const runJob = async (queue: string) => {
      const worker = h.worker!;
      await worker.queue.send(queue, { trigger: 'manual' });
    };
    const wait = (fn: () => Promise<boolean>) =>
      until(async () => ((await fn()) ? true : undefined), 60_000, 300);
    try {
      expect(await stagedOf(done.id)).toBeGreaterThan(0);
      // 30 días: la revisión abandonada expira (cancelada por el sistema, auditada, sin celdas).
      clock.set(start.plusMillis(30 * 86_400_000));
      await runJob('imports.expire-reviews');
      await wait(async () => (await getImport(waiting.id)).status === 'CANCELLED');
      const expired = await getImport(waiting.id);
      expect(expired).toMatchObject({ status: 'CANCELLED', cancelledBy: 'SYSTEM' });
      expect(await stagedOf(waiting.id)).toBe(0);
      const audit = await auditRows(`action = 'imports.import.expired' AND aggregate_id = $2::uuid`, [
        waiting.id,
      ]);
      expect(audit.map((a) => [a.actor_type, a.actor_process])).toEqual([
        ['SYSTEM', 'imports.expire-reviews'],
      ]);
      expect(await stagedOf(done.id)).toBeGreaterThan(0);

      // 90 días tras terminar: se purgan las celdas; el import, sus conteos y los vínculos se conservan.
      clock.set(start.plusMillis(91 * 86_400_000));
      await runJob('imports.purge-staging');
      await wait(async () => (await stagedOf(done.id)) === 0);
      const kept = await getImport(done.id);
      expect(kept.status).toBe('COMPLETED');
      expect(kept.counters.created).toBe(4);
      const links = await asAdmin(h, (c) =>
        c.query(
          `SELECT count(*)::int AS n FROM imports.row_link WHERE account_id = $1 AND status = 'ACTIVE'`,
          [acct],
        ),
      );
      expect(links.rows[0]!.n).toBe(4);
    } finally {
      clock.set(start);
    }
    // Reimportar el mismo archivo sigue dando 0 nuevas.
    const again = await uploaded(fixture('extracto-octubre/input.csv'), acct);
    const mapped = await mapImport(again);
    expect(mapped.previewSummary.counts).toMatchObject({ alreadyImported: 4, new: 0 });
  }, 240_000);
});
