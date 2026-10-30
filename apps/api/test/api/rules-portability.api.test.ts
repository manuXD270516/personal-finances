import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { IMPORT_ROW_NAMESPACE } from '@pf/transactions/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demoQueryRuntimes } from '../support/demo-runtimes.js';
import {
  asAdmin,
  downloadExport,
  exportAndWait,
  importAndWait,
  money,
  startHarness,
  type Harness,
  type Json,
  type Reply,
  type User,
} from '../support/portability.js';

// Export e import del workspace con reglas versionadas (openspec add-rule-engine, TC-RULES-ENGINE-058): las reglas con
// todas sus versiones, prioridades y estados, el origen de la clasificación de cada split (regla y versión) y las marcas
// de revisión viajan, se remapean a ids nuevos y la cobertura da el mismo resultado.
const deps = inject('deps');
let h: Harness;
let runtime: ReturnType<typeof demoQueryRuntimes>;

const call = (u: User, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  h.call(method, `/api/v1/workspaces/${u.ws}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers,
  });
const post = (u: User, path: string, body?: unknown) =>
  call(u, 'POST', path, body, { 'idempotency-key': randomUUID() });
const ok = (r: Reply, status = 200): Json => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};

beforeAll(async () => {
  h = await startHarness({ worker: true });
  runtime = demoQueryRuntimes({ databaseUrl: deps.databaseUrl, today: '2026-11-03' });
}, 300_000);

afterAll(async () => {
  await Promise.all([h?.close(), runtime?.close()]);
});

describe('Portabilidad de reglas y de la clasificación', () => {
  it('[TC-RULES-ENGINE-058] ida y vuelta: 3 reglas (una archivada y una en la versión 3), 3 transacciones importadas (2 por reglas) y 1 marca de revisión', async () => {
    const owner = await h.user(`kc-rules-port-${randomUUID()}`);
    const acc = ok(
      await post(owner, '/accounts', {
        name: 'Banco BOB',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: money('4000.00'), date: '2026-06-30' },
      }),
      201,
    )['id'] as string;
    const cats = ok(await call(owner, 'GET', '/categories?kind=EXPENSE&limit=200'))['data'] as {
      id: string;
      name: string;
    }[];
    const sup = cats.find((c) => c.name === 'Supermercado')!.id;
    const serv = cats.find((c) => c.name === 'Servicios básicos')!.id;
    const tag = ok(await post(owner, '/tags', { name: 'hogar' }), 201)['id'] as string;

    // "Supermercado" llega a la versión 3.
    const sRule = ok(
      await post(owner, '/rules', {
        name: 'Supermercado',
        priority: 10,
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
        actions: [{ type: 'SET_CATEGORY', categoryId: sup }],
      }),
      201,
    );
    const sid = String(sRule['id']);
    ok(
      await call(
        owner,
        'PUT',
        `/rules/${sid}`,
        {
          actions: [
            { type: 'SET_CATEGORY', categoryId: sup },
            { type: 'ADD_TAG', tagId: tag },
          ],
        },
        { 'if-match': '"1"' },
      ),
    );
    ok(await call(owner, 'PUT', `/rules/${sid}`, { stopProcessing: true }, { 'if-match': '"2"' }));
    const tRule = ok(
      await post(owner, '/rules', {
        name: 'Telefonía',
        priority: 20,
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'tigo' }],
        actions: [{ type: 'SET_CATEGORY', categoryId: serv }],
      }),
      201,
    );
    const oldRule = ok(
      await post(owner, '/rules', {
        name: 'Vieja',
        priority: 30,
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'vieja' }],
        actions: [{ type: 'ADD_TAG', tagId: tag }],
      }),
      201,
    );
    ok(
      await call(owner, 'POST', `/rules/${String(oldRule['id'])}/archive`, undefined, { 'if-match': '"1"' }),
    );

    const job = randomUUID();
    const rows = [
      ['HIPERMAXI SUC 12', '185.40', sup, sRule, [tag]],
      ['TIGO MONEY RECARGA', '100.00', serv, tRule, []],
      ['TRANSF 99812', '300.00', null, null, []],
    ] as const;
    const created = await runtime.inWs(owner.id, owner.ws, () =>
      runtime.r.transactions.imported.recordBatch({
        workspaceId: owner.ws,
        accountId: acc,
        importJobId: job,
        actorUserId: owner.id,
        rows: rows.map(([description, amount, category, r, tags], i) => ({
          rowRef: `r${i}`,
          date: '2026-09-10',
          direction: 'OUT' as const,
          amount: money(amount),
          description,
          externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: `fp-${owner.id}-${i}` },
          ...(category && r
            ? {
                classification: {
                  categoryId: category,
                  categoryOrigin: 'RULE' as const,
                  categoryRule: { ruleId: String(r['id']), ruleVersion: Number(r['version']) },
                  counterpartyId: null,
                  tagIds: [...tags],
                  customFields: [],
                  needsReview: i === 1 ? { ruleId: String(r['id']), ruleVersion: 1 } : null,
                  ruleRefs: tags.map((t) => ({ field: `TAG:${t}`, ruleId: String(r['id']), ruleVersion: 3 })),
                },
              }
            : {}),
        })),
      }),
    );
    expect(created.created).toHaveLength(3);
    const range = '/rules/coverage?from=2026-09-01&to=2026-09-30';
    const before = ok(await call(owner, 'GET', range));
    expect(before).toMatchObject({ count: 3, ruleCoverage: '0.6667' });
    const reviewBefore = ok(await call(owner, 'GET', '/transactions?needsReview=true'))['data'] as Json[];
    expect(reviewBefore).toHaveLength(1);
    const rulesBefore = ok(await call(owner, 'GET', '/rules?includeArchived=true'))['data'] as Json[];
    expect(rulesBefore).toHaveLength(3);

    // Exportar e importar.
    const exported = await exportAndWait(h, owner, owner.ws);
    const zip = (await downloadExport(h, owner, owner.ws, exported['id'] as string)).raw;
    const done = await importAndWait(h, owner, zip);
    expect(done, JSON.stringify(done)).toMatchObject({ status: 'SUCCEEDED', errorCode: null });
    const restored: User = { ...owner, ws: done['workspaceId'] as string };

    // Las 3 reglas con sus versiones, prioridades y estados; ids nuevos.
    const rulesAfter = ok(await call(restored, 'GET', '/rules?includeArchived=true'))['data'] as Json[];
    expect(rulesAfter.map((r) => [r['name'], r['priority'], r['version'], r['status']])).toEqual(
      rulesBefore.map((r) => [r['name'], r['priority'], r['version'], r['status']]),
    );
    expect(rulesAfter.map((r) => r['id'])).not.toContain(sid);
    const restoredS = rulesAfter.find((r) => r['name'] === 'Supermercado')!;
    const versions = ok(await call(restored, 'GET', `/rules/${String(restoredS['id'])}/versions`))[
      'data'
    ] as Json[];
    expect(versions.map((v) => v['version'])).toEqual([1, 2, 3]);
    // Las referencias de los splits resuelven a las reglas nuevas y la cobertura vuelve a dar el mismo resultado.
    const after = ok(await call(restored, 'GET', range));
    expect(after).toMatchObject({
      count: before['count'],
      ruleCoverage: before['ruleCoverage'],
      byOrigin: before['byOrigin'],
    });
    expect((after['byRule'] as Json[]).map((r) => r['name']).sort()).toEqual(['Supermercado', 'Telefonía']);
    const tx = ok(await call(restored, 'GET', '/transactions?limit=50'))['data'] as Json[];
    const hip = tx.find((t) => t['description'] === 'HIPERMAXI SUC 12')!;
    const split = (hip['splits'] as { ruleRefs: Json[]; categoryOrigin: string }[])[0]!;
    expect(split.categoryOrigin).toBe('RULE');
    expect(split.ruleRefs.find((r) => r['field'] === 'CATEGORY')).toMatchObject({
      ruleId: restoredS['id'],
      ruleName: 'Supermercado',
    });
    expect(split.ruleRefs.some((r) => String(r['field']).startsWith('TAG:'))).toBe(true);
    // La marca de revisión sigue pendiente.
    const reviewAfter = ok(await call(restored, 'GET', '/transactions?needsReview=true'))['data'] as Json[];
    expect(reviewAfter).toHaveLength(1);
    expect((reviewAfter[0]!['review'] as Json)['ruleName']).toBe('Telefonía');
    // Las tablas de reglas del original no cambiaron.
    const counts = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ n: number }>(
            `SELECT (SELECT count(*)::int FROM rules.rule WHERE workspace_id = $1) + (SELECT count(*)::int FROM rules.rule_version WHERE workspace_id = $1) AS n`,
            [owner.ws],
          )
        ).rows[0]!.n,
    );
    expect(counts).toBe(3 + 5);
  }, 360_000);
});
