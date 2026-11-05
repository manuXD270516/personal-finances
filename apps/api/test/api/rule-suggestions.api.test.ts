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

// Sugerencias de reglas por HTTP y contra PostgreSQL real (openspec add-rule-suggestions, TC-RULES-SUGGEST-*): evidencia
// por origen de la categoría, patrones, confianza, cobertura y conflictos, vista previa, aceptación por `createRule`,
// descartar y restaurar, roles, aislamiento y truncado. El reloj del harness fija «hoy» en 2026-11-03 (ventana de 180
// días: desde el 2026-05-07).
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
  expect(r.body['code']).toBe(code);
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
  const u = await h.user(`kc-sugg-${prefix}-${randomUUID()}`);
  const bank = ok(
    await post(u, '/accounts', {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('9000.00'), date: '2026-04-30' },
    }),
    201,
  )['id'] as string;
  const cats = ok(await get(u, '/categories?kind=EXPENSE&limit=200'))['data'] as {
    id: string;
    name: string;
  }[];
  const income = ok(await get(u, '/categories?kind=INCOME&limit=200'))['data'] as {
    id: string;
    name: string;
  }[];
  const byName = new Map([...cats, ...income].map((c) => [c.name, c.id]));
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
async function expense(
  e: Env,
  date: string,
  description: string,
  category?: string,
  extra: Json = {},
): Promise<Json> {
  return ok(
    await post(e.u, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: date,
      accountId: e.bank,
      amount: money('30.00'),
      description,
      ...(category ? { splits: [{ amount: money('30.00'), categoryId: category }] } : {}),
      ...extra,
    }),
    201,
  );
}

const SUGGESTIONS = '/rules/suggestions';
interface Suggestion {
  suggestionId: string;
  pattern: { type: string; value: string; kind: string; categoryId: string };
  support: number;
  evidenceCount: number;
  confidence: string;
  confidenceLevel: string;
  status: string;
  conflicts: { name: string; priority: number; count: number }[];
  warnings: string[];
  evidence: { transactionId: string; description: string }[];
  counterExamples: { transactionId: string }[];
  proposedRule: Json;
}
async function list(u: User, query = ''): Promise<{ items: Suggestion[]; body: Json }> {
  const body = ok(await get(u, `${SUGGESTIONS}${query}`));
  expect(contract.validateResponse('listRuleSuggestions', 200, body), JSON.stringify(body)).toEqual([]);
  return { items: body['items'] as Suggestion[], body };
}

const ruleCount = (u: User) =>
  asAdmin(h, async (c) => {
    const { rows } = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rules.rule WHERE workspace_id = $1`,
      [u.ws],
    );
    return rows[0]!.n;
  });
const auditCount = (u: User) =>
  asAdmin(h, async (c) => {
    const { rows } = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.audit_log WHERE workspace_id = $1`,
      [u.ws],
    );
    return rows[0]!.n;
  });

