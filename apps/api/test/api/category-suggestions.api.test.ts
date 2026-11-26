/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

// Sugerencias de categoría por historial por HTTP, con el worker real y contra PostgreSQL con RLS (openspec
// add-category-suggestions, TC-CLASSIFICATION-AUTO-*): evidencia, reglas, categorías archivadas, aislamiento, vista
// previa del import, aceptación en lote, tasa de aceptación y roles. El reloj del harness fija «hoy» en 2026-11-03.
let h: Harness;

const W = (u: User) => `/api/v1/workspaces/${u.ws}`;
const call = (u: User, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  h.call(method, `${W(u)}${path}`, { token: u.token, ...(body === undefined ? {} : { body }), headers });
const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(u, 'POST', path, body, { 'idempotency-key': randomUUID(), ...headers });
const get = (u: User, path: string) => call(u, 'GET', path);
const ok = (r: Reply, status = 200): Json => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code'], JSON.stringify(r.body)).toBe(code);
};

async function addMember(owner: User, u: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
  await asAdmin(h, (c) =>
    c.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
      [owner.ws, u.id, role],
    ),
  );
  return { ...u, ws: owner.ws };
}

interface Env {
  readonly u: User;
  readonly bank: string;
  readonly cat: (name: string) => string;
}

async function env(prefix: string): Promise<Env> {
  const u = await h.user(`kc-cat-${prefix}-${randomUUID()}`);
  const bank = ok(
    await post(u, '/accounts', {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('9000.00'), date: '2026-01-01' },
    }),
    201,
  )['id'] as string;
  const cats = ok(await get(u, '/categories?kind=EXPENSE&limit=200'))['data'] as {
    id: string;
    name: string;
  }[];
  const byName = new Map(cats.map((c) => [c.name, c.id]));
  return {
    u,
    bank,
    cat: (name) => {
      const id = byName.get(name);
      expect(id, `categoría ${name}`).toBeDefined();
      return id as string;
    },
  };
}

/** Un gasto clasificado a mano (origen MANUAL) o, sin `category`, sin categoría. */
async function expense(e: Env, date: string, description: string, category?: string): Promise<Json> {
  return ok(
    await post(e.u, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: date,
      accountId: e.bank,
      amount: money('30.00'),
      description,
      ...(category ? { splits: [{ amount: money('30.00'), categoryId: category }] } : {}),
    }),
    201,
  );
}

/** El historial de TC-CLASSIFICATION-AUTO-001: 9 «PEDIDOSYA» en Restaurantes y 1 en Supermercado. */
async function pedidosYa(e: Env) {
  for (let i = 0; i < 9; i += 1) {
    await expense(
      e,
      `2026-09-${String(10 + i).padStart(2, '0')}`,
      `PEDIDOSYA *88${i}`,
      e.cat('Restaurantes'),
    );
  }
  await expense(e, '2026-09-25', 'PEDIDOSYA *8899', e.cat('Supermercado'));
}

async function query(u: User, body: Json): Promise<Json> {
  const r = await post(u, '/category-suggestions/query', body);
  ok(r);
  expect(contract.validateResponse('queryCategorySuggestion', 200, r.body), JSON.stringify(r.body)).toEqual(
    [],
  );
  return r.body;
}

