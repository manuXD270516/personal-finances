import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FinancialPeriodStatus } from '../domain/index.js';
import {
  ALQ,
  REST,
  SUPER,
  W,
  alquiler,
  cat,
  money,
  restaurantes,
  salario,
  setupTemplates,
  supermercado,
} from './testing/template-fixtures.js';

const reject = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
interface LineLike {
  id: string;
  version: number;
  planned: { amount: string; currency: string } | null;
  overridden: boolean;
}
const lineOf = (lines: readonly { target: { id: string } }[], categoryId: string): LineLike =>
  lines.find((l) => l.target.id === categoryId) as unknown as LineLike;

/** "Mes estándar" v1 (con Restaurantes 600.00) y v2 (Supermercado 1600.00); planes de 2026-11, 2026-12 y 2027-01. */
async function propagationScenario() {
  const ctx = setupTemplates();
  const t = await ctx.templates.createTemplate({
    workspaceId: W,
    name: 'Mes estándar',
    lines: [alquiler(), supermercado(), salario(), restaurantes('600.00')],
  });
  await ctx.templates.publishVersion({
    workspaceId: W,
    templateId: t.id,
    baseVersionNo: 1,
    lines: [alquiler(), supermercado('1600.00'), salario(), restaurantes('600.00')],
  });
  const plan = (periodId: string) =>
    ctx.budgets.createBudget({ workspaceId: W, periodId, source: { kind: 'TEMPLATE', templateId: t.id } });
  const nov = await plan(ctx.periods.nov.id);
  const dec = await plan(ctx.periods.dec.id);
  const jan = await plan(ctx.periods.jan.id);
  return { ctx, templateId: t.id, nov, dec, jan };
}
type Scenario = Awaited<ReturnType<typeof propagationScenario>>;

async function edit(
  s: Scenario,
  budget: { id: string; lines: readonly { id: string; target: { id: string } }[] },
  categoryId: string,
  amount: string,
) {
  const line = lineOf(budget.lines, categoryId);
  return s.ctx.budgets.updateLine({
    workspaceId: W,
    budgetId: budget.id,
    lineId: line.id,
    expectedVersion: line.version,
    patch: { planned: money(amount) },
  });
}

/** TC-PLANNING-TEMPLATE-015: propagar "Restaurantes" 650.00 desde el plan activo de 2026-11. */
async function previewFromNov(s: Scenario) {
  // el plan de 2026-11 (activo) ajusta Restaurantes a 650.00; 2027-01 lo tiene modificado a mano en 700.00
  const nov = await s.ctx.queries.getBudget(W, s.nov.id);
  const novRest = await edit(s, nov, REST, '650.00');
  await edit(s, await s.ctx.queries.getBudget(W, s.jan.id), REST, '700.00');
  const source = { kind: 'BUDGET', budgetId: s.nov.id, lineIds: [novRest.id] };
  return { source, preview: await s.ctx.propagation.preview({ workspaceId: W, source }) };
}

