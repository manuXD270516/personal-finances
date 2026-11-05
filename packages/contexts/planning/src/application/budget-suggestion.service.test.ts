import { describe, expect, it } from 'vitest';
import { BudgetSuggestionService } from './budget-suggestion.service.js';
import {
  GIMNASIO,
  REST,
  SALARIO,
  SUPER,
  TRANSPORTE,
  W,
  cat,
  money,
  restaurantes,
  salario,
  setupTemplates,
  supermercado,
} from './testing/template-fixtures.js';

/** Real de "Supermercado" de 2026-05 a 2026-10 (TC-PLANNING-HISTBUDGET-008). */
const VIAJE = ['1420.00', '1515.50', '1380.00', '3950.00', '1610.00', '1474.50'];
const LABELS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

function setup(now = '2026-11-04T14:00:00Z') {
  const ctx = setupTemplates(now);
  for (const label of ['2026-05', '2026-06', '2026-07', '2026-08']) ctx.env.mem.seed(W, label, 'CLOSED');
  ctx.env.mem.entries(W, '2026-01-05', '2026-10-30');
  const svc = new BudgetSuggestionService(ctx.deps);
  const history = (categoryId: string, values: readonly string[], nature: 'EXPENSE' | 'INCOME' = 'EXPENSE') =>
    values.forEach((v, i) => ctx.env.flow(`${LABELS[i]}-15`, nature, categoryId, v));
  const request = (extra: Record<string, unknown> = {}) => ({ periodId: ctx.periods.nov.id, ...extra });
  const preview = (extra: Record<string, unknown> = {}) =>
    svc.preview({ workspaceId: W, request: request(extra) });
  return { ctx, svc, history, request, preview };
}
type Ctx = ReturnType<typeof setup>;

/** Plan de 2026-11 vacío con las líneas dadas. */
async function planWith(s: Ctx, lines: readonly object[]) {
  const budget = await s.ctx.budgets.createBudget({ workspaceId: W, periodId: s.ctx.periods.nov.id });
  for (const spec of lines) {
    const { target, ...rest } = spec as { target: unknown };
    await s.ctx.budgets.addLine({ workspaceId: W, budgetId: budget.id, target, spec: rest });
  }
  return s.ctx.queries.getBudget(W, budget.id);
}

const lineOf = <T extends { target: { id: string } }>(lines: readonly T[], categoryId: string): T =>
  lines.find((l) => l.target.id === categoryId) as T;

const confirmBody = (
  s: Ctx,
  preview: { token: string },
  lines: readonly { target: object; kind?: string; amount: string; suggestedAmount: string }[],
  extra: Record<string, unknown> = {},
) => ({
  workspaceId: W,
  request: s.request(extra),
  token: preview.token,
  lines: lines.map((l) => ({
    target: l.target,
    ...(l.kind ? { kind: l.kind } : {}),
    amount: money(l.amount),
    suggestedAmount: money(l.suggestedAmount),
  })),
});

