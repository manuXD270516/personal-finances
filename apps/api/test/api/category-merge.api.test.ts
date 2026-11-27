/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asAdmin,
  contract,
  money,
  startHarness,
  type Harness,
  type Json,
  type Reply,
  type User,
} from '../support/portability.js';

// Fusión de categorías y contrapartes por HTTP contra PostgreSQL con RLS (openspec add-category-and-counterparty-merge,
// TC-CLASSIFICATION-MERGE-*, TC-AUDIT-LIFECYCLE-028/029): la API real con todos los participantes compuestos. El reloj del
// harness fija «hoy» en 2026-11-03 (octubre ya terminó, noviembre está abierto).
let h: Harness;

const W = (u: User) => `/api/v1/workspaces/${u.ws}`;
const call = (u: User, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  h.call(method, `${W(u)}${path}`, { token: u.token, ...(body === undefined ? {} : { body }), headers });
const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(u, 'POST', path, body, { 'idempotency-key': randomUUID(), ...headers });
const get = (u: User, path: string) => call(u, 'GET', path);
const ifMatch = (v: number) => ({ 'if-match': `"${v}"` });
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
  readonly viewer: User;
  readonly bank: string;
  readonly group: string;
  readonly periods: () => Promise<Record<string, { id: string; version: number }>>;
}

/** Workspace nuevo con una cuenta, un grupo de gastos propio y los periodos hasta fin de año. */
async function env(label: string): Promise<Env> {
  const u = await h.user(`kc-merge-${label}-${randomUUID()}`);
  const viewer = await addMember(u, await h.user(`kc-merge-${label}-v-${randomUUID()}`), 'VIEWER');
  const bank = ok(
    await post(u, '/accounts', {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('9000.00'), date: '2026-10-01' },
    }),
    201,
  )['id'] as string;
  ok(await post(u, '/periods', { through: '2026-12-31' }));
  const group = ok(await post(u, '/category-groups', { name: `Gastos ${label}`, kind: 'EXPENSE' }), 201)[
    'id'
  ] as string;
  const periods = async () => {
    const out: Record<string, { id: string; version: number }> = {};
    for (const p of ok(await get(u, '/periods?limit=100'))['data'] as {
      id: string;
      label: string;
      version: number;
    }[]) {
      out[p.label] = { id: p.id, version: p.version };
    }
    return out;
  };
  return { u, viewer, bank, group, periods };
}

const category = async (e: Env, name: string, parentId?: string): Promise<Json> =>
  ok(await post(e.u, '/categories', { groupId: e.group, name, ...(parentId ? { parentId } : {}) }), 201);
const counterparty = async (e: Env, name: string, extra: Json = {}): Promise<Json> =>
  ok(await post(e.u, '/counterparties', { name, ...extra }), 201);

async function expense(
  e: Env,
  date: string,
  amount: string,
  categoryId: string,
  extra: Json = {},
): Promise<Json> {
  return ok(
    await post(e.u, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: date,
      accountId: e.bank,
      amount: money(amount),
      description: 'Compra',
      splits: [{ amount: money(amount), categoryId }],
      ...extra,
    }),
    201,
  );
}

/** Cierra octubre (relaja «cuentas sin conciliar»); con `reopen` lo reabre. */
async function closeOctober(e: Env, reopen = false): Promise<void> {
  const policy = await get(e.u, '/planning/closing-policy');
  const severities = { ...(policy.body['severities'] as Json), UNRECONCILED_ACCOUNTS: 'WARNING' };
  ok(
    await call(
      e.u,
      'PUT',
      '/planning/closing-policy',
      { severities },
      ifMatch(policy.body['version'] as number),
    ),
  );
  let p = (await e.periods())['2026-10']!;
  ok(await post(e.u, `/periods/${p.id}/close`, { acknowledgeWarnings: true }, ifMatch(p.version)));
  if (reopen) {
    p = (await e.periods())['2026-10']!;
    ok(await post(e.u, `/periods/${p.id}/reopen`, { reason: 'Corrección' }, ifMatch(p.version)));
  }
}

const merge = (
  e: Env,
  sourceId: string,
  version: number,
  targetId: string,
  headers: Record<string, string> = {},
) =>
  post(
    e.u,
    `/categories/${sourceId}/merge`,
    { targetCategoryId: targetId },
    { ...ifMatch(version), ...headers },
  );