describe('Propagación a meses futuros (planning/budget-templates)', () => {
  it('[TC-PLANNING-TEMPLATE-015] la vista previa lista 2026-12 y marca 2027-01 como conflicto; al confirmar crea la versión 3', async () => {
    const s = await propagationScenario();
    const { source, preview } = await previewFromNov(s);
    expect(preview.baseVersionNo).toBe(2);
    expect(preview.periods.map((p) => p.periodLabel)).toEqual(['2026-12', '2027-01']);
    expect(preview.changes).toHaveLength(1);
    expect(preview.changes[0]).toMatchObject({
      periodLabel: '2026-12',
      action: 'UPDATE',
      target: cat(REST),
      from: { planned: money('600.00') },
      to: { planned: money('650.00') },
    });
    expect(preview.conflicts).toEqual([
      expect.objectContaining({ periodLabel: '2027-01', reason: 'OVERRIDDEN', target: cat(REST) }),
    ]);
    expect(preview.newVersionPreview).toMatchObject({ versionNo: 3, updated: 1, added: 0, removed: 0 });
    // la vista previa no persiste nada
    expect((await s.ctx.templateQueries.get(W, s.templateId)).currentVersionNo).toBe(2);

    const result = await s.ctx.propagation.confirm({ workspaceId: W, source, token: preview.token });
    expect(result.template.currentVersionNo).toBe(3);
    expect(result.applied.map((a) => [a.periodLabel, a.changes, a.conflicts])).toEqual([
      ['2026-12', 1, 0],
      ['2027-01', 0, 1],
    ]);
    const dec = await s.ctx.queries.getBudget(W, s.dec.id);
    const jan = await s.ctx.queries.getBudget(W, s.jan.id);
    expect(lineOf(dec.lines, REST)).toMatchObject({ planned: money('650.00'), overridden: false });
    expect(lineOf(jan.lines, REST)).toMatchObject({ planned: money('700.00'), overridden: true });
    expect(dec.templateVersion).toMatchObject({ versionNo: 3 });
    expect((await s.ctx.queries.getBudget(W, s.nov.id)).templateVersion).toMatchObject({ versionNo: 2 });
    expect(s.ctx.audits('planning.budget.propagated')).toHaveLength(2);
  });

  it('[TC-PLANNING-TEMPLATE-016] una edición entre la vista previa y la confirmación la rechaza con BUDGET_PROPAGATION_STALE sin cambios', async () => {
    const s = await propagationScenario();
    const { source, preview } = await previewFromNov(s);
    await edit(s, await s.ctx.queries.getBudget(W, s.dec.id), SUPER, '1650.00');
    await reject(
      s.ctx.propagation.confirm({ workspaceId: W, source, token: preview.token }),
      'BUDGET_PROPAGATION_STALE',
    );
    expect((await s.ctx.templateQueries.get(W, s.templateId)).currentVersionNo).toBe(2);
    expect(lineOf((await s.ctx.queries.getBudget(W, s.dec.id)).lines, REST).planned).toEqual(money('600.00'));
  });

  it('un token alterado o ausente se rechaza', async () => {
    const s = await propagationScenario();
    const { source } = await previewFromNov(s);
    await reject(
      s.ctx.propagation.confirm({ workspaceId: W, source, token: 'deadbeef' }),
      'BUDGET_PROPAGATION_STALE',
    );
    await reject(s.ctx.propagation.confirm({ workspaceId: W, source }), 'VALIDATION_FAILED');
  });

  it('propagar desde un plan sin template se rechaza con BUDGET_NO_TEMPLATE_ORIGIN (docs/33 D84)', async () => {
    const s = await propagationScenario();
    const empty = await s.ctx.budgets.createBudget({ workspaceId: W, periodId: s.ctx.periods.feb.id });
    const line = await s.ctx.budgets.addLine({
      workspaceId: W,
      budgetId: empty.id,
      target: cat(ALQ),
      spec: { kind: 'FIXED', planned: money('2800.00') },
    });
    await reject(
      s.ctx.propagation.preview({
        workspaceId: W,
        source: { kind: 'BUDGET', budgetId: empty.id, lineIds: [line.id] },
      }),
      'BUDGET_NO_TEMPLATE_ORIGIN',
    );
  });

  it('desde el template: las líneas quitadas se quitan solo de los planes donde no fueron editadas (docs/33 D85)', async () => {
    const s = await propagationScenario();
    await edit(s, await s.ctx.queries.getBudget(W, s.jan.id), REST, '700.00');
    const source = {
      kind: 'TEMPLATE',
      templateId: s.templateId,
      baseVersionNo: 2,
      lines: [alquiler(), supermercado('1600.00'), salario()],
    };
    const preview = await s.ctx.propagation.preview({ workspaceId: W, source });
    expect(preview.changes.map((c) => [c.periodLabel, c.action, c.target.id])).toEqual([
      ['2026-12', 'REMOVE', REST],
    ]);
    expect(preview.conflicts.map((c) => [c.periodLabel, c.action, c.reason])).toEqual([
      ['2027-01', 'REMOVE', 'OVERRIDDEN'],
    ]);
    await s.ctx.propagation.confirm({ workspaceId: W, source, token: preview.token });
    expect((await s.ctx.queries.getBudget(W, s.dec.id)).lines.map((l) => l.target.id)).not.toContain(REST);
    expect((await s.ctx.queries.getBudget(W, s.jan.id)).lines.map((l) => l.target.id)).toContain(REST);
  });

  it('desde el template: una línea agregada se agrega a los planes futuros salvo que choque con otra', async () => {
    const s = await propagationScenario();
    const source = {
      kind: 'TEMPLATE',
      templateId: s.templateId,
      baseVersionNo: 2,
      lines: [
        alquiler(),
        supermercado('1600.00'),
        salario(),
        restaurantes('600.00'),
        { target: cat('0190a000-0000-7000-8000-000000000010'), kind: 'MAXIMUM', planned: money('300.00') },
      ],
    };
    const preview = await s.ctx.propagation.preview({ workspaceId: W, source });
    expect(preview.changes.map((c) => [c.periodLabel, c.action])).toEqual([
      ['2026-12', 'ADD'],
      ['2027-01', 'ADD'],
    ]);
    await s.ctx.propagation.confirm({ workspaceId: W, source, token: preview.token });
    const dec = await s.ctx.queries.getBudget(W, s.dec.id);
    expect(lineOf(dec.lines, '0190a000-0000-7000-8000-000000000010')).toMatchObject({
      planned: money('300.00'),
      source: 'TEMPLATE',
      overridden: false,
    });
  });

  it('sin diferencias no hay nada que propagar', async () => {
    const s = await propagationScenario();
    const source = {
      kind: 'TEMPLATE',
      templateId: s.templateId,
      baseVersionNo: 2,
      lines: [alquiler(), supermercado('1600.00'), salario(), restaurantes('600.00')],
    };
    const preview = await s.ctx.propagation.preview({ workspaceId: W, source });
    expect(preview.changes).toEqual([]);
    await reject(
      s.ctx.propagation.confirm({ workspaceId: W, source, token: preview.token }),
      'VALIDATION_FAILED',
    );
  });

  it('[TC-PLANNING-TEMPLATE-017] solo alcanza planes de periodos en borrador posteriores a hoy', async () => {
    const ctx = setupTemplates();
    const t = await ctx.templates.createTemplate({
      workspaceId: W,
      name: 'Mes estándar',
      lines: [alquiler(), salario()],
    });
    const plan = (periodId: string) =>
      ctx.budgets.createBudget({ workspaceId: W, periodId, source: { kind: 'TEMPLATE', templateId: t.id } });
    ctx.env.mem.rows.set(ctx.periods.oct.id, { ...ctx.periods.oct, status: 'ACTIVE' });
    const oct = await plan(ctx.periods.oct.id);
    const nov = await plan(ctx.periods.nov.id);
    const dec = await plan(ctx.periods.dec.id);
    ctx.env.mem.rows.set(ctx.periods.oct.id, { ...ctx.periods.oct, status: 'CLOSED' });
    const source = {
      kind: 'TEMPLATE',
      templateId: t.id,
      baseVersionNo: 1,
      lines: [alquiler('2900.00'), salario()],
    };
    const preview = await ctx.propagation.preview({ workspaceId: W, source });
    expect(preview.changes.map((c) => c.periodLabel)).toEqual(['2026-12']);
    await ctx.propagation.confirm({ workspaceId: W, source, token: preview.token });
    const amount = async (id: string) =>
      lineOf((await ctx.queries.getBudget(W, id)).lines, ALQ).planned!.amount;
    expect(await amount(dec.id)).toBe('2900.00');
    expect(await amount(nov.id)).toBe('2800.00');
    expect(await amount(oct.id)).toBe('2800.00');
  });

  it('[TC-PLANNING-TEMPLATE-017] PBT: ninguna secuencia de propagaciones cambia un plan de periodo no borrador ni una línea modificada', async () => {
    const statuses: readonly FinancialPeriodStatus[] = ['DRAFT', 'ACTIVE', 'CLOSED', 'REOPENED'];
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          nov: fc.constantFrom(...statuses),
          dec: fc.constantFrom(...statuses),
          jan: fc.constantFrom(...statuses),
          feb: fc.constantFrom(...statuses),
          overridden: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
          amounts: fc.array(fc.integer({ min: 1000, max: 4000 }), { minLength: 1, maxLength: 5 }),
        }),
        async (input) => {
          const ctx = setupTemplates();
          const t = await ctx.templates.createTemplate({
            workspaceId: W,
            name: 'Mes estándar',
            lines: [alquiler(), salario()],
          });
          const labels = ['nov', 'dec', 'jan', 'feb'] as const;
          const budgets = new Map<string, string>();
          for (const [i, label] of labels.entries()) {
            const period = ctx.periods[label];
            const b = await ctx.budgets.createBudget({
              workspaceId: W,
              periodId: period.id,
              source: { kind: 'TEMPLATE', templateId: t.id },
            });
            if (input.overridden[i]) {
              await ctx.budgets.updateLine({
                workspaceId: W,
                budgetId: b.id,
                lineId: lineOf(b.lines, ALQ).id,
                expectedVersion: 1,
                patch: { planned: money('3333.00') },
              });
            }
            budgets.set(label, b.id);
            ctx.env.mem.rows.set(period.id, { ...period, status: input[label] });
          }
          const snapshot = async () => {
            const out: Record<string, string> = {};
            for (const label of labels) {
              out[label] = JSON.stringify(
                (await ctx.queries.getBudget(W, budgets.get(label)!)).lines.map((l) => [
                  l.target.id,
                  l.planned,
                  l.overridden,
                ]),
              );
            }
            return out;
          };
          const before = await snapshot();
          let version = 1;
          let current = '2800.00';
          for (const cents of input.amounts) {
            const amountText = `${cents}.00`;
            if (amountText === current) continue;
            const source = {
              kind: 'TEMPLATE',
              templateId: t.id,
              baseVersionNo: version,
              lines: [alquiler(amountText), salario()],
            };
            const preview = await ctx.propagation.preview({ workspaceId: W, source });
            await ctx.propagation.confirm({ workspaceId: W, source, token: preview.token });
            version += 1;
            current = amountText;
          }
          const after = await snapshot();
          for (const [i, label] of labels.entries()) {
            const reachable = label !== 'nov' && input[label] === 'DRAFT';
            if (!reachable) expect(after[label]).toBe(before[label]);
            else if (input.overridden[i]) expect(after[label]).toBe(before[label]);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});
