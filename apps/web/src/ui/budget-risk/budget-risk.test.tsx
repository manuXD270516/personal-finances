import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FormatContext } from '../dashboard/types';
import { textOf } from '../test-support';
import { BudgetRiskCell, BudgetRiskHomeCard, BudgetRiskLegend } from './BudgetRiskView';
import { budgetLineHref, riskSentence } from './logic';
import type { BudgetLineRisk } from './types';

const catalog = (locale: string) =>
  JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
const ctxOf = (locale: 'es' | 'en' | 'pt', formatLocale: string): FormatContext => {
  const tr = createTranslator({ locale, messages: catalog(locale), namespace: 'BudgetRisk' as never });
  return {
    locale: formatLocale,
    timeZone: 'America/La_Paz',
    t: (key, values) => tr(key as never, values as never),
    has: (key) => tr.has(key as never),
  };
};
const es = ctxOf('es', 'es-BO');

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const restaurants: BudgetLineRisk = {
  budgetLineId: '0190a000-0000-7000-8000-000000000101',
  target: { kind: 'CATEGORY', id: 'cat-1' },
  targetName: 'Restaurantes',
  reference: bob('600.00'),
  actual: bob('280.00'),
  variableActual: bob('280.00'),
  knownPending: bob('0.00'),
  projected: bob('840.00'),
  projectedHigh: null,
  projectionComplete: true,
  level: 'LIKELY',
  reason: null,
  estimatedDate: '2026-11-22',
  basis: 'RUN_RATE',
};

describe('Riesgo de exceder un presupuesto (UI)', () => {
  it('[TC-REPORTING-INSIGHT-012] la línea muestra riesgo probable, proyección 840,00, exceso estimado el 22/11/2026 y la base', () => {
    const html = renderToStaticMarkup(<BudgetRiskCell risk={restaurants} f={es} />);
    const text = textOf(html);
    expect(html).toContain('data-level="LIKELY"');
    expect(text).toContain('Probable');
    expect(text).toContain('Proyección 840,00 BOB');
    expect(text).toContain('exceso estimado alrededor del 22/11/2026');
    expect(text).toContain('según el ritmo del periodo');
    // El icono es decorativo y el nivel va como texto (no solo color).
    expect(html).toMatch(/<span aria-hidden="true">▲<\/span> Probable/);
  });

  it('[TC-REPORTING-INSIGHT-012] el riesgo posible muestra la proyección alta y la leyenda lo explica', () => {
    const possible: BudgetLineRisk = {
      ...restaurants,
      level: 'POSSIBLE',
      projected: bob('1400.00'),
      projectedHigh: bob('1620.00'),
      basis: 'FORECAST',
    };
    const text = textOf(renderToStaticMarkup(<BudgetRiskCell risk={possible} f={es} />));
    expect(text).toContain('Posible');
    expect(text).toContain('alta 1.620,00 BOB');
    expect(text).toContain('según el pronóstico');
    expect(textOf(renderToStaticMarkup(<BudgetRiskLegend lines={[possible]} f={es} />))).toContain(
      'solo ocurriría si el gasto se acerca a lo alto',
    );
    expect(textOf(renderToStaticMarkup(<BudgetRiskLegend lines={[restaurants]} f={es} />))).not.toContain(
      '«Posible»',
    );
  });

  it('[TC-REPORTING-INSIGHT-012] sin riesgo calculable muestra el motivo y sin cifras', () => {
    const early: BudgetLineRisk = {
      ...restaurants,
      level: 'NOT_AVAILABLE',
      reason: 'TOO_EARLY',
      projected: null,
      estimatedDate: null,
      basis: null,
    };
    const text = textOf(renderToStaticMarkup(<BudgetRiskCell risk={early} f={es} />));
    expect(text).toContain('No disponible');
    expect(text).toContain('Faltan datos del periodo');
    expect(text).not.toContain('Proyección');
  });

  it('[TC-REPORTING-INSIGHT-013] el texto habla de ritmo y fecha estimada en es-BO, en-US y pt-BR, sin certezas', () => {
    expect(riskSentence(restaurants, es)).toBe(
      'Con el ritmo actual, Restaurantes superaría su tope alrededor del 22/11/2026.',
    );
    expect(riskSentence(restaurants, ctxOf('en', 'en-US'))).toBe(
      'At the current pace, Restaurantes would exceed its limit around 11/22/2026.',
    );
    expect(riskSentence(restaurants, ctxOf('pt', 'pt-BR'))).toBe(
      'No ritmo atual, Restaurantes ultrapassaria o limite por volta de 22/11/2026.',
    );
    for (const [locale, fl] of [
      ['es', 'es-BO'],
      ['en', 'en-US'],
      ['pt', 'pt-BR'],
    ] as const) {
      const c = ctxOf(locale, fl);
      for (const line of [
        restaurants,
        { ...restaurants, level: 'POSSIBLE' },
        { ...restaurants, estimatedDate: null },
      ]) {
        expect(riskSentence(line, c)).not.toMatch(
          /\b(seguro|certeza|inevitable|will exceed|certain|inevit|vai ultrapassar)\b/i,
        );
      }
    }
    expect(riskSentence({ ...restaurants, level: 'UNLIKELY' }, es)).toBeUndefined();
  });

  it('[TC-REPORTING-INSIGHT-018] la tarjeta de Q5 lista las líneas con su enlace al plan y el resto', () => {
    const services: BudgetLineRisk = {
      ...restaurants,
      budgetLineId: 'line-2',
      targetName: 'Servicios',
      estimatedDate: '2026-11-21',
    };
    const html = renderToStaticMarkup(
      <BudgetRiskHomeCard
        block={{ periodId: 'p', periodLabel: '2026-11', lines: [services, restaurants], moreCount: 2 }}
        f={es}
        href={(path) => `/es${path}`}
      />,
    );
    const text = textOf(html);
    expect(text).toContain('Presupuestos en riesgo');
    expect(text.indexOf('Servicios')).toBeLessThan(text.indexOf('Restaurantes'));
    expect(text).toContain('y 2 líneas más en riesgo en el plan');
    expect(html).toContain(`href="/es${budgetLineHref('2026-11', 'line-2').replace('&', '&amp;')}"`);
  });

  it('[TC-REPORTING-INSIGHT-019] sin líneas en riesgo la tarjeta no se muestra', () => {
    expect(renderToStaticMarkup(<BudgetRiskHomeCard block={null} f={es} href={(p) => p} />)).toBe('');
    expect(
      renderToStaticMarkup(
        <BudgetRiskHomeCard
          block={{ periodId: 'p', periodLabel: '2026-11', lines: [], moreCount: 0 }}
          f={es}
          href={(p) => p}
        />,
      ),
    ).toBe('');
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-001] las preferencias muestran el tipo de riesgo de presupuesto en los tres idiomas', () => {
    for (const locale of ['es', 'en', 'pt']) {
      const n = catalog(locale)['Notifications'] as {
        types?: Record<string, string>;
        preferences?: { types?: Record<string, string> };
      };
      const json = JSON.stringify(n);
      expect(json).toContain('BUDGET_OVERRUN_RISK');
    }
  });
});