const mergeCp = (e: Env, sourceId: string, version: number, targetId: string) =>
  post(e.u, `/counterparties/${sourceId}/merge`, { targetCounterpartyId: targetId }, ifMatch(version));

const splitsOf = (e: Env, categoryId: string) =>
  asAdmin(h, async (c) => {
    const { rows } = await c.query<{ n: string; total: string }>(
      `SELECT count(*)::text AS n, COALESCE(sum(amount), 0)::numeric(38,2)::text AS total
         FROM txn.transaction_split WHERE workspace_id = $1 AND category_id = $2 AND superseded_in_revision IS NULL`,
      [e.u.ws, categoryId],
    );
    return { n: Number(rows[0]!.n), total: rows[0]!.total };
  });
const ledgerFingerprint = (e: Env) =>
  asAdmin(h, async (c) => {
    const { rows } = await c.query<{ n: number; hash: string | null }>(
      `SELECT (SELECT count(*)::int FROM ledger.journal_entry WHERE workspace_id = $1) AS n,
              md5((SELECT string_agg(row_to_json(p)::text, ',' ORDER BY id) FROM ledger.posting p WHERE workspace_id = $1)) AS hash`,
      [e.u.ws],
    );
    return rows[0]!;
  });
const count = (counts: unknown, key: string): number =>
  (counts as { key: string; count: number }[]).find((c) => c.key === key)?.count ?? 0;

