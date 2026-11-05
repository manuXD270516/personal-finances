import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { CAT, SUPERMERCADO_MAXIMO, plan } from './budget-fixtures';
import { BudgetLinesTable, type TargetNames } from './BudgetLinesTable';
import { ExplanationView, SuggestionsTable } from './SuggestionsPanel';
import {
  confirmBody,
  diffTone,
  lineKey,
  parseEdited,
  periodAction,
  requestBody,
  validateParams,
  withOverride,
  type SuggestionLine,
  type SuggestionPreview,
} from './suggestion-logic';

const f = esContext('Suggestions');
const fb = esContext('Budgets');
const names: TargetNames = {
  CATEGORY: new Map([[CAT.super, 'Supermercado']]),
  GROUP: new Map(),
  TAG: new Map(),
};
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const period = (label: string, status: string, actual: string | null, id: string | null = `id-${label}`) => ({
  periodId: id,
  label,
  start: `${label}-01`,
  end: `${label}-28`,
  closed: label < '2026-08',
  actual: actual ? bob(actual) : null,
  status,
});

const SUPER_LINE: SuggestionLine = {
  target: { kind: 'CATEGORY', id: CAT.super },
  targetName: 'Supermercado',
  nature: 'EXPENSE',
  kind: 'MAXIMUM',
  existingLineId: 'l1',
  currentAmount: bob('1500.00'),
  suggestedAmount: bob('1480.00'),
  difference: bob('-20.00'),
  status: 'OK',
  explanation: {
    method: 'AVERAGE',
    periodsRequested: 6,
    adjustmentPercent: '0.00',
    roundingIncrement: null,
    usedCount: 5,
    minValid: 3,
    outlierRule: 'TUKEY_1_5_IQR',
    q1: '1420.00',
    q3: '1610.00',
    mean: '1480.00',
    median: '1474.50',
    suggested: bob('1480.00'),
    periods: [
      period('2026-05', 'USED', '1420.00'),
      period('2026-06', 'USED', '1515.50'),
      period('2026-07', 'USED', '1380.00'),
      period('2026-08', 'OUTLIER', '3950.00'),
      period('2026-09', 'USED', '1610.00'),
      period('2026-10', 'INCOMPLETE', null, null),
    ],
  },
};
const PERCENT_LINE: SuggestionLine = {
  ...SUPER_LINE,
  target: { kind: 'CATEGORY', id: 'don' },
  targetName: 'Donaciones',
  kind: 'PERCENT_OF_INCOME',
  currentAmount: null,
  suggestedAmount: null,
  difference: null,
  status: 'NOT_APPLICABLE',
  explanation: null,
};
const preview = (lines: SuggestionLine[]): SuggestionPreview => ({
  periodId: 'p',
  budgetId: 'b',
  budgetVersion: 3,
  currency: 'BOB',
  method: 'AVERAGE',
  periods: 6,
  adjustmentPercent: '0.00',
  roundingIncrement: null,
  token: 'a'.repeat(64),
  window: [],
  lines,
});