beforeAll(async () => {
  h = await startHarness({});
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('Evidencia de clasificación manual', () => {
  it('[TC-RULES-SUGGEST-001] cuatro recargas de Tigo clasificadas a mano generan la sugerencia con su regla propuesta', async () => {
    const e = await env('tigo');
    const tel = e.cat('Servicios básicos');
    for (const [d, n] of [
      ['2026-07-02', '77712345'],
      ['2026-08-10', '77754321'],
      ['2026-09-15', '70011122'],
      ['2026-10-28', '77712345'],
    ] as const) {
      await expense(e, d, `TIGO MONEY RECARGA ${n}`, tel);
    }
    const { items, body } = await list(e.u);
    expect(body).toMatchObject({ from: '2026-05-07', to: '2026-11-03', scanned: 4, truncated: false });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      pattern: { type: 'DESCRIPTION', value: 'tigo money recarga', kind: 'EXPENSE', categoryId: tel },
      support: 4,
      evidenceCount: 4,
      confidence: '1.0000',
      confidenceLevel: 'MEDIUM',
      status: 'OPEN',
    });
    expect(items[0]!.proposedRule).toMatchObject({
      matchMode: 'ALL',
      priority: 100,
      triggers: ['IMPORT', 'RETROACTIVE'],
      actions: [{ type: 'SET_CATEGORY', categoryId: tel }],
    });
  }, 120_000);

  it('[TC-RULES-SUGGEST-004] las categorías fijadas por reglas no son evidencia', async () => {
    const e = await env('rule-origin');
    const sup = e.cat('Supermercado');
    const created = ok(
      await post(e.u, '/rules', {
        name: 'Supermercado',
        triggers: ['MANUAL_CREATE'],
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
        actions: [{ type: 'SET_CATEGORY', categoryId: sup }],
      }),
      201,
    );
    for (let i = 0; i < 5; i += 1) await expense(e, `2026-10-0${i + 1}`, 'HIPERMAXI SUC 12');
    const tx = ok(await get(e.u, '/transactions?limit=10'))['data'] as {
      splits: { categoryOrigin: string }[];
    }[];
    expect(tx.every((t) => t.splits[0]!.categoryOrigin === 'RULE')).toBe(true);
    expect((await list(e.u)).items).toEqual([]);
    expect(created['id']).toBeDefined();
  }, 120_000);

  it('[TC-RULES-SUGGEST-005] la corrección manual de lo que puso una regla cuenta, con el conflicto de la regla', async () => {
    const e = await env('correction');
    const sup = e.cat('Supermercado');
    const far = e.cat('Farmacia');
    ok(
      await post(e.u, '/rules', {
        name: 'Supermercado',
        priority: 100,
        triggers: ['MANUAL_CREATE'],
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'farmacorp' }],
        actions: [{ type: 'SET_CATEGORY', categoryId: sup }],
      }),
      201,
    );
    const txs: Json[] = [];
    for (let i = 0; i < 3; i += 1) txs.push(await expense(e, `2026-10-0${i + 1}`, 'FARMACORP SUC 3'));
    for (const t of txs) {
      ok(
        await call(
          e.u,
          'PATCH',
          `/transactions/${String(t['id'])}`,
          { splits: [{ amount: money('30.00'), categoryId: far }] },
          { 'if-match': `"${String(t['version'])}"`, 'content-type': 'application/merge-patch+json' },
        ),
      );
    }
    const { items } = await list(e.u);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ support: 3, pattern: { categoryId: far, value: 'farmacorp suc' } });
    expect(items[0]!.conflicts).toEqual([
      expect.objectContaining({ name: 'Supermercado', priority: 100, count: 3 }),
    ]);
    expect(items[0]!.proposedRule['priority']).toBe(99);
  }, 120_000);

  it('[TC-RULES-SUGGEST-006] las clasificaciones anteriores al motor (origen desconocido) cuentan solo si fueron manuales o importadas', async () => {
    const e = await env('unknown');
    const gym = e.cat('Farmacia');
    const manual: Json[] = [];
    for (let i = 0; i < 3; i += 1)
      manual.push(await expense(e, `2026-06-0${i + 1}`, 'GIMNASIO BODYTECH', gym));
    const processed: Json[] = [];
    for (let i = 0; i < 3; i += 1)
      processed.push(await expense(e, `2026-06-1${i}`, 'SUSCRIPCION AUTOMATICA', gym));
    await asAdmin(h, async (c) => {
      await c.query(
        `UPDATE txn.transaction_split SET category_origin = NULL
          WHERE workspace_id = $1 AND category_origin IS NOT NULL`,
        [e.u.ws],
      );
      await c.query(
        `UPDATE txn.transaction SET source = 'RECURRING' WHERE workspace_id = $1 AND id = ANY ($2::uuid[])`,
        [e.u.ws, processed.map((t) => String(t['id']))],
      );
    });
    const { items } = await list(e.u);
    expect(items.map((s) => [s.pattern.value, s.support])).toEqual([['gimnasio bodytech', 3]]);
  }, 120_000);

  it('[TC-RULES-SUGGEST-008] varios splits y las administradas por Deudas no son evidencia', async () => {
    const e = await env('excluded');
    const far = e.cat('Farmacia');
    const sup = e.cat('Supermercado');
    const managed: Json[] = [];
    for (let i = 0; i < 3; i += 1) managed.push(await expense(e, `2026-10-0${i + 1}`, 'PAGO CUOTA', far));
    for (let i = 0; i < 3; i += 1) {
      await expense(e, `2026-10-1${i}`, 'SUPER CENTER', undefined, {
        splits: [
          { amount: money('15.00'), categoryId: far },
          { amount: money('15.00'), categoryId: sup },
        ],
      });
    }
    await asAdmin(h, (c) =>
      c.query(
        `UPDATE txn.transaction SET source = 'DEBT' WHERE workspace_id = $1 AND id = ANY ($2::uuid[])`,
        [e.u.ws, managed.map((t) => String(t['id']))],
      ),
    );
    expect((await list(e.u)).items).toEqual([]);
  }, 120_000);

  it('[TC-RULES-SUGGEST-003] la evidencia fuera de la ventana no cuenta y windowDays la amplía', async () => {
    const e = await env('window');
    const tel = e.cat('Servicios básicos');
    await expense(e, '2026-04-20', 'TIGO MONEY RECARGA 1', tel);
    await expense(e, '2026-09-01', 'TIGO MONEY RECARGA 2', tel);
    await expense(e, '2026-10-01', 'TIGO MONEY RECARGA 3', tel);
    expect((await list(e.u)).items).toEqual([]);
    expect((await list(e.u, '?windowDays=366')).items).toHaveLength(1);
    problem(await get(e.u, `${SUGGESTIONS}?windowDays=400`), 400, 'VALIDATION_FAILED');
  }, 120_000);
});

