import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import {
  costExportPath,
  costPath,
  costQuery,
  DEFAULT_COST_FILTERS,
  filterError,
  type ConversionCostAnalysis,
  type ConversionCostGroup,
} from './conversion-costs-logic';
import { ConversionCostsView } from './ConversionCostsView';

const f = esContext('ConversionCosts');
const bob = (amount: string) => ({ amount, currency: 'BOB' });

const BINANCE: ConversionCostGroup = {
  period: { label: '2026-10', from: '2026-10-01', to: '2026-10-31' },
  channel: { kind: 'COUNTERPARTY', counterpartyId: 'cp1', name: 'Binance P2P' },
  sourceAccountId: 'a1',
  sourceAccountName: 'Wallet USDT',
  targetAccountId: 'a2',
  targetAccountName: 'Banco BOB',
  pair: { base: 'USDT', quote: 'BOB' },
  conversions: 2,
  converted: bob('4800.00'),
  spreadPct: '0.5833',
  spreadAmount: bob('28.00'),
  fees: bob('2.00'),
  costTotal: bob('30.00'),
  costComplete: true,
  unvaluedFees: [],
  excluded: [{ reason: 'NO_REFERENCE', count: 1, amounts: [{ amount: '20.000000', currency: 'USDT' }] }],
  alternative: null,
};
const SIN_CANAL: ConversionCostGroup = {
  ...BINANCE,
  channel: { kind: 'NONE', counterpartyId: null, name: null },
  sourceAccountName: 'Banco BOB',
  targetAccountName: 'Wallet USDT',
  conversions: 1,
  converted: bob('600.00'),
  spreadPct: '1.6667',
  spreadAmount: bob('10.00'),
  fees: bob('0.00'),
  costTotal: bob('10.00'),
  excluded: [],
};
const ANALYSIS: ConversionCostAnalysis = {
  reportingCurrency: 'BOB',
  grouping: 'FINANCIAL_PERIOD',
  from: '2026-10-01',
  to: '2026-10-31',
  groups: [BINANCE, SIN_CANAL],
  totals: {
    conversions: 3,
    converted: bob('5400.00'),
    spreadAmount: bob('38.00'),
    fees: bob('2.00'),
    costTotal: bob('40.00'),
    excludedCount: 1,
    costComplete: true,
  },
  meta: { generatedAt: '2026-10-20T16:00:00Z', timeZone: 'America/La_Paz', rateWindowDays: 7 },
};

const render = (
  analysis: ConversionCostAnalysis | undefined,
  over: Partial<Parameters<typeof ConversionCostsView>[0]> = {},
) =>
  renderToStaticMarkup(
    <ConversionCostsView
      f={f}
      draft={DEFAULT_COST_FILTERS}
      onDraft={() => undefined}
      onApply={() => undefined}
      analysis={analysis}
      exportHref="/api/bff/v1/workspaces/w1/reports/conversion-costs/export?grouping=FINANCIAL_PERIOD"
      fxHref="/es/fx"
      {...over}
    />,
  );

