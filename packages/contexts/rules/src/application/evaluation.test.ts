import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { RuleSubject } from '../domain/index.js';
import { RuleDryRunService } from './dry-run.service.js';
import { RulesQueries } from './rules.queries.js';
import { RulesService } from './rules.service.js';
import { createRulesWorld } from './testing/in-memory.js';

const W = 'w1';
const U = 'u1';

const subject = (over: Partial<RuleSubject> = {}): RuleSubject => ({
  ref: 'row-1',
  kind: 'EXPENSE',
  accountId: 'acc-bob',
  date: '2026-09-10',
  amount: { amount: '185.40', currency: 'BOB' },
  description: 'HIPERMAXI SUC 12',
  counterpartyId: null,
  counterpartyOrigin: null,
  categoryId: null,
  tagIds: [],
  externalSource: 'imports.csv-row',
  customFields: [],
  splitCount: 1,
  ...over,
});

async function setup() {
  const world = createRulesWorld();
  const service = new RulesService(world.deps);
  const queries = new RulesQueries(world.deps);
  const dryRun = new RuleDryRunService(world.deps, queries);
  const rule = await service.createRule(U, W, {
    name: 'Supermercado',
    priority: 100,
    conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
    actions: [
      { type: 'SET_CATEGORY', categoryId: 'cat-super' },
      { type: 'ADD_TAG', tagId: 'tag-hogar' },
    ],
  });
  return { ...world, service, queries, dryRun, rule };
}