describe('Listar, probar y decidir', () => {
  it('[TC-RULES-SUGGEST-015] [TC-RULES-SUGGEST-020] muestra la evidencia y el contraejemplo; listar y probar no cambian nada', async () => {
    const e = await env('explain');
    const rest = e.cat('Restaurantes');
    const sup = e.cat('Supermercado');
    for (let i = 0; i < 4; i += 1) await expense(e, `2026-10-0${i + 1}`, 'PEDIDOSYA', rest);
    const counter = await expense(e, '2026-10-09', 'PEDIDOSYA', sup);
    const rulesBefore = await ruleCount(e.u);
    const auditBefore = await auditCount(e.u);
    const { items } = await list(e.u);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      support: 4,
      evidenceCount: 5,
      confidence: '0.8000',
      confidenceLevel: 'MEDIUM',
    });
    expect(items[0]!.evidence).toHaveLength(4);
    expect(items[0]!.counterExamples.map((c) => c.transactionId)).toEqual([counter['id']]);
    const s = items[0]!;
    const preview = ok(
      await post(e.u, `${SUGGESTIONS}/preview`, { suggestionId: s.suggestionId, pattern: s.pattern }),
    );
    expect(contract.validateResponse('previewRuleSuggestion', 200, preview), JSON.stringify(preview)).toEqual(
      [],
    );
    expect(await ruleCount(e.u)).toBe(rulesBefore);
    expect(await auditCount(e.u)).toBe(auditBefore);
  }, 120_000);

  it('[TC-RULES-SUGGEST-016] la vista previa cuenta coincidencias, completar, ya en la categoría y otra categoría', async () => {
    const e = await env('preview');
    const tel = e.cat('Servicios básicos');
    const rec = e.cat('Regalos y celebraciones');
    for (let i = 0; i < 4; i += 1)
      await expense(e, `2026-10-0${i + 1}`, `TIGO MONEY RECARGA 7771234${i}`, tel);
    for (let i = 0; i < 3; i += 1) await expense(e, `2026-10-1${i}`, 'TIGO MONEY RECARGA 70000000');
    for (let i = 0; i < 2; i += 1) await expense(e, `2026-10-2${i}`, 'TIGO MONEY RECARGA 71111111', rec);
    // La categoría de esas dos viene de la categoría por defecto de la contraparte: no es evidencia.
    await asAdmin(h, (c) =>
      c.query(
        `UPDATE txn.transaction_split s SET category_origin = 'COUNTERPARTY_DEFAULT'
          FROM txn.transaction t
         WHERE s.workspace_id = $1 AND t.workspace_id = s.workspace_id AND t.id = s.transaction_id
           AND t.description LIKE '%71111111'`,
        [e.u.ws],
      ),
    );
    const s = (await list(e.u)).items.find((x) => x.pattern.categoryId === tel)!;
    const out = ok(
      await post(e.u, `${SUGGESTIONS}/preview`, { suggestionId: s.suggestionId, pattern: s.pattern }),
    );
    expect(out).toMatchObject({
      matched: 9,
      wouldFill: 3,
      alreadyInCategory: 4,
      otherCategory: 2,
      notApplicable: 0,
      truncated: false,
    });
    expect((out['items'] as unknown[]).length).toBe(9);
    // una definición editada se prueba tal cual
    const edited = ok(
      await post(e.u, `${SUGGESTIONS}/preview`, {
        suggestionId: s.suggestionId,
        pattern: s.pattern,
        definition: {
          conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: '70000000' }],
          actions: [{ type: 'SET_CATEGORY', categoryId: tel }],
        },
      }),
    );
    expect(edited).toMatchObject({ matched: 3, wouldFill: 3 });
    problem(
      await post(e.u, `${SUGGESTIONS}/preview`, { suggestionId: 'f'.repeat(64), pattern: s.pattern }),
      400,
      'VALIDATION_FAILED',
    );
  }, 120_000);

  it('[TC-RULES-SUGGEST-017] aceptar crea la regla en la versión 1 sin reclasificar; [-018] aceptar otra vez y la carrera responden RULE_SUGGESTION_DECIDED', async () => {
    const e = await env('accept');
    const tel = e.cat('Servicios básicos');
    for (let i = 0; i < 4; i += 1) await expense(e, `2026-10-0${i + 1}`, 'TIGO MONEY RECARGA 777', tel);
    const empty = await expense(e, '2026-10-20', 'TIGO MONEY RECARGA 999');
    const s = (await list(e.u)).items[0]!;
    const accept = (name: string) =>
      post(e.u, '/rules', {
        name,
        conditions: s.proposedRule['conditions'],
        actions: s.proposedRule['actions'],
        fromSuggestion: { suggestionId: s.suggestionId, pattern: s.pattern },
      });
    const created = ok(await accept('Recargas Tigo'), 201);
    expect(contract.validateResponse('createRule', 201, created), JSON.stringify(created)).toEqual([]);
    expect(created).toMatchObject({
      version: 1,
      triggers: ['IMPORT', 'RETROACTIVE'],
      fromSuggestion: { suggestionId: s.suggestionId },
    });
    const still = ok(await get(e.u, `/transactions/${String(empty['id'])}`));
    expect((still['splits'] as { categoryOrigin: string }[])[0]!.categoryOrigin).toBe('SYSTEM_DEFAULT');
    const fetched = ok(await get(e.u, `/rules/${String(created['id'])}`));
    expect(fetched['fromSuggestion']).toMatchObject({ suggestionId: s.suggestionId });
    // la sugerencia aceptada ya no se lista
    expect((await list(e.u, '?includeDismissed=true')).items).toEqual([]);
    problem(await accept('Otro nombre'), 409, 'RULE_SUGGESTION_DECIDED');
    problem(await accept('Recargas Tigo'), 409, 'RULE_SUGGESTION_DECIDED');
    expect(await ruleCount(e.u)).toBe(1);
    const events = await asAdmin(h, (c) =>
      c.query<{ action: string }>(
        `SELECT action FROM audit.audit_log WHERE workspace_id = $1 AND aggregate_type = 'RuleSuggestion'`,
        [e.u.ws],
      ),
    );
    expect(events.rows.map((r) => r.action)).toEqual(['rules.suggestion.accepted']);
  }, 120_000);

  it('[TC-RULES-SUGGEST-018] dos aceptaciones simultáneas: una crea la regla y la otra responde 409', async () => {
    const e = await env('race');
    const tel = e.cat('Servicios básicos');
    for (let i = 0; i < 3; i += 1) await expense(e, `2026-10-0${i + 1}`, 'TIGO MONEY RECARGA 777', tel);
    const s = (await list(e.u)).items[0]!;
    const accept = (name: string) =>
      post(e.u, '/rules', {
        name,
        conditions: s.proposedRule['conditions'],
        actions: s.proposedRule['actions'],
        fromSuggestion: { suggestionId: s.suggestionId, pattern: s.pattern },
      });
    const [a, b] = await Promise.all([accept('Recargas A'), accept('Recargas B')]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body['code']).toBe('RULE_SUGGESTION_DECIDED');
    expect(await ruleCount(e.u)).toBe(1);
  }, 120_000);

  it('[TC-RULES-SUGGEST-019] descartar oculta la sugerencia aunque crezca su evidencia; [-028] restaurar la vuelve a mostrar', async () => {
    const e = await env('dismiss');
    const rest = e.cat('Restaurantes');
    for (let i = 0; i < 4; i += 1) await expense(e, `2026-10-0${i + 1}`, 'PEDIDOSYA', rest);
    const s = (await list(e.u)).items[0]!;
    const dismiss = (key = randomUUID()) =>
      call(
        e.u,
        'POST',
        `${SUGGESTIONS}/${s.suggestionId}/dismiss`,
        { pattern: s.pattern },
        { 'idempotency-key': key },
      );
    expect((await dismiss()).status).toBe(204);
    problem(await dismiss(), 409, 'RULE_SUGGESTION_DECIDED');
    for (let i = 0; i < 3; i += 1) await expense(e, `2026-10-1${i}`, 'PEDIDOSYA', rest);
    expect((await list(e.u)).items).toEqual([]);
    const withDismissed = (await list(e.u, '?includeDismissed=true')).items;
    expect(withDismissed).toHaveLength(1);
    expect(withDismissed[0]).toMatchObject({ support: 7, status: 'DISMISSED' });
    expect((await post(e.u, `${SUGGESTIONS}/${s.suggestionId}/restore`)).status).toBe(204);
    expect((await list(e.u)).items.map((x) => x.status)).toEqual(['OPEN']);
    problem(await post(e.u, `${SUGGESTIONS}/${s.suggestionId}/restore`), 404, 'RESOURCE_NOT_FOUND');
    const events = await asAdmin(h, (c) =>
      c.query<{ action: string }>(
        `SELECT action FROM audit.audit_log WHERE workspace_id = $1 AND aggregate_type = 'RuleSuggestion' ORDER BY occurred_at, id`,
        [e.u.ws],
      ),
    );
    expect(events.rows.map((r) => r.action)).toEqual([
      'rules.suggestion.dismissed',
      'rules.suggestion.restored',
    ]);
  }, 120_000);

  it('[TC-RULES-SUGGEST-028] restaurar una sugerencia aceptada responde RULE_SUGGESTION_DECIDED', async () => {
    const e = await env('restore-accepted');
    const tel = e.cat('Servicios básicos');
    for (let i = 0; i < 3; i += 1) await expense(e, `2026-10-0${i + 1}`, 'TIGO MONEY RECARGA 777', tel);
    const s = (await list(e.u)).items[0]!;
    ok(
      await post(e.u, '/rules', {
        name: 'Recargas',
        conditions: s.proposedRule['conditions'],
        actions: s.proposedRule['actions'],
        fromSuggestion: { suggestionId: s.suggestionId, pattern: s.pattern },
      }),
      201,
    );
    problem(await post(e.u, `${SUGGESTIONS}/${s.suggestionId}/restore`), 409, 'RULE_SUGGESTION_DECIDED');
  }, 120_000);
});

