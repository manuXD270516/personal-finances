import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FormatContext } from '../dashboard/types';
import { esContext, textOf as rawTextOf } from '../test-support';
import { AcceptanceRateView } from './AcceptanceRateCard';
import {
  chipCategoryId,
  counterpartySuggestionPath,
  feedbackPath,
  monthRange,
  queryBody,
  queryPath,
  rateText,
  reasonText,
  resolveChip,
  suggestionCounts,
  type HistorySuggestion,
  type SuggestionStats,
} from './logic';
import { RowSuggestion } from './RowSuggestion';
import { SuggestionChip } from './SuggestionChip';

const RESTAURANTES = '0190a000-0000-7000-8000-0000000000d2';
const FARMACIA = '0190a000-0000-7000-8000-0000000000f1';
const CP = '0190a000-0000-7000-8000-0000000000c9';

const history = (over: Partial<HistorySuggestion> = {}): HistorySuggestion => ({
  categoryId: RESTAURANTES,
  confidence: '0.9000',
  level: 'HIGH',
  support: 10,
  matches: 9,
  basis: 'DESCRIPTION',
  descriptionKey: 'pedidosya',
  counterpartyId: null,
  ...over,
});

/** Texto visible con las comillas HTML ya resueltas. */
const textOf = (html: string): string => rawTextOf(html).replace(/&quot;/gu, '"');

const f = esContext('CategorySuggestions');
const names = (id: string) => ({ [RESTAURANTES]: 'Restaurantes', [FARMACIA]: 'Farmacia' })[id] ?? id;
const cpName = (id: string | null) => (id === CP ? 'Farmacorp' : undefined);