beforeAll(async () => {
  h = await startHarness({
    apiEnv: { RATE_LIMIT_WRITES_PER_MIN: '100000', RATE_LIMIT_READS_PER_MIN: '100000' },
  });
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Fusionar categorías (classification/categories)', () => {
  it('[TC-CLASSIFICATION-MERGE-001][TC-CLASSIFICATION-MERGE-007][TC-CLASSIFICATION-MERGE-019][TC-CLASSIFICATION-MERGE-020][TC-CLASSIFICATION-MERGE-006] fusiona Super en Supermercado: 1560.50 sin tocar el ledger, replay idempotente, VIEWER rechazado y la fusionada no se desarchiva', async () => {
    const e = await env('basic');
    const sup = await category(e, 'Super');
    const mkt = await category(e, 'Supermercado');
    const otra = await category(e, 'Mercado');
    for (const amount of ['100.00', '120.50', '100.00'])
      await expense(e, '2026-11-02', amount, sup['id'] as string);
    await expense(e, '2026-11-02', '1240.00', mkt['id'] as string);
    const before = await ledgerFingerprint(e);

    problem(
      await call(
        e.viewer,
        'POST',
        `/categories/${sup['id']}/merge`,
        { targetCategoryId: mkt['id'] },
        {
          'idempotency-key': randomUUID(),
          ...ifMatch(sup['version'] as number),
        },
      ),
      403,
      'INSUFFICIENT_ROLE',
    );
    const key = randomUUID();
    const first = await merge(e, sup['id'] as string, sup['version'] as number, mkt['id'] as string, {
      'idempotency-key': key,
    });
    const body = ok(first);
    expect(contract.validateResponse('mergeCategory', 200, body), JSON.stringify(body)).toEqual([]);
    expect(count(body['counts'], 'SPLITS_OPEN')).toBe(3);
    expect((body['source'] as Json)['mergedInto']).toEqual({ id: mkt['id'], name: 'Supermercado' });
    expect(await splitsOf(e, mkt['id'] as string)).toEqual({ n: 4, total: '1560.50' });
    expect(await splitsOf(e, sup['id'] as string)).toEqual({ n: 0, total: '0.00' });
    expect(await ledgerFingerprint(e)).toEqual(before);

    // Repetir con la misma clave devuelve el mismo resultado sin reasignar ni auditar de nuevo.
    const audits = await asAdmin(
      h,
      async (c) =>
        (await c.query(`SELECT count(*)::int AS n FROM audit.audit_log WHERE workspace_id = $1`, [e.u.ws]))
          .rows[0]!.n,
    );
    const replay = await merge(e, sup['id'] as string, sup['version'] as number, mkt['id'] as string, {
      'idempotency-key': key,
    });
    expect(replay.body).toEqual(body);
    expect(
      await asAdmin(
        h,
        async (c) =>
          (await c.query(`SELECT count(*)::int AS n FROM audit.audit_log WHERE workspace_id = $1`, [e.u.ws]))
            .rows[0]!.n,
      ),
    ).toBe(audits);

    // La fusionada no se desarchiva ni se vuelve a fusionar.
    const merged = ok(await get(e.u, `/categories/${sup['id']}`));
    expect(merged).toMatchObject({ archivedAt: expect.any(String), mergedInto: { id: mkt['id'] } });
    const unarchive = await post(
      e.u,
      `/categories/${sup['id']}/unarchive`,
      undefined,
      ifMatch(merged['version'] as number),
    );
    problem(unarchive, 409, 'CATEGORY_MERGED');
    expect(unarchive.body['mergedInto']).toEqual({ id: mkt['id'], name: 'Supermercado' });
    problem(
      await merge(e, sup['id'] as string, merged['version'] as number, otra['id'] as string),
      409,
      'CATEGORY_MERGED',
    );
  }, 120_000);

  it('[TC-CLASSIFICATION-MERGE-002][TC-CLASSIFICATION-MERGE-003][TC-CLASSIFICATION-MERGE-004][TC-CLASSIFICATION-MERGE-005] las reglas de validez rechazan sin cambios', async () => {
    const e = await env('rules');
    const sup = await category(e, 'Super');
    await expense(e, '2026-11-02', '10.00', sup['id'] as string);
    const incomeGroup = ok(await post(e.u, '/category-groups', { name: 'Ingresos', kind: 'INCOME' }), 201)[
      'id'
    ] as string;
    const sueldo = ok(await post(e.u, '/categories', { groupId: incomeGroup, name: 'Sueldo' }), 201);
    problem(await merge(e, sup['id'] as string, 1, sueldo['id'] as string), 422, 'CATEGORY_KIND_MISMATCH');
    const sys = (ok(await get(e.u, '/categories?kind=EXPENSE&limit=200'))['data'] as Json[]).find(
      (c) => c['systemCode'] === 'FEES',
    )!;
    const dest = await category(e, 'Gastos bancarios');
    problem(
      await merge(e, sys['id'] as string, sys['version'] as number, dest['id'] as string),
      409,
      'SYSTEM_CATEGORY_IMMUTABLE',
    );
    const old = await category(e, 'Old Market');
    ok(await post(e.u, `/categories/${old['id']}/archive`, undefined, ifMatch(1)));
    problem(await merge(e, sup['id'] as string, 1, old['id'] as string), 409, 'CATEGORY_ARCHIVED');
    problem(await merge(e, sup['id'] as string, 1, sup['id'] as string), 400, 'VALIDATION_FAILED');
    expect(await splitsOf(e, sup['id'] as string)).toEqual({ n: 1, total: '10.00' });
    expect(ok(await get(e.u, `/categories/${sup['id']}`))['archivedAt']).toBeNull();
  }, 120_000);

  it('[TC-CLASSIFICATION-MERGE-014] octubre cerrado conserva Super y noviembre pasa a Supermercado', async () => {
    const e = await env('closed');
    const sup = await category(e, 'Super');
    const mkt = await category(e, 'Supermercado');
    await expense(e, '2026-10-10', '100.00', sup['id'] as string);
    await expense(e, '2026-11-02', '320.50', sup['id'] as string);
    await closeOctober(e);
    const preview = ok(await get(e.u, `/categories/${sup['id']}/merge-preview?targetId=${mkt['id']}`));
    expect(contract.validateResponse('previewCategoryMerge', 200, preview), JSON.stringify(preview)).toEqual(
      [],
    );
    expect(count(preview['counts'], 'SPLITS_OPEN')).toBe(1);
    expect(count(preview['counts'], 'SPLITS_CLOSED_KEPT')).toBe(1);
    expect(preview['conflicts']).toEqual([]);
    const result = ok(await merge(e, sup['id'] as string, 1, mkt['id'] as string));
    expect(count(result['counts'], 'SPLITS_OPEN')).toBe(1);
    expect(await splitsOf(e, sup['id'] as string)).toEqual({ n: 1, total: '100.00' });
    expect(await splitsOf(e, mkt['id'] as string)).toEqual({ n: 1, total: '320.50' });
  }, 180_000);

  it('[TC-CLASSIFICATION-MERGE-015] un periodo reabierto se reasigna como abierto', async () => {
    const e = await env('reopened');
    const sup = await category(e, 'Super');
    const mkt = await category(e, 'Supermercado');
    await expense(e, '2026-10-10', '100.00', sup['id'] as string);
    await closeOctober(e, true);
    ok(await merge(e, sup['id'] as string, 1, mkt['id'] as string));
    expect(await splitsOf(e, mkt['id'] as string)).toEqual({ n: 1, total: '100.00' });
  }, 180_000);

  it('[TC-CLASSIFICATION-MERGE-016][TC-CLASSIFICATION-MERGE-017][TC-CLASSIFICATION-MERGE-008] plan, plantilla, compromiso, regla, contraparte y esenciales pasan a la destino en la misma operación', async () => {
    const e = await env('refs');
    const sup = await category(e, 'Super');
    const mkt = await category(e, 'Supermercado');
    const periods = await e.periods();
    const budget = ok(
      await post(e.u, '/budgets', { periodId: periods['2026-11']!.id, source: { kind: 'EMPTY' } }),
      201,
    );
    ok(
      await post(e.u, `/budgets/${budget['id']}/lines`, {
        target: { kind: 'CATEGORY', id: sup['id'] },
        kind: 'MAXIMUM',
        planned: money('400.00'),
      }),
      201,
    );
    const tpl = ok(
      await post(e.u, '/templates', {
        name: 'Mensual',
        lines: [{ target: { kind: 'CATEGORY', id: sup['id'] }, kind: 'MAXIMUM', planned: money('1500.00') }],
      }),
      201,
    );
    const def = ok(
      await post(e.u, '/recurring', {
        name: 'Mercado semanal',
        kind: 'EXPENSE',
        template: {
          accountId: e.bank,
          amount: { type: 'FIXED', amount: money('150.00') },
          categoryId: sup['id'],
          schedule: { cadence: 'WEEKLY', startDate: '2026-11-10' },
          materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        },
      }),
      201,
    );
    const rule = ok(
      await post(e.u, '/rules', {
        name: 'HIPERMAXI',
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'HIPERMAXI' }],
        actions: [{ type: 'SET_CATEGORY', categoryId: sup['id'] }],
      }),
      201,
    );
    const hiper = await counterparty(e, 'Hipermaxi', { defaultCategoryId: sup['id'] });
    const settings = await get(e.u, '/reports/spendable/settings');
    ok(
      await call(
        e.u,
        'PUT',
        '/reports/spendable/settings',
        {
          horizonMode: 'FINANCIAL_PERIOD',
          subtractEssentials: true,
          essentialCategoryIds: [sup['id'], mkt['id']],
        },
        ifMatch(settings.body['version'] as number),
      ),
    );

    const preview = ok(await get(e.u, `/categories/${sup['id']}/merge-preview?targetId=${mkt['id']}`));
    for (const [key, n] of [
      ['BUDGET_LINES', 1],
      ['TEMPLATES', 1],
      ['RECURRING_DEFINITIONS', 1],
      ['RULES', 1],
      ['DEFAULT_CATEGORY_COUNTERPARTIES', 1],
      ['ESSENTIALS', 1],
    ] as const) {
      expect(count(preview['counts'], key), key).toBe(n);
    }
    expect(preview['conflicts']).toEqual([]);

    ok(await merge(e, sup['id'] as string, 1, mkt['id'] as string));

    const line = (await get(e.u, `/budgets/${budget['id']}`)).body['lines'] as Json[];
    expect(line.map((l) => (l['target'] as Json)['id'])).toEqual([mkt['id']]);
    const tplDetail = ok(await get(e.u, `/templates/${tpl['id']}`));
    expect(tplDetail['currentVersionNo']).toBe(2);
    const definition = ok(await get(e.u, `/recurring/${def['id']}`));
    expect(JSON.stringify(definition)).toContain(mkt['id'] as string);
    expect(JSON.stringify(definition)).not.toContain(sup['id'] as string);
    const ruleNow = ok(await get(e.u, `/rules/${rule['id']}`));
    expect(ruleNow['version']).toBe(2);
    expect(JSON.stringify(ruleNow['actions'])).toContain(mkt['id'] as string);
    expect(ok(await get(e.u, `/counterparties/${hiper['id']}`))['defaultCategoryId']).toBe(mkt['id']);
    expect(ok(await get(e.u, '/reports/spendable/settings'))['essentialCategoryIds']).toEqual([mkt['id']]);
  }, 180_000);

  it('[TC-CLASSIFICATION-MERGE-009] un plan con líneas de las dos categorías bloquea la fusión con CLASSIFICATION_MERGE_CONFLICT', async () => {
    const e = await env('conflict');
    const sup = await category(e, 'Super');
    const mkt = await category(e, 'Supermercado');
    const periods = await e.periods();
    const budget = ok(
      await post(e.u, '/budgets', { periodId: periods['2026-11']!.id, source: { kind: 'EMPTY' } }),
      201,
    );
    for (const [cat, planned] of [
      [sup, '400.00'],
      [mkt, '1500.00'],
    ] as const) {
      ok(
        await post(e.u, `/budgets/${budget['id']}/lines`, {
          target: { kind: 'CATEGORY', id: cat['id'] },
          kind: 'MAXIMUM',
          planned: money(planned),
        }),
        201,
      );
    }
    const preview = ok(await get(e.u, `/categories/${sup['id']}/merge-preview?targetId=${mkt['id']}`));
    expect((preview['conflicts'] as Json[])[0]).toMatchObject({ reason: 'BUDGET_LINE_EXISTS' });
    const r = await merge(e, sup['id'] as string, 1, mkt['id'] as string);
    problem(r, 409, 'CLASSIFICATION_MERGE_CONFLICT');
    expect(JSON.stringify(r.body['conflicts'])).toContain('BUDGET_LINE_EXISTS');
    expect(ok(await get(e.u, `/categories/${sup['id']}`))['archivedAt']).toBeNull();
  }, 120_000);

  it('[TC-CLASSIFICATION-MERGE-010][TC-CLASSIFICATION-MERGE-012][TC-CLASSIFICATION-MERGE-011][TC-CLASSIFICATION-MERGE-013] subcategorías: pasan a la destino, se fusionan en su padre, profundidad y nombres repetidos', async () => {
    const e = await env('subs');
    const servicios = await category(e, 'Servicios');
    const basicos = await category(e, 'Servicios básicos');
    const luz = await category(e, 'Luz', servicios['id'] as string);
    const agua = await category(e, 'Agua', servicios['id'] as string);
    await expense(e, '2026-11-02', '180.00', luz['id'] as string);
    const hogar = await category(e, 'Hogar');
    const mant = await category(e, 'Mantenimiento', hogar['id'] as string);
    problem(
      await merge(e, servicios['id'] as string, 1, mant['id'] as string),
      422,
      'CATEGORY_DEPTH_EXCEEDED',
    );
    const done = ok(await merge(e, servicios['id'] as string, 1, basicos['id'] as string));
    expect(count(done['counts'], 'SUBCATEGORIES_MOVED')).toBe(2);
    for (const c of [luz, agua]) {
      expect(ok(await get(e.u, `/categories/${c['id']}`))['parentId']).toBe(basicos['id']);
    }
    expect(await splitsOf(e, luz['id'] as string)).toEqual({ n: 1, total: '180.00' });
    // Fusionar la subcategoría en su padre.
    const luzNow = ok(await get(e.u, `/categories/${luz['id']}`));
    ok(await merge(e, luz['id'] as string, luzNow['version'] as number, basicos['id'] as string));
    expect(await splitsOf(e, basicos['id'] as string)).toEqual({ n: 1, total: '180.00' });
    // Nombre repetido.
    const a = await category(e, 'A');
    const b = await category(e, 'B');
    await category(e, 'Gas', a['id'] as string);
    await category(e, 'gas', b['id'] as string);
    const r = await merge(e, a['id'] as string, 1, b['id'] as string);
    problem(r, 409, 'CLASSIFICATION_MERGE_CONFLICT');
    expect(JSON.stringify(r.body['conflicts'])).toContain('SUBCATEGORY_NAME_TAKEN');
  }, 180_000);

  it('[TC-AUDIT-LIFECYCLE-028] el recorrido de Super muestra CREATE y MERGE y el de Supermercado la anotación MERGED_FROM con el mismo operationId', async () => {
    const e = await env('timeline');
    const sup = await category(e, 'Super');
    const mkt = await category(e, 'Supermercado');
    for (let i = 0; i < 3; i += 1) await expense(e, '2026-11-02', '10.00', sup['id'] as string);
    const result = ok(await merge(e, sup['id'] as string, 1, mkt['id'] as string));
    const t = ok(await get(e.u, `/categories/${sup['id']}/lifecycle`));
    expect(contract.validateResponse('getCategoryLifecycle', 200, t), JSON.stringify(t)).toEqual([]);
    const items = t['items'] as Json[];
    expect(items.map((i) => i['transition'])).toEqual(expect.arrayContaining(['CREATE', 'MERGE']));
    const mergeStep = items.find((i) => i['transition'] === 'MERGE')!;
    expect(mergeStep).toMatchObject({ fromState: 'ACTIVE', toState: 'ARCHIVED', machineVersion: 2 });
    expect(mergeStep['detailRefs']).toEqual({ mergedInto: mkt['id'], operationId: result['operationId'] });
    expect(t['currentState']).toBe('ARCHIVED');
    const target = ok(await get(e.u, `/categories/${mkt['id']}/lifecycle`));
    const note = (target['items'] as Json[]).find((i) =>
      (i['changedFields'] as string[] | undefined)?.includes('MERGED_FROM'),
    )!;
    expect(note['detailRefs']).toEqual({
      mergedFrom: sup['id'],
      operationId: result['operationId'],
      reassigned: 3,
    });
  }, 120_000);

  it('[TC-CLASSIFICATION-MERGE-018] las filas de una importación en revisión pasan a la destino', async () => {
    const e = await env('import');
    const sup = await category(e, 'Super');
    const mkt = await category(e, 'Supermercado');
    const cp = await counterparty(e, 'Hipermaxi');
    const jobId = randomUUID();
    const rowId = randomUUID();
    await asAdmin(h, async (c) => {
      await c.query(
        `INSERT INTO imports.import_job (id, workspace_id, target_account_id, status, file_checksum, file_size_bytes,
           encoding, delimiter, row_count, column_count, header, counters, progress, created_by)
         VALUES ($1, $2, $3, 'AWAITING_REVIEW', decode(repeat('ab', 32), 'hex'), 10, 'utf-8', ',', 1, 3,
           '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, $4)`,
        [jobId, e.u.ws, e.bank, e.u.id],
      );
      await c.query(
        `INSERT INTO imports.staged_transaction (id, workspace_id, import_job_id, row_number, raw, proposal, edits)
         VALUES ($1, $2, $3, 1, '[]'::jsonb, $4::jsonb, $5::jsonb)`,
        [
          rowId,
          e.u.ws,
          jobId,
          JSON.stringify({ category: { value: sup['id'], origin: { type: 'RULE' } } }),
          JSON.stringify({ categoryId: sup['id'], counterpartyId: cp['id'] }),
        ],
      );
    });
    const done = ok(await merge(e, sup['id'] as string, 1, mkt['id'] as string));
    expect(count(done['counts'], 'IMPORT_ROWS')).toBe(1);
    const row = await asAdmin(
      h,
      async (c) =>
        (await c.query(`SELECT proposal, edits FROM imports.staged_transaction WHERE id = $1`, [rowId]))
          .rows[0],
    );
    expect(row.proposal.category.value).toBe(mkt['id']);
    expect(row.edits).toEqual({ categoryId: mkt['id'], counterpartyId: cp['id'] });
  }, 120_000);
});

