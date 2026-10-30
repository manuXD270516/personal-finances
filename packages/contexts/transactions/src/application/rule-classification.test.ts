import { DomainError } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IMPORT_ROW_NAMESPACE, type ImportedClassificationDto } from '../contracts/index.js';
import { BulkEditService } from './bulk-edit.service.js';
import type { ImportedRefReader, RuleSuggestion, RuleSuggestionPort } from './ports/index.js';
import { RecordImportedTransactions } from './record-imported-transactions.js';
import { inMemoryTransactionsDeps, type FakeCustomField } from './testing/in-memory.js';
import { TransactionsService, type RecordTransactionCommand } from './transactions.service.js';

const WS = 'ws-1';
const USER = 'user-1';
const BANK = 'bank-a';
const SUPER = 'supermercado';
const HOGAR = 'hogar';
const RULE = { ruleId: 'rule-super', ruleVersion: 1 };
const bob = (amount: string) => ({ amount, currency: 'BOB' });

const noRefs: ImportedRefReader = {
  async lockAccount() {},
  async existingByRefs() {
    return new Map();
  },
};

function setup(suggest?: RuleSuggestionPort['suggest']) {
  const mem = inMemoryTransactionsDeps({
    accounts: [{ accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' }],
  });
  const field: FakeCustomField = {
    fieldId: 'f-proyecto',
    key: 'proyecto',
    dataType: 'SELECT',
    target: 'TRANSACTION',
    options: ['casa'],
  };
  mem.state.customFields.push(field);
  const deps = suggest ? { ...mem.deps, ruleSuggestions: { suggest } } : mem.deps;
  const service = new TransactionsService(deps);
  return {
    ...mem,
    service,
    bulk: new BulkEditService(deps, service),
    imported: new RecordImportedTransactions(deps, noRefs),
  };
}
type Ctx = ReturnType<typeof setup>;

const row = (n: number, over: Record<string, unknown> = {}) => ({
  rowRef: `row-${n}`,
  date: '2026-10-02',
  direction: 'OUT' as const,
  amount: bob('185.40'),
  description: 'HIPERMAXI SUC 12',
  externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: `fp-${n}` },
  ...over,
});
const classification = (over: Partial<ImportedClassificationDto> = {}): ImportedClassificationDto => ({
  categoryId: SUPER,
  categoryOrigin: 'RULE',
  categoryRule: RULE,
  counterpartyId: null,
  tagIds: [],
  customFields: [],
  needsReview: null,
  ruleRefs: [],
  ...over,
});
const batch = (rows: ReturnType<typeof row>[]) => ({
  workspaceId: WS,
  accountId: BANK,
  importJobId: 'job-1',
  actorUserId: USER,
  rows,
});

const expense = (over: Partial<RecordTransactionCommand> = {}): RecordTransactionCommand => ({
  workspaceId: WS,
  userId: USER,
  kind: 'EXPENSE',
  transactionDate: '2026-10-02',
  accountId: BANK,
  amount: bob('100.00'),
  description: 'Tigo recarga',
  ...over,
});

async function failure(p: Promise<unknown>): Promise<DomainError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('expected a DomainError');
}

const suggestion = (over: Partial<RuleSuggestion> = {}): RuleSuggestion => ({
  category: null,
  counterparty: null,
  addTags: [],
  customFields: [],
  description: null,
  appendNotes: [],
  markForReview: null,
  ...over,
});

