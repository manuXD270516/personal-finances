import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { IMPORT_ROW_NAMESPACE } from '@pf/transactions/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demoQueryRuntimes } from '../support/demo-runtimes.js';
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

// Motor de reglas por HTTP y contra PostgreSQL real (openspec add-rule-engine, TC-RULES-ENGINE-*): CRUD con versiones y
// `If-Match`, vista previa, dry-run y su aplicación (atómica, con `RULE_DRY_RUN_STALE`), evaluación para el import
// (`RuleEvaluationQuery`) y registro en lote con origen, creación manual con `applyRules`, cobertura (D334), marca de
// revisión, roles y aislamiento entre workspaces. Ninguna regla toca el ledger.
const deps = inject('deps');

let h: Harness;
let runtime: ReturnType<typeof demoQueryRuntimes>;
let owner: User;
let editor: User;
let viewer: User;
let other: User;

const W = (u: User) => `/api/v1/workspaces/${u.ws}`;
const call = (u: User, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  h.call(method, `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: { ...headers },
  });
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
  expect(r.body['code']).toBe(code);
};

async function addMember(u: User, ws: string, role: 'EDITOR' | 'VIEWER'): Promise<User> {
  await asAdmin(h, (c) =>
    c.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
      [ws, u.id, role],
    ),
  );
  return { ...u, ws };
}

async function categoryId(name: string, kind: 'EXPENSE' | 'INCOME' = 'EXPENSE'): Promise<string> {
  const list = ok(await get(owner, `/categories?kind=${kind}&limit=200`))['data'] as {
    id: string;
    name: string;
  }[];
  const hit = list.find((c) => c.name === name);
  expect(hit, `categoría ${name}`).toBeDefined();
  return hit!.id;
}

let bank: string;
let SUPER: string;
let HOGAR: string;
let TAG_HOGAR: string;

const rule = (over: Json = {}): Json => ({
  name: 'Supermercado',
  priority: 100,
  conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
  actions: [
    { type: 'SET_CATEGORY', categoryId: SUPER },
    { type: 'ADD_TAG', tagId: TAG_HOGAR },
  ],
  ...over,
});
const createRule = async (u: User, body: Json): Promise<Json> => {
  const r = await post(u, '/rules', body);
  const created = ok(r, 201);
  expect(contract.validateResponse('createRule', 201, created), JSON.stringify(created)).toEqual([]);
  return created;
};

const ledgerFingerprint = (u: User) =>
  asAdmin(h, async (c) => {
    const { rows } = await c.query<{ n: number; hash: string | null }>(
      `SELECT (SELECT count(*)::int FROM ledger.journal_entry WHERE workspace_id = $1) AS n,
              md5((SELECT string_agg(row_to_json(p)::text, ',' ORDER BY id) FROM ledger.posting p WHERE workspace_id = $1)) AS hash`,
      [u.ws],
    );
    return rows[0]!;
  });

const splitOf = (tx: Json) =>
  (tx['splits'] as { categoryId: string; tagIds: string[]; categoryOrigin: string; ruleRefs: Json[] }[])[0]!;

async function expense(u: User, amount: string, date: string, description: string, extra: Json = {}) {
  return ok(
    await post(u, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: date,
      accountId: bank,
      amount: money(amount),
      description,
      ...extra,
    }),
    201,
  );
}

beforeAll(async () => {
  h = await startHarness({});
  owner = await h.user(`kc-rules-owner-${randomUUID()}`);
  editor = await addMember(await h.user(`kc-rules-ed-${randomUUID()}`), owner.ws, 'EDITOR');
  viewer = await addMember(await h.user(`kc-rules-vw-${randomUUID()}`), owner.ws, 'VIEWER');
  other = await h.user(`kc-rules-other-${randomUUID()}`);
  runtime = demoQueryRuntimes({ databaseUrl: deps.databaseUrl, today: '2026-11-03' });
  const acc = await post(owner, '/accounts', {
    name: 'Banco BOB',
    type: 'BANK',
    currency: 'BOB',
    openingBalance: { amount: money('4000.00'), date: '2026-06-30' },
  });
  bank = ok(acc, 201)['id'] as string;
  SUPER = await categoryId('Supermercado');
  HOGAR = await categoryId('Hogar');
  TAG_HOGAR = ok(await post(owner, '/tags', { name: 'hogar' }), 201)['id'] as string;
}, 300_000);

afterAll(async () => {
  await Promise.all([h?.close(), runtime?.close()]);
});

describe('Definición, versiones y estados', () => {
  it('[TC-RULES-ENGINE-001] crea una regla activa en la versión 1 con los disparadores por defecto y la deja en la auditoría', async () => {
    const created = await createRule(owner, rule({ name: 'Supermercado 001' }));
    expect(created).toMatchObject({
      enabled: true,
      version: 1,
      rowVersion: 1,
      priority: 100,
      status: 'ACTIVE',
    });
    expect(created['triggers']).toEqual(['IMPORT', 'RETROACTIVE']);
    const audit = await asAdmin(h, (c) =>
      c.query(`SELECT action, aggregate_type FROM audit.audit_log WHERE aggregate_id = $1`, [created['id']]),
    );
    expect(audit.rows).toEqual([{ action: 'rules.rule.created', aggregate_type: 'Rule' }]);
    const versions = ok(await get(owner, `/rules/${String(created['id'])}/versions`));
    expect((versions['data'] as Json[]).map((v) => v['version'])).toEqual([1]);
  });

  it('[TC-RULES-ENGINE-002] rechaza una regla sin acciones, una acción sobre el monto y un regex con referencia hacia atrás', async () => {
    problem(
      await post(owner, '/rules', rule({ name: 'sin acciones', actions: [] })),
      400,
      'VALIDATION_FAILED',
    );
    const amountAction = await post(
      owner,
      '/rules',
      rule({ name: 'monto', actions: [{ type: 'SET_CATEGORY', categoryId: SUPER, amount: '100.00' }] }),
    );
    expect([400, 422]).toContain(amountAction.status);
    expect(amountAction.body['code']).toBe('VALIDATION_FAILED');
    const regex = await post(
      owner,
      '/rules',
      rule({
        name: 'regex',
        conditions: [{ field: 'DESCRIPTION', operator: 'matches_regex', value: String.raw`(a+)\1` }],
      }),
    );
    problem(regex, 422, 'RULE_INVALID_REGEX');
  });

  it('[TC-RULES-ENGINE-003] el nombre es único sin distinguir mayúsculas entre las no archivadas; archivar lo libera', async () => {
    const first = await createRule(owner, rule({ name: 'Nombre 003' }));
    problem(await post(owner, '/rules', rule({ name: 'NOMBRE 003' })), 409, 'NAME_TAKEN');
    const archived = ok(
      await call(owner, 'POST', `/rules/${String(first['id'])}/archive`, undefined, ifMatch(1)),
    );
    expect(archived).toMatchObject({ status: 'ARCHIVED', enabled: false });
    await createRule(owner, rule({ name: 'NOMBRE 003' }));
  });

  it('[TC-RULES-ENGINE-009] rechaza un operador incompatible con el campo señalando la condición', async () => {
    const r = await post(
      owner,
      '/rules',
      rule({
        name: 'op',
        conditions: [{ field: 'AMOUNT', operator: 'starts_with', value: '100', currency: 'BOB' }],
      }),
    );
    expect([400, 422]).toContain(r.status);
    expect(r.body['code']).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(r.body)).toContain('/conditions/0');
  });

  it('[TC-RULES-ENGINE-041] editar las acciones crea la versión 2 y deja la 1 consultable; el ETag es la versión de la fila', async () => {
    const created = await createRule(
      owner,
      rule({ name: 'Versionada 041', actions: [{ type: 'SET_CATEGORY', categoryId: SUPER }] }),
    );
    const id = String(created['id']);
    const updated = ok(
      await call(
        owner,
        'PUT',
        `/rules/${id}`,
        {
          actions: [
            { type: 'SET_CATEGORY', categoryId: SUPER },
            { type: 'ADD_TAG', tagId: TAG_HOGAR },
          ],
        },
        ifMatch(1),
      ),
    );
    expect(updated).toMatchObject({ version: 2, rowVersion: 2 });
    const versions = ok(await get(owner, `/rules/${id}/versions`))['data'] as { actions: unknown[] }[];
    expect(versions.map((v) => v.actions.length)).toEqual([1, 2]);
    const read = await get(owner, `/rules/${id}`);
    expect(read.headers.get('etag')).toBe('"2"');
  });

  it('[TC-RULES-ENGINE-042] dos ediciones con la misma versión: la segunda falla con 412 PRECONDITION_FAILED', async () => {
    const created = await createRule(owner, rule({ name: 'Concurrente 042' }));
    const id = String(created['id']);
    ok(await call(owner, 'PUT', `/rules/${id}`, { description: 'uno' }, ifMatch(1)));
    problem(
      await call(owner, 'PUT', `/rules/${id}`, { description: 'dos' }, ifMatch(1)),
      412,
      'PRECONDITION_FAILED',
    );
  });

  it('[TC-RULES-ENGINE-043] cambiar la prioridad no crea versión y deja el valor anterior y el nuevo en la auditoría', async () => {
    const created = await createRule(owner, rule({ name: 'Prioridad 043' }));
    const id = String(created['id']);
    const updated = ok(await call(owner, 'PUT', `/rules/${id}`, { priority: 5 }, ifMatch(1)));
    expect(updated).toMatchObject({ version: 1, rowVersion: 2, priority: 5 });
    const { rows } = await asAdmin(h, (c) =>
      c.query<{ changes: { field: string; before: unknown; after: unknown }[] }>(
        `SELECT changes FROM audit.audit_log WHERE aggregate_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [id],
      ),
    );
    expect(rows[0]?.changes).toEqual([{ field: 'priority', before: 100, after: 5 }]);
  });

  it('[TC-RULES-ENGINE-040] DELETE responde 405 y una regla archivada sigue resolviéndose en las transacciones que clasificó', async () => {
    const created = await createRule(owner, rule({ name: 'Archivable 040', priority: 1 }));
    const id = String(created['id']);
    const del = await call(owner, 'DELETE', `/rules/${id}`);
    expect(del.status).toBe(405);
    const tx = await expense(owner, '40.00', '2026-09-05', 'HIPERMAXI SUC 1', { applyRules: false });
    // el dry-run + aplicar deja a la regla como origen
    const dry = ok(
      await post(owner, '/rules/dry-run', {
        ruleIds: [id],
        from: '2026-09-01',
        to: '2026-09-30',
        mode: 'FILL_EMPTY',
      }),
    );
    const item = (dry['items'] as Json[]).find((i) => i['transactionId'] === tx['id']);
    expect(item).toBeDefined();
    ok(
      await post(owner, '/rules/dry-run/apply', {
        token: dry['token'],
        ruleIds: [id],
        mode: 'FILL_EMPTY',
        items: [{ transactionId: tx['id'], version: item!['version'] }],
      }),
    );
    ok(await call(owner, 'POST', `/rules/${id}/archive`, undefined, ifMatch(1)));
    const after = ok(await get(owner, `/transactions/${String(tx['id'])}`));
    const ref = splitOf(after).ruleRefs.find((r) => r['field'] === 'CATEGORY');
    expect(ref).toMatchObject({ ruleId: id, ruleVersion: 1, ruleName: 'Archivable 040', ruleArchived: true });
    expect(splitOf(after).categoryOrigin).toBe('RULE');
  }, 120_000);
});