describe('Fusionar contrapartes (classification/counterparties)', () => {
  it('[TC-CLASSIFICATION-MERGE-021][TC-CLASSIFICATION-MERGE-024][TC-CLASSIFICATION-MERGE-025][TC-CLASSIFICATION-MERGE-026][TC-CLASSIFICATION-MERGE-027] HIPERMAXI S.A. en Hipermaxi: gastos abiertos, alias, periodo cerrado, suscripción, préstamo y regla', async () => {
    const e = await env('cp');
    const cat = await category(e, 'Supermercado');
    const src = await counterparty(e, 'HIPERMAXI S.A.', { aliases: ['hipermaxi sa'] });
    const dst = await counterparty(e, 'Hipermaxi');
    for (let i = 0; i < 4; i += 1) {
      await expense(e, '2026-11-02', '128.10', cat['id'] as string, { counterpartyId: src['id'] });
    }
    await expense(e, '2026-10-12', '60.00', cat['id'] as string, { counterpartyId: src['id'] });
    const usd = ok(
      await post(e.u, '/accounts', {
        name: 'Visa USD',
        type: 'CREDIT_CARD',
        currency: 'USD',
        openingBalance: { amount: money('0.00', 'USD'), date: '2026-10-01' },
      }),
      201,
    )['id'] as string;
    const sub = ok(
      await post(e.u, '/subscriptions', {
        counterpartyId: src['id'],
        name: 'Seguro de desgravamen',
        price: money('25.00'),
        billingCycle: { cadence: 'MONTHLY' },
        firstRenewalOn: '2026-11-15',
        paymentAccountId: e.bank,
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        categoryId: cat['id'],
      }),
      201,
    );
    void usd;
    const loan = ok(
      await post(e.u, '/loans', {
        name: 'Préstamo vehicular',
        account: { create: { name: 'Préstamo vehicular cta' } },
        disbursementAccountId: e.bank,
        principal: money('50000.00'),
        annualRate: '0.115',
        termInstallments: 24,
        disbursementDate: '2026-10-15',
        firstDueDate: '2026-11-15',
        lenderCounterpartyId: src['id'],
      }),
      201,
    );
    ok(
      await post(e.u, '/rules', {
        name: 'HIPERMAXI RULE',
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'HIPERMAXI' }],
        actions: [{ type: 'SET_COUNTERPARTY', counterpartyId: src['id'] }],
      }),
      201,
    );
    await closeOctober(e);

    const preview = ok(await get(e.u, `/counterparties/${src['id']}/merge-preview?targetId=${dst['id']}`));
    expect(
      contract.validateResponse('previewCounterpartyMerge', 200, preview),
      JSON.stringify(preview),
    ).toEqual([]);
    for (const [key, n] of [
      ['TRANSACTIONS_OPEN', 4],
      ['TRANSACTIONS_CLOSED_KEPT', 1],
      ['SUBSCRIPTIONS', 1],
      ['LOANS', 1],
      ['RULES', 1],
      ['ALIASES_MOVED', 1],
    ] as const) {
      expect(count(preview['counts'], key), key).toBe(n);
    }
    // VIEWER la puede leer y nada cambia.
    ok(await get(e.viewer, `/counterparties/${src['id']}/merge-preview?targetId=${dst['id']}`));

    const before = await ledgerFingerprint(e);
    const result = ok(await mergeCp(e, src['id'] as string, src['version'] as number, dst['id'] as string));
    expect(contract.validateResponse('mergeCounterparty', 200, result), JSON.stringify(result)).toEqual([]);
    expect(await ledgerFingerprint(e)).toEqual(before);
    const txs = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ counterparty_id: string; n: string }>(
            `SELECT counterparty_id, count(*)::text AS n FROM txn.transaction WHERE workspace_id = $1 GROUP BY 1`,
            [e.u.ws],
          )
        ).rows,
    );
    expect(Object.fromEntries(txs.map((r) => [r.counterparty_id, Number(r.n)]))).toMatchObject({
      [dst['id'] as string]: 4,
      [src['id'] as string]: 1,
    });
    const target = ok(await get(e.u, `/counterparties/${dst['id']}`));
    expect([...(target['aliases'] as string[])].sort()).toEqual(['HIPERMAXI S.A.', 'hipermaxi sa']);
    const resolved = ok(
      await get(
        e.u,
        `/counterparties/resolve?description=${encodeURIComponent('COMPRA HIPERMAXI S.A. 4471')}`,
      ),
    );
    expect((resolved['counterparty'] as Json)['id']).toBe(dst['id']);
    const merged = ok(await get(e.u, `/counterparties/${src['id']}`));
    expect(merged).toMatchObject({ mergedInto: { id: dst['id'], name: 'Hipermaxi' }, aliases: [] });
    expect(ok(await get(e.u, `/subscriptions/${sub['id']}`))['counterpartyId']).toBe(dst['id']);
    expect((ok(await get(e.u, `/loans/${loan['id']}`)) as Json)['lenderCounterpartyId']).toBe(dst['id']);
    const unarchive = await post(
      e.u,
      `/counterparties/${src['id']}/unarchive`,
      undefined,
      ifMatch(merged['version'] as number),
    );
    problem(unarchive, 409, 'COUNTERPARTY_MERGED');
    expect(unarchive.body['mergedInto']).toEqual({ id: dst['id'], name: 'Hipermaxi' });
  }, 240_000);

  it('[TC-AUDIT-LIFECYCLE-029][TC-CLASSIFICATION-MERGE-023] una destino archivada se rechaza sin dejar rastro en los recorridos', async () => {
    const e = await env('cparch');
    const src = await counterparty(e, 'HIPERMAXI S.A.');
    const old = await counterparty(e, 'Hiper Viejo');
    ok(await post(e.u, `/counterparties/${old['id']}/archive`, undefined, ifMatch(1)));
    const timeline = async (id: unknown) =>
      ((await get(e.u, `/counterparties/${id}/lifecycle`)).body['items'] as Json[]).length;
    const [a, b] = [await timeline(src['id']), await timeline(old['id'])];
    problem(await mergeCp(e, src['id'] as string, 1, old['id'] as string), 409, 'COUNTERPARTY_ARCHIVED');
    expect([await timeline(src['id']), await timeline(old['id'])]).toEqual([a, b]);
  }, 120_000);
});

