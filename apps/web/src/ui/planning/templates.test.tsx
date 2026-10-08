import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { CAT, line as budgetLine } from './budget-fixtures';
import { OmittedLinesNotice, PlanOriginInfo } from './PlanOriginPanel';
import { PropagationView } from './PropagationPanel';
import { TemplateLinesTable } from './TemplateLinesTable';
import type { TargetNames } from './BudgetLinesTable';
import {
  compareVersions,
  groupByPeriod,
  hasPropagationChanges,
  linesFromPlan,
  lineInput,
  specInput,
  type LineSpec,
  type PropagationPreview,
  type TemplateLine,
} from './template-logic';

const f = esContext('Templates');
const fb = esContext('Budgets');
const names: TargetNames = {
  CATEGORY: new Map([
    [CAT.super, 'Supermercado'],
    [CAT.rest, 'Restaurantes'],
    [CAT.alquiler, 'Alquiler'],
    [CAT.salario, 'Salario'],
  ]),
  GROUP: new Map(),
  TAG: new Map(),
};
const bob = (amount: string) => ({ amount, currency: 'BOB' });

const spec = (over: Partial<LineSpec> = {}): LineSpec => ({
  kind: 'MAXIMUM',
  planned: bob('600.00'),
  min: null,
  max: null,
  percent: null,
  incomeBasis: null,
  rolloverPolicy: 'NONE',
  rolloverCap: null,
  thresholds: ['50', '75', '90', '100'],
  ...over,
});
const tline = (id: string, target: string, over: Partial<LineSpec> = {}): TemplateLine => ({
  id,
  target: { kind: 'CATEGORY', id: target },
  nature: 'EXPENSE',
  currency: 'BOB',
  ...spec(over),
});

const preview: PropagationPreview = {
  templateId: 't1',
  baseVersionNo: 2,
  newVersionPreview: { versionNo: 3, added: 0, updated: 1, removed: 0, lines: [] },
  periods: [
    { budgetId: 'b1', periodId: 'p1', periodLabel: '2026-12' },
    { budgetId: 'b2', periodId: 'p2', periodLabel: '2027-01' },
  ],
  changes: [
    {
      budgetId: 'b1',
      periodId: 'p1',
      periodLabel: '2026-12',
      action: 'UPDATE',
      target: { kind: 'CATEGORY', id: CAT.rest },
      from: spec(),
      to: spec({ planned: bob('650.00') }),
    },
  ],
  conflicts: [
    {
      budgetId: 'b2',
      periodId: 'p2',
      periodLabel: '2027-01',
      action: 'UPDATE',
      reason: 'OVERRIDDEN',
      target: { kind: 'CATEGORY', id: CAT.rest },
      current: spec({ planned: bob('700.00') }),
      proposed: spec({ planned: bob('650.00') }),
    },
  ],
  token: 'abc',
};

