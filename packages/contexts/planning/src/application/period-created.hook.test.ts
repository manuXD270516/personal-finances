import { describe, expect, it } from 'vitest';
import { PeriodsService } from './periods.service.js';
import { W, SUPER, setupTemplates } from './testing/template-fixtures.js';

/** Escenario de la creación automática: hoy 2026-11-01, solo existe el periodo activo "2026-11". */
function scenario() {
  const ctx = setupTemplates('2026-11-01T15:00:00Z');
  ctx.env.mem.rows.clear();
  ctx.env.mem.seed(W, '2026-11', 'ACTIVE');
  const periods = new PeriodsService(ctx.env.mem.deps({ uow: ctx.env.uow, onPeriodCreated: [ctx.hook] }));
  const plans = () =>
    [...ctx.env.budgetRows.values()].map((r) => ({
      label: ctx.env.mem.rows.get(r.state.periodId)!.label,
      lines: r.lines.length,
    }));
  return { ...ctx, periods, plans };
}

describe('PeriodCreatedHook (planning/budget-templates: predeterminado en periodos nuevos)', () => {
  it('[TC-PLANNING-TEMPLATE-010] la creación automática crea el plan de cada periodo nuevo desde la última versión del predeterminado', async () => {
    const s = scenario();
    const templateId = await s.estandar();
    await s.templates.setDefault({ workspaceId: W, templateId });
    const result = await s.periods.ensurePeriods({ workspaceId: W });
    expect(result.created.map((p) => p.label)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(s.plans().sort((a, b) => a.label.localeCompare(b.label))).toEqual([
      { label: '2026-12', lines: 3 },
      { label: '2027-01', lines: 3 },
      { label: '2027-02', lines: 3 },
    ]);
    const dec = await s.queries.getBudgetByPeriod(W, s.env.mem.byLabel(W, '2026-12')!.id);
    expect(dec).toMatchObject({
      origin: 'TEMPLATE',
      templateVersion: { name: 'Mes estándar', versionNo: 2 },
    });
    expect(dec.lines.find((l) => l.target.id === SUPER)).toMatchObject({
      planned: { amount: '1600.00', currency: 'BOB' },
      source: 'TEMPLATE',
    });
  });

  it('[TC-PLANNING-TEMPLATE-010] sin predeterminado el periodo se crea sin plan', async () => {
    const s = scenario();
    await s.estandar();
    const result = await s.periods.ensurePeriods({ workspaceId: W });
    expect(result.created).toHaveLength(3);
    expect(s.plans()).toEqual([]);
  });

  it('[TC-PLANNING-TEMPLATE-011] ejecutar dos veces la creación deja un solo plan por periodo', async () => {
    const s = scenario();
    const templateId = await s.estandar();
    await s.templates.setDefault({ workspaceId: W, templateId });
    await s.periods.ensurePeriods({ workspaceId: W });
    await s.periods.ensurePeriods({ workspaceId: W });
    expect(s.plans()).toHaveLength(3);
    // el hook reintentado sobre un periodo que ya tiene plan no hace nada
    const dec = s.env.mem.byLabel(W, '2026-12')!;
    const again = await s.budgets.applyDefaultTemplate({ workspaceId: W, periodId: dec.id });
    expect(again).toBe(false);
    expect(s.events('planning.BudgetCreated')).toHaveLength(3);
  });

  it('un template predeterminado archivado deja de aplicarse a los periodos nuevos', async () => {
    const s = scenario();
    const templateId = await s.estandar();
    await s.templates.setDefault({ workspaceId: W, templateId });
    await s.templates.archive({ workspaceId: W, templateId });
    await s.periods.ensurePeriods({ workspaceId: W });
    expect(s.plans()).toEqual([]);
  });

  it('una falla al copiar revierte la creación del periodo (misma unidad de trabajo)', async () => {
    const s = scenario();
    const templateId = await s.estandar();
    await s.templates.setDefault({ workspaceId: W, templateId });
    const failing = new PeriodsService(
      s.env.mem.deps({
        uow: s.env.uow,
        onPeriodCreated: [{ onPeriodCreated: async () => Promise.reject(new Error('boom')) }],
      }),
    );
    await expect(failing.ensurePeriods({ workspaceId: W })).rejects.toThrow('boom');
    expect(s.env.mem.labels(W)).toEqual(['2026-11:ACTIVE']);
  });
});