describe('Roles y aislamiento', () => {
  it('[TC-RULES-ENGINE-052] VIEWER lista, ve, prueba y consulta la cobertura, pero no escribe (INSUFFICIENT_ROLE)', async () => {
    const created = await createRule(owner, rule({ name: 'Roles 052' }));
    const id = String(created['id']);
    ok(await get(viewer, '/rules'));
    ok(await get(viewer, `/rules/${id}`));
    ok(await get(viewer, '/rules/coverage?from=2026-07-01&to=2026-09-30'));
    ok(
      await post(viewer, '/rules/preview', {
        ruleId: id,
        subject: { sample: { description: 'HIPERMAXI SUC 12', amount: money('185.40') } },
      }),
    );
    problem(await post(viewer, '/rules', rule({ name: 'no' })), 403, 'INSUFFICIENT_ROLE');
    problem(
      await call(viewer, 'PUT', `/rules/${id}`, { description: 'x' }, ifMatch(1)),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(
      await call(viewer, 'POST', `/rules/${id}/archive`, undefined, ifMatch(1)),
      403,
      'INSUFFICIENT_ROLE',
    );
    // EDITOR sí escribe
    ok(await call(editor, 'PUT', `/rules/${id}`, { description: 'editor' }, ifMatch(1)));
  });

  it('[TC-RULES-ENGINE-053] las reglas de un workspace no se ven ni se evalúan en otro', async () => {
    await createRule(owner, rule({ name: 'Aislada 053' }));
    const theirs = ok(await get(other, '/rules'))['data'] as Json[];
    expect(theirs).toEqual([]);
    const outcomes = await runtime.inWs(other.id, other.ws, () =>
      runtime.r.rules.evaluation.evaluate({
        workspaceId: other.ws,
        trigger: 'IMPORT',
        mode: 'FILL_EMPTY',
        subjects: [
          {
            ref: 'r1',
            kind: 'EXPENSE',
            accountId: randomUUID(),
            date: '2026-09-03',
            amount: money('185.40'),
            description: 'HIPERMAXI SUC 12',
            counterpartyId: null,
            counterpartyOrigin: null,
            categoryId: null,
            tagIds: [],
            externalSource: IMPORT_ROW_NAMESPACE,
            customFields: [],
            splitCount: 1,
          },
        ],
      }),
    );
    expect(outcomes[0]?.matched).toEqual([]);
    const rls = await asAdmin(h, (c) =>
      c.query(`SELECT count(*)::int AS n FROM rules.rule WHERE workspace_id = $1`, [other.ws]),
    );
    expect(rls.rows[0].n).toBe(0);
  });

  it('[TC-RULES-ENGINE-049] la regla número 501 se rechaza con RULE_LIMIT_EXCEEDED (límite configurable)', async () => {
    const small = await startHarness({ apiEnv: { RULES_MAX_PER_WORKSPACE: '2' } });
    try {
      const u = await small.user(`kc-rules-limit-${randomUUID()}`);
      const cat = (
        (
          await small.call('GET', `/api/v1/workspaces/${u.ws}/categories?kind=EXPENSE&limit=5`, {
            token: u.token,
          })
        ).body['data'] as { id: string }[]
      )[0]!.id;
      const mk = (name: string) =>
        small.call('POST', `/api/v1/workspaces/${u.ws}/rules`, {
          token: u.token,
          body: {
            name,
            conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'x' }],
            actions: [{ type: 'SET_CATEGORY', categoryId: cat }],
          },
          headers: { 'idempotency-key': randomUUID() },
        });
      expect((await mk('a')).status).toBe(201);
      expect((await mk('b')).status).toBe(201);
      problem(await mk('c'), 422, 'RULE_LIMIT_EXCEEDED');
    } finally {
      await small.close();
    }
  }, 300_000);
});