describe('Templates (planning/budget-templates 6.1)', () => {
  it('[TC-PLANNING-TEMPLATE-002] (UI) comparar la versión 1 con la 2 muestra solo la línea cambiada, con antes y después', () => {
    const v1 = [
      tline('a', CAT.alquiler, { kind: 'FIXED', planned: bob('2800.00') }),
      tline('b', CAT.super, { planned: bob('1500.00') }),
    ];
    const v2 = [
      tline('c', CAT.alquiler, { kind: 'FIXED', planned: bob('2800.00') }),
      tline('d', CAT.super, { planned: bob('1600.00') }),
    ];
    const rows = compareVersions(v1, v2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'CHANGED', target: { id: CAT.super } });
    expect(compareVersions(v1, v1)).toEqual([]);
    expect(compareVersions([], [v1[0]!])[0]?.kind).toBe('ADDED');
    expect(compareVersions([v1[0]!], [])[0]?.kind).toBe('REMOVED');
  });

  it('las líneas de una versión se muestran con tipo, monto, umbrales y remanente, con rótulos de tabla', () => {
    const html = renderToStaticMarkup(
      <TemplateLinesTable
        lines={[
          tline('a', CAT.alquiler, { kind: 'FIXED', planned: bob('2800.00'), thresholds: [] }),
          tline('b', CAT.super, { planned: bob('1500.00'), rolloverPolicy: 'CARRY_POSITIVE' }),
        ]}
        names={names}
        f={f}
        fb={fb}
        caption="Líneas de la versión 1"
      />,
    );
    const text = textOf(html);
    expect(text).toContain('Alquiler');
    expect(text).toContain('Fijo 2.800,00 BOB');
    expect(text).toContain('Máximo 1.500,00 BOB');
    expect(text).toContain('50, 75, 90, 100 %');
    expect(text).toContain('Trasladar solo el sobrante');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).not.toContain('<button');
  });

  it('el borrador permite editar y quitar con etiquetas accesibles; una versión sin líneas lo dice', () => {
    const lines = [tline('a', CAT.alquiler, { kind: 'FIXED', planned: bob('2800.00') })];
    const html = renderToStaticMarkup(
      <TemplateLinesTable
        lines={lines}
        names={names}
        f={f}
        fb={fb}
        caption="Borrador"
        onEdit={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Editar la línea Alquiler"');
    expect(html).toContain('aria-label="Quitar la línea Alquiler"');
    const empty = renderToStaticMarkup(
      <TemplateLinesTable lines={[]} names={names} f={f} fb={fb} caption="x" />,
    );
    expect(textOf(empty)).toContain('Esta versión no tiene líneas.');
  });

  it('[TC-PLANNING-TEMPLATE-015] (UI) la vista previa lista 2026-12 de 600,00 a 650,00 BOB y 2027-01 como línea que no se toca', () => {
    const html = renderToStaticMarkup(<PropagationView preview={preview} names={names} f={f} fb={fb} />);
    const text = textOf(html);
    expect(text).toContain(
      'Se publicará la versión 3 del template: 0 líneas agregadas, 1 cambiadas y 0 quitadas.',
    );
    expect(html).toMatch(/data-period="2026-12"/);
    expect(html).toMatch(/data-action="UPDATE"/);
    expect(text).toContain('Restaurantes');
    expect(text).toContain('Máximo 600,00 BOB');
    expect(text).toContain('Máximo 650,00 BOB');
    // conflicto: texto + icono (no solo color) y el valor que se conserva
    expect(html).toMatch(/data-reason="OVERRIDDEN"/);
    expect(text).toContain('la modificaste a mano');
    expect(text).toContain('se conserva');
    expect(text).toContain('Máximo 700,00 BOB');
    expect(html).toContain('aria-hidden="true">⚠');
    expect(
      groupByPeriod(preview).map((g) => [g.period.periodLabel, g.changes.length, g.conflicts.length]),
    ).toEqual([
      ['2026-12', 1, 0],
      ['2027-01', 0, 1],
    ]);
    expect(hasPropagationChanges(preview)).toBe(true);
    expect(
      hasPropagationChanges({ ...preview, newVersionPreview: { ...preview.newVersionPreview, updated: 0 } }),
    ).toBe(false);
  });

  it('sin planes alcanzados la vista previa lo dice', () => {
    const html = renderToStaticMarkup(
      <PropagationView
        preview={{ ...preview, periods: [], changes: [], conflicts: [] }}
        names={names}
        f={f}
        fb={fb}
      />,
    );
    expect(html).toContain('data-testid="propagation-no-periods"');
    expect(textOf(html)).toContain('No hay planes de periodos futuros en borrador');
  });

  it('[TC-PLANNING-TEMPLATE-007] (UI) las líneas omitidas se informan con su motivo', () => {
    const html = renderToStaticMarkup(
      <OmittedLinesNotice
        omitted={[
          { target: { kind: 'CATEGORY', id: CAT.rest }, reason: 'TARGET_ARCHIVED' },
          { target: { kind: 'CATEGORY', id: CAT.super }, reason: 'CURRENCY_MISMATCH' },
        ]}
        names={names}
        f={fb}
      />,
    );
    const text = textOf(html);
    expect(html).toContain('role="note"');
    expect(text).toContain('Algunas líneas no se copiaron');
    expect(text).toContain('Restaurantes: su categoría, grupo o tag está archivado.');
    expect(text).toContain('Supermercado: está en otra moneda que el plan.');
    expect(renderToStaticMarkup(<OmittedLinesNotice omitted={[]} names={names} f={fb} />)).toBe('');
  });

  it('[TC-PLANNING-TEMPLATE-004] (UI) el origen del plan se muestra con template y versión, o como clonado', () => {
    const render = (props: Parameters<typeof PlanOriginInfo>[0]) =>
      textOf(renderToStaticMarkup(<PlanOriginInfo {...props} />));
    expect(
      render({ origin: 'TEMPLATE', templateVersion: { name: 'Mes estándar', versionNo: 2 }, f: fb }),
    ).toBe('Origen: template Mes estándar, versión 2.');
    expect(render({ origin: 'CLONE', templateVersion: null, f: fb })).toBe(
      'Origen: clonado del plan del mes anterior.',
    );
    expect(
      render({ origin: 'CLONE', templateVersion: { name: 'Mes estándar', versionNo: 1 }, f: fb }),
    ).toContain('template Mes estándar, versión 1');
    expect(render({ origin: 'EMPTY', templateVersion: null, f: fb })).toBe('Origen: plan creado vacío.');
  });

  it('[TC-PLANNING-TEMPLATE-001] los cuerpos de línea no envían campos nulos y los montos viajan como texto decimal', () => {
    const body = lineInput(
      { kind: 'CATEGORY', id: CAT.alquiler },
      {
        kind: 'FIXED',
        planned: bob('2800.00'),
        min: null,
        max: null,
        percent: null,
        incomeBasis: null,
        rolloverPolicy: 'NONE',
        rolloverCap: null,
        thresholds: null,
      },
    );
    expect(body).toEqual({
      target: { kind: 'CATEGORY', id: CAT.alquiler },
      kind: 'FIXED',
      rolloverPolicy: 'NONE',
      planned: { amount: '2800.00', currency: 'BOB' },
    });
    expect(specInput({ kind: 'CATEGORY', id: CAT.super }, spec())).toMatchObject({
      kind: 'MAXIMUM',
      thresholds: ['50', '75', '90', '100'],
    });
    expect(specInput({ kind: 'CATEGORY', id: CAT.super }, spec({ thresholds: [] }))).not.toHaveProperty(
      'thresholds',
    );
  });

  it('[TC-PLANNING-TEMPLATE-006] crear un template desde un plan envía sus líneas tal cual (docs/33 D84)', () => {
    const plan = [
      budgetLine({ id: 'l1', kind: 'MAXIMUM', planned: bob('600.00'), progress: {} }),
      budgetLine({
        id: 'l2',
        kind: 'FIXED',
        planned: bob('8000.00'),
        nature: 'INCOME',
        target: { kind: 'CATEGORY', id: CAT.salario },
        progress: {},
      }),
    ];
    const lines = linesFromPlan(plan);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      kind: 'MAXIMUM',
      planned: bob('600.00'),
      thresholds: ['50', '75', '90', '100'],
    });
    expect(lines[1]).not.toHaveProperty('thresholds');
  });

  it('las claves de i18n de Templates existen en los tres idiomas', () => {
    const load = (lang: string) =>
      JSON.parse(readFileSync(new URL(`../../../messages/${lang}.json`, import.meta.url), 'utf8')) as Record<
        string,
        Record<string, unknown>
      >;
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix];
    const es = load('es');
    for (const lang of ['en', 'pt']) {
      const other = load(lang);
      expect(keys(other['Templates']).sort()).toEqual(keys(es['Templates']).sort());
      expect(keys((other['Budgets'] as Record<string, unknown>)['origin']).sort()).toEqual(
        keys((es['Budgets'] as Record<string, unknown>)['origin']).sort(),
      );
      expect(keys((other['Budgets'] as Record<string, unknown>)['propagate']).sort()).toEqual(
        keys((es['Budgets'] as Record<string, unknown>)['propagate']).sort(),
      );
    }
  });
});
