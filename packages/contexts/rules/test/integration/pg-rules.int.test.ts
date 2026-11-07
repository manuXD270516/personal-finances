import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Rule, parseDefinition } from '../../src/domain/index.js';
import type { RuleProposalDecisionRecord } from '../../src/application/ports/index.js';
import {
  PgRuleProposalDecisionRepository,
  PgRuleRepository,
  PgRulesUnitOfWork,
} from '../../src/infrastructure/pg-rules.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `rules.*` contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec add-rule-engine, tarea 4.1, TC-RULES-ENGINE-053):
// repositorio con control optimista y orden de evaluación, versiones append-only (PF003), unicidad del nombre entre las no
// archivadas, aislamiento entre workspaces, RLS fail-closed (PF002) y permisos.
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
let uow: PgRulesUnitOfWork;
const rules = new PgRuleRepository();
const decisions = new PgRuleProposalDecisionRepository();
const AT = '2026-10-20T14:00:00.000Z';

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: user }, origin: 'api' }, fn);
const inWs = <T>(ws: string, fn: () => Promise<T>): Promise<T> => asUser(() => uow.run(ws, fn));

async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

const newRule = (ws: string, name: string, over: { priority?: number; createdAt?: string } = {}) =>
  Rule.create({
    id: randomUUID(),
    workspaceId: ws,
    name,
    priority: over.priority ?? 100,
    definition: parseDefinition({
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: randomUUID() }],
    }),
    createdBy: user,
    now: over.createdAt ?? AT,
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgRulesUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/rules', $1, $2, 'U1') AS id`,
    [`sub-rules-${randomUUID()}`, `rules-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  const setup = new PgUnitOfWork(app);
  for (const ws of [w1, w2]) {
    await setup.run({ userId: user, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Rules', 'BOB', 'America/La_Paz', 'es-BO')`,
        [ws],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, user],
      );
    });
  }
}, 120_000);

afterAll(async () => {
  await Promise.all([app?.end(), migrator?.end()]);
});