beforeAll(async () => {
  h = await startHarness({
    worker: true,
    apiEnv: { RATE_LIMIT_WRITES_PER_MIN: '100000', RATE_LIMIT_READS_PER_MIN: '100000' },
  });
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Consulta de la sugerencia del alta manual', () => {
  it('[TC-CLASSIFICATION-AUTO-001][TC-CLASSIFICATION-AUTO-013] nueve de diez sugiere Restaurantes con confianza alta y la descripción viaja en el cuerpo', async () => {
    const e = await env('nueve');
    await pedidosYa(e);
    const result = await query(e.u, { kind: 'EXPENSE', description: 'PEDIDOSYA *8812' });
    expect(result).toEqual({
      status: 'SUGGESTED',
      suggestion: {
        categoryId: e.cat('Restaurantes'),
        confidence: '0.9000',
        level: 'HIGH',
        support: 10,
        matches: 9,
        basis: 'DESCRIPTION',
        descriptionKey: 'pedidosya',
        counterpartyId: null,
      },
      ruleId: null,
    });
    // Nada se aplicó: no hay más transacciones que las 10 del historial y la consulta no auditó nada nuevo.
    const count = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM txn.transaction WHERE workspace_id = $1`,
        [e.u.ws],
      );
      return rows[0]!.n;
    });
    expect(count).toBe(10);
  }, 180_000);

  it('[TC-CLASSIFICATION-AUTO-005] las categorías fijadas por una regla no cuentan como historial', async () => {
    const e = await env('regla');
    const sup = e.cat('Supermercado');
    const rule = ok(
      await post(e.u, '/rules', {
        name: 'Supermercado',
        triggers: ['MANUAL_CREATE'],
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
        actions: [{ type: 'SET_CATEGORY', categoryId: sup }],
      }),
      201,
    );
    for (let i = 0; i < 6; i += 1) await expense(e, `2026-10-0${i + 1}`, 'HIPERMAXI SUC 12');
    const origins = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ o: string }>(
        `SELECT DISTINCT category_origin AS o FROM txn.transaction_split s JOIN txn.transaction t ON t.id = s.transaction_id WHERE t.workspace_id = $1`,
        [e.u.ws],
      );
      return rows.map((r) => r.o);
    });
    expect(origins).toEqual(['RULE']);
    // La regla se desactiva: ya no responde RULE_APPLIES y el historial que fijó no cuenta.
    ok(
      await call(e.u, 'POST', `/rules/${String(rule['id'])}/disable`, undefined, {
        'if-match': `"${String(rule['rowVersion'])}"`,
      }),
    );
    const result = await query(e.u, { kind: 'EXPENSE', description: 'HIPERMAXI SUC 12' });
    expect(result).toEqual({ status: 'NONE', suggestion: null, ruleId: null });
  }, 180_000);

  it('[TC-CLASSIFICATION-AUTO-009] si una regla de alta manual clasificará el gasto responde RULE_APPLIES sin sugerencia', async () => {
    const e = await env('rule-applies');
    const home = e.cat('Servicios básicos');
    for (let i = 0; i < 6; i += 1) await expense(e, `2026-10-1${i}`, 'HIPERMAXI', home);
    const rule = ok(
      await post(e.u, '/rules', {
        name: 'Supermercado',
        triggers: ['MANUAL_CREATE'],
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
        actions: [{ type: 'SET_CATEGORY', categoryId: e.cat('Supermercado') }],
      }),
      201,
    );
    expect(await query(e.u, { kind: 'EXPENSE', description: 'HIPERMAXI' })).toEqual({
      status: 'RULE_APPLIES',
      suggestion: null,
      ruleId: rule['id'],
    });
  }, 180_000);

  it('[TC-CLASSIFICATION-AUTO-006] una categoría archivada no se sugiere', async () => {
    const e = await env('archivada');
    const gym = e.cat('Deporte y gimnasio');
    for (let i = 0; i < 5; i += 1) await expense(e, `2026-10-0${i + 1}`, 'GIMNASIO BODYTECH', gym);
    const listed = ok(await get(e.u, '/categories?kind=EXPENSE&limit=200'))['data'] as {
      id: string;
      version: number;
    }[];
    const version = listed.find((c) => c.id === gym)!.version;
    ok(await call(e.u, 'POST', `/categories/${gym}/archive`, undefined, { 'if-match': `"${version}"` }));
    expect(await query(e.u, { kind: 'EXPENSE', description: 'GIMNASIO BODYTECH' })).toEqual({
      status: 'NONE',
      suggestion: null,
      ruleId: null,
    });
  }, 180_000);

  it('[TC-CLASSIFICATION-AUTO-021] la sugerencia funciona con el servicio de pronósticos detenido', async () => {
    // El harness no levanta el servicio de pronósticos y `FORECASTING_ENABLED` es falso: la consulta responde igual.
    const e = await env('sin-forecast');
    await pedidosYa(e);
    expect((await query(e.u, { kind: 'EXPENSE', description: 'PEDIDOSYA' }))['status']).toBe('SUGGESTED');
  }, 180_000);

  it('[TC-CLASSIFICATION-AUTO-023] el historial de otro workspace no influye y los resultados tienen RLS forzada', async () => {
    const w2 = await env('w2');
    for (let i = 0; i < 10; i += 1) {
      await expense(w2, `2026-09-${String(10 + i).padStart(2, '0')}`, 'PEDIDOSYA', w2.cat('Supermercado'));
    }
    expect((await query(w2.u, { kind: 'EXPENSE', description: 'PEDIDOSYA' }))['status']).toBe('SUGGESTED');
    const w1 = await env('w1');
    expect(await query(w1.u, { kind: 'EXPENSE', description: 'PEDIDOSYA' })).toEqual({
      status: 'NONE',
      suggestion: null,
      ruleId: null,
    });
    const meta = await asAdmin(h, async (c) => {
      const rls = await c.query<{ forced: boolean }>(
        `SELECT relforcerowsecurity AS forced FROM pg_class WHERE oid = 'rules.category_suggestion_outcome'::regclass`,
      );
      const reg = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform.workspace_scoped_table WHERE schema_name = 'rules' AND table_name = 'category_suggestion_outcome'`,
      );
      const cols = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'rules' AND table_name = 'category_suggestion_outcome' ORDER BY column_name`,
      );
      return {
        forced: rls.rows[0]!.forced,
        registered: reg.rows[0]!.n,
        columns: cols.rows.map((r) => r.column_name),
      };
    });
    expect(meta.forced).toBe(true);
    expect(meta.registered).toBe(1);
    // [TC-CLASSIFICATION-AUTO-018] sin descripciones, montos ni categorías.
    expect(meta.columns).toEqual([
      'created_at',
      'id',
      'import_job_id',
      'level',
      'occurred_on',
      'outcome',
      'surface',
      'transaction_id',
      'workspace_id',
    ]);
  }, 180_000);

  it('valida el cuerpo: sin descripción ni contraparte es VALIDATION_FAILED y un VIEWER puede consultar', async () => {
    const e = await env('validacion');
    problem(await post(e.u, '/category-suggestions/query', { kind: 'EXPENSE' }), 400, 'VALIDATION_FAILED');
    problem(
      await post(e.u, '/category-suggestions/query', { kind: 'EXPENSE', description: 'x'.repeat(501) }),
      400,
      'VALIDATION_FAILED',
    );
    const viewer = await addMember(e.u, await h.user(`kc-cat-viewer-${randomUUID()}`), 'VIEWER');
    expect((await query(viewer, { kind: 'EXPENSE', description: 'PEDIDOSYA' }))['status']).toBe('NONE');
  }, 180_000);
});

describe('Tasa de aceptación', () => {
  it('[TC-CLASSIFICATION-AUTO-012][TC-CLASSIFICATION-AUTO-018] el alta manual registra los resultados y el informe del mes da 0.7500', async () => {
    const e = await env('tasa');
    const editor = await addMember(e.u, await h.user(`kc-cat-editor-${randomUUID()}`), 'EDITOR');
    const viewer = await addMember(e.u, await h.user(`kc-cat-viewer2-${randomUUID()}`), 'VIEWER');
    const rest = e.cat('Restaurantes');
    const other = e.cat('Supermercado');
    const send = (chosen: string | null) =>
      post(editor, '/category-suggestions/feedback', {
        surface: 'MANUAL_ENTRY',
        level: 'HIGH',
        suggestedCategoryId: rest,
        chosenCategoryId: chosen,
      });
    for (let i = 0; i < 15; i += 1) ok(await send(rest), 204);
    for (let i = 0; i < 3; i += 1) ok(await send(other), 204);
    for (let i = 0; i < 2; i += 1) ok(await send(null), 204);
    // Un VIEWER no registra resultados (EDITOR o más).
    problem(
      await post(viewer, '/category-suggestions/feedback', {
        surface: 'MANUAL_ENTRY',
        level: 'HIGH',
        suggestedCategoryId: rest,
        chosenCategoryId: rest,
      }),
      403,
      'INSUFFICIENT_ROLE',
    );
    const stats = ok(await get(viewer, '/category-suggestions/stats?from=2026-11-01&to=2026-11-30'));
    expect(
      contract.validateResponse('getCategorySuggestionStats', 200, stats),
      JSON.stringify(stats),
    ).toEqual([]);
    expect(stats).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
      shown: 20,
      accepted: 15,
      corrected: 3,
      ignored: 2,
      acceptanceRate: '0.7500',
    });
    expect((stats['bySurface'] as any[]).find((s) => s.surface === 'MANUAL_ENTRY')).toMatchObject({
      shown: 20,
    });
    // Un mes sin resultados: tasa nula; un rango invertido o de más de 366 días es INVALID_FILTER.
    expect(
      ok(await get(viewer, '/category-suggestions/stats?from=2026-10-01&to=2026-10-31'))['acceptanceRate'],
    ).toBeNull();
    problem(
      await get(viewer, '/category-suggestions/stats?from=2026-11-30&to=2026-11-01'),
      400,
      'INVALID_FILTER',
    );
    problem(
      await get(viewer, '/category-suggestions/stats?from=2025-01-01&to=2026-11-30'),
      400,
      'INVALID_FILTER',
    );
  }, 180_000);
});

// ───────────────────────────────────────────────────────────── vista previa del import

const OFX = (rows: { id: string; date: string; amount: string; name: string }[]) =>
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
      '<CURDEF>BOB',
      '<BANKTRANLIST>',
      '<DTSTART>20260301',
      '<DTEND>20260331',
      ...rows.map(
        (r) =>
          `<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>${r.date}\n<TRNAMT>${r.amount}\n<FITID>${r.id}\n<NAME>${r.name}\n</STMTTRN>`,
      ),
      '</BANKTRANLIST>',
      '</STMTRS>',
      '</STMTTRNRS>',
      '</BANKMSGSRSV1>',
      '</OFX>',
    ].join('\n'),
    'latin1',
  );

async function uploadStatement(u: User, content: Buffer, fileName: string): Promise<string> {
  const requested = ok(
    await post(u, '/documents/uploads', {
      fileName,
      contentType: 'application/x-ofx',
      sizeBytes: content.length,
      sha256: sha256Hex(content),
      purpose: 'IMPORT_SOURCE',
    }),
    201,
  ) as any;
  const upload = requested['upload'];
  const sent = await fetch(upload.url as string, {
    method: upload.method as string,
    headers: upload.headers as Record<string, string>,
    body: content,
  });
  expect(sent.status, await sent.text()).toBe(200);
  const documentId = requested['document'].id as string;
  expect(ok(await post(u, `/documents/${documentId}/complete`))['status']).toBe('AVAILABLE');
  return documentId;
}

async function importOf(e: Env, rows: { id: string; date: string; amount: string; name: string }[]) {
  const documentId = await uploadStatement(e.u, OFX(rows), `extracto-${randomUUID()}.ofx`);
  const created = ok(await post(e.u, '/imports', { accountId: e.bank, documentId }), 202);
  return until(async () => {
    const j = ok(await get(e.u, `/imports/${String(created['id'])}`));
    return j['status'] === 'AWAITING_REVIEW' ? j : undefined;
  }, 90_000) as Promise<any>;
}

async function preview(u: User, importId: string): Promise<any[]> {
  const r = await get(u, `/imports/${importId}/preview?limit=200`);
  ok(r);
  expect(contract.validateResponse('getImportPreview', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body['rows'] as any[];
}

const importJob = async (u: User, id: string) => ok(await get(u, `/imports/${id}`)) as any;

describe('Vista previa del import con sugerencias', () => {
  it('[TC-CLASSIFICATION-AUTO-010][TC-CLASSIFICATION-AUTO-014][TC-CLASSIFICATION-AUTO-011] las filas sin categoría muestran la sugerencia, el lote acepta las altas y aprobar sin aceptar deja sin categoría', async () => {
    const e = await env('import');
    const editor = await addMember(e.u, await h.user(`kc-cat-imp-editor-${randomUUID()}`), 'EDITOR');
    await pedidosYa(e);
    const review = await importOf(e, [
      { id: 'S1', date: '20260301', amount: '-31.00', name: 'PEDIDOSYA 101' },
      { id: 'S2', date: '20260302', amount: '-32.00', name: 'PEDIDOSYA 102' },
      { id: 'S3', date: '20260303', amount: '-33.00', name: 'COMERCIO NUEVO SIN HISTORIAL' },
    ]);
    const rows = await preview(e.u, review.id as string);
    const byName = (n: string) => rows.find((r) => String(r.description).startsWith(n));
    expect(byName('PEDIDOSYA 101').suggestedCategory).toMatchObject({
      categoryId: e.cat('Restaurantes'),
      level: 'HIGH',
      confidence: '0.9000',
      basis: 'DESCRIPTION',
    });
    expect(byName('COMERCIO').suggestedCategory ?? null).toBeNull();
    expect(rows.every((r) => r.edits?.categoryId === undefined)).toBe(true);

    // [TC-CLASSIFICATION-AUTO-024] un VIEWER no acepta en lote.
    const viewer = await addMember(e.u, await h.user(`kc-cat-imp-viewer-${randomUUID()}`), 'VIEWER');
    problem(
      await post(
        viewer,
        `/imports/${review.id}/rows/accept-suggestions`,
        { minLevel: 'HIGH' },
        {
          'if-match': `"${review.version}"`,
        },
      ),
      403,
      'INSUFFICIENT_ROLE',
    );

    // [TC-CLASSIFICATION-AUTO-015] con una versión vencida se rechaza y ninguna fila cambia.
    const edited = await call(
      editor,
      'PATCH',
      `/imports/${review.id}/rows/${byName('COMERCIO').id}`,
      { note: 'otra edición' },
      { 'if-match': `"${review.version}"` },
    );
    ok(edited);
    problem(
      await post(
        editor,
        `/imports/${review.id}/rows/accept-suggestions`,
        { minLevel: 'HIGH' },
        {
          'if-match': `"${review.version}"`,
        },
      ),
      412,
      'PRECONDITION_FAILED',
    );
    expect((await preview(e.u, review.id)).filter((r) => r.edits?.categoryId !== undefined)).toHaveLength(0);

    // Aceptar en lote las de nivel alta con la versión vigente.
    const current = await importJob(e.u, review.id);
    const accepted = await post(
      editor,
      `/imports/${review.id}/rows/accept-suggestions`,
      { minLevel: 'HIGH' },
      {
        'if-match': `"${current.version}"`,
      },
    );
    ok(accepted);
    expect(contract.validateResponse('acceptImportCategorySuggestions', 200, accepted.body)).toEqual([]);
    expect(accepted.body).toEqual({ accepted: 2, version: current.version + 1 });
    const after = await preview(e.u, review.id);
    const acceptedRows = after.filter((r) => String(r.description).startsWith('PEDIDOSYA'));
    expect(acceptedRows.every((r) => r.edits.categoryId === e.cat('Restaurantes'))).toBe(true);
    expect(after.find((r) => String(r.description).startsWith('COMERCIO')).edits.categoryId).toBeUndefined();

    // Aprobar y persistir: las aceptadas quedan con origen manual; los resultados se registran (2 ACCEPTED).
    const latest = await importJob(e.u, review.id);
    ok(
      await post(editor, `/imports/${review.id}/approve`, undefined, { 'if-match': `"${latest.version}"` }),
      202,
    );
    await until(async () => {
      const j = await importJob(e.u, review.id);
      return /^COMPLETED/u.test(j.status) ? j : undefined;
    }, 90_000);
    const created = await asAdmin(h, async (c) => {
      const { rows: r } = await c.query<{ description: string; origin: string | null }>(
        `SELECT t.description, s.category_origin AS origin
           FROM txn.transaction t JOIN txn.transaction_split s ON s.transaction_id = t.id
          WHERE t.workspace_id = $1 AND t.source = 'IMPORT' ORDER BY t.description`,
        [e.u.ws],
      );
      return r;
    });
    expect(
      created.filter((t) => t.description.startsWith('PEDIDOSYA')).every((t) => t.origin === 'MANUAL'),
    ).toBe(true);
    const outcomes = await asAdmin(h, async (c) => {
      const { rows: r } = await c.query<{ surface: string; level: string; outcome: string; n: number }>(
        `SELECT surface, level, outcome, count(*)::int AS n FROM rules.category_suggestion_outcome WHERE workspace_id = $1 GROUP BY 1, 2, 3`,
        [e.u.ws],
      );
      return r;
    });
    expect(outcomes).toEqual([{ surface: 'IMPORT', level: 'HIGH', outcome: 'ACCEPTED', n: 2 }]);
  }, 300_000);

  it('[TC-CLASSIFICATION-AUTO-011] aprobar sin aceptar crea las transacciones sin categoría y registra los resultados IGNORED', async () => {
    const e = await env('sin-aceptar');
    await pedidosYa(e);
    const review = await importOf(
      e,
      Array.from({ length: 4 }, (_, i) => ({
        id: `N${i}`,
        date: `2026030${i + 1}`,
        amount: `-${40 + i}.00`,
        name: `PEDIDOSYA 20${i}`,
      })),
    );
    expect((await preview(e.u, review.id)).every((r) => r.suggestedCategory?.level === 'HIGH')).toBe(true);
    ok(
      await post(e.u, `/imports/${review.id}/approve`, undefined, { 'if-match': `"${review.version}"` }),
      202,
    );
    await until(async () => {
      const j = await importJob(e.u, review.id);
      return /^COMPLETED/u.test(j.status) ? j : undefined;
    }, 90_000);
    const created = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ name: string }>(
        `SELECT cat.name FROM txn.transaction t
           JOIN txn.transaction_split s ON s.transaction_id = t.id
           JOIN classification.category cat ON cat.id = s.category_id
          WHERE t.workspace_id = $1 AND t.source = 'IMPORT'`,
        [e.u.ws],
      );
      return rows.map((r) => r.name);
    });
    expect(created).toHaveLength(4);
    expect(created.every((n) => /sin categor/iu.test(n))).toBe(true);
    const outcomes = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ outcome: string; n: number }>(
        `SELECT outcome, count(*)::int AS n FROM rules.category_suggestion_outcome WHERE workspace_id = $1 AND surface = 'IMPORT' GROUP BY 1`,
        [e.u.ws],
      );
      return rows;
    });
    expect(outcomes).toEqual([{ outcome: 'IGNORED', n: 4 }]);
  }, 300_000);

  it('aceptar una fila con decideImportRow y reevaluar las reglas recalcula las sugerencias de las demás', async () => {
    const e = await env('fila');
    await pedidosYa(e);
    const review = await importOf(e, [
      { id: 'F1', date: '20260301', amount: '-31.00', name: 'PEDIDOSYA 301' },
      { id: 'F2', date: '20260302', amount: '-32.00', name: 'PEDIDOSYA 302' },
    ]);
    const rows = await preview(e.u, review.id);
    const decided = await call(
      e.u,
      'PATCH',
      `/imports/${review.id}/rows/${rows[0].id}`,
      { categoryId: e.cat('Restaurantes'), acceptedSuggestion: true },
      { 'if-match': `"${review.version}"` },
    );
    ok(decided);
    expect(contract.validateResponse('decideImportRow', 200, decided.body)).toEqual([]);
    expect(decided.body['edits']).toMatchObject({ categoryId: e.cat('Restaurantes') });
    // Otra categoría con la marca de aceptación se rechaza.
    problem(
      await call(
        e.u,
        'PATCH',
        `/imports/${review.id}/rows/${rows[1].id}`,
        { categoryId: e.cat('Supermercado'), acceptedSuggestion: true },
        { 'if-match': `"${decided.body['version']}"` },
      ),
      400,
      'VALIDATION_FAILED',
    );
    const reevaluated = await post(e.u, `/imports/${review.id}/reevaluate-rules`, undefined, {
      'if-match': `"${decided.body['version']}"`,
    });
    ok(reevaluated);
    const after = await preview(e.u, review.id);
    expect(after[1].suggestedCategory).toMatchObject({ categoryId: e.cat('Restaurantes'), level: 'HIGH' });
  }, 300_000);
});