describe('Vista previa, dry-run y aplicación', () => {
  it('[TC-RULES-ENGINE-025] la vista previa de una definición sin guardar no crea reglas ni auditoría', async () => {
    const before = await asAdmin(h, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM rules.rule WHERE workspace_id = $1) r, (SELECT count(*)::int FROM audit.audit_log WHERE workspace_id = $1) a`,
        [owner.ws],
      ),
    );
    const r = ok(
      await post(owner, '/rules/preview', {
        definition: {
          conditions: [
            { field: 'DESCRIPTION', operator: 'contains', value: 'tigo' },
            { field: 'AMOUNT', operator: 'lte', value: '150.00', currency: 'BOB' },
          ],
          actions: [{ type: 'SET_CATEGORY', categoryId: HOGAR }],
        },
        subject: { sample: { description: 'TIGO MONEY RECARGA', amount: money('100.00') } },
      }),
    );
    expect(contract.validateResponse('previewRule', 200, r), JSON.stringify(r)).toEqual([]);
    expect(r['matched']).toBe(true);
    expect(r['actions']).toEqual([{ type: 'SET_CATEGORY', categoryId: HOGAR }]);
    const after = await asAdmin(h, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM rules.rule WHERE workspace_id = $1) r, (SELECT count(*)::int FROM audit.audit_log WHERE workspace_id = $1) a`,
        [owner.ws],
      ),
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    // [TC-RULES-ENGINE-026] condición que falla
    const fail = ok(
      await post(owner, '/rules/preview', {
        definition: {
          conditions: [
            { field: 'DESCRIPTION', operator: 'contains', value: 'tigo' },
            { field: 'AMOUNT', operator: 'lte', value: '150.00', currency: 'BOB' },
          ],
          actions: [{ type: 'SET_CATEGORY', categoryId: HOGAR }],
        },
        subject: { sample: { description: 'TIGO MONEY RECARGA', amount: money('180.00') } },
      }),
    );
    expect(fail['matched']).toBe(false);
    expect((fail['conditions'] as { met: boolean }[]).map((c) => c.met)).toEqual([true, false]);
    expect(fail['actions']).toEqual([]);
  });

  it('[TC-RULES-ENGINE-027] el dry-run completa solo los gastos sin categoría, no persiste y la aplicación es atómica y auditada', async () => {
    const u = await h.user(`kc-rules-dry-${randomUUID()}`);
    const acc = ok(
      await post(u, '/accounts', {
        name: 'Banco dry',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: money('4000.00'), date: '2026-06-30' },
      }),
      201,
    )['id'] as string;
    const cat = async (name: string) =>
      (ok(await get(u, '/categories?kind=EXPENSE&limit=200'))['data'] as { id: string; name: string }[]).find(
        (c) => c.name === name,
      )!.id;
    const sup = await cat('Supermercado');
    const hogar = await cat('Hogar');
    const tx = async (amount: string, date: string, categoryId?: string) =>
      ok(
        await post(u, '/transactions', {
          kind: 'EXPENSE',
          transactionDate: date,
          accountId: acc,
          amount: money(amount),
          description: 'HIPERMAXI SUC 12',
          ...(categoryId ? { splits: [{ amount: money(amount), categoryId }] } : {}),
        }),
        201,
      );
    const uncategorized = await Promise.all([1, 2, 3, 4].map((i) => tx(`${10 + i}.00`, `2026-09-0${i}`)));
    const hogares = await Promise.all([5, 6].map((i) => tx(`${10 + i}.00`, `2026-09-0${i}`, hogar)));
    const created = await createRule(u, {
      name: 'Supermercado dry',
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: sup }],
    });
    const id = String(created['id']);
    const fingerprint = await ledgerFingerprint(u);

    const dry = ok(await post(u, '/rules/dry-run', { from: '2026-09-01', to: '2026-09-30' }));
    expect(contract.validateResponse('dryRunRules', 200, dry), JSON.stringify(dry)).toEqual([]);
    expect(dry).toMatchObject({ scanned: 6, changed: 4, truncated: false });
    const items = dry['items'] as {
      transactionId: string;
      version: number;
      changes: { field: string; ruleId: string; ruleVersion: number }[];
    }[];
    expect(items.map((i) => i.transactionId).sort()).toEqual(
      uncategorized.map((t) => String(t['id'])).sort(),
    );
    expect(items[0]!.changes[0]).toMatchObject({ field: 'categoryId', ruleId: id, ruleVersion: 1 });
    // [TC-RULES-ENGINE-028] reemplazar propone también las 2 de Hogar
    const overwrite = ok(
      await post(u, '/rules/dry-run', { from: '2026-09-01', to: '2026-09-30', mode: 'OVERWRITE' }),
    );
    expect(overwrite['changed']).toBe(6);
    // nada cambió
    expect(splitOf(ok(await get(u, `/transactions/${String(uncategorized[0]!['id'])}`))).categoryId).not.toBe(
      sup,
    );

    // [TC-RULES-ENGINE-030] el usuario editó a mano una entre el dry-run y la aplicación ⇒ 409 y nada cambia
    const victim = uncategorized[1]!;
    ok(
      await call(
        u,
        'PATCH',
        `/transactions/${String(victim['id'])}`,
        { notes: 'editada a mano' },
        { 'if-match': `"${String(victim['version'])}"`, 'content-type': 'application/merge-patch+json' },
      ),
    );
    const apply = (bodyItems: unknown) =>
      post(u, '/rules/dry-run/apply', { token: dry['token'], mode: 'FILL_EMPTY', items: bodyItems });
    const stale = await apply(items.map((i) => ({ transactionId: i.transactionId, version: i.version })));
    problem(stale, 409, 'RULE_DRY_RUN_STALE');
    expect(splitOf(ok(await get(u, `/transactions/${String(uncategorized[0]!['id'])}`))).categoryId).not.toBe(
      sup,
    );

    // [TC-RULES-ENGINE-029] nuevo dry-run y aplicación atómica con origen en la regla y un identificador común
    const fresh = ok(await post(u, '/rules/dry-run', { from: '2026-09-01', to: '2026-09-30' }));
    const freshItems = fresh['items'] as { transactionId: string; version: number }[];
    const applied = ok(
      await post(u, '/rules/dry-run/apply', {
        token: fresh['token'],
        mode: 'FILL_EMPTY',
        items: freshItems.map((i) => ({ transactionId: i.transactionId, version: i.version })),
      }),
    );
    expect(contract.validateResponse('applyRuleDryRun', 200, applied), JSON.stringify(applied)).toEqual([]);
    expect(applied).toMatchObject({ applied: 4, notApplicable: [] });
    for (const t of uncategorized) {
      const s = splitOf(ok(await get(u, `/transactions/${String(t['id'])}`)));
      expect(s.categoryId).toBe(sup);
      expect(s.categoryOrigin).toBe('RULE');
      expect(s.ruleRefs.find((r) => r['field'] === 'CATEGORY')).toMatchObject({ ruleId: id, ruleVersion: 1 });
    }
    for (const t of hogares)
      expect(splitOf(ok(await get(u, `/transactions/${String(t['id'])}`))).categoryId).toBe(hogar);
    const audits = await asAdmin(h, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM audit.audit_log WHERE correlation_id = $1 AND action = 'transactions.transaction.updated' AND origin = 'rule'`,
        [applied['bulkOperationId']],
      ),
    );
    expect(audits.rows[0].n).toBe(4);
    // [TC-RULES-ENGINE-018] el ledger no cambió
    expect(await ledgerFingerprint(u)).toEqual(fingerprint);
    // la regla clasificó 4 transacciones (estadísticas)
    const view = ok(await get(u, `/rules/${id}`));
    expect((view['stats'] as Json)['classifiedTransactions']).toBe(4);
  }, 180_000);

  it('[TC-RULES-ENGINE-029] un periodo cerrado queda como no aplicable y el resto se aplica', async () => {
    const u = await h.user(`kc-rules-closed-${randomUUID()}`);
    const acc = ok(
      await post(u, '/accounts', {
        name: 'Banco cerrado',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: money('1000.00'), date: '2026-06-30' },
      }),
      201,
    )['id'] as string;
    const sup = (
      (ok(await get(u, '/categories?kind=EXPENSE&limit=200'))['data'] as { id: string; name: string }[]).find(
        (c) => c.name === 'Supermercado',
      ) as { id: string }
    ).id;
    const mk = async (date: string) =>
      ok(
        await post(u, '/transactions', {
          kind: 'EXPENSE',
          transactionDate: date,
          accountId: acc,
          amount: money('20.00'),
          description: 'HIPERMAXI',
        }),
        201,
      );
    const open = await mk('2026-09-10');
    const closed = await mk('2026-08-10');
    await createRule(u, {
      name: 'Cerrado',
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: sup }],
    });
    const dry = ok(await post(u, '/rules/dry-run', { from: '2026-08-01', to: '2026-09-30' }));
    await asAdmin(h, (c) =>
      c.query(
        `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end) VALUES ($1, '2026-08', '2026-08-01', '2026-08-31')`,
        [u.ws],
      ),
    );
    const items = (dry['items'] as { transactionId: string; version: number }[]).map((i) => ({
      transactionId: i.transactionId,
      version: i.version,
    }));
    const applied = ok(
      await post(u, '/rules/dry-run/apply', { token: dry['token'], mode: 'FILL_EMPTY', items }),
    );
    expect(applied['applied']).toBe(1);
    expect(applied['notApplicable']).toEqual([{ transactionId: closed['id'], reason: 'PERIOD_CLOSED' }]);
    expect(splitOf(ok(await get(u, `/transactions/${String(open['id'])}`))).categoryId).toBe(sup);
  }, 120_000);
});

describe('Creación manual con reglas', () => {
  it('[TC-RULES-ENGINE-034] una regla con el disparador de creación completa la categoría vacía; [-035] respeta la elegida; [-036] applyRules false la evita', async () => {
    const u = await h.user(`kc-rules-manual-${randomUUID()}`);
    const acc = ok(
      await post(u, '/accounts', {
        name: 'Banco manual',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: money('1000.00'), date: '2026-06-30' },
      }),
      201,
    )['id'] as string;
    const cats = ok(await get(u, '/categories?kind=EXPENSE&limit=200'))['data'] as {
      id: string;
      name: string;
    }[];
    const byName = (n: string) => cats.find((c) => c.name === n)!.id;
    const servicios = byName('Servicios básicos');
    const regalos = byName('Regalos y celebraciones');
    const created = await createRule(u, {
      name: 'Telefonía',
      triggers: ['MANUAL_CREATE'],
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'tigo' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: servicios }],
    });
    const mk = (extra: Json) =>
      post(u, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-05',
        accountId: acc,
        amount: money('100.00'),
        description: 'Tigo recarga',
        ...extra,
      });
    const a = ok(await mk({}), 201);
    expect(contract.validateResponse('createTransaction', 201, a), JSON.stringify(a)).toEqual([]);
    expect(splitOf(a)).toMatchObject({ categoryId: servicios, categoryOrigin: 'RULE' });
    expect(splitOf(a).ruleRefs[0]).toMatchObject({
      field: 'CATEGORY',
      ruleId: created['id'],
      ruleVersion: 1,
      ruleName: 'Telefonía',
    });
    const b = ok(await mk({ splits: [{ amount: money('100.00'), categoryId: regalos }] }), 201);
    expect(splitOf(b)).toMatchObject({ categoryId: regalos, categoryOrigin: 'MANUAL' });
    const c = ok(await mk({ applyRules: false }), 201);
    expect(splitOf(c).categoryOrigin).toBe('SYSTEM_DEFAULT');
    expect(splitOf(c).ruleRefs).toEqual([]);
    // las reglas con disparador solo de importación no actúan en el registro manual
    await createRule(u, {
      name: 'Solo import',
      triggers: ['IMPORT'],
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'netflix' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: servicios }],
    });
    const d = ok(await mk({ description: 'NETFLIX' }), 201);
    expect(splitOf(d).categoryOrigin).toBe('SYSTEM_DEFAULT');
  }, 120_000);
});

describe('Importación, cobertura y marca de revisión', () => {
  it('[TC-RULES-ENGINE-031] la evaluación del import propone con regla y versión; [-055] el lote registra el origen de cada split; [-044/-045/-046] la cobertura lo mide', async () => {
    const u = await h.user(`kc-rules-import-${randomUUID()}`);
    const acc = ok(
      await post(u, '/accounts', {
        name: 'Banco import',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: money('4000.00'), date: '2026-06-30' },
      }),
      201,
    )['id'] as string;
    const cats = ok(await get(u, '/categories?kind=EXPENSE&limit=200'))['data'] as {
      id: string;
      name: string;
    }[];
    const sup = cats.find((c) => c.name === 'Supermercado')!.id;
    const serv = cats.find((c) => c.name === 'Servicios básicos')!.id;
    const tag = ok(await post(u, '/tags', { name: 'hogar' }), 201)['id'] as string;
    const sRule = await createRule(u, {
      name: 'Supermercado',
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
      actions: [
        { type: 'SET_CATEGORY', categoryId: sup },
        { type: 'ADD_TAG', tagId: tag },
      ],
    });
    const tRule = await createRule(u, {
      name: 'Telefonía',
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'tigo' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: serv }],
    });
    const subject = (ref: string, description: string, amount: string) => ({
      ref,
      kind: 'EXPENSE' as const,
      accountId: acc,
      date: '2026-09-10',
      amount: money(amount),
      description,
      counterpartyId: null,
      counterpartyOrigin: null,
      categoryId: null,
      tagIds: [],
      externalSource: IMPORT_ROW_NAMESPACE,
      customFields: [],
      splitCount: 1,
    });
    const rows = [
      subject('r1', 'HIPERMAXI SUC 12', '185.40'),
      subject('r2', 'TIGO MONEY RECARGA', '100.00'),
      subject('r3', 'TRANSF 99812', '300.00'),
    ];
    const outcomes = await runtime.inWs(u.id, u.ws, () =>
      runtime.r.rules.evaluation.evaluate({
        workspaceId: u.ws,
        trigger: 'IMPORT',
        mode: 'FILL_EMPTY',
        subjects: rows,
      }),
    );
    expect(outcomes[0]?.category).toEqual({
      categoryId: sup,
      origin: { ruleId: sRule['id'], ruleVersion: 1 },
    });
    expect(outcomes[1]?.category).toEqual({
      categoryId: serv,
      origin: { ruleId: tRule['id'], ruleVersion: 1 },
    });
    expect(outcomes[2]?.category).toBeNull();

    const job = randomUUID();
    const record = (classified: Json[]) =>
      runtime.inWs(u.id, u.ws, () =>
        runtime.r.transactions.imported.recordBatch({
          workspaceId: u.ws,
          accountId: acc,
          importJobId: job,
          actorUserId: u.id,
          rows: rows.map((r, i) => ({
            rowRef: r.ref,
            date: r.date,
            direction: 'OUT' as const,
            amount: r.amount,
            description: r.description,
            externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: `fp-${u.id}-${i}` },
            ...(classified[i] ? { classification: classified[i] as never } : {}),
          })),
        }),
      );
    const created = await record([
      {
        categoryId: sup,
        categoryOrigin: 'RULE',
        categoryRule: { ruleId: sRule['id'], ruleVersion: 1 },
        counterpartyId: null,
        tagIds: [tag],
        customFields: [],
        needsReview: null,
        ruleRefs: [{ field: `TAG:${tag}`, ruleId: sRule['id'], ruleVersion: 1 }],
      },
      {
        categoryId: serv,
        categoryOrigin: 'RULE',
        categoryRule: { ruleId: tRule['id'], ruleVersion: 1 },
        counterpartyId: null,
        tagIds: [],
        customFields: [],
        needsReview: null,
        ruleRefs: [],
      },
    ]);
    expect(created.created).toHaveLength(3);
    // origen de cada split y saldo exacto (TC-055): 4000.00 − 185.40 − 100.00 − 300.00
    const [t1, t2, t3] = await Promise.all(
      created.created.map(async (c) => ok(await get(u, `/transactions/${c.transactionId}`))),
    );
    expect(splitOf(t1!)).toMatchObject({ categoryOrigin: 'RULE', categoryId: sup, tagIds: [tag] });
    expect(splitOf(t2!)).toMatchObject({ categoryOrigin: 'RULE', categoryId: serv });
    expect(splitOf(t3!)).toMatchObject({ categoryOrigin: 'SYSTEM_DEFAULT' });
    expect(ok(await get(u, `/accounts/${acc}`))['balance']).toMatchObject({ amount: '3414.60' });
    // auditoría de la creación con la regla y versión por campo
    const audit = await asAdmin(h, (c) =>
      c.query<{ changes: { field: string; after: unknown }[] }>(
        `SELECT changes FROM audit.audit_log WHERE aggregate_id = $1 AND action = 'transactions.transaction.created'`,
        [t1!['id']],
      ),
    );
    const fields = Object.fromEntries(audit.rows[0]!.changes.map((c) => [c.field, c.after]));
    expect(fields['categoryOrigin']).toBe('RULE');
    expect(fields['categoryRuleId']).toBe(sRule['id']);
    expect(JSON.parse(fields['ruleRefs'] as string)).toEqual([
      { field: `TAG:${tag}`, ruleId: sRule['id'], ruleVersion: 1 },
    ]);

    // cobertura (D334): 2 de 3 por reglas
    const range = '/rules/coverage?from=2026-09-01&to=2026-09-30';
    const cov = ok(await get(u, range));
    expect(contract.validateResponse('getRuleCoverage', 200, cov), JSON.stringify(cov)).toEqual([]);
    expect(cov).toMatchObject({
      count: 3,
      byOrigin: { rule: 2, systemDefault: 1, manual: 0, counterpartyDefault: 0, unknown: 0 },
      ruleCoverage: '0.6667',
      target: '0.7000',
      meetsTarget: false,
    });
    const byRule = cov['byRule'] as { ruleId: string; name: string; count: number }[];
    expect(byRule.map((r) => [r.name, r.count]).sort()).toEqual([
      ['Supermercado', 1],
      ['Telefonía', 1],
    ]);
    // [TC-RULES-ENGINE-045] una corrección manual saca la transacción del numerador; anular una sin categoría la saca del total
    const tx2 = t2!;
    ok(
      await call(
        u,
        'PATCH',
        `/transactions/${String(tx2['id'])}`,
        { splits: [{ amount: money('100.00'), categoryId: sup }] },
        {
          'if-match': `"${String(tx2['version'])}"`,
          'content-type': 'application/merge-patch+json',
        },
      ),
    );
    const afterFix = ok(await get(u, range));
    expect(afterFix).toMatchObject({
      count: 3,
      byOrigin: { rule: 1, manual: 1, systemDefault: 1 },
      ruleCoverage: '0.3333',
    });
    ok(
      await post(
        u,
        `/transactions/${String(t3!['id'])}/void`,
        { reason: 'duplicada' },
        ifMatch(Number(t3!['version'])),
      ),
    );
    const afterVoid = ok(await get(u, range));
    expect(afterVoid).toMatchObject({ count: 2, ruleCoverage: '0.5000' });
    // [TC-RULES-ENGINE-046] por import
    const perJob = ok(await get(u, `/rules/coverage?importJobId=${job}`));
    expect(perJob['count']).toBe(2);
    // exige rango o import
    expect((await get(u, '/rules/coverage')).status).toBe(400);
  }, 180_000);

  it('[TC-RULES-ENGINE-057] filtra las pendientes de revisión, las quita con If-Match y el saldo no cambia', async () => {
    const u = await h.user(`kc-rules-review-${randomUUID()}`);
    const acc = ok(
      await post(u, '/accounts', {
        name: 'Banco rev',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: money('5000.00'), date: '2026-06-30' },
      }),
      201,
    )['id'] as string;
    const rule = await createRule(u, {
      name: 'Revisar gastos grandes',
      triggers: ['MANUAL_CREATE'],
      conditions: [
        { field: 'KIND', operator: 'equals', value: 'EXPENSE' },
        { field: 'AMOUNT', operator: 'gt', value: '2000.00', currency: 'BOB' },
      ],
      actions: [{ type: 'MARK_FOR_REVIEW' }],
    });
    const mk = (amount: string) =>
      post(u, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-05',
        accountId: acc,
        amount: money(amount),
        description: 'Compra',
      });
    const big = ok(await mk('2450.00'), 201);
    ok(await mk('30.00'), 201);
    expect(big).toMatchObject({ needsReview: true });
    expect(big['review']).toMatchObject({
      reason: 'RULE',
      ruleId: rule['id'],
      ruleVersion: 1,
      ruleName: 'Revisar gastos grandes',
    });
    const listed = ok(await get(u, '/transactions?needsReview=true'))['data'] as Json[];
    expect(listed.map((t) => t['id'])).toEqual([big['id']]);
    const balance = ok(await get(u, `/accounts/${acc}`))['balance'];
    const cleared = ok(
      await call(
        u,
        'PATCH',
        `/transactions/${String(big['id'])}`,
        { needsReview: false },
        {
          'if-match': `"${String(big['version'])}"`,
          'content-type': 'application/merge-patch+json',
        },
      ),
    );
    expect(cleared).toMatchObject({ needsReview: false, review: null, status: 'POSTED' });
    expect(ok(await get(u, `/accounts/${acc}`))['balance']).toEqual(balance);
    expect(ok(await get(u, '/transactions?needsReview=true'))['data']).toEqual([]);
    const audit = await asAdmin(h, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM audit.audit_log WHERE aggregate_id = $1 AND changes @> '[{"field":"needsReview"}]'::jsonb`,
        [big['id']],
      ),
    );
    expect(audit.rows[0].n).toBe(2);
  }, 120_000);
});