describe('Sugerir desde el historial (planning/budgets, add-historical-budgets 6.1-6.3)', () => {
  it('[TC-PLANNING-HISTBUDGET-016] (UI) la explicación lista los periodos con real y estado en texto, promedio, mediana y diferencia', () => {
    const html = renderToStaticMarkup(
      <ExplanationView
        line={SUPER_LINE}
        explanation={SUPER_LINE.explanation!}
        f={f}
        onPeriod={() => undefined}
      />,
    );
    const text = textOf(html);
    expect(html.match(/data-testid="explanation-period"/g)).toHaveLength(6);
    expect(text).toContain('3.950,00 BOB');
    expect(text).toContain('Atípico (excluido)');
    expect(text).toContain('Incompleto (primera actividad)');
    expect(text).toContain('Promedio: 1.480,00 BOB');
    expect(text).toContain('Mediana: 1.474,50 BOB');
    expect(text).toContain('Valores usados: 5');
    expect(text).toContain('Q1 1.420,00 BOB');
    expect(text).toContain('Vigente: 1.500,00 BOB');
    expect(text).toContain('Según tus categorías de hoy');
    expect(text).toContain('cerrado');
    expect(text).toContain('no cerrado (datos no congelados)');
    // el atípico se puede reincluir; el incompleto (y el periodo sin fila) no ofrecen acción
    expect(html.match(/data-testid="period-include"/g)).toHaveLength(1);
    expect(html.match(/data-testid="period-exclude"/g)).toHaveLength(4);
  });

  it('[TC-PLANNING-HISTBUDGET-017] (UI) la línea de porcentaje de ingresos muestra "No aplica" y no ofrece elegirla', () => {
    const html = renderToStaticMarkup(
      <SuggestionsTable
        preview={preview([SUPER_LINE, PERCENT_LINE])}
        names={names}
        f={f}
        canConfirm
        picked={new Set()}
        amounts={{}}
        invalid={new Set()}
      />,
    );
    expect(textOf(html)).toContain('No aplica (porcentaje de ingresos)');
    expect(html.match(/data-testid="suggestion-pick"/g)).toHaveLength(1);
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });

  it('[TC-PLANNING-HISTBUDGET-020] (UI) la diferencia se dice con texto e icono y la línea elegida muestra el monto editable', () => {
    const key = lineKey(SUPER_LINE.target);
    const html = renderToStaticMarkup(
      <SuggestionsTable
        preview={preview([SUPER_LINE])}
        names={names}
        f={f}
        canConfirm
        picked={new Set([key])}
        amounts={{ [key]: '1480.00' }}
        invalid={new Set([key])}
      />,
    );
    const text = textOf(html);
    expect(text).toContain('-20,00 BOB');
    expect(text).toContain('menos que el vigente');
    expect(html).toContain('▼');
    expect(html).toContain('data-testid="suggestion-amount"');
    expect(text).toContain('Escribe un monto válido');
    expect(diffTone(SUPER_LINE)).toBe('DOWN');
  });

  it('un VIEWER ve la vista previa pero no puede elegir ni editar', () => {
    const html = renderToStaticMarkup(
      <SuggestionsTable
        preview={preview([SUPER_LINE])}
        names={names}
        f={f}
        canConfirm={false}
        picked={new Set()}
        amounts={{}}
        invalid={new Set()}
      />,
    );
    expect(html).not.toContain('suggestion-pick');
    expect(html).not.toContain('period-exclude');
    expect(textOf(html)).toContain('1.480,00 BOB');
  });

  it('[TC-PLANNING-HISTBUDGET-024] (UI) la línea del plan indica "sugerido desde el historial" y "modificado después"', () => {
    const base = {
      ...SUPERMERCADO_MAXIMO,
      historyBasis: { method: 'AVERAGE', usedCount: 5, suggested: bob('1480.00'), applied: bob('1480.00') },
    } as const;
    const same = renderToStaticMarkup(
      <BudgetLinesTable
        budget={plan([{ ...base, historyBasis: { ...base.historyBasis, modifiedAfterSuggestion: false } }])}
        names={names}
        f={fb}
        canEdit
      />,
    );
    expect(textOf(same)).toContain('Sugerido desde el historial');
    expect(textOf(same)).not.toContain('modificado después');
    const modified = renderToStaticMarkup(
      <BudgetLinesTable
        budget={plan([{ ...base, historyBasis: { ...base.historyBasis, modifiedAfterSuggestion: true } }])}
        names={names}
        f={fb}
        canEdit
      />,
    );
    expect(textOf(modified)).toContain('Sugerido desde el historial · modificado después');
    const none = renderToStaticMarkup(
      <BudgetLinesTable budget={plan([SUPERMERCADO_MAXIMO])} names={names} f={fb} canEdit />,
    );
    expect(none).not.toContain('line-history-basis');
  });

  it('valida N, ajuste y redondeo con el formato del locale', () => {
    const ok = validateParams(
      { method: 'AVERAGE', periods: '4', adjustment: '10,5', rounding: '50' },
      'es-BO',
    );
    expect(ok).toEqual({
      ok: true,
      body: { method: 'AVERAGE', periods: 4, adjustmentPercent: '10.5', roundingIncrement: 50 },
    });
    expect(
      validateParams({ method: 'AVERAGE', periods: '13', adjustment: '', rounding: '' }, 'es-BO'),
    ).toEqual({
      ok: false,
      errors: { periods: 'invalid' },
    });
    for (const adjustment of ['1000,01', '-100,01', '1,234', 'abc']) {
      expect(
        validateParams({ method: 'SAME_PERIOD_LAST_YEAR', periods: '', adjustment, rounding: '' }, 'es-BO'),
      ).toEqual({ ok: false, errors: { adjustment: 'invalid' } });
    }
    expect(
      validateParams(
        { method: 'SAME_PERIOD_LAST_YEAR', periods: '', adjustment: '-100', rounding: '' },
        'es-BO',
      ),
    ).toMatchObject({ ok: true, body: { adjustmentPercent: '-100' } });
  });

  it('[TC-PLANNING-HISTBUDGET-010] [TC-PLANNING-HISTBUDGET-011] excluir y reincluir periodos arma los ajustes de la solicitud', () => {
    const key = lineKey(SUPER_LINE.target);
    let overrides = withOverride(new Map(), key, 'id-2026-08', 'include');
    overrides = withOverride(overrides, key, 'id-2026-10', 'exclude');
    const body = requestBody('p', { method: 'AVERAGE', periods: 6, roundingIncrement: null }, overrides);
    expect(body.overrides).toEqual([
      {
        target: { kind: 'CATEGORY', id: CAT.super },
        excludePeriodIds: ['id-2026-10'],
        includePeriodIds: ['id-2026-08'],
      },
    ]);
    expect(
      withOverride(withOverride(overrides, key, 'id-2026-08', 'clear'), key, 'id-2026-10', 'clear').size,
    ).toBe(0);
    expect(periodAction({ periodId: 'x', status: 'USED' })).toBe('exclude');
    expect(periodAction({ periodId: 'x', status: 'OUTLIER' })).toBe('include');
    expect(periodAction({ periodId: 'x', status: 'USER_EXCLUDED' })).toBe('clear');
    expect(periodAction({ periodId: 'x', status: 'NO_RATE' })).toBeNull();
    expect(periodAction({ periodId: null, status: 'USED' })).toBeNull();
  });

  it('[TC-PLANNING-HISTBUDGET-021] el monto escrito se valida (sin negativos ni más decimales) y vacío usa el sugerido; la confirmación lleva solo lo elegido', () => {
    const opts = { locale: 'es-BO', currency: 'BOB', scale: 2 };
    expect(parseEdited('', '1480.00', opts)).toEqual({ ok: true, value: '1480.00' });
    expect(parseEdited('650,5', '1480.00', opts)).toEqual({ ok: true, value: '650.50' });
    expect(parseEdited('-10', '1480.00', opts)).toEqual({ ok: false });
    expect(parseEdited('10,555', '1480.00', opts)).toEqual({ ok: false });
    const body = confirmBody(preview([SUPER_LINE]), { periodId: 'p' }, [
      { line: SUPER_LINE, amount: '650.00' },
    ]);
    expect(body).toMatchObject({
      token: 'a'.repeat(64),
      lines: [
        {
          target: SUPER_LINE.target,
          amount: bob('650.00'),
          suggestedAmount: bob('1480.00'),
        },
      ],
    });
    expect(body.lines[0]).not.toHaveProperty('kind');
    const created = confirmBody(preview([]), {}, [
      { line: { ...SUPER_LINE, existingLineId: null }, amount: '1480.00' },
    ]);
    expect(created.lines[0]).toMatchObject({ kind: 'MAXIMUM' });
  });

  it('las claves es, en y pt del namespace Suggestions son las mismas', () => {
    const read = (l: string) =>
      JSON.parse(readFileSync(new URL(`../../../messages/${l}.json`, import.meta.url), 'utf8')) as Record<
        string,
        unknown
      >;
    const keys = (o: unknown, prefix = ''): string[] =>
      typeof o === 'object' && o !== null
        ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix];
    const es = keys(read('es')['Suggestions']).sort();
    expect(keys(read('en')['Suggestions']).sort()).toEqual(es);
    expect(keys(read('pt')['Suggestions']).sort()).toEqual(es);
    for (const l of ['en', 'pt']) {
      const errors = read(`errors.${l}`);
      expect(errors['BUDGET_SUGGESTION_STALE']).toBeTruthy();
    }
  });
});
