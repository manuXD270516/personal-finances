import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { RulesQueries } from './rules.queries.js';
import { RulesService } from './rules.service.js';
import { createRulesWorld } from './testing/in-memory.js';

const W = 'w1';
const U = 'u1';
const supermercado = (over: object = {}) => ({
  name: 'Supermercado',
  priority: 100,
  conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
  actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
  ...over,
});

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('no error');
}

function setup() {
  const world = createRulesWorld();
  return { ...world, service: new RulesService(world.deps), queries: new RulesQueries(world.deps) };
}

describe('RulesService', () => {
  it('[TC-RULES-ENGINE-001] crea una regla activa en la versión 1, con auditoría y su primera versión', async () => {
    const { service, rules, audit } = setup();
    const created = await service.createRule(U, W, supermercado());
    expect(created).toMatchObject({
      enabled: true,
      version: 1,
      priority: 100,
      triggers: ['IMPORT', 'RETROACTIVE'],
    });
    expect(rules.versions).toHaveLength(1);
    expect(audit.entries.map((e) => e.action)).toEqual(['rules.rule.created']);
    // los valores compuestos viajan como texto JSON
    const conditions = audit.entries[0]?.changes?.find((c) => c.field === 'conditions');
    expect(typeof conditions?.after).toBe('string');
  });

  it('[TC-RULES-ENGINE-002] una regla sin acciones no se crea', async () => {
    const { service, rules, audit } = setup();
    expect((await failure(service.createRule(U, W, supermercado({ actions: [] })))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(rules.states.size).toBe(0);
    expect(audit.entries).toHaveLength(0);
  });

  it('[TC-RULES-ENGINE-003] el nombre es único sin distinguir mayúsculas entre las no archivadas', async () => {
    const { service } = setup();
    await service.createRule(U, W, supermercado());
    expect((await failure(service.createRule(U, W, supermercado({ name: 'SUPERMERCADO' })))).code).toBe(
      'NAME_TAKEN',
    );
  });

  it('[TC-RULES-ENGINE-040] archivar libera el nombre y conserva la regla', async () => {
    const { service, rules } = setup();
    const r = await service.createRule(U, W, supermercado());
    await service.archiveRule(U, W, r.id, r.rowVersion);
    const again = await service.createRule(U, W, supermercado({ name: 'Supermercado' }));
    expect(again.id).not.toBe(r.id);
    expect(rules.states.get(r.id)?.archivedAt).not.toBeNull();
  });

  it('[TC-RULES-ENGINE-049] la regla número 501 se rechaza con RULE_LIMIT_EXCEEDED', async () => {
    const { service, deps } = setup();
    const small = new RulesService({ ...deps, settings: { ...deps.settings, maxRules: 2 } });
    await small.createRule(U, W, supermercado({ name: 'a' }));
    await small.createRule(U, W, supermercado({ name: 'b' }));
    expect((await failure(small.createRule(U, W, supermercado({ name: 'c' })))).code).toBe(
      'RULE_LIMIT_EXCEEDED',
    );
    expect(service).toBeDefined();
  });

  it('valida las referencias con los códigos de Classification', async () => {
    const { service, catalog } = setup();
    catalog.categories.set('cat-vieja', { kind: 'EXPENSE', archived: true });
    expect(
      (
        await failure(
          service.createRule(
            U,
            W,
            supermercado({ actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-vieja' }] }),
          ),
        )
      ).code,
    ).toBe('CATEGORY_ARCHIVED');
    expect(
      (
        await failure(
          service.createRule(U, W, supermercado({ actions: [{ type: 'ADD_TAG', tagId: 'nada' }] })),
        )
      ).code,
    ).toBe('REFERENCE_NOT_FOUND');
  });

  it('[TC-RULES-ENGINE-041] editar la definición crea una versión inmutable; la anterior sigue consultable', async () => {
    const { service, queries } = setup();
    const r = await service.createRule(U, W, supermercado());
    const updated = await service.updateRule(U, W, r.id, r.rowVersion, {
      actions: [
        { type: 'SET_CATEGORY', categoryId: 'cat-super' },
        { type: 'ADD_TAG', tagId: 'tag-hogar' },
      ],
    });
    expect(updated.version).toBe(2);
    const versions = await queries.versions(W, r.id);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect((versions[0]?.snapshot.actions as unknown[]).length).toBe(1);
    expect((versions[1]?.snapshot.actions as unknown[]).length).toBe(2);
  });

  it('[TC-RULES-ENGINE-042] dos ediciones con la misma versión: la segunda falla con PRECONDITION_FAILED', async () => {
    const { service } = setup();
    const r = await service.createRule(U, W, supermercado());
    await service.updateRule(U, W, r.id, r.rowVersion, { description: 'uno' });
    const e = await failure(service.updateRule(U, W, r.id, r.rowVersion, { description: 'dos' }));
    expect(e.code).toBe('PRECONDITION_FAILED');
    expect(e.details['currentVersion']).toBe(2);
  });

  it('[TC-RULES-ENGINE-043] cambiar la prioridad se audita con valor anterior y nuevo, sin versión nueva', async () => {
    const { service, audit } = setup();
    const r = await service.createRule(U, W, supermercado());
    const updated = await service.updateRule(U, W, r.id, r.rowVersion, { priority: 5 });
    expect(updated.version).toBe(1);
    const entry = audit.entries.at(-1);
    expect(entry?.changes).toEqual([{ field: 'priority', before: 100, after: 5 }]);
  });

  it('[TC-RULES-ENGINE-039] desactivar y activar se auditan como cambio de estado', async () => {
    const { service, audit } = setup();
    const r = await service.createRule(U, W, supermercado());
    const off = await service.disableRule(U, W, r.id, r.rowVersion);
    expect(off.enabled).toBe(false);
    expect(audit.entries.at(-1)?.changes).toEqual([{ field: 'status', before: 'ACTIVE', after: 'INACTIVE' }]);
  });

  it('reordenar asigna 10, 20, 30… sin versionar y exige todas las reglas', async () => {
    const { service, queries } = setup();
    const a = await service.createRule(U, W, supermercado({ name: 'a', priority: 100 }));
    const b = await service.createRule(U, W, supermercado({ name: 'b', priority: 200 }));
    expect((await failure(service.reorderRules(U, W, [a.id]))).code).toBe('VALIDATION_FAILED');
    await service.reorderRules(U, W, [b.id, a.id]);
    const listed = await queries.list(W);
    expect(listed.map((v) => [v.rule.name, v.rule.priority, v.rule.version])).toEqual([
      ['b', 10, 1],
      ['a', 20, 1],
    ]);
  });

  it('[TC-RULES-ENGINE-023] el listado señala "requiere atención" cuando un destino se archivó', async () => {
    const { service, queries, catalog } = setup();
    await service.createRule(U, W, supermercado());
    catalog.categories.set('cat-super', { kind: 'EXPENSE', archived: true });
    const [view] = await queries.list(W);
    expect(view?.needsAttention).toBe(true);
    expect(await queries.list(W, { needsAttention: false })).toHaveLength(0);
  });

  it('[TC-RULES-ENGINE-048] señala la regla activa sin aplicaciones en 90 días', async () => {
    const { service, queries, coverage, rules } = setup();
    const r = await service.createRule(U, W, supermercado({ name: 'Gimnasio' }));
    // creada el 2026-06-01, sin uso hasta el 2026-10-20
    rules.states.set(r.id, { ...r, createdAt: '2026-06-01T00:00:00.000Z' });
    const [view] = await queries.list(W);
    expect(view?.stats).toEqual({ classifiedTransactions: 0, lastAppliedAt: null, unusedFor90Days: true });
    coverage.stats = [{ ruleId: r.id, ruleVersion: 1, count: 3, lastAppliedAt: '2026-10-18T10:00:00.000Z' }];
    const [used] = await queries.list(W);
    expect(used?.stats.unusedFor90Days).toBe(false);
    expect(used?.stats.classifiedTransactions).toBe(3);
  });
});
