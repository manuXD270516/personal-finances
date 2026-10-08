import { describe, expect, it } from 'vitest';
import {
  ALQ,
  GIMNASIO,
  REST,
  SALARIO,
  SUPER,
  W,
  alquiler,
  cat,
  id,
  money,
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

describe('Templates versionados (planning/budget-templates)', () => {
  it('[TC-PLANNING-TEMPLATE-001] crea el template con su versión 1 y rechaza un nombre repetido sin distinguir mayúsculas', async () => {
    const ctx = setupTemplates();
    const t = await ctx.templates.createTemplate({
      workspaceId: W,
      name: 'Mes estándar',
      lines: [alquiler(), supermercado(), salario()],
    });
    expect(t).toMatchObject({ status: 'ACTIVE', currentVersionNo: 1, isDefault: false, lineCount: 3 });
    expect(lineOf(t.currentVersion.lines, ALQ)).toMatchObject({ kind: 'FIXED', planned: money('2800.00') });
    expect(lineOf(t.currentVersion.lines, SUPER)).toMatchObject({
      kind: 'MAXIMUM',
      planned: money('1500.00'),
    });
    expect(lineOf(t.currentVersion.lines, SALARIO)).toMatchObject({
      nature: 'INCOME',
      planned: money('8000.00'),
    });
    expect(ctx.audits('planning.template.created')).toHaveLength(1);
    await reject(
      ctx.templates.createTemplate({ workspaceId: W, name: 'mes estándar', lines: [] }),
      'NAME_TAKEN',
    );
    expect(ctx.env.templateRows.size).toBe(1);
  });

  it('las líneas del template usan las mismas reglas que las del plan (objetivo repetido, moneda y montos)', async () => {
    const ctx = setupTemplates();
    await reject(
      ctx.templates.createTemplate({ workspaceId: W, name: 'A', lines: [alquiler(), alquiler('2900.00')] }),
      'BUDGET_LINE_DUPLICATE_TARGET',
    );
    await reject(
      ctx.templates.createTemplate({
        workspaceId: W,
        name: 'B',
        lines: [{ target: cat(ALQ), kind: 'FIXED', planned: money('10.00', 'USD') }],
      }),
      'CURRENCY_MISMATCH',
    );
    await reject(
      ctx.templates.createTemplate({
        workspaceId: W,
        name: 'C',
        lines: [{ target: cat(ALQ), kind: 'FIXED', planned: money('-1.00') }],
      }),
      'BUDGET_INVALID_AMOUNTS',
    );
    await reject(ctx.templates.createTemplate({ workspaceId: W, name: ' ', lines: [] }), 'VALIDATION_FAILED');
    expect(ctx.env.templateRows.size).toBe(0);
  });

  it('[TC-PLANNING-TEMPLATE-002] publicar crea la versión 2 con la nota y deja intacta la versión 1', async () => {
    const ctx = setupTemplates();
    const t = await ctx.templates.createTemplate({
      workspaceId: W,
      name: 'Mes estándar',
      lines: [alquiler(), supermercado(), salario()],
    });
    const v2 = await ctx.templates.publishVersion({
      workspaceId: W,
      templateId: t.id,
      baseVersionNo: 1,
      lines: [alquiler(), supermercado('1600.00'), salario()],
      changeNote: 'Inflación',
    });
    expect(v2.currentVersionNo).toBe(2);
    expect(v2.currentVersion).toMatchObject({ versionNo: 2, basedOnVersionNo: 1, changeNote: 'Inflación' });
    expect(lineOf(v2.currentVersion.lines, SUPER).planned).toEqual(money('1600.00'));
    const v1 = await ctx.templateQueries.getVersion(W, t.id, 1);
    expect(lineOf(v1.lines, SUPER).planned).toEqual(money('1500.00'));
    expect(v2.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(ctx.audits('planning.template.version_published')).toHaveLength(1);
  });

  it('[TC-PLANNING-TEMPLATE-003] una modificación sobre una versión vieja se rechaza con CONCURRENCY_CONFLICT sin crear la 3', async () => {
    const ctx = setupTemplates();
    const templateId = await ctx.estandar();
    await reject(
      ctx.templates.publishVersion({
        workspaceId: W,
        templateId,
        baseVersionNo: 1,
        lines: [alquiler()],
      }),
      'CONCURRENCY_CONFLICT',
    );
    expect((await ctx.templateQueries.get(W, templateId)).versions).toHaveLength(2);
  });

  it('una línea idéntica a la de la versión base se conserva aunque su objetivo se archive después', async () => {
    const ctx = setupTemplates();
    const t = await ctx.templates.createTemplate({
      workspaceId: W,
      name: 'Con gimnasio',
      lines: [alquiler(), { target: cat(GIMNASIO), kind: 'MAXIMUM', planned: money('250.00') }],
    });
    ctx.archiveCategory(GIMNASIO);
    const v2 = await ctx.templates.publishVersion({
      workspaceId: W,
      templateId: t.id,
      baseVersionNo: 1,
      lines: [alquiler('2900.00'), { target: cat(GIMNASIO), kind: 'MAXIMUM', planned: money('250.00') }],
    });
    expect(v2.currentVersion.lines).toHaveLength(2);
    // una línea nueva o cambiada sobre el objetivo archivado sí se rechaza
    await reject(
      ctx.templates.publishVersion({
        workspaceId: W,
        templateId: t.id,
        baseVersionNo: 2,
        lines: [alquiler('2900.00'), { target: cat(GIMNASIO), kind: 'MAXIMUM', planned: money('300.00') }],
      }),
      'CATEGORY_ARCHIVED',
    );
  });
});

describe('Crear el plan desde un template', () => {
  it('[TC-PLANNING-TEMPLATE-004] sin versión usa la última y el origen no cambia al publicar la 3', async () => {
    const ctx = setupTemplates();
    const templateId = await ctx.estandar();
    const plan = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.nov.id,
      source: { kind: 'TEMPLATE', templateId },
    });
    expect(lineOf(plan.lines, SUPER)).toMatchObject({ planned: money('1600.00'), source: 'TEMPLATE' });
    expect(lineOf(plan.lines, ALQ).planned).toEqual(money('2800.00'));
    expect(lineOf(plan.lines, SALARIO).planned).toEqual(money('8000.00'));
    expect(plan).toMatchObject({ origin: 'TEMPLATE', omittedLines: [] });
    expect(plan.templateVersion).toEqual({ templateId, versionNo: 2, name: 'Mes estándar' });
    await ctx.templates.publishVersion({
      workspaceId: W,
      templateId,
      baseVersionNo: 2,
      lines: [alquiler('3000.00')],
    });
    const again = await ctx.queries.getBudgetByPeriod(W, ctx.periods.nov.id);
    expect(again.templateVersion).toMatchObject({ versionNo: 2 });
    expect(lineOf(again.lines, ALQ).planned).toEqual(money('2800.00'));
    expect(ctx.events('planning.BudgetCreated')[0]!.payload).toMatchObject({
      origin: 'TEMPLATE',
      templateId,
      templateVersionNo: 2,
      lineCount: 3,
    });
  });

  it('[TC-PLANNING-TEMPLATE-005] desde la versión 1 copia sus montos y registra ese origen', async () => {
    const ctx = setupTemplates();
    const templateId = await ctx.estandar();
    const plan = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.nov.id,
      source: { kind: 'TEMPLATE', templateId, versionNo: 1 },
    });
    expect(lineOf(plan.lines, SUPER).planned).toEqual(money('1500.00'));
    expect(plan.templateVersion).toMatchObject({ name: 'Mes estándar', versionNo: 1 });
    await reject(
      ctx.budgets.createBudget({
        workspaceId: W,
        periodId: ctx.periods.dec.id,
        source: { kind: 'TEMPLATE', templateId, versionNo: 9 },
      }),
      'REFERENCE_NOT_FOUND',
    );
  });

  it('[TC-PLANNING-TEMPLATE-006] si el periodo ya tiene plan se rechaza con BUDGET_ALREADY_EXISTS sin tocarlo', async () => {
    const ctx = setupTemplates();
    const templateId = await ctx.estandar();
    await ctx.budgets.createBudget({ workspaceId: W, periodId: ctx.periods.nov.id });
    await reject(
      ctx.budgets.createBudget({
        workspaceId: W,
        periodId: ctx.periods.nov.id,
        source: { kind: 'TEMPLATE', templateId },
      }),
      'BUDGET_ALREADY_EXISTS',
    );
    expect((await ctx.queries.getBudgetByPeriod(W, ctx.periods.nov.id)).lines).toEqual([]);
  });

  it('[TC-PLANNING-TEMPLATE-007] omite e informa las líneas de objetivos archivados sin cambiar el template', async () => {
    const ctx = setupTemplates();
    const t = await ctx.templates.createTemplate({
      workspaceId: W,
      name: 'Mes estándar',
      lines: [alquiler(), { target: cat(GIMNASIO), kind: 'MAXIMUM', planned: money('250.00') }],
    });
    ctx.archiveCategory(GIMNASIO);
    const plan = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.nov.id,
      source: { kind: 'TEMPLATE', templateId: t.id },
    });
    expect(plan.lines.map((l) => l.target.id)).toEqual([ALQ]);
    expect(plan.omittedLines).toEqual([{ target: cat(GIMNASIO), reason: 'TARGET_ARCHIVED' }]);
    expect((await ctx.templateQueries.getVersion(W, t.id, 1)).lines.map((l) => l.target.id)).toContain(
      GIMNASIO,
    );
    // TC-PLANNING-TEMPLATE-019: la auditoría registra el plan creado, el origen y las omitidas
    const audit = ctx.audits('planning.budget.created')[0]!;
    const fields = Object.fromEntries((audit.changes ?? []).map((c) => [c.field, c.after]));
    expect(fields).toMatchObject({
      origin: 'TEMPLATE',
      templateId: t.id,
      templateVersionNo: 1,
      lineCount: 1,
    });
    expect(JSON.parse(fields['omittedLines'] as string)).toEqual([
      { target: `CATEGORY:${GIMNASIO}`, reason: 'TARGET_ARCHIVED' },
    ]);
  });

  it('omite las líneas de otra moneda que la base sin convertir (CURRENCY_MISMATCH, docs/33 D79)', async () => {
    const ctx = setupTemplates();
    const templateId = await ctx.estandar();
    ctx.env.baseCurrency = 'USD';
    const plan = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.nov.id,
      source: { kind: 'TEMPLATE', templateId },
    });
    expect(plan).toMatchObject({ currency: 'USD', lines: [] });
    expect(plan.omittedLines).toHaveLength(3);
    expect(plan.omittedLines!.every((o) => o.reason === 'CURRENCY_MISMATCH')).toBe(true);
  });

  it('un template inexistente es REFERENCE_NOT_FOUND y uno archivado BUDGET_TEMPLATE_ARCHIVED', async () => {
    const ctx = setupTemplates();
    await reject(
      ctx.budgets.createBudget({
        workspaceId: W,
        periodId: ctx.periods.nov.id,
        source: { kind: 'TEMPLATE', templateId: id(999) },
      }),
      'REFERENCE_NOT_FOUND',
    );
    await reject(
      ctx.budgets.createBudget({ workspaceId: W, periodId: ctx.periods.nov.id, source: { kind: 'OTRO' } }),
      'VALIDATION_FAILED',
    );
  });
});