describe('origen de la clasificación en la importación por lote', () => {
  it('[TC-RULES-ENGINE-055] cada split registra su origen y el saldo baja exactamente 545.40 BOB', async () => {
    const ctx = setup();
    const result = await ctx.imported.recordBatch({
      ...batch([]),
      rows: [
        {
          ...row(1, { amount: bob('185.40') }),
          classification: classification({
            tagIds: ['tag-hogar'],
            ruleRefs: [{ field: 'TAG:tag-hogar', ...RULE }],
          }),
        },
        {
          ...row(2, { amount: bob('60.00'), description: 'FARMACORP' }),
          classification: classification({
            categoryId: HOGAR,
            categoryOrigin: 'COUNTERPARTY_DEFAULT',
            categoryRule: null,
            counterpartyId: 'cp-farmacorp',
          }),
        },
        { ...row(3, { amount: bob('300.00'), description: 'TRANSF 99812' }) },
      ],
    });
    const [a, b, c] = result.created.map((r) => ctx.state.txs.get(r.transactionId)!);
    expect(a?.splits[0]).toMatchObject({ categoryOrigin: 'RULE', categoryRule: RULE, tagIds: ['tag-hogar'] });
    expect(a?.splits[0]?.ruleRefs).toEqual([{ field: 'TAG:tag-hogar', ...RULE }]);
    expect(b?.splits[0]).toMatchObject({ categoryOrigin: 'COUNTERPARTY_DEFAULT', categoryRule: null });
    expect(b?.counterpartyId).toBe('cp-farmacorp');
    expect(c?.splits[0]).toMatchObject({ categoryOrigin: 'SYSTEM_DEFAULT', categoryId: 'cat-uncategorized' });
    // 4000.00 de saldo previo inexistente en memoria: el saldo es −545.40 (185.40 + 60.00 + 300.00)
    expect(ctx.balanceOf(BANK)).toBe('-545.40');
  });

  it('el audit de la creación lista la regla y versión por campo; y el origen nunca toca el ledger', async () => {
    const ctx = setup();
    await ctx.imported.recordBatch({
      ...batch([]),
      rows: [
        {
          ...row(1),
          classification: classification({
            tagIds: ['tag-hogar'],
            ruleRefs: [{ field: 'TAG:tag-hogar', ...RULE }],
          }),
        },
      ],
    });
    const audit = ctx.state.audit.find((a) => a.action === 'transactions.transaction.created');
    const field = (name: string) => audit?.changes?.find((c) => c.field === name)?.after;
    expect(field('categoryOrigin')).toBe('RULE');
    expect(field('categoryRuleId')).toBe('rule-super');
    expect(field('categoryRuleVersion')).toBe(1);
    expect(JSON.parse(field('ruleRefs') as string)).toEqual([{ field: 'TAG:tag-hogar', ...RULE }]);
  });

  it('valida las referencias una vez por lote con los códigos de Classification', async () => {
    const ctx = setup();
    const withClass = (c: ImportedClassificationDto) => ({
      ...batch([]),
      rows: [{ ...row(1), classification: c }],
    });
    expect(
      (await failure(ctx.imported.recordBatch(withClass(classification({ categoryId: 'archived' }))))).code,
    ).toBe('CATEGORY_ARCHIVED');
    expect(
      (await failure(ctx.imported.recordBatch(withClass(classification({ tagIds: ['archived-tag'] }))))).code,
    ).toBe('TAG_ARCHIVED');
    expect(
      (await failure(ctx.imported.recordBatch(withClass(classification({ counterpartyId: 'archived-cp' })))))
        .code,
    ).toBe('COUNTERPARTY_ARCHIVED');
    expect(
      (await failure(ctx.imported.recordBatch(withClass(classification({ categoryId: null }))))).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (
        await failure(
          ctx.imported.recordBatch(withClass(classification({ categoryOrigin: 'RULE', categoryRule: null }))),
        )
      ).code,
    ).toBe('VALIDATION_FAILED');
    expect(ctx.state.txs.size).toBe(0);
  });

  it('[TC-RULES-ENGINE-032] una corrección del usuario en la vista previa llega con origen MANUAL', async () => {
    const ctx = setup();
    const res = await ctx.imported.recordBatch({
      ...batch([]),
      rows: [
        {
          ...row(1),
          classification: classification({
            categoryId: 'internet',
            categoryOrigin: 'MANUAL',
            categoryRule: null,
          }),
        },
      ],
    });
    const tx = ctx.state.txs.get(res.created[0]!.transactionId);
    expect(tx?.splits[0]).toMatchObject({ categoryOrigin: 'MANUAL', categoryRule: null });
  });

  it('sin clasificación se comporta como en Phase 3: «sin categoría» con origen SYSTEM_DEFAULT', async () => {
    const ctx = setup();
    const res = await ctx.imported.recordBatch(batch([row(1)]));
    expect(ctx.state.txs.get(res.created[0]!.transactionId)?.splits[0]).toMatchObject({
      categoryId: 'cat-uncategorized',
      categoryOrigin: 'SYSTEM_DEFAULT',
    });
  });

  it('la marca de revisión, la descripción visible, las notas y los campos viajan con la fila', async () => {
    const ctx = setup();
    const res = await ctx.imported.recordBatch({
      ...batch([]),
      rows: [
        {
          ...row(1, { description: 'DEB AUT NFLX.COM 0412' }),
          classification: classification({
            categoryId: SUPER,
            description: 'Netflix',
            notes: 'revisar',
            needsReview: RULE,
            customFields: [{ fieldId: 'f-proyecto', value: 'casa' }],
            ruleRefs: [
              { field: 'DESCRIPTION', ...RULE },
              { field: 'CUSTOM_FIELD:f-proyecto', ...RULE },
            ],
          }),
        },
      ],
    });
    const tx = ctx.state.txs.get(res.created[0]!.transactionId);
    expect(tx).toMatchObject({ description: 'Netflix', notes: 'revisar' });
    expect(tx?.review).toMatchObject({ reason: 'RULE', ruleId: 'rule-super', ruleVersion: 1 });
    expect(tx?.splits[0]?.customFields.map((f) => [f.key, f.value])).toEqual([['proyecto', 'casa']]);
  });

  it('[TC-RULES-ENGINE-033] equivalencia: el lote y el registro individual dan el mismo resultado observable', async () => {
    const full = classification({
      tagIds: ['tag-hogar'],
      counterpartyId: 'cp-hipermaxi',
      description: 'Hipermaxi',
      notes: 'nota',
      needsReview: RULE,
      customFields: [{ fieldId: 'f-proyecto', value: 'casa' }],
      ruleRefs: [
        { field: 'TAG:tag-hogar', ...RULE },
        { field: 'COUNTERPARTY', ...RULE },
      ],
    });
    const a = setup();
    await a.imported.recordBatch({ ...batch([]), rows: [{ ...row(1), classification: full }] });
    const b = setup();
    await b.service.recordTransaction({
      workspaceId: WS,
      userId: USER,
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-10-02',
      accountId: BANK,
      amount: bob('185.40'),
      description: 'Hipermaxi',
      notes: 'nota',
      counterpartyId: 'cp-hipermaxi',
      source: 'IMPORT',
      externalRef: { namespace: IMPORT_ROW_NAMESPACE, id: 'fp-1' },
      importJobId: 'job-1',
      review: { reason: 'RULE', rule: RULE, at: '2026-10-20T14:00:00.000Z' },
      splits: [
        {
          amount: bob('185.40'),
          categoryId: SUPER,
          tagIds: ['tag-hogar'],
          customFields: [{ fieldId: 'f-proyecto', value: 'casa' }],
          categoryOrigin: 'RULE',
          categoryRule: RULE,
          ruleRefs: [
            { field: 'TAG:tag-hogar', ...RULE },
            { field: 'COUNTERPARTY', ...RULE },
          ],
        },
      ],
    });
    const norm = (c: Ctx) =>
      JSON.stringify(
        [...c.state.txs.values()].map((t) => ({
          description: t.description,
          notes: t.notes,
          counterpartyId: t.counterpartyId,
          review: t.review ? { ...t.review, markedAt: 'x' } : null,
          splits: t.splits.map((s) => ({
            categoryId: s.categoryId,
            tagIds: s.tagIds,
            origin: s.categoryOrigin,
            rule: s.categoryRule,
            refs: s.ruleRefs,
            fields: s.customFields.map((f) => [f.key, f.value]),
          })),
        })),
      );
    expect(norm(a)).toBe(norm(b));
    expect(a.balanceOf(BANK)).toBe(b.balanceOf(BANK));
    // Los identificadores se reemplazan por su orden de aparición (como en la equivalencia de IMPORTS).
    const auditOf = (c: Ctx) => {
      const tokens = new Map<string, string>();
      return JSON.stringify(c.state.audit.map((x) => [x.action, x.changes])).replace(
        /0192f3c4-0000-7000-9000-[0-9a-f]{12}/g,
        (id) => tokens.get(id) ?? (tokens.set(id, `#${tokens.size}`), `#${tokens.size - 1}`),
      );
    };
    expect(auditOf(a)).toBe(auditOf(b));
  });
});

