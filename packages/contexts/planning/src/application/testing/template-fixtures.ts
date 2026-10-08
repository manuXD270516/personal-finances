import { Instant } from '@pf/shared-kernel';
import { BudgetQueries } from '../budget.queries.js';
import { BudgetsService } from '../budgets.service.js';
import { TemplatePeriodHook } from '../period-created.hook.js';
import { PeriodsService } from '../periods.service.js';
import { PropagationService } from '../propagation.service.js';
import { TemplateQueries } from '../template.queries.js';
import { TemplatesService } from '../templates.service.js';
import { InMemoryBudgets } from './in-memory-budgets.js';

export const W = '0190a000-0000-7000-8000-00000000a001';
export const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const G_ALIM = id(100);
export const G_VIV = id(101);
export const G_ING = id(102);
export const SUPER = id(1);
export const REST = id(3);
export const ALQ = id(4);
export const SALARIO = id(7);
export const GIMNASIO = id(8);
export const TRANSPORTE = id(10);

export const money = (amount: string, currency = 'BOB') => ({ amount, currency });
export const cat = (categoryId: string) => ({ kind: 'CATEGORY', id: categoryId });

/** Líneas de "Mes estándar" (TC-PLANNING-TEMPLATE-001). */
export const alquiler = (amount = '2800.00') => ({ target: cat(ALQ), kind: 'FIXED', planned: money(amount) });
export const supermercado = (amount = '1500.00') => ({
  target: cat(SUPER),
  kind: 'MAXIMUM',
  planned: money(amount),
});
export const salario = (amount = '8000.00') => ({
  target: cat(SALARIO),
  kind: 'FIXED',
  planned: money(amount),
});
export const restaurantes = (amount: string) => ({
  target: cat(REST),
  kind: 'MAXIMUM',
  planned: money(amount),
});

/**
 * Escenario de los tests de templates: periodos 2026-09/10 cerrados, 2026-11 activo, 2026-12 / 2027-01 / 2027-02 en
 * borrador, hoy = 2026-11-10 (America/La_Paz). Los servicios comparten los mismos dobles en memoria.
 */
export function setupTemplates(now = '2026-11-10T15:00:00Z') {
  const env = new InMemoryBudgets();
  env.mem.workspace(W);
  env.mem.clock.set(Instant.parse(now));
  const node = (
    categoryId: string,
    name: string,
    groupId: string,
    kind: 'EXPENSE' | 'INCOME' = 'EXPENSE',
    archived = false,
  ) => ({ categoryId, name, kind, groupId, parentId: null, systemCode: null, archived });
  env.tree = {
    groups: [
      { groupId: G_ALIM, name: 'Alimentación', kind: 'EXPENSE', archived: false },
      { groupId: G_VIV, name: 'Vivienda', kind: 'EXPENSE', archived: false },
      { groupId: G_ING, name: 'Ingresos', kind: 'INCOME', archived: false },
    ],
    categories: [
      node(SUPER, 'Supermercado', G_ALIM),
      node(REST, 'Restaurantes', G_ALIM),
      node(ALQ, 'Alquiler', G_VIV),
      node(TRANSPORTE, 'Transporte', G_VIV),
      node(GIMNASIO, 'Gimnasio', G_VIV),
      node(SALARIO, 'Salario', G_ING, 'INCOME'),
    ],
    tags: [],
  };
  const periods = {
    sep: env.mem.seed(W, '2026-09', 'CLOSED'),
    oct: env.mem.seed(W, '2026-10', 'CLOSED'),
    nov: env.mem.seed(W, '2026-11', 'ACTIVE'),
    dec: env.mem.seed(W, '2026-12', 'DRAFT'),
    jan: env.mem.seed(W, '2027-01', 'DRAFT'),
    feb: env.mem.seed(W, '2027-02', 'DRAFT'),
  };
  const deps = env.deps();
  const budgets = new BudgetsService(deps);
  return {
    env,
    periods,
    deps,
    budgets,
    queries: new BudgetQueries(deps),
    templates: new TemplatesService(deps),
    templateQueries: new TemplateQueries(deps),
    propagation: new PropagationService(deps),
    hook: new TemplatePeriodHook(budgets),
    archiveCategory: (categoryId: string) => {
      env.tree = {
        ...env.tree,
        categories: env.tree.categories.map((c) =>
          c.categoryId === categoryId ? { ...c, archived: true } : c,
        ),
      };
    },
    events: (type: string) => env.mem.events.filter((e) => e.eventType === type),
    audits: (action: string) => env.mem.audits.filter((a) => a.action === action),
    /** "Mes estándar" v1 (Alquiler, Supermercado 1500, Salario) y v2 (Supermercado 1600). */
    async estandar() {
      const t = await this.templates.createTemplate({
        workspaceId: W,
        name: 'Mes estándar',
        lines: [alquiler(), supermercado(), salario()],
      });
      await this.templates.publishVersion({
        workspaceId: W,
        templateId: t.id,
        baseVersionNo: 1,
        lines: [alquiler(), supermercado('1600.00'), salario()],
        changeNote: 'Inflación',
      });
      return t.id;
    },
  };
}
export type TemplateCtx = ReturnType<typeof setupTemplates>;

/** Crea el servicio de periodos con el participante de templates (TC-PLANNING-TEMPLATE-010/011). */
export function periodsWithHook(ctx: TemplateCtx) {
  return new PeriodsService(ctx.env.mem.deps({ onPeriodCreated: [ctx.hook] }));
}