function contextOf(locale: 'en' | 'pt'): FormatContext {
  const messages = JSON.parse(
    readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const tr = createTranslator({ locale, messages, namespace: 'CategorySuggestions' as never });
  return {
    locale: locale === 'en' ? 'en-US' : 'pt-BR',
    timeZone: 'America/La_Paz',
    t: (key, values) => tr(key as never, values as never),
    has: (key) => tr.has(key as never),
  };
}

describe('motivo de la sugerencia (plantilla es/en/pt)', () => {
  it('[TC-CLASSIFICATION-AUTO-017] 9 de 10 gastos con la clave pedidosya: el motivo lo dice en los tres idiomas', () => {
    const s = history();
    const input = { category: 'Restaurantes', kind: 'EXPENSE' as const };
    expect(reasonText(f, s, input)).toBe('Elegiste "Restaurantes" en 9 de 10 gastos parecidos a "pedidosya"');
    expect(reasonText(contextOf('en'), s, input)).toBe(
      'You chose "Restaurantes" for 9 of 10 expenses similar to "pedidosya"',
    );
    expect(reasonText(contextOf('pt'), s, input)).toBe(
      'Você escolheu "Restaurantes" em 9 de 10 despesas parecidos com "pedidosya"',
    );
  });

  it('[TC-CLASSIFICATION-AUTO-017] por contraparte y por los dos patrones nombra la contraparte y la clave normalizada, no la descripción original', () => {
    const byCounterparty = history({
      basis: 'COUNTERPARTY',
      descriptionKey: null,
      counterpartyId: CP,
      support: 4,
      matches: 4,
    });
    expect(
      reasonText(f, byCounterparty, { category: 'Farmacia', counterparty: 'Farmacorp', kind: 'EXPENSE' }),
    ).toBe('Elegiste "Farmacia" en 4 de 4 gastos con "Farmacorp"');
    const both = history({ basis: 'BOTH', counterpartyId: CP, descriptionKey: 'compra tarj farmacorp suc' });
    const text = reasonText(f, both, { category: 'Farmacia', kind: 'INCOME' });
    expect(text).toContain('ingresos parecidos a "compra tarj farmacorp suc" y de la misma contraparte');
    expect(text).not.toContain('****');
  });
});

describe('qué se muestra en el alta manual', () => {
  it('[TC-CLASSIFICATION-AUTO-013] la consulta viaja por POST con la descripción en el cuerpo y nunca en la URL', () => {
    const body = queryBody({
      kind: 'EXPENSE',
      description: '  PEDIDOSYA *8812 ',
      counterpartyId: '',
      accountId: 'acc-1',
      date: '2026-11-03',
    });
    expect(body).toEqual({
      kind: 'EXPENSE',
      description: 'PEDIDOSYA *8812',
      accountId: 'acc-1',
      date: '2026-11-03',
    });
    const url = queryPath('/api/v1/workspaces/w1');
    expect(url).toBe('/api/v1/workspaces/w1/category-suggestions/query');
    expect(url).not.toMatch(/pedidosya/iu);
    expect(counterpartySuggestionPath('/b', CP, 'REFUND')).toBe(
      `/b/counterparties/${CP}/category-suggestion?kind=EXPENSE`,
    );
    expect(feedbackPath('/b')).toBe('/b/category-suggestions/feedback');
  });

  it('sin descripción ni contraparte no hay nada que consultar', () => {
    expect(
      queryBody({ kind: 'EXPENSE', description: '   ', counterpartyId: '', accountId: '', date: '' }),
    ).toBeNull();
    expect(
      queryBody({ kind: 'INCOME', description: '', counterpartyId: CP, accountId: '', date: '' }),
    ).toEqual({ kind: 'INCOME', counterpartyId: CP });
  });

  it('[TC-CLASSIFICATION-AUTO-025] la sugerencia por historial reemplaza a la última categoría usada; el defecto de la contraparte y la regla mandan', () => {
    const lastUsed = { categoryId: 'cat-regalos', source: 'LAST_USED' as const };
    const suggested = {
      status: 'SUGGESTED' as const,
      suggestion: history({ categoryId: FARMACIA, confidence: '0.8000' }),
      ruleId: null,
    };
    expect(resolveChip(lastUsed, suggested)).toMatchObject({ source: 'HISTORY' });
    expect(chipCategoryId(resolveChip(lastUsed, suggested)!)).toBe(FARMACIA);
    // Sin historial queda la última usada.
    expect(resolveChip(lastUsed, { status: 'NONE', suggestion: null, ruleId: null })).toEqual({
      source: 'LAST_USED',
      categoryId: 'cat-regalos',
    });
    // La categoría por defecto de la contraparte (FR-CLASSIFICATION-011) va antes que el historial.
    expect(resolveChip({ categoryId: 'cat-def', source: 'DEFAULT' }, suggested)).toEqual({
      source: 'DEFAULT',
      categoryId: 'cat-def',
    });
    // Una regla de alta manual que clasificará el gasto: aviso, sin categoría propuesta.
    const rule = resolveChip(
      { categoryId: 'cat-def', source: 'DEFAULT' },
      { status: 'RULE_APPLIES', suggestion: null, ruleId: 'r1' },
    );
    expect(rule).toEqual({ source: 'RULE_APPLIES', ruleId: 'r1' });
    expect(chipCategoryId(rule!)).toBeNull();
    expect(resolveChip(null, { status: 'DISABLED', suggestion: null, ruleId: null })).toBeNull();
    expect(resolveChip({ categoryId: null, source: 'NONE' }, null)).toBeNull();
  });

  it('[TC-CLASSIFICATION-AUTO-013] el chip muestra la categoría con su nivel y su motivo, ofrece Aceptar u Otra y no asigna nada', () => {
    const html = renderToStaticMarkup(
      <SuggestionChip
        f={f}
        chip={{ source: 'HISTORY', suggestion: history() }}
        kind="EXPENSE"
        categoryName={names}
        counterpartyName={cpName}
        accepted={false}
        onAccept={() => undefined}
        onOther={() => undefined}
      />,
    );
    expect(html).toContain('data-testid="category-suggestion"');
    expect(html).toContain('data-level="HIGH"');
    expect(textOf(html)).toContain('Sugerida: Restaurantes · confianza alta');
    expect(textOf(html)).toContain('Elegiste "Restaurantes" en 9 de 10 gastos parecidos a "pedidosya"');
    expect(html).toContain('data-testid="category-suggestion-accept"');
    expect(html).toContain('data-testid="category-suggestion-other"');
    expect(html).toContain('aria-label="Aceptar la categoría sugerida Restaurantes"');
  });

  it('[TC-CLASSIFICATION-AUTO-012] aceptada, el chip lo dice y deja de ofrecer los botones; una regla solo avisa', () => {
    const accepted = renderToStaticMarkup(
      <SuggestionChip
        f={f}
        chip={{ source: 'HISTORY', suggestion: history() }}
        kind="EXPENSE"
        categoryName={names}
        counterpartyName={cpName}
        accepted
        onAccept={() => undefined}
        onOther={() => undefined}
      />,
    );
    expect(textOf(accepted)).toContain('Categoría sugerida aceptada: Restaurantes');
    expect(accepted).not.toContain('category-suggestion-accept');
    const rule = renderToStaticMarkup(
      <SuggestionChip
        f={f}
        chip={{ source: 'RULE_APPLIES', ruleId: 'r1' }}
        kind="EXPENSE"
        categoryName={names}
        counterpartyName={cpName}
        accepted={false}
        onAccept={() => undefined}
        onOther={() => undefined}
      />,
    );
    expect(textOf(rule)).toContain('Una regla clasificará este movimiento al guardarlo');
    expect(rule).not.toContain('category-suggestion-accept');
  });
});

describe('vista previa del import', () => {
  it('[TC-CLASSIFICATION-AUTO-014] la fila muestra su sugerencia con nivel y motivo y, para quien escribe, el botón Aceptar', () => {
    const render = (canEdit: boolean) =>
      renderToStaticMarkup(
        <RowSuggestion
          f={f}
          suggestion={history({ level: 'MEDIUM', matches: 3, support: 4, confidence: '0.7500' })}
          kind="EXPENSE"
          line={7}
          categoryName={names}
          counterpartyName={cpName}
          canEdit={canEdit}
          busy={false}
          onAccept={() => undefined}
        />,
      );
    const editable = render(true);
    expect(textOf(editable)).toContain('Sugerida: Restaurantes · confianza media');
    expect(editable).toContain('aria-label="Aceptar la categoría sugerida Restaurantes en la línea 7"');
    expect(render(false)).not.toContain('import-row-suggestion-accept');
  });

  it('cuenta las filas con sugerencia por nivel', () => {
    expect(
      suggestionCounts([
        { suggestedCategory: history() },
        { suggestedCategory: history({ level: 'MEDIUM' }) },
        { suggestedCategory: history() },
        { suggestedCategory: null },
        {},
      ]),
    ).toEqual({ high: 2, medium: 1 });
  });
});

describe('tasa de aceptación', () => {
  const stats = (over: Partial<SuggestionStats> = {}): SuggestionStats => ({
    from: '2026-11-01',
    to: '2026-11-30',
    shown: 20,
    accepted: 15,
    corrected: 3,
    ignored: 2,
    acceptanceRate: '0.7500',
    bySurface: [
      { surface: 'MANUAL_ENTRY', shown: 8, accepted: 6, corrected: 1, ignored: 1 },
      { surface: 'IMPORT', shown: 12, accepted: 9, corrected: 2, ignored: 1 },
    ],
    byLevel: [],
    ...over,
  });

  it('[TC-CLASSIFICATION-AUTO-018] el mes con 15 aceptadas de 20 muestra 75 % y el desglose por canal', () => {
    const html = renderToStaticMarkup(<AcceptanceRateView stats={stats()} f={f} locale="es-BO" />);
    expect(textOf(html)).toContain('20 mostradas · 15 aceptadas · 3 corregidas · 2 ignoradas');
    expect(html).toContain('data-testid="acceptance-rate"');
    expect(textOf(html)).toMatch(/Tasa de aceptación: 75\s?%/u);
    expect(textOf(html)).toContain('Alta manual: 8 mostradas');
    expect(textOf(html)).toContain('Importación: 12 mostradas');
  });

  it('sin sugerencias resueltas el mes lo dice y no inventa una tasa', () => {
    const html = renderToStaticMarkup(
      <AcceptanceRateView
        stats={stats({
          shown: 0,
          accepted: 0,
          corrected: 0,
          ignored: 0,
          acceptanceRate: null,
          bySurface: [],
        })}
        f={f}
        locale="es-BO"
      />,
    );
    expect(textOf(html)).toContain('Todavía no hay sugerencias resueltas este mes.');
    expect(rateText(null, 'es-BO')).toBe('—');
  });

  it('el rango del mes cubre del primero al último día (zona America/La_Paz)', () => {
    expect(monthRange('2026-11-25')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});