describe('equivalencia por lote con clasificación (PBT)', () => {
  interface Generated {
    origin: 'RULE' | 'MANUAL' | 'COUNTERPARTY_DEFAULT' | 'SYSTEM_DEFAULT';
    tags: string[];
    counterparty: string | null;
    notes: string | undefined;
    review: boolean;
  }
  const classArb: fc.Arbitrary<Generated | undefined> = fc.option(
    fc.record({
      origin: fc.constantFrom<'RULE' | 'MANUAL' | 'COUNTERPARTY_DEFAULT' | 'SYSTEM_DEFAULT'>(
        'RULE',
        'MANUAL',
        'COUNTERPARTY_DEFAULT',
        'SYSTEM_DEFAULT',
      ),
      tags: fc.subarray(['tag-a', 'tag-b', 'tag-c']),
      counterparty: fc.option(fc.constantFrom('cp-1', 'cp-2'), { nil: null }),
      notes: fc.option(fc.constantFrom('uno', 'dos'), { nil: undefined }),
      review: fc.boolean(),
    }),
    { nil: undefined },
  );

  const toDto = (g: Generated): ImportedClassificationDto => ({
    categoryId: g.origin === 'SYSTEM_DEFAULT' ? null : SUPER,
    categoryOrigin: g.origin,
    categoryRule: g.origin === 'RULE' ? RULE : null,
    counterpartyId: g.counterparty,
    tagIds: g.tags,
    customFields: [],
    ...(g.notes ? { notes: g.notes } : {}),
    needsReview: g.review ? RULE : null,
    ruleRefs: g.tags.map((t) => ({ field: `TAG:${t}`, ...RULE })),
  });

  it('[TC-RULES-ENGINE-033] (PBT) cualquier lote clasificado da el mismo resultado por el lote y de a una', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(classArb, { minLength: 1, maxLength: 12 }), async (generated) => {
        const rows = generated.map((g, i) => ({
          ...row(i),
          ...(g ? { classification: toDto(g) } : {}),
        }));
        const a = setup();
        const b = setup();
        await a.imported.recordBatch({ ...batch([]), rows });
        for (const r of rows) {
          const c = r.classification;
          await b.service.recordTransaction({
            workspaceId: WS,
            userId: USER,
            kind: 'EXPENSE',
            status: 'POSTED',
            transactionDate: r.date,
            accountId: BANK,
            amount: r.amount,
            description: r.description,
            source: 'IMPORT',
            externalRef: r.externalRef,
            importJobId: 'job-1',
            ...(c
              ? {
                  counterpartyId: c.counterpartyId,
                  ...(c.notes ? { notes: c.notes } : {}),
                  ...(c.needsReview
                    ? { review: { reason: 'RULE' as const, rule: c.needsReview, at: 'x' } }
                    : {}),
                  splits: [
                    {
                      amount: r.amount,
                      categoryId: c.categoryId ?? 'cat-uncategorized',
                      tagIds: c.tagIds,
                      categoryOrigin: c.categoryOrigin,
                      categoryRule: c.categoryRule ?? null,
                      ruleRefs: c.ruleRefs,
                    },
                  ],
                }
              : {}),
          });
        }
        const norm = (ctx: Ctx) =>
          JSON.stringify(
            [...ctx.state.txs.values()].map((t) => ({
              notes: t.notes,
              counterpartyId: t.counterpartyId,
              review: t.review ? { ...t.review, markedAt: 'x' } : null,
              splits: t.splits.map((x) => [
                x.categoryId,
                x.tagIds,
                x.categoryOrigin,
                x.categoryRule,
                x.ruleRefs,
              ]),
            })),
          );
        expect(norm(a)).toBe(norm(b));
        expect(a.balanceOf(BANK)).toBe(b.balanceOf(BANK));
      }),
      { numRuns: 40 },
    );
  }, 60_000);
});