describe('vista Costo de conversiones (add-conversion-cost-analysis, TC-FX-COST-009)', () => {
  it('[TC-FX-COST-009] muestra Binance P2P con 0,5833 % y 30,00 BOB y Sin canal con 1,6667 % en es-BO', () => {
    const html = render(ANALYSIS);
    const text = textOf(html);
    expect(text).toContain('Costo de conversiones');
    const rows = html.split('data-testid="cost-row"').slice(1);
    expect(rows).toHaveLength(2);
    expect(textOf(rows[0] ?? '')).toContain('Binance P2P');
    expect(textOf(rows[0] ?? '')).toContain('Wallet USDT → Banco BOB');
    expect(textOf(rows[0] ?? '')).toContain('4.800,00 BOB');
    expect(textOf(rows[0] ?? '')).toContain('0,5833 %');
    expect(textOf(rows[0] ?? '')).toContain('30,00 BOB');
    expect(textOf(rows[1] ?? '')).toContain('Sin canal');
    expect(textOf(rows[1] ?? '')).toContain('1,6667 %');
    expect(text).toContain('1 sin tasa de referencia (20,000000 USDT)');
    expect(text).toContain('Total');
    expect(text).toContain('40,00 BOB');
  });

  it('[TC-FX-COST-009] tiene tabla accesible (caption, encabezados de columna), filtros rotulados y exportación CSV', () => {
    const html = render(ANALYSIS);
    expect(html).toContain('<caption');
    expect(html.match(/<th scope="col"/g)?.length).toBeGreaterThanOrEqual(10);
    expect(html).toContain('data-testid="costs-export"');
    expect(html).toContain('download');
    expect(html).toContain(
      'href="/api/bff/v1/workspaces/w1/reports/conversion-costs/export?grouping=FINANCIAL_PERIOD"',
    );
    for (const label of ['Desde (fecha de negocio)', 'Hasta (fecha de negocio)', 'Agrupar por']) {
      expect(textOf(html)).toContain(label);
    }
    expect(html).toContain('Periodo financiero');
    expect(html).toContain('Mes calendario');
  });

  it('un grupo con costo incompleto avisa la comisión sin tasa; sin conversiones dice que no hay', () => {
    const incomplete = {
      ...ANALYSIS,
      groups: [{ ...BINANCE, costComplete: false, unvaluedFees: [{ amount: '15.000000', currency: 'TRX' }] }],
      totals: { ...ANALYSIS.totals, costComplete: false },
    };
    const text = textOf(render(incomplete));
    expect(text).toContain('Sin tasa para: 15,000000 TRX');
    expect(text).toContain('Algún costo está incompleto');
    const empty = textOf(render({ ...ANALYSIS, groups: [], totals: { ...ANALYSIS.totals, conversions: 0 } }));
    expect(empty).toContain('No hay conversiones posteadas entre');
  });

  it('con la comparación pedida agrega la columna del spread contra la paralela', () => {
    const withAlt = {
      ...ANALYSIS,
      groups: [{ ...BINANCE, alternative: { spreadPct: '0.1678', excludedCount: 1 } }, SIN_CANAL],
    };
    const text = textOf(render(withAlt));
    expect(text).toContain('Spread vs. paralela');
    expect(text).toContain('0,1678 %');
    expect(text).toContain('(1 sin tasa paralela)');
    expect(textOf(render(ANALYSIS))).not.toContain('Spread vs. paralela');
  });

  it('mientras carga muestra el estado de carga y con filtros inválidos deshabilita Aplicar y explica el error', () => {
    expect(render(undefined)).toContain('data-testid="costs-loading"');
    const html = render(undefined, {
      draft: { ...DEFAULT_COST_FILTERS, from: '2026-10-31', to: '2026-10-01' },
    });
    expect(textOf(html)).toContain('La fecha inicial no puede ser posterior a la final.');
    expect(html).toMatch(/<button type="submit" disabled/);
  });
});

describe('filtros y rutas del análisis', () => {
  it('valida fechas y rango; sin fechas no manda from ni to', () => {
    expect(filterError(DEFAULT_COST_FILTERS)).toBeNull();
    expect(filterError({ ...DEFAULT_COST_FILTERS, from: '2026-10-01', to: '2026-10-31' })).toBeNull();
    expect(filterError({ ...DEFAULT_COST_FILTERS, from: '2026/10/01' })).toBe('DATE');
    expect(filterError({ ...DEFAULT_COST_FILTERS, from: '2026-11-01', to: '2026-10-01' })).toBe('RANGE');
    expect(costQuery(DEFAULT_COST_FILTERS)).toBe('grouping=FINANCIAL_PERIOD');
  });

  it('la consulta lleva la agrupación y la comparación; la exportación nunca lleva la comparación', () => {
    const filters = {
      from: '2026-10-01',
      to: '2026-10-31',
      grouping: 'CALENDAR_MONTH' as const,
      compare: true,
    };
    expect(costPath('/workspaces/w1', filters)).toBe(
      '/workspaces/w1/reports/conversion-costs?from=2026-10-01&to=2026-10-31&grouping=CALENDAR_MONTH&compareWith=PARALLEL_SIDE',
    );
    expect(costExportPath('/workspaces/w1', filters)).toBe(
      '/workspaces/w1/reports/conversion-costs/export?from=2026-10-01&to=2026-10-31&grouping=CALENDAR_MONTH',
    );
  });
});