describe('rules.rule', () => {
  it('inserta, relee y actualiza con control optimista (row_version); la versión de definición se guarda aparte', async () => {
    const rule = newRule(w1, 'Supermercado');
    await inWs(w1, async () => {
      await rules.insert(rule, user);
      await rules.insertVersion(rule.snapshot, user);
    });
    const loaded = await inWs(w1, () => rules.findById(w1, rule.id));
    expect(loaded?.snapshot).toMatchObject({
      name: 'Supermercado',
      version: 1,
      rowVersion: 1,
      enabled: true,
    });
    expect(loaded?.snapshot.createdAt).toBe(AT);
    expect(loaded?.snapshot.triggers).toEqual(['IMPORT', 'RETROACTIVE']);
    const fresh = await inWs(w1, () => rules.findById(w1, rule.id));
    fresh!.update({ priority: 5 }, '2026-10-21T00:00:00.000Z');
    expect(await inWs(w1, () => rules.update(fresh!, 1))).toBe(true);
    // la segunda escritura con la versión vieja pierde la carrera
    const stale = (await inWs(w1, () => rules.findById(w1, rule.id)))!;
    stale.update({ priority: 7 }, '2026-10-22T00:00:00.000Z');
    expect(await inWs(w1, () => rules.update(stale, 1))).toBe(false);
  });

  it('[TC-RULES-ENGINE-020] listEvaluable ordena por (priority, created_at, id) y solo trae las activas del disparador', async () => {
    const early = newRule(w1, 'Empate A', { priority: 50, createdAt: '2026-10-01T00:00:00.000Z' });
    const late = newRule(w1, 'Empate B', { priority: 50, createdAt: '2026-10-02T00:00:00.000Z' });
    const first = newRule(w1, 'Primera', { priority: 1 });
    const off = newRule(w1, 'Inactiva', { priority: 2 });
    off.disable(AT);
    await inWs(w1, async () => {
      for (const r of [late, early, first, off]) {
        await rules.insert(r, user);
        await rules.insertVersion(r.snapshot, user);
      }
    });
    const evaluable = await inWs(w1, () => rules.listEvaluable(w1, 'IMPORT'));
    const names = [early, late, first].map((r) => r.snapshot.name);
    const order = evaluable.map((r) => r.id);
    expect(order.indexOf(first.id)).toBeLessThan(order.indexOf(early.id));
    expect(order.indexOf(early.id)).toBeLessThan(order.indexOf(late.id));
    expect(order).not.toContain(off.id);
    expect(names).toHaveLength(3);
    // un disparador que ninguna regla tiene
    expect(await inWs(w1, () => rules.listEvaluable(w1, 'MANUAL_CREATE'))).toEqual([]);
  });

  it('el nombre es único (sin distinguir mayúsculas) entre las no archivadas y se libera al archivar', async () => {
    const a = newRule(w1, 'Única');
    await inWs(w1, async () => {
      await rules.insert(a, user);
      await rules.insertVersion(a.snapshot, user);
    });
    const dup = newRule(w1, 'única');
    await expect(inWs(w1, () => rules.insert(dup, user))).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    const fresh = (await inWs(w1, () => rules.findById(w1, a.id)))!;
    fresh.archive('2026-10-23T00:00:00.000Z');
    expect(await inWs(w1, () => rules.update(fresh, 1))).toBe(true);
    await inWs(w1, () => rules.insert(newRule(w1, 'única'), user));
  });

  it('[TC-RULES-ENGINE-053] las reglas de un workspace no se ven en otro y sin contexto RLS falla cerrado (PF002)', async () => {
    const mine = newRule(w1, 'Solo w1');
    await inWs(w1, async () => {
      await rules.insert(mine, user);
      await rules.insertVersion(mine.snapshot, user);
    });
    expect(await inWs(w2, () => rules.findById(w2, mine.id))).toBeNull();
    expect(await inWs(w2, () => rules.listAll(w2, { includeArchived: true }))).toEqual([]);
    // leer w1 con el contexto de w2: RLS lo oculta aunque el filtro lo pida
    expect(await inWs(w2, () => rules.findById(w1, mine.id))).toBeNull();
    // sin contexto de workspace
    const client = await app.connect();
    try {
      expect(await sqlState(() => client.query(`SELECT * FROM rules.rule`))).toBe('PF002');
      expect(await sqlState(() => client.query(`SELECT * FROM rules.rule_version`))).toBe('PF002');
    } finally {
      client.release();
    }
  });

  it('las versiones son append-only (PF003) y las reglas no se borran', async () => {
    const r = newRule(w1, 'Inmutable');
    await inWs(w1, async () => {
      await rules.insert(r, user);
      await rules.insertVersion(r.snapshot, user);
    });
    const attempt = (sql: string) =>
      sqlState(() =>
        asUser(() =>
          uow.run(w1, async () => {
            await requireSqlExecutor().query(sql, [r.id]);
          }),
        ),
      );
    // pf_app solo tiene SELECT e INSERT: sin permiso de UPDATE ni DELETE.
    expect(['PF003', '42501']).toContain(
      await attempt(`UPDATE rules.rule_version SET snapshot = '{}'::jsonb WHERE rule_id = $1`),
    );
    expect(['PF003', '42501']).toContain(await attempt(`DELETE FROM rules.rule_version WHERE rule_id = $1`));
    // pf_app no tiene DELETE sobre rules.rule
    expect(await attempt(`DELETE FROM rules.rule WHERE id = $1`)).toBe('42501');
    const versions = await inWs(w1, () => rules.listVersions(w1, r.id));
    expect(versions.map((v) => v.version)).toEqual([1]);
    expect(versions[0]?.snapshot).toMatchObject({
      name: 'Inmutable',
      stopProcessing: false,
      schemaVersion: 1,
    });
  });

  it('las reglas están registradas para la purga del workspace demo (workspace_scoped_table)', async () => {
    const { rows } = await migrator.query<{ table_name: string; schema_name: string }>(
      `SELECT schema_name, table_name FROM platform.workspace_scoped_table WHERE schema_name = 'rules' ORDER BY table_name`,
    );
    expect(rows.map((r) => `${r.schema_name}.${r.table_name}`)).toEqual([
      'rules.rule',
      'rules.rule_suggestion_decision',
      'rules.rule_version',
    ]);
  });
});