describe('creación manual con reglas (RuleSuggestionPort)', () => {
  it('[TC-RULES-ENGINE-034] completa la categoría vacía con origen en la regla', async () => {
    const ctx = setup(async () => suggestion({ category: { categoryId: 'telefonia', origin: RULE } }));
    const { transaction } = await ctx.service.recordTransaction(expense());
    expect(transaction.splits[0]).toMatchObject({
      categoryId: 'telefonia',
      categoryOrigin: 'RULE',
      categoryRule: RULE,
    });
  });

  it('[TC-RULES-ENGINE-035] no reemplaza la categoría elegida por el usuario (origen MANUAL)', async () => {
    let received: unknown;
    const ctx = setup(async (input) => {
      received = input.subject;
      return null;
    });
    const { transaction } = await ctx.service.recordTransaction(
      expense({ splits: [{ amount: bob('100.00'), categoryId: 'regalos' }] }),
    );
    expect(transaction.splits[0]).toMatchObject({ categoryId: 'regalos', categoryOrigin: 'MANUAL' });
    expect(received).toMatchObject({ categoryId: 'regalos', kind: 'EXPENSE' });
  });

  it('[TC-RULES-ENGINE-036] applyRules false no consulta las reglas y deja «sin categoría» sin regla', async () => {
    let calls = 0;
    const ctx = setup(async () => {
      calls += 1;
      return suggestion({ category: { categoryId: 'telefonia', origin: RULE } });
    });
    const { transaction } = await ctx.service.recordTransaction(expense({ applyRules: false }));
    expect(calls).toBe(0);
    expect(transaction.splits[0]).toMatchObject({
      categoryId: 'cat-uncategorized',
      categoryOrigin: 'SYSTEM_DEFAULT',
    });
  });

  it('solo aplica a ingresos, gastos y reembolsos manuales', async () => {
    let calls = 0;
    const ctx = setup(async () => {
      calls += 1;
      return null;
    });
    await ctx.service.recordTransaction(expense({ source: 'RECURRING' }));
    await ctx.service.recordTransaction({
      workspaceId: WS,
      userId: USER,
      kind: 'ADJUSTMENT',
      direction: 'INCREASE',
      reason: 'ajuste',
      transactionDate: '2026-10-02',
      accountId: BANK,
      amount: bob('5.00'),
    });
    expect(calls).toBe(0);
  });

  it('agrega etiquetas, contraparte vacía, notas y marca la revisión con la regla como motivo', async () => {
    const ctx = setup(async () =>
      suggestion({
        counterparty: { counterpartyId: 'cp-tigo', origin: RULE },
        addTags: [{ tagId: 'tag-hogar', origin: RULE }],
        appendNotes: [{ text: 'revisar', origin: RULE }],
        markForReview: RULE,
      }),
    );
    const { transaction } = await ctx.service.recordTransaction(expense());
    expect(transaction).toMatchObject({ counterpartyId: 'cp-tigo', notes: 'revisar' });
    expect(transaction.splits[0]).toMatchObject({ categoryOrigin: 'SYSTEM_DEFAULT', tagIds: ['tag-hogar'] });
    expect(transaction.splits[0]?.ruleRefs?.map((r) => r.field).sort()).toEqual([
      'COUNTERPARTY',
      'NOTES',
      'TAG:tag-hogar',
    ]);
    expect(transaction.review).toMatchObject({ reason: 'RULE', ruleId: 'rule-super' });
  });
});