describe('Continuidad de la historia (D496)', () => {
  it('[TC-CLASSIFICATION-MERGE-030] la sugerencia de categoría propone la destino y nunca la origen fusionada', async () => {
    const e = await env('suggest');
    const sup = await category(e, 'Super');
    const mkt = await category(e, 'Supermercado');
    for (let i = 0; i < 6; i += 1) {
      await expense(e, `2026-10-${String(10 + i).padStart(2, '0')}`, '30.00', sup['id'] as string, {
        description: `HIPERMAXI *77${i}`,
      });
    }
    await closeOctober(e);
    ok(await merge(e, sup['id'] as string, 1, mkt['id'] as string));
    const r = ok(
      await post(e.u, '/category-suggestions/query', { kind: 'EXPENSE', description: 'HIPERMAXI *7700' }),
    );
    expect(JSON.stringify(r)).toContain(mkt['id'] as string);
    expect(JSON.stringify(r)).not.toContain(sup['id'] as string);
  }, 240_000);
});

describe('Volumen (design decisión 8)', () => {
  it('[TC-CLASSIFICATION-MERGE-001] una categoría con 10 000 porciones se fusiona dentro del tope de 30 s (objetivo de diseño 10 s)', async () => {
    const e = await env('volume');
    const sup = await category(e, 'Super');
    const mkt = await category(e, 'Supermercado');
    await asAdmin(h, async (c) => {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO txn.transaction (id, workspace_id, kind, status, transaction_date, account_id, amount, currency)
         SELECT gen_random_uuid(), $1, 'EXPENSE', 'PENDING', DATE '2026-11-02', $2, 1.00, 'BOB' FROM generate_series(1, 10000)`,
        [e.u.ws, e.bank],
      );
      await c.query(
        `INSERT INTO txn.transaction_split (id, workspace_id, transaction_id, position, amount, currency, category_id, revision)
         SELECT gen_random_uuid(), workspace_id, id, 0, 1.00, 'BOB', $2, 1 FROM txn.transaction WHERE workspace_id = $1`,
        [e.u.ws, sup['id']],
      );
      await c.query('COMMIT');
    });
    const started = Date.now();
    const result = ok(await merge(e, sup['id'] as string, 1, mkt['id'] as string));
    const seconds = (Date.now() - started) / 1000;
    console.log(`MERGE-PERF 10000 porciones: ${seconds.toFixed(2)} s`);
    expect(count(result['counts'], 'SPLITS_OPEN')).toBe(10000);
    expect(await splitsOf(e, mkt['id'] as string)).toEqual({ n: 10000, total: '10000.00' });
    // Medición de la tarea 5.3: el objetivo de diseño (10 s) no se alcanza en la máquina de desarrollo (~15 s); la pregunta
    // al owner queda en el informe. El tope de 30 s detecta una regresión grande sin fallar por la variación de CI.
    expect(seconds).toBeLessThan(30);
  }, 240_000);
});