describe('Clonar el plan del periodo anterior', () => {
  it('[TC-PLANNING-TEMPLATE-008] copia montos, umbrales y marca; sin cruces; conserva el template de origen', async () => {
    const ctx = setupTemplates();
    const templateId = await ctx.estandar();
    const nov = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.nov.id,
      source: { kind: 'TEMPLATE', templateId },
    });
    const added = await ctx.budgets.addLine({
      workspaceId: W,
      budgetId: nov.id,
      target: cat(REST),
      spec: { kind: 'MAXIMUM', planned: money('650.00'), thresholds: ['80', '100'] },
    });
    ctx.env.crossingRows.push({
      workspaceId: W,
      periodId: ctx.periods.nov.id,
      targetKind: 'CATEGORY',
      targetId: REST,
      threshold: '80',
      budgetId: nov.id,
      budgetLineId: added.id,
      reference: '650.00',
      actual: '530.00',
      currency: 'BOB',
      crossedAt: '2026-11-09T12:00:00.000Z',
      eventId: id(500),
    });
    await ctx.budgets.updateLine({
      workspaceId: W,
      budgetId: nov.id,
      lineId: lineOf(nov.lines, SUPER).id,
      expectedVersion: 1,
      patch: { planned: money('1700.00') },
    });
    const dec = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.dec.id,
      source: { kind: 'CLONE_PREVIOUS' },
    });
    expect(dec).toMatchObject({ origin: 'CLONE', clonedFromBudgetId: nov.id, omittedLines: [] });
    expect(lineOf(dec.lines, REST)).toMatchObject({ planned: money('650.00'), thresholds: ['80', '100'] });
    expect(lineOf(dec.lines, SUPER)).toMatchObject({
      planned: money('1700.00'),
      overridden: true,
      source: 'CLONE',
    });
    expect(dec.templateVersion).toMatchObject({ templateId, versionNo: 2 });
    expect(ctx.env.crossingRows.filter((c) => c.periodId === ctx.periods.dec.id)).toEqual([]);
    expect(dec.lines.every((l) => l.progress.crossedThresholds.length === 0)).toBe(true);
    expect(ctx.events('planning.BudgetCreated').at(-1)!.payload).toMatchObject({
      origin: 'CLONE',
      clonedFromBudgetId: nov.id,
    });
  });

  it('[TC-PLANNING-TEMPLATE-009] sin plan en el periodo anterior se rechaza con REFERENCE_NOT_FOUND', async () => {
    const ctx = setupTemplates();
    await reject(
      ctx.budgets.createBudget({
        workspaceId: W,
        periodId: ctx.periods.jan.id,
        source: { kind: 'CLONE_PREVIOUS' },
      }),
      'REFERENCE_NOT_FOUND',
    );
    expect(ctx.env.budgetRows.size).toBe(0);
  });

  it('omite al clonar las líneas con objetivo archivado', async () => {
    const ctx = setupTemplates();
    const nov = await ctx.budgets.createBudget({ workspaceId: W, periodId: ctx.periods.nov.id });
    await ctx.budgets.addLine({
      workspaceId: W,
      budgetId: nov.id,
      target: cat(GIMNASIO),
      spec: { kind: 'MAXIMUM', planned: money('250.00') },
    });
    await ctx.budgets.addLine({
      workspaceId: W,
      budgetId: nov.id,
      target: cat(ALQ),
      spec: { kind: 'FIXED', planned: money('2800.00') },
    });
    ctx.archiveCategory(GIMNASIO);
    const dec = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.dec.id,
      source: { kind: 'CLONE_PREVIOUS' },
    });
    expect(dec.lines.map((l) => l.target.id)).toEqual([ALQ]);
    expect(dec.omittedLines).toEqual([{ target: cat(GIMNASIO), reason: 'TARGET_ARCHIVED' }]);
  });
});