describe('aplicación del dry-run (applyBatch) y origen manual', () => {
  async function seeded(ctx: Ctx) {
    const { transaction } = await ctx.service.recordTransaction(
      expense({ description: 'HIPERMAXI', amount: bob('185.40'), applyRules: false }),
    );
    return transaction;
  }

  it('[TC-RULES-ENGINE-018] recategorizar por regla no cambia saldos ni crea asientos', async () => {
    const ctx = setup();
    const tx = await seeded(ctx);
    const balance = ctx.balanceOf(BANK);
    const entries = ctx.state.entries.length;
    const res = await ctx.bulk.applyBatch({
      workspaceId: WS,
      actorUserId: USER,
      operationId: 'op-1',
      items: [
        {
          transactionId: tx.id,
          expectedVersion: tx.version,
          changes: { categoryId: SUPER, addTagIds: ['tag-hogar'] },
          categoryRule: RULE,
          ruleRefs: [{ field: 'TAG:tag-hogar', ...RULE }],
        },
      ],
    });
    expect(res.applied).toEqual([tx.id]);
    const after = ctx.state.txs.get(tx.id)!;
    expect(after.splits[0]).toMatchObject({ categoryId: SUPER, categoryOrigin: 'RULE', categoryRule: RULE });
    expect(after.version).toBe(tx.version + 1);
    expect(ctx.balanceOf(BANK)).toBe(balance);
    expect(ctx.state.entries.length).toBe(entries);
    const audit = ctx.state.audit.filter((a) => a.correlationId === 'op-1');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.origin).toBe('rule');
    const categorized = ctx.state.outbox.find((e) => e.eventType === 'transactions.TransactionCategorized');
    expect(categorized?.payload).toMatchObject({
      appliedBy: 'RULE',
      ruleId: 'rule-super',
      bulkOperationId: 'op-1',
    });
  });

  it('[TC-RULES-ENGINE-029] una versión distinta rechaza todo con CONCURRENCY_CONFLICT sin escribir nada', async () => {
    const ctx = setup();
    const a = await seeded(ctx);
    const b = await seeded(ctx);
    const err = await failure(
      ctx.bulk.applyBatch({
        workspaceId: WS,
        actorUserId: USER,
        operationId: 'op-2',
        items: [
          {
            transactionId: a.id,
            expectedVersion: a.version,
            changes: { categoryId: SUPER },
            categoryRule: RULE,
            ruleRefs: [],
          },
          {
            transactionId: b.id,
            expectedVersion: b.version + 5,
            changes: { categoryId: SUPER },
            categoryRule: RULE,
            ruleRefs: [],
          },
        ],
      }),
    );
    expect(err.code).toBe('CONCURRENCY_CONFLICT');
    expect(ctx.state.txs.get(a.id)?.splits[0]?.categoryId).toBe('cat-uncategorized');
  });

  it('un periodo cerrado queda no aplicable y el resto se aplica', async () => {
    const ctx = setup();
    const open = await seeded(ctx);
    const closed = (
      await ctx.service.recordTransaction(expense({ transactionDate: '2026-08-15', applyRules: false }))
    ).transaction;
    ctx.state.closedMonths.add('2026-08');
    const res = await ctx.bulk.applyBatch({
      workspaceId: WS,
      actorUserId: USER,
      operationId: 'op-3',
      items: [open, closed].map((t) => ({
        transactionId: t.id,
        expectedVersion: t.version,
        changes: { categoryId: SUPER },
        categoryRule: RULE,
        ruleRefs: [],
      })),
    });
    expect(res.applied).toEqual([open.id]);
    expect(res.notApplicable).toEqual([{ transactionId: closed.id, reason: 'PERIOD_CLOSED' }]);
  });

  it('la descripción y la nota no se aplican en periodos cerrados solo por clasificar: se permiten (D65)', async () => {
    const ctx = setup();
    const closed = (
      await ctx.service.recordTransaction(expense({ transactionDate: '2026-08-15', applyRules: false }))
    ).transaction;
    ctx.state.closedMonths.add('2026-08');
    const res = await ctx.bulk.applyBatch({
      workspaceId: WS,
      actorUserId: USER,
      operationId: 'op-4',
      items: [
        {
          transactionId: closed.id,
          expectedVersion: closed.version,
          changes: { description: 'Netflix', appendNotes: ['nota'], markForReview: true },
          ruleRefs: [{ field: 'DESCRIPTION', ...RULE }],
          reviewRule: RULE,
        },
      ],
    });
    expect(res.applied).toEqual([closed.id]);
    expect(ctx.state.txs.get(closed.id)).toMatchObject({ description: 'Netflix', notes: 'nota' });
  });

  it('[TC-RULES-ENGINE-056] la edición masiva posterior deja el origen MANUAL sin regla', async () => {
    const ctx = setup();
    const tx = await seeded(ctx);
    await ctx.bulk.applyBatch({
      workspaceId: WS,
      actorUserId: USER,
      operationId: 'op-5',
      items: [
        {
          transactionId: tx.id,
          expectedVersion: tx.version,
          changes: { categoryId: SUPER },
          categoryRule: RULE,
          ruleRefs: [],
        },
      ],
    });
    const v = ctx.state.txs.get(tx.id)!.version;
    await ctx.bulk.bulkEdit({
      workspaceId: WS,
      userId: USER,
      items: [{ id: tx.id, version: v }],
      changes: { categoryId: HOGAR },
    });
    expect(ctx.state.txs.get(tx.id)!.splits[0]).toMatchObject({
      categoryId: HOGAR,
      categoryOrigin: 'MANUAL',
      categoryRule: null,
    });
  });

  it('[TC-RULES-ENGINE-038] la corrección manual de la categoría conserva el origen de la etiqueta y audita el anterior', async () => {
    const ctx = setup();
    const tx = await seeded(ctx);
    await ctx.bulk.applyBatch({
      workspaceId: WS,
      actorUserId: USER,
      operationId: 'op-6',
      items: [
        {
          transactionId: tx.id,
          expectedVersion: tx.version,
          changes: { categoryId: SUPER, addTagIds: ['tag-hogar'] },
          categoryRule: RULE,
          ruleRefs: [{ field: 'TAG:tag-hogar', ...RULE }],
        },
      ],
    });
    const current = ctx.state.txs.get(tx.id)!;
    await ctx.service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: current.version,
      splits: [{ amount: bob('185.40'), categoryId: HOGAR, tagIds: ['tag-hogar'] }],
    });
    const after = ctx.state.txs.get(tx.id)!;
    expect(after.splits[0]).toMatchObject({ categoryOrigin: 'MANUAL', categoryRule: null });
    expect(after.splits[0]?.ruleRefs).toEqual([{ field: 'TAG:tag-hogar', ...RULE }]);
    const audit = ctx.state.audit.at(-1);
    expect(audit?.changes?.find((c) => c.field === 'categoryOrigin')).toEqual({
      field: 'categoryOrigin',
      before: 'RULE',
      after: 'MANUAL',
    });
    expect(audit?.changes?.find((c) => c.field === 'categoryRuleId')).toEqual({
      field: 'categoryRuleId',
      before: 'rule-super',
      after: null,
    });
  });

  it('quitar una etiqueta a mano descarta su referencia de regla', async () => {
    const ctx = setup();
    const tx = await seeded(ctx);
    await ctx.bulk.applyBatch({
      workspaceId: WS,
      actorUserId: USER,
      operationId: 'op-7',
      items: [
        {
          transactionId: tx.id,
          expectedVersion: tx.version,
          changes: { addTagIds: ['tag-hogar'] },
          ruleRefs: [{ field: 'TAG:tag-hogar', ...RULE }],
        },
      ],
    });
    const current = ctx.state.txs.get(tx.id)!;
    await ctx.service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: current.version,
      splits: [{ amount: bob('185.40'), categoryId: current.splits[0]!.categoryId, tagIds: [] }],
    });
    expect(ctx.state.txs.get(tx.id)!.splits[0]?.ruleRefs).toEqual([]);
  });
});