describe('Permisos, aislamiento y límites', () => {
  it('[TC-RULES-SUGGEST-021] VIEWER lista y prueba pero no acepta, descarta ni restaura (INSUFFICIENT_ROLE)', async () => {
    const e = await env('viewer');
    const viewer = await addMember(e.u, await h.user(`kc-sugg-viewer-${randomUUID()}`), 'VIEWER');
    const tel = e.cat('Servicios básicos');
    for (let i = 0; i < 3; i += 1) await expense(e, `2026-10-0${i + 1}`, 'TIGO MONEY RECARGA 777', tel);
    const s = (await list(viewer)).items[0]!;
    ok(await post(viewer, `${SUGGESTIONS}/preview`, { suggestionId: s.suggestionId, pattern: s.pattern }));
    problem(
      await post(viewer, '/rules', {
        name: 'Recargas',
        conditions: s.proposedRule['conditions'],
        actions: s.proposedRule['actions'],
        fromSuggestion: { suggestionId: s.suggestionId, pattern: s.pattern },
      }),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(
      await post(viewer, `${SUGGESTIONS}/${s.suggestionId}/dismiss`, { pattern: s.pattern }),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(await post(viewer, `${SUGGESTIONS}/${s.suggestionId}/restore`), 403, 'INSUFFICIENT_ROLE');
    expect(await ruleCount(e.u)).toBe(0);
  }, 120_000);

  it('[TC-RULES-SUGGEST-022] la evidencia de otro workspace nunca genera sugerencias', async () => {
    const w2 = await env('w2');
    const w1 = await env('w1');
    const tel = w2.cat('Servicios básicos');
    for (let i = 0; i < 5; i += 1) await expense(w2, `2026-10-0${i + 1}`, 'TIGO MONEY RECARGA 777', tel);
    expect((await list(w2.u)).items).toHaveLength(1);
    expect((await list(w1.u)).items).toEqual([]);
    // una huella de W2 no se puede descartar ni restaurar desde W1 (cada workspace tiene sus decisiones)
    const s = (await list(w2.u)).items[0]!;
    expect(
      (await post(w2.u, `${SUGGESTIONS}/${s.suggestionId}/dismiss`, { pattern: s.pattern })).status,
    ).toBe(204);
    problem(await post(w1.u, `${SUGGESTIONS}/${s.suggestionId}/restore`), 404, 'RESOURCE_NOT_FOUND');
    const decisions = await asAdmin(h, (c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM rules.rule_suggestion_decision WHERE workspace_id = $1`,
        [w1.u.ws],
      ),
    );
    expect(decisions.rows[0]!.n).toBe(0);
  }, 120_000);

  it('[TC-RULES-SUGGEST-023] con más evidencia que el tope usa las más recientes e indica el truncado', async () => {
    const small = await startHarness({ apiEnv: { RULES_SUGGEST_MAX_EVIDENCE: '5' } });
    try {
      const u = await small.user(`kc-sugg-trunc-${randomUUID()}`);
      const bank = (
        await small.call('POST', `/api/v1/workspaces/${u.ws}/accounts`, {
          token: u.token,
          headers: { 'idempotency-key': randomUUID() },
          body: {
            name: 'Banco',
            type: 'BANK',
            currency: 'BOB',
            openingBalance: { amount: money('9000.00'), date: '2026-04-30' },
          },
        })
      ).body['id'] as string;
      const cat = (
        (
          await small.call('GET', `/api/v1/workspaces/${u.ws}/categories?kind=EXPENSE&limit=5`, {
            token: u.token,
          })
        ).body['data'] as { id: string }[]
      )[0]!.id;
      for (let i = 0; i < 7; i += 1) {
        const r = await small.call('POST', `/api/v1/workspaces/${u.ws}/transactions`, {
          token: u.token,
          headers: { 'idempotency-key': randomUUID() },
          body: {
            kind: 'EXPENSE',
            transactionDate: `2026-10-0${i + 1}`,
            accountId: bank,
            amount: money('10.00'),
            description: 'PEDIDOSYA',
            splits: [{ amount: money('10.00'), categoryId: cat }],
          },
        });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
      }
      const r = await small.call('GET', `/api/v1/workspaces/${u.ws}${SUGGESTIONS}`, { token: u.token });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ scanned: 5, truncated: true });
      expect((r.body['items'] as Suggestion[])[0]).toMatchObject({ support: 5, evidenceCount: 5 });
    } finally {
      await small.close();
    }
  }, 300_000);
});