describe('Predeterminado, edición local, clonado y archivado', () => {
  it('[TC-PLANNING-TEMPLATE-012] un solo predeterminado: marcar otro desmarca el anterior; archivar lo desmarca', async () => {
    const ctx = setupTemplates();
    const a = await ctx.templates.createTemplate({
      workspaceId: W,
      name: 'Mes estándar',
      lines: [alquiler()],
    });
    const b = await ctx.templates.createTemplate({ workspaceId: W, name: 'Mes de vacaciones', lines: [] });
    await ctx.templates.setDefault({ workspaceId: W, templateId: a.id });
    const second = await ctx.templates.setDefault({ workspaceId: W, templateId: b.id });
    expect(second.isDefault).toBe(true);
    expect((await ctx.templateQueries.get(W, a.id)).isDefault).toBe(false);
    expect((await ctx.templateQueries.list(W)).filter((t) => t.isDefault)).toHaveLength(1);
    const archived = await ctx.templates.archive({ workspaceId: W, templateId: b.id });
    expect(archived).toMatchObject({ status: 'ARCHIVED', isDefault: false });
    expect(await ctx.env.templates.findDefault(W)).toBeNull();
  });

  it('[TC-PLANNING-TEMPLATE-013] editar el plan no toca el template ni otros planes y marca la línea como modificada', async () => {
    const ctx = setupTemplates();
    const templateId = await ctx.estandar();
    const nov = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.nov.id,
      source: { kind: 'TEMPLATE', templateId },
    });
    const dec = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.dec.id,
      source: { kind: 'TEMPLATE', templateId },
    });
    const line = await ctx.budgets.updateLine({
      workspaceId: W,
      budgetId: nov.id,
      lineId: lineOf(nov.lines, SUPER).id,
      expectedVersion: 1,
      patch: { planned: money('1800.00') },
    });
    expect(line).toMatchObject({ planned: money('1800.00'), overridden: true });
    const stored = await ctx.templateQueries.get(W, templateId);
    expect(stored.currentVersionNo).toBe(2);
    expect(lineOf(stored.currentVersion.lines, SUPER).planned).toEqual(money('1600.00'));
    expect(lineOf((await ctx.queries.getBudget(W, dec.id)).lines, SUPER)).toMatchObject({
      planned: money('1600.00'),
      overridden: false,
    });
  });

  it('[TC-PLANNING-TEMPLATE-014] clonar crea un template independiente: la versión 3 del original no lo cambia', async () => {
    const ctx = setupTemplates();
    const templateId = await ctx.estandar();
    const clone = await ctx.templates.cloneTemplate({
      workspaceId: W,
      templateId,
      name: 'Mes de vacaciones',
      versionNo: 2,
    });
    expect(clone).toMatchObject({ currentVersionNo: 1, isDefault: false, name: 'Mes de vacaciones' });
    expect(lineOf(clone.currentVersion.lines, SUPER).planned).toEqual(money('1600.00'));
    await ctx.templates.publishVersion({
      workspaceId: W,
      templateId,
      baseVersionNo: 2,
      lines: [alquiler('9999.00')],
    });
    const after = await ctx.templateQueries.get(W, clone.id);
    expect(after.currentVersionNo).toBe(1);
    expect(lineOf(after.currentVersion.lines, ALQ).planned).toEqual(money('2800.00'));
    await reject(
      ctx.templates.cloneTemplate({ workspaceId: W, templateId, name: 'MES DE VACACIONES' }),
      'NAME_TAKEN',
    );
  });

  it('[TC-PLANNING-TEMPLATE-018] un template archivado no se aplica y los planes previos conservan su origen', async () => {
    const ctx = setupTemplates();
    const t = await ctx.templates.createTemplate({
      workspaceId: W,
      name: 'Mes de vacaciones',
      lines: [alquiler()],
    });
    const nov = await ctx.budgets.createBudget({
      workspaceId: W,
      periodId: ctx.periods.nov.id,
      source: { kind: 'TEMPLATE', templateId: t.id },
    });
    await ctx.templates.archive({ workspaceId: W, templateId: t.id });
    await reject(
      ctx.budgets.createBudget({
        workspaceId: W,
        periodId: ctx.periods.feb.id,
        source: { kind: 'TEMPLATE', templateId: t.id },
      }),
      'BUDGET_TEMPLATE_ARCHIVED',
    );
    await reject(
      ctx.templates.publishVersion({ workspaceId: W, templateId: t.id, baseVersionNo: 1, lines: [] }),
      'BUDGET_TEMPLATE_ARCHIVED',
    );
    await reject(ctx.templates.setDefault({ workspaceId: W, templateId: t.id }), 'BUDGET_TEMPLATE_ARCHIVED');
    expect((await ctx.queries.getBudget(W, nov.id)).templateVersion).toMatchObject({
      name: 'Mes de vacaciones',
      versionNo: 1,
    });
    const back = await ctx.templates.unarchive({ workspaceId: W, templateId: t.id });
    expect(back.status).toBe('ACTIVE');
  });

  it('desarchivar con el nombre ocupado por otro template activo se rechaza con NAME_TAKEN', async () => {
    const ctx = setupTemplates();
    const a = await ctx.templates.createTemplate({ workspaceId: W, name: 'Mes estándar', lines: [] });
    await ctx.templates.archive({ workspaceId: W, templateId: a.id });
    await ctx.templates.createTemplate({ workspaceId: W, name: 'Mes estándar', lines: [] });
    await reject(ctx.templates.unarchive({ workspaceId: W, templateId: a.id }), 'NAME_TAKEN');
  });
});