describe('marca de revisión pendiente', () => {
  it('[TC-RULES-ENGINE-057] marcar y quitar la marca se audita sin tocar el ledger ni el estado', async () => {
    const ctx = setup();
    const { transaction: tx } = await ctx.service.recordTransaction(
      expense({ amount: bob('2450.00'), applyRules: false }),
    );
    const balance = ctx.balanceOf(BANK);
    const marked = await ctx.service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: tx.version,
      needsReview: true,
    });
    expect(marked.review).toMatchObject({ reason: 'USER', ruleId: null });
    const cleared = await ctx.service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: marked.version,
      needsReview: false,
    });
    expect(cleared.review ?? null).toBeNull();
    expect(cleared.status).toBe('POSTED');
    expect(ctx.balanceOf(BANK)).toBe(balance);
    const reviewAudits = ctx.state.audit.filter((a) => a.changes?.some((c) => c.field === 'needsReview'));
    expect(reviewAudits).toHaveLength(2);
  });

  it('marcar dos veces es idempotente (sin versión nueva)', async () => {
    const ctx = setup();
    const { transaction: tx } = await ctx.service.recordTransaction(expense({ applyRules: false }));
    const first = await ctx.service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: tx.version,
      needsReview: true,
    });
    const second = await ctx.service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: first.version,
      needsReview: true,
    });
    expect(second.version).toBe(first.version);
  });
});