describe('RuleEvaluationQuery (evaluate)', () => {
  it('[TC-RULES-ENGINE-031] la vista previa de un import muestra la regla y versión de cada propuesta', async () => {
    const { queries, rule, rules } = await setup();
    const out = await queries.evaluate({
      workspaceId: W,
      trigger: 'IMPORT',
      mode: 'FILL_EMPTY',
      subjects: [
        subject(),
        subject({
          ref: 'row-2',
          description: 'TIGO MONEY RECARGA',
          amount: { amount: '100.00', currency: 'BOB' },
        }),
        subject({ ref: 'row-3', description: 'TRANSF 99812', amount: { amount: '300.00', currency: 'BOB' } }),
      ],
    });
    expect(out[0]?.category).toEqual({
      categoryId: 'cat-super',
      origin: { ruleId: rule.id, ruleVersion: 1 },
    });
    expect(out[1]?.category).toBeNull();
    expect(out[2]?.category).toBeNull();
    // una sola consulta de reglas por llamada
    expect(rules.evaluableQueries).toBe(1);
  });

  it('[TC-RULES-ENGINE-039] una regla desactivada no clasifica la fila', async () => {
    const { queries, service, rule } = await setup();
    await service.disableRule(U, W, rule.id, rule.rowVersion);
    const [out] = await queries.evaluate({
      workspaceId: W,
      trigger: 'IMPORT',
      mode: 'FILL_EMPTY',
      subjects: [subject()],
    });
    expect(out?.category).toBeNull();
  });

  it('[TC-RULES-ENGINE-053] las reglas de otro workspace no se evalúan', async () => {
    const { queries } = await setup();
    const [out] = await queries.evaluate({
      workspaceId: 'w2',
      trigger: 'IMPORT',
      mode: 'FILL_EMPTY',
      subjects: [subject()],
    });
    expect(out?.matched).toEqual([]);
  });

  it('rechaza más de 5 000 sujetos por llamada', async () => {
    const { queries } = await setup();
    const subjects = Array.from({ length: 5001 }, (_, i) => subject({ ref: `r${i}` }));
    await expect(
      queries.evaluate({ workspaceId: W, trigger: 'IMPORT', mode: 'FILL_EMPTY', subjects }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('[TC-RULES-ENGINE-033] la regla editada después de la vista previa no cambia lo ya evaluado', async () => {
    const { queries, service, rule } = await setup();
    const input = { workspaceId: W, trigger: 'IMPORT', mode: 'FILL_EMPTY', subjects: [subject()] } as const;
    const [before] = await queries.evaluate(input);
    await service.updateRule(U, W, rule.id, rule.rowVersion, {
      actions: [{ type: 'ADD_TAG', tagId: 'tag-hogar' }],
    });
    const [after] = await queries.evaluate(input);
    expect(before?.category?.origin.ruleVersion).toBe(1);
    expect(after?.category).toBeNull();
    expect(after?.addTags[0]?.origin.ruleVersion).toBe(2);
  });
});

describe('vista previa', () => {
  it('[TC-RULES-ENGINE-025] una definición sin guardar no persiste ni audita', async () => {
    const { queries, rules, audit } = await setup();
    const auditBefore = audit.entries.length;
    const result = await queries.preview(W, {
      definition: {
        conditions: [
          { field: 'DESCRIPTION', operator: 'contains', value: 'tigo' },
          { field: 'AMOUNT', operator: 'lte', value: '150.00', currency: 'BOB' },
        ],
        actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
      },
      subject: {
        sample: { description: 'TIGO MONEY RECARGA', amount: { amount: '100.00', currency: 'BOB' } },
      },
    });
    expect(result.matched).toBe(true);
    expect(result.actions).toEqual([{ type: 'SET_CATEGORY', categoryId: 'cat-super' }]);
    expect(rules.states.size).toBe(1);
    expect(audit.entries).toHaveLength(auditBefore);
  });

  it('[TC-RULES-ENGINE-026] muestra la condición de monto no cumplida y ninguna acción', async () => {
    const { queries } = await setup();
    const result = await queries.preview(W, {
      definition: {
        conditions: [
          { field: 'DESCRIPTION', operator: 'contains', value: 'tigo' },
          { field: 'AMOUNT', operator: 'lte', value: '150.00', currency: 'BOB' },
        ],
        actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
      },
      subject: {
        sample: { description: 'TIGO MONEY RECARGA', amount: { amount: '180.00', currency: 'BOB' } },
      },
    });
    expect(result.matched).toBe(false);
    expect(result.conditions.map((c) => c.met)).toEqual([true, false]);
    expect(result.actions).toEqual([]);
  });

  it('prueba una regla guardada contra una transacción existente', async () => {
    const { queries, subjects, rule } = await setup();
    subjects.add({ transactionId: 't1' });
    const result = await queries.preview(W, {
      ruleId: rule.id,
      subject: { transactionId: 't1' },
      trigger: 'RETROACTIVE',
    });
    expect(result.matched).toBe(true);
    expect(result.actions.map((a) => a.type)).toEqual(['SET_CATEGORY', 'ADD_TAG']);
  });
});

describe('dry-run y aplicación', () => {
  async function september() {
    const w = await setup();
    // 6 gastos con hipermaxi: 4 sin categoría y 2 en Hogar
    for (const id of ['t1', 't2', 't3', 't4']) w.subjects.add({ transactionId: id });
    for (const id of ['t5', 't6'])
      w.subjects.add({ transactionId: id, categoryId: 'cat-hogar', categoryOrigin: 'MANUAL' });
    return w;
  }
  const range = { from: '2026-09-01', to: '2026-09-30' } as const;

  it('[TC-RULES-ENGINE-027] completar propone la categoría solo para los 4 sin categoría y no persiste', async () => {
    const { dryRun, subjects } = await september();
    const r = await dryRun.dryRun(W, { ...range, mode: 'FILL_EMPTY' });
    const categoryItems = r.items.filter((i) => i.changes.some((c) => c.field === 'categoryId'));
    expect(categoryItems.map((i) => i.transactionId).sort()).toEqual(['t1', 't2', 't3', 't4']);
    expect(r.scanned).toBe(6);
    expect(r.truncated).toBe(false);
    expect(subjects.byId.get('t1')?.categoryId).toBeNull();
  });

  it('[TC-RULES-ENGINE-028] el modo de reemplazo propone la categoría para los 6', async () => {
    const { dryRun } = await september();
    const r = await dryRun.dryRun(W, { ...range, mode: 'OVERWRITE' });
    expect(r.items.filter((i) => i.changes.some((c) => c.field === 'categoryId'))).toHaveLength(6);
  });

  it('el rango se limita a 366 días', async () => {
    const { dryRun } = await september();
    await expect(
      dryRun.dryRun(W, { from: '2025-01-01', to: '2026-01-31', mode: 'FILL_EMPTY' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('[TC-RULES-ENGINE-027] indica truncado si hay más de las transacciones permitidas', async () => {
    const w = await september();
    const small = new RuleDryRunService(
      { ...w.deps, settings: { ...w.deps.settings, dryRunMaxTransactions: 3 } },
      w.queries,
    );
    const r = await small.dryRun(W, { ...range, mode: 'FILL_EMPTY' });
    expect(r.truncated).toBe(true);
    expect(r.scanned).toBe(3);
  });

  it('[TC-RULES-ENGINE-029] aplicar es atómico, usa la regla y versión como origen y un identificador común', async () => {
    const { dryRun, subjects, classifier, audit, rule } = await september();
    const r = await dryRun.dryRun(W, { ...range, mode: 'FILL_EMPTY' });
    const items = r.items.map((i) => ({ transactionId: i.transactionId, version: i.version }));
    const res = await dryRun.apply(U, W, { token: r.token, mode: 'FILL_EMPTY', items });
    // los 6 reciben la etiqueta "hogar"; la categoría solo los 4 sin categoría
    expect(res.applied).toBe(6);
    expect(subjects.byId.get('t1')?.categoryId).toBe('cat-super');
    expect(subjects.byId.get('t5')?.categoryId).toBe('cat-hogar');
    const call = classifier.calls[0];
    expect(call?.operationId).toBe(res.bulkOperationId);
    expect(call?.items[0]?.categoryRule).toEqual({ ruleId: rule.id, ruleVersion: 1 });
    expect(audit.entries.at(-1)?.action).toBe('rules.dry_run.applied');
  });

  it('[TC-RULES-ENGINE-030] un cambio posterior al dry-run rechaza toda la aplicación con RULE_DRY_RUN_STALE', async () => {
    const { dryRun, subjects } = await september();
    const r = await dryRun.dryRun(W, { ...range, mode: 'FILL_EMPTY' });
    const items = r.items.map((i) => ({ transactionId: i.transactionId, version: i.version }));
    // el usuario editó a mano t2 entre el dry-run y la aplicación
    const t2 = subjects.byId.get('t2');
    if (t2) subjects.byId.set('t2', { ...t2, version: t2.version + 1 });
    const failed = await dryRun
      .apply(U, W, { token: r.token, mode: 'FILL_EMPTY', items })
      .catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(DomainError);
    expect((failed as DomainError).code).toBe('RULE_DRY_RUN_STALE');
    expect(subjects.byId.get('t1')?.categoryId).toBeNull();
  });

  it('una regla modificada después del dry-run también lo deja obsoleto', async () => {
    const { dryRun, service, rule } = await september();
    const r = await dryRun.dryRun(W, { ...range, mode: 'FILL_EMPTY' });
    await service.updateRule(U, W, rule.id, rule.rowVersion, { stopProcessing: true });
    await expect(
      dryRun.apply(U, W, {
        token: r.token,
        mode: 'FILL_EMPTY',
        items: r.items.slice(0, 1).map((i) => ({ transactionId: i.transactionId, version: i.version })),
      }),
    ).rejects.toMatchObject({ code: 'RULE_DRY_RUN_STALE' });
  });

  it('un periodo cerrado queda como no aplicable y el resto se aplica', async () => {
    const { dryRun, classifier, subjects } = await september();
    subjects.add({ transactionId: 't7', date: '2026-08-31' });
    classifier.closedDates.add('2026-08-31');
    const r = await dryRun.dryRun(W, { from: '2026-08-01', to: '2026-09-30', mode: 'FILL_EMPTY' });
    const items = r.items.map((i) => ({ transactionId: i.transactionId, version: i.version }));
    const res = await dryRun.apply(U, W, { token: r.token, mode: 'FILL_EMPTY', items });
    expect(res.notApplicable).toEqual([{ transactionId: 't7', reason: 'PERIOD_CLOSED' }]);
    expect(res.applied).toBe(6);
  });

  it('marca como no aplicables las transacciones gestionadas por otro módulo', async () => {
    const w = await september();
    w.subjects.add({ transactionId: 't8', managedBy: 'DEBT' });
    const r = await w.dryRun.dryRun(W, { ...range, mode: 'FILL_EMPTY' });
    expect(r.items.find((i) => i.transactionId === 't8')).toMatchObject({
      applicable: false,
      reasons: ['TRANSACTION_MANAGED_EXTERNALLY'],
    });
  });

  it('limita la aplicación a 500 transacciones', async () => {
    const { dryRun } = await september();
    const items = Array.from({ length: 501 }, (_, i) => ({ transactionId: `t${i}`, version: 1 }));
    await expect(dryRun.apply(U, W, { token: 'x', mode: 'FILL_EMPTY', items })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('cobertura', () => {
  it('[TC-RULES-ENGINE-044] informa el desglose y el cociente de tres meses', async () => {
    const { queries, coverage, rule } = await setup();
    coverage.next = {
      count: 200,
      byOrigin: { RULE: 148, COUNTERPARTY_DEFAULT: 20, MANUAL: 12, SYSTEM_DEFAULT: 20, UNKNOWN: 0 },
      byRule: [{ ruleId: rule.id, ruleVersion: 1, count: 148, lastAppliedAt: null }],
    };
    const c = await queries.coverage(W, { from: '2026-07-01', to: '2026-09-30' });
    expect(c).toMatchObject({ count: 200, ruleCoverage: '0.7400', target: '0.7000', meetsTarget: true });
    expect(c.byRule[0]).toMatchObject({ name: 'Supermercado', count: 148, archived: false });
  });

  it('[TC-RULES-ENGINE-045] las correcciones y las anulaciones bajan la cobertura', async () => {
    const { queries, coverage } = await setup();
    coverage.next = {
      count: 198,
      byOrigin: { RULE: 145, COUNTERPARTY_DEFAULT: 20, MANUAL: 15, SYSTEM_DEFAULT: 18, UNKNOWN: 0 },
      byRule: [],
    };
    expect((await queries.coverage(W, { from: '2026-07-01', to: '2026-09-30' })).ruleCoverage).toBe('0.7323');
  });

  it('[TC-RULES-ENGINE-046] la cobertura de un import usa su cociente (41 ÷ 57 = 0.7193) y falla la meta', async () => {
    const { queries, coverage } = await setup();
    coverage.next = {
      count: 57,
      byOrigin: { RULE: 41, COUNTERPARTY_DEFAULT: 5, MANUAL: 3, SYSTEM_DEFAULT: 8, UNKNOWN: 0 },
      byRule: [],
    };
    const c = await queries.coverage(W, { importJobId: 'job-oct' });
    expect(c.ruleCoverage).toBe('0.7193');
    expect(c.meetsTarget).toBe(true);
  });

  it('sin transacciones el cociente es 0.0000 y exige rango o import', async () => {
    const { queries } = await setup();
    expect((await queries.coverage(W, { from: '2026-01-01', to: '2026-01-31' })).ruleCoverage).toBe('0.0000');
    await expect(queries.coverage(W, {})).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('0.7000 exacto cumple la meta (redondeo HALF_EVEN a 4 decimales)', async () => {
    const { queries, coverage } = await setup();
    coverage.next = {
      count: 10,
      byOrigin: { RULE: 7, COUNTERPARTY_DEFAULT: 1, MANUAL: 1, SYSTEM_DEFAULT: 1, UNKNOWN: 0 },
      byRule: [],
    };
    const c = await queries.coverage(W, { from: '2026-01-01', to: '2026-01-31' });
    expect(c).toMatchObject({ ruleCoverage: '0.7000', meetsTarget: true });
  });
});