describe('Sugerencias de presupuesto desde el historial (planning/budgets, add-historical-budgets)', () => {
  it('[TC-PLANNING-HISTBUDGET-016] la explicación lista los 6 periodos, el atípico, el promedio, la mediana y la diferencia', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    await planWith(s, [supermercado('1500.00')]);
    const p = await s.preview({ periods: 6 });
    const line = lineOf(p.lines, SUPER);
    expect(line).toMatchObject({
      status: 'OK',
      currentAmount: money('1500.00'),
      suggestedAmount: money('1480.00'),
      difference: money('-20.00'),
    });
    expect(line.explanation).toMatchObject({
      method: 'AVERAGE',
      usedCount: 5,
      mean: '1480.00',
      median: '1474.50',
      outlierRule: 'TUKEY_1_5_IQR',
    });
    expect(line.explanation?.periods.map((x) => [x.label, x.status])).toEqual([
      ['2026-05', 'USED'],
      ['2026-06', 'USED'],
      ['2026-07', 'USED'],
      ['2026-08', 'OUTLIER'],
      ['2026-09', 'USED'],
      ['2026-10', 'USED'],
    ]);
    expect(line.explanation?.periods[3]?.actual).toEqual(money('3950.00'));
    expect(p.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('[TC-PLANNING-HISTBUDGET-001] el promedio de 4 periodos del real del presupuesto es 1495.00 BOB', async () => {
    const s = setup();
    for (const [i, v] of ['1380.00', '1515.50', '1610.00', '1474.50'].entries()) {
      s.ctx.env.flow(`${['2026-07', '2026-08', '2026-09', '2026-10'][i]}-10`, 'EXPENSE', SUPER, v);
    }
    await planWith(s, [supermercado('1500.00')]);
    const p = await s.preview({ periods: 4 });
    expect(lineOf(p.lines, SUPER).suggestedAmount).toEqual(money('1495.00'));
  });

  it('[TC-PLANNING-HISTBUDGET-003] [TC-PLANNING-HISTBUDGET-005] la primera actividad a mitad de un periodo lo deja INCOMPLETE', async () => {
    const s = setup();
    s.ctx.env.mem.activityRanges.set(W, { minEntryDate: '2026-08-20', maxEntryDate: '2026-10-30' });
    s.ctx.env.flow('2026-08-25', 'EXPENSE', REST, '210.00');
    s.ctx.env.flow('2026-09-15', 'EXPENSE', REST, '610.00');
    s.ctx.env.flow('2026-10-15', 'EXPENSE', REST, '650.00');
    await planWith(s, [restaurantes('600.00')]);
    const p = await s.preview({ periods: 3 });
    const e = lineOf(p.lines, REST);
    expect(e.explanation?.periods.map((x) => [x.label, x.status])).toEqual([
      ['2026-08', 'INCOMPLETE'],
      ['2026-09', 'USED'],
      ['2026-10', 'USED'],
    ]);
    expect(e.suggestedAmount).toEqual(money('630.00'));
  });

  it('[TC-PLANNING-HISTBUDGET-006] un gasto en dólares sin tasa deja NO_RATE solo esa línea y ese periodo', async () => {
    const s = setup();
    s.ctx.env.flow('2026-08-15', 'EXPENSE', GIMNASIO, '300.00');
    s.ctx.env.flow('2026-09-15', 'EXPENSE', GIMNASIO, '40.00', 'USD');
    s.ctx.env.flow('2026-10-15', 'EXPENSE', GIMNASIO, '500.00');
    s.ctx.env.flow('2026-09-16', 'EXPENSE', TRANSPORTE, '100.00');
    await planWith(s, [
      { target: cat(GIMNASIO), kind: 'MAXIMUM', planned: money('400.00') },
      { target: cat(TRANSPORTE), kind: 'MAXIMUM', planned: money('100.00') },
    ]);
    const p = await s.preview({ periods: 3 });
    const viajes = lineOf(p.lines, GIMNASIO);
    expect(viajes.explanation?.periods.map((x) => x.status)).toEqual(['USED', 'NO_RATE', 'USED']);
    expect(viajes.suggestedAmount).toEqual(money('400.00'));
    expect(lineOf(p.lines, TRANSPORTE).explanation?.periods.every((x) => x.status === 'USED')).toBe(true);
  });

  it('[TC-PLANNING-HISTBUDGET-003] el periodo en curso se informa IN_PROGRESS y no entra en el promedio', async () => {
    const s = setup('2026-11-20T14:00:00Z');
    s.history(SUPER, VIAJE);
    s.ctx.env.flow('2026-11-05', 'EXPENSE', SUPER, '999.00');
    await planWith(s, [supermercado('1500.00')]);
    const p = await s.svc.preview({
      workspaceId: W,
      request: { periodId: s.ctx.periods.dec.id, periods: 3 },
    });
    expect(p.window.map((w) => w.label)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
  });

  it('[TC-PLANNING-HISTBUDGET-007] sin suficientes periodos válidos la línea queda INSUFFICIENT_HISTORY', async () => {
    const s = setup();
    s.ctx.env.mem.activityRanges.set(W, { minEntryDate: '2026-09-10', maxEntryDate: '2026-10-30' });
    await planWith(s, [supermercado('1500.00')]);
    const p = await s.preview({ periods: 3 });
    expect(lineOf(p.lines, SUPER)).toMatchObject({ status: 'INSUFFICIENT_HISTORY', suggestedAmount: null });
    expect(lineOf(p.lines, SUPER).explanation).toMatchObject({ usedCount: 1, minValid: 2 });
  });

  it('[TC-PLANNING-HISTBUDGET-010] [TC-PLANNING-HISTBUDGET-011] excluir y reincluir periodos desde la solicitud', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    await planWith(s, [supermercado('1500.00')]);
    const base = await s.preview({ periods: 6 });
    const id = (label: string) => base.window.find((w) => w.label === label)?.periodId as string;
    const included = await s.preview({
      periods: 6,
      overrides: [{ target: cat(SUPER), includePeriodIds: [id('2026-08')] }],
    });
    expect(lineOf(included.lines, SUPER).suggestedAmount).toEqual(money('1891.67'));
    const excluded = await s.preview({
      periods: 6,
      overrides: [{ target: cat(SUPER), excludePeriodIds: [id('2026-10')] }],
    });
    expect(lineOf(excluded.lines, SUPER).explanation?.periods.at(-1)?.status).toBe('USER_EXCLUDED');
    await expect(
      s.preview({ periods: 6, overrides: [{ target: cat(SUPER), includePeriodIds: ['no-existe'] }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('[TC-PLANNING-HISTBUDGET-012] el año anterior con ajuste 10 % y redondeo', async () => {
    const s = setup();
    s.ctx.env.mem.seed(W, '2025-11', 'CLOSED');
    s.ctx.env.mem.entries(W, '2025-01-05');
    s.ctx.env.flow('2025-11-10', 'EXPENSE', SUPER, '1000.15');
    await planWith(s, [supermercado('1500.00')]);
    const p = await s.preview({ method: 'SAME_PERIOD_LAST_YEAR', adjustmentPercent: '10.00' });
    expect(lineOf(p.lines, SUPER).suggestedAmount).toEqual(money('1100.16'));
    expect(p.window.map((w) => w.label)).toEqual(['2025-11']);
  });

  it('[TC-PLANNING-HISTBUDGET-013] sin el periodo del año anterior queda INSUFFICIENT_HISTORY con BEFORE_FIRST_ACTIVITY', async () => {
    const s = setup();
    s.ctx.env.mem.activityRanges.set(W, { minEntryDate: '2026-02-01', maxEntryDate: '2026-10-30' });
    await planWith(s, [supermercado('1500.00')]);
    const p = await s.preview({ method: 'SAME_PERIOD_LAST_YEAR' });
    const e = lineOf(p.lines, SUPER);
    expect(e.status).toBe('INSUFFICIENT_HISTORY');
    expect(e.explanation?.periods[0]).toMatchObject({ label: '2025-11', status: 'BEFORE_FIRST_ACTIVITY' });
  });

  it('[TC-PLANNING-HISTBUDGET-017] la línea de porcentaje de ingresos es NOT_APPLICABLE y sin monto sugerido', async () => {
    const s = setup();
    await planWith(s, [
      { target: cat(TRANSPORTE), kind: 'PERCENT_OF_INCOME', percent: '10', incomeBasis: 'EXPECTED' },
      salario('7800.00'),
    ]);
    const p = await s.preview();
    expect(lineOf(p.lines, TRANSPORTE)).toMatchObject({
      status: 'NOT_APPLICABLE',
      suggestedAmount: null,
      explanation: null,
    });
  });

  it('[TC-PLANNING-HISTBUDGET-018] un periodo sin plan propone líneas MAXIMUM para las categorías raíz con gasto', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    s.history(TRANSPORTE, ['100.00', '100.00', '100.00', '100.00', '100.00', '100.00']);
    const p = await s.svc.preview({
      workspaceId: W,
      request: { periodId: s.ctx.periods.dec.id, periods: 6 },
    });
    expect(p.budgetId).toBeNull();
    expect(p.lines.map((l) => l.target.id).sort()).toEqual([SUPER, TRANSPORTE].sort());
    expect(p.lines.every((l) => l.kind === 'MAXIMUM' && l.existingLineId === null)).toBe(true);
    expect(p.lines.some((l) => l.target.id === REST)).toBe(false);
  });

  it('[TC-PLANNING-HISTBUDGET-018] un objetivo extra que se solapa con una línea propuesta se rechaza', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    await expect(
      s.svc.preview({
        workspaceId: W,
        request: {
          periodId: s.ctx.periods.dec.id,
          extraTargets: [{ kind: 'GROUP', id: '0190a000-0000-7000-8000-000000000100' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_TARGET_OVERLAP' });
  });

  it('[TC-PLANNING-HISTBUDGET-019] la vista previa no modifica el plan ni audita', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    const plan = await planWith(s, [supermercado('1500.00')]);
    const audits = s.ctx.env.mem.audits.length;
    const events = s.ctx.env.mem.events.length;
    await s.preview();
    expect(s.ctx.env.mem.audits.length).toBe(audits);
    expect(s.ctx.env.mem.events.length).toBe(events);
    expect((await s.ctx.queries.getBudget(W, plan.id)).version).toBe(plan.version);
  });

  it('[TC-PLANNING-HISTBUDGET-020] [TC-PLANNING-HISTBUDGET-028] confirmar dos de tres líneas con un monto editado y auditar con una operación común', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    s.history(REST, Array(6).fill('630.00'));
    s.history(SALARIO, Array(6).fill('8000.00'), 'INCOME');
    const t = await s.ctx.templates.createTemplate({
      workspaceId: W,
      name: 'Mes estándar',
      lines: [supermercado('1500.00'), restaurantes('600.00'), salario('7800.00')],
    });
    const plan = await s.ctx.budgets.createBudget({
      workspaceId: W,
      periodId: s.ctx.periods.nov.id,
      source: { kind: 'TEMPLATE', templateId: t.id },
    });
    const p = await s.preview({ periods: 6 });
    expect(p.lines.map((l) => l.suggestedAmount?.amount).sort()).toEqual(['1480.00', '630.00', '8000.00']);
    const before = s.ctx.env.mem.audits.length;
    const result = await s.svc.confirm(
      confirmBody(
        s,
        p,
        [
          { target: cat(SUPER), amount: '1480.00', suggestedAmount: '1480.00' },
          { target: cat(REST), amount: '650.00', suggestedAmount: '630.00' },
        ],
        { periods: 6 },
      ),
    );
    const sup = lineOf(result.lines, SUPER);
    expect(sup.max ?? sup.planned).toEqual(money('1480.00'));
    expect(sup.overridden).toBe(true);
    expect(sup.historyBasis).toMatchObject({
      method: 'AVERAGE',
      suggested: money('1480.00'),
      applied: money('1480.00'),
      modifiedAfterSuggestion: false,
    });
    const rest = lineOf(result.lines, REST);
    expect(rest.planned).toEqual(money('650.00'));
    expect(rest.historyBasis).toMatchObject({ suggested: money('630.00'), applied: money('650.00') });
    const sal = lineOf(result.lines, SALARIO);
    expect(sal.planned).toEqual(money('7800.00'));
    expect(sal.historyBasis).toBeNull();
    expect((await s.ctx.templateQueries.get(W, t.id)).currentVersionNo).toBe(1);
    expect(result.version).toBeGreaterThan(plan.version);
    // auditoría: dos registros con el mismo operationId, antes y después, y el método
    const created = s.ctx.env.mem.audits
      .slice(before)
      .filter((a) => a.action === 'planning.budget.line_updated');
    expect(created).toHaveLength(2);
    const ops = created.map((a) => a.changes?.find((c) => c.field === 'operationId')?.after);
    expect(ops[0]).toBeTruthy();
    expect(new Set(ops).size).toBe(1);
    const planned = created[1]!.changes?.find((c) => c.field === 'planned');
    expect(planned).toMatchObject({ before: money('600.00'), after: money('650.00') });
    expect(String(created[0]!.changes?.find((c) => c.field === 'historyBasis')?.after)).toContain(
      '"periods":6',
    );
  });

  it('[TC-PLANNING-HISTBUDGET-021] un monto negativo rechaza toda la confirmación y no cambia nada', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    s.history(REST, Array(6).fill('630.00'));
    const plan = await planWith(s, [supermercado('1500.00'), restaurantes('600.00')]);
    const p = await s.preview({ periods: 6 });
    await expect(
      s.svc.confirm(
        confirmBody(
          s,
          p,
          [
            { target: cat(SUPER), amount: '1480.00', suggestedAmount: '1480.00' },
            { target: cat(REST), amount: '-10.00', suggestedAmount: '630.00' },
          ],
          { periods: 6 },
        ),
      ),
    ).rejects.toMatchObject({ code: 'BUDGET_INVALID_AMOUNTS' });
    const after = await s.ctx.queries.getBudget(W, plan.id);
    expect(after.version).toBe(plan.version);
    expect(lineOf(after.lines, SUPER).planned).toEqual(money('1500.00'));
  });

  it('[TC-PLANNING-HISTBUDGET-022] un gasto nuevo entre la vista previa y la confirmación da BUDGET_SUGGESTION_STALE', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    const plan = await planWith(s, [supermercado('1500.00')]);
    const p = await s.preview({ periods: 6 });
    s.ctx.env.flow('2026-09-12', 'EXPENSE', SUPER, '200.00');
    await expect(
      s.svc.confirm(
        confirmBody(s, p, [{ target: cat(SUPER), amount: '1480.00', suggestedAmount: '1480.00' }], {
          periods: 6,
        }),
      ),
    ).rejects.toMatchObject({ code: 'BUDGET_SUGGESTION_STALE' });
    expect((await s.ctx.queries.getBudget(W, plan.id)).version).toBe(plan.version);
  });

  it('[TC-PLANNING-HISTBUDGET-022] un monto sugerido que no coincide con el recalculado también es obsoleto', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    await planWith(s, [supermercado('1500.00')]);
    const p = await s.preview({ periods: 6 });
    await expect(
      s.svc.confirm(
        confirmBody(s, p, [{ target: cat(SUPER), amount: '1480.00', suggestedAmount: '1000.00' }], {
          periods: 6,
        }),
      ),
    ).rejects.toMatchObject({ code: 'BUDGET_SUGGESTION_STALE' });
  });

  it('[TC-PLANNING-HISTBUDGET-018] confirmar sobre un periodo sin plan crea el plan EMPTY y las líneas nuevas', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    const req = { periodId: s.ctx.periods.dec.id, periods: 6 };
    const p = await s.svc.preview({ workspaceId: W, request: req });
    const result = await s.svc.confirm({
      workspaceId: W,
      request: req,
      token: p.token,
      lines: [
        {
          target: cat(SUPER),
          kind: 'MAXIMUM',
          amount: money('1480.00'),
          suggestedAmount: money('1480.00'),
        },
      ],
    });
    expect(result).toMatchObject({ origin: 'EMPTY', periodLabel: '2026-12' });
    expect(lineOf(result.lines, SUPER).historyBasis).not.toBeNull();
    expect(s.ctx.events('planning.BudgetCreated').length).toBeGreaterThanOrEqual(1);
    await expect(
      s.svc.confirm({
        workspaceId: W,
        request: req,
        token: p.token,
        lines: [{ target: cat(SUPER), amount: money('1.00'), suggestedAmount: money('1480.00') }],
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_SUGGESTION_STALE' });
  });

  it('[TC-PLANNING-HISTBUDGET-027] confirmar en un periodo cerrado se rechaza con PERIOD_CLOSED', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    const plan = await planWith(s, [supermercado('1500.00')]);
    const p = await s.preview({ periods: 6 });
    const row = s.ctx.env.mem.rows.get(s.ctx.periods.nov.id)!;
    s.ctx.env.mem.rows.set(row.id, { ...row, status: 'CLOSED' });
    await expect(
      s.svc.confirm(
        confirmBody(s, p, [{ target: cat(SUPER), amount: '1480.00', suggestedAmount: '1480.00' }], {
          periods: 6,
        }),
      ),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    expect(lineOf((await s.ctx.queries.getBudget(W, plan.id)).lines, SUPER).planned).toEqual(
      money('1500.00'),
    );
  });

  it('[TC-PLANNING-HISTBUDGET-023] [TC-PLANNING-HISTBUDGET-024] [TC-PLANNING-HISTBUDGET-025] ni el template predeterminado, ni el clonado, ni un cambio de la historia aplican o copian la base', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    const t = await s.ctx.templates.createTemplate({
      workspaceId: W,
      name: 'Mes estándar',
      lines: [supermercado('1600.00')],
    });
    await s.ctx.templates.setDefault({ workspaceId: W, templateId: t.id });
    await s.ctx.hook.onPeriodCreated({
      workspaceId: W,
      period: { id: s.ctx.periods.nov.id, label: '2026-11' } as never,
    });
    const nov = await s.ctx.queries.getBudgetByPeriod(W, s.ctx.periods.nov.id);
    expect(lineOf(nov.lines, SUPER)).toMatchObject({ planned: money('1600.00'), historyBasis: null });

    const p = await s.preview({ periods: 6 });
    await s.svc.confirm(
      confirmBody(s, p, [{ target: cat(SUPER), amount: '1480.00', suggestedAmount: '1480.00' }], {
        periods: 6,
      }),
    );
    // la historia cambia después de aplicar: la línea no se recalcula
    s.ctx.env.flow('2026-09-20', 'EXPENSE', SUPER, '300.00');
    const applied = await s.ctx.queries.getBudget(W, nov.id);
    expect(lineOf(applied.lines, SUPER)).toMatchObject({
      planned: money('1480.00'),
      historyBasis: { suggested: money('1480.00') },
    });
    // el clonado copia el monto sin la base
    const clone = await s.ctx.budgets.createBudget({
      workspaceId: W,
      periodId: s.ctx.periods.dec.id,
      source: { kind: 'CLONE_PREVIOUS' },
    });
    expect(lineOf(clone.lines, SUPER)).toMatchObject({
      planned: money('1480.00'),
      source: 'CLONE',
      historyBasis: null,
    });
  });

  it('[TC-PLANNING-HISTBUDGET-024] una edición manual posterior conserva la base y la marca como modificada', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    const plan = await planWith(s, [supermercado('1500.00')]);
    const p = await s.preview({ periods: 6 });
    const applied = await s.svc.confirm(
      confirmBody(s, p, [{ target: cat(SUPER), amount: '1480.00', suggestedAmount: '1480.00' }], {
        periods: 6,
      }),
    );
    const line = lineOf(applied.lines, SUPER);
    const edited = await s.ctx.budgets.updateLine({
      workspaceId: W,
      budgetId: plan.id,
      lineId: line.id,
      expectedVersion: line.version,
      patch: { planned: money('1700.00') },
    });
    expect(edited.historyBasis).toMatchObject({ applied: money('1480.00'), modifiedAfterSuggestion: true });
  });

  it('[TC-PLANNING-HISTBUDGET-029] la vista previa lee los flujos con UNA consulta de agregados y resuelve las tasas en UN lote', async () => {
    const s = setup();
    s.history(SUPER, VIAJE);
    s.history(REST, Array(6).fill('630.00'));
    s.ctx.env.rate('USD', 'BOB', '2026-06-09T00:00:00Z', '6.96');
    s.ctx.env.rate('USD', 'BOB', '2026-09-09T00:00:00Z', '6.96');
    s.ctx.env.flow('2026-06-10', 'EXPENSE', SUPER, '10.00', 'USD');
    s.ctx.env.flow('2026-09-10', 'EXPENSE', REST, '10.00', 'USD');
    await planWith(s, [supermercado('1500.00'), restaurantes('600.00')]);
    let rateCalls = 0;
    const deps = s.ctx.env.deps();
    const counted = {
      ...deps,
      rates: {
        ...deps.rates,
        resolveValuationRates: async (input: Parameters<typeof deps.rates.resolveValuationRates>[0]) => {
          rateCalls += 1;
          return deps.rates.resolveValuationRates(input);
        },
      },
    };
    const before = s.ctx.env.flowCalls;
    const p = await new BudgetSuggestionService(counted).preview({
      workspaceId: W,
      request: { periodId: s.ctx.periods.nov.id, periods: 6 },
    });
    expect(p.lines).toHaveLength(2);
    expect(s.ctx.env.flowCalls - before).toBe(1);
    expect(rateCalls).toBe(1);
    // 6.96 x 10.00 USD = 69.60 BOB entra en el real de junio y septiembre
    expect(lineOf(p.lines, SUPER).explanation?.periods[1]?.actual).toEqual(money('1585.10'));
  });

  it('[TC-PLANNING-HISTBUDGET-016] los parámetros fuera de rango se rechazan con VALIDATION_FAILED', async () => {
    const s = setup();
    for (const bad of [
      { periods: 13 },
      { periods: 0 },
      { adjustmentPercent: '1000.01' },
      { adjustmentPercent: '-100.01' },
      { adjustmentPercent: '1.234' },
      { roundingIncrement: 7 },
      { method: 'MEDIAN' },
    ]) {
      await expect(s.preview(bad)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await expect(
      s.svc.preview({ workspaceId: W, request: { periodId: '0190a000-0000-7000-8000-0000000000ff' } }),
    ).rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
  });
});