// rules.rule_suggestion_decision (openspec add-rule-suggestions, tarea 4.1; TC-RULES-SUGGEST-022 y -018): clave primaria
// (workspace, huella) que serializa las decisiones concurrentes, aislamiento entre workspaces, RLS fail-closed (PF002) y
// permisos de pf_app (SELECT, INSERT, DELETE; sin UPDATE).
describe('rules.rule_suggestion_decision', () => {
  const fingerprint = () => randomUUID().replaceAll('-', '').repeat(2);
  const record = (over: Partial<RuleProposalDecisionRecord> = {}): RuleProposalDecisionRecord => ({
    suggestionId: fingerprint(),
    patternType: 'DESCRIPTION',
    patternValue: 'tigo money recarga',
    kind: 'EXPENSE',
    categoryId: randomUUID(),
    decision: 'DISMISSED',
    ruleId: null,
    support: 4,
    evidenceCount: 5,
    confidence: '0.8000',
    decidedAt: AT,
    decidedBy: user,
    ...over,
  });

  it('[TC-RULES-SUGGEST-018] inserta una vez por huella: la segunda decisión, previa o simultánea, no escribe', async () => {
    const r = record();
    expect(await inWs(w1, () => decisions.insert(w1, r))).toBe(true);
    expect(await inWs(w1, () => decisions.insert(w1, { ...r, decision: 'DISMISSED' }))).toBe(false);
    const found = await inWs(w1, () => decisions.find(w1, r.suggestionId));
    expect(found).toMatchObject({
      decision: 'DISMISSED',
      support: 4,
      evidenceCount: 5,
      confidence: '0.8000',
      decidedAt: AT,
    });
    // dos escrituras simultáneas de la misma huella: una gana
    const racing = record();
    const results = await Promise.all([
      inWs(w1, () => decisions.insert(w1, racing)),
      inWs(w1, () => decisions.insert(w1, { ...racing, decidedBy: user })),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('una aceptada guarda la regla; solo se borra una descartada; las aceptadas se leen por regla', async () => {
    const rule = newRule(w1, 'Origen sugerencia');
    await inWs(w1, async () => {
      await rules.insert(rule, user);
      await rules.insertVersion(rule.snapshot, user);
    });
    const accepted = record({ decision: 'ACCEPTED', ruleId: rule.id });
    expect(await inWs(w1, () => decisions.insert(w1, accepted))).toBe(true);
    expect(await inWs(w1, () => decisions.deleteDismissed(w1, accepted.suggestionId))).toBe(false);
    const origins = await inWs(w1, () => decisions.acceptedByRules(w1, [rule.id, randomUUID()]));
    expect([...origins.entries()]).toEqual([
      [rule.id, { suggestionId: accepted.suggestionId, acceptedAt: AT }],
    ]);
    const dismissed = record();
    await inWs(w1, () => decisions.insert(w1, dismissed));
    expect(await inWs(w1, () => decisions.deleteDismissed(w1, dismissed.suggestionId))).toBe(true);
    expect(await inWs(w1, () => decisions.find(w1, dismissed.suggestionId))).toBeNull();
    // una aceptada exige la regla y una descartada no puede llevarla (CHECK)
    const bad = (r: RuleProposalDecisionRecord) => sqlState(() => inWs(w1, () => decisions.insert(w1, r)));
    expect(await bad(record({ decision: 'ACCEPTED', ruleId: null }))).toBe('23514');
    expect(await bad(record({ decision: 'DISMISSED', ruleId: rule.id }))).toBe('23514');
  });

  it('[TC-RULES-SUGGEST-022] las decisiones de un workspace no se ven en otro y sin contexto RLS falla cerrado (PF002)', async () => {
    const mine = record();
    await inWs(w1, () => decisions.insert(w1, mine));
    expect(await inWs(w2, () => decisions.find(w2, mine.suggestionId))).toBeNull();
    expect(await inWs(w2, () => decisions.find(w1, mine.suggestionId))).toBeNull();
    expect((await inWs(w2, () => decisions.list(w2))).map((d) => d.suggestionId)).not.toContain(
      mine.suggestionId,
    );
    // w2 puede decidir la misma huella: la clave incluye el workspace
    expect(await inWs(w2, () => decisions.insert(w2, { ...mine }))).toBe(true);
    // un INSERT con el workspace de otro contexto lo rechaza la política
    expect(await sqlState(() => inWs(w2, () => decisions.insert(w1, record())))).toBe('42501');
    const client = await app.connect();
    try {
      expect(await sqlState(() => client.query(`SELECT * FROM rules.rule_suggestion_decision`))).toBe(
        'PF002',
      );
    } finally {
      client.release();
    }
  });

  it('pf_app no puede actualizar una decisión (solo SELECT, INSERT y DELETE)', async () => {
    const r = record();
    await inWs(w1, () => decisions.insert(w1, r));
    const attempt = (query: string) =>
      sqlState(() =>
        asUser(() =>
          uow.run(w1, async () => {
            await requireSqlExecutor().query(query, [r.suggestionId]);
          }),
        ),
      );
    expect(
      await attempt(
        `UPDATE rules.rule_suggestion_decision SET decision = 'DISMISSED' WHERE suggestion_id = $1`,
      ),
    ).toBe('42501');
  });
});
