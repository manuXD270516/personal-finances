import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ResolvedRate } from '../dashboard/types';
import { esContext, textOf } from '../test-support';
import { buildChart, pointStates, totalChange } from './chart-model';
import { COMPACT_PERIODS, lastPoints, NetWorthEvolutionView } from './NetWorthEvolutionView';
import type { NetWorthHistory, NetWorthPoint } from './types';

const f = esContext('NetWorthEvolution');

const rate = (value: string, asOf: string): ResolvedRate => ({
  rate: { base: 'USDT', quote: 'BOB', value },
  fxRateId: `rate-${asOf}`,
  derivation: 'DIRECT',
  rateType: 'PARALLEL',
  source: 'PROVIDER',
  asOf,
  ageDays: 0,
  approx: false,
  provider: 'PARALELO_BO',
  selection: 'PRIMARY',
  attribution: {
    provider: 'PARALELO_BO',
    text: 'Fuente: paralelo.bo',
    url: 'https://paralelo.bo',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
});

const point = (over: Partial<NetWorthPoint> & Pick<NetWorthPoint, 'period' | 'netWorth'>): NetWorthPoint => ({
  periodId: `id-${over.period}`,
  asOf: `${over.period}-28`,
  assets: over.netWorth,
  liabilities: '0.00',
  change: null,
  comparable: false,
  complete: true,
  unconverted: [],
  source: 'COMPUTED',
  closed: false,
  partial: false,
  ratesUsed: [],
  ...over,
});

/** Ejemplo canónico (TC-REPORTING-NETWORTH-006): 2700.00, 3550.00 y 3570.00 BOB, y abril parcial. */
const HISTORY: NetWorthHistory = {
  reportingCurrency: 'BOB',
  points: [
    point({
      period: '2026-01',
      asOf: '2026-01-31',
      assets: '3000.00',
      liabilities: '300.00',
      netWorth: '2700.00',
      closed: true,
      source: 'SNAPSHOT',
    }),
    point({
      period: '2026-02',
      asOf: '2026-02-28',
      assets: '3550.00',
      netWorth: '3550.00',
      change: '850.00',
      comparable: true,
      ratesUsed: [rate('10.50', '2026-02-28T20:00:00Z')],
    }),
    point({
      period: '2026-03',
      asOf: '2026-03-31',
      assets: '3720.00',
      liabilities: '150.00',
      netWorth: '3570.00',
      change: '20.00',
      comparable: true,
    }),
    point({
      period: '2026-04',
      asOf: '2026-04-12',
      assets: '1800.00',
      netWorth: '1800.00',
      change: '-1770.00',
      complete: false,
      comparable: false,
      partial: true,
      unconverted: [{ amount: '100.000000', currency: 'USDT' }],
    }),
  ],
  meta: {
    generatedAt: '2026-04-12T16:00:00Z',
    timeZone: 'America/La_Paz',
    rateWindowDays: 7,
    ratesUsed: [rate('10.50', '2026-02-28T20:00:00Z')],
    attributions: [rate('10.50', '2026-02-28T20:00:00Z').attribution!],
  },
};

const render = (history: NetWorthHistory, variant: 'compact' | 'full') =>
  renderToStaticMarkup(
    <NetWorthEvolutionView history={history} f={f} variant={variant} fullHref="/patrimonio" homeHref="/" />,
  );

describe('Evolución del patrimonio (add-net-worth-evolution, tarea 6.1)', () => {
  it('[TC-REPORTING-NETWORTH-006] la tabla alternativa trae las cifras de cada periodo con el locale es-BO', () => {
    const html = render(HISTORY, 'full');
    const rows = html.match(/<tr data-testid="net-worth-row"[\s\S]*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(4);
    const cells = (row: string) => textOf(row.replace(/<\/t[dh]>/g, '|'));
    expect(cells(rows[0]!)).toContain('2.700,00');
    expect(cells(rows[1]!)).toContain('3.550,00');
    expect(cells(rows[2]!)).toContain('3.720,00');
    expect(cells(rows[2]!)).toContain('3.570,00');
  });

  it('[TC-REPORTING-NETWORTH-011] la variación se muestra con signo y la no comparable lo dice con texto', () => {
    const rows = render(HISTORY, 'full').match(/<tr data-testid="net-worth-row"[\s\S]*?<\/tr>/g) ?? [];
    expect(textOf(rows[1]!)).toContain('+850,00 BOB');
    expect(textOf(rows[2]!)).toContain('+20,00 BOB');
    expect(textOf(rows[3]!)).toContain('no comparable');
    expect(textOf(rows[0]!)).toContain('—');
  });

  it('[TC-REPORTING-NETWORTH-008] un punto incompleto lista los saldos sin tasa y avisa con texto, no solo con color', () => {
    const html = render(HISTORY, 'full');
    expect(html).toContain('data-testid="net-worth-evolution-incomplete"');
    expect(textOf(html)).toContain('Un periodo está incompleto');
    expect(textOf(html.match(/data-testid="net-worth-row-unconverted"[^>]*>[^<]*/)![0])).toContain(
      'Sin tasa: 100,000000 USDT',
    );
    expect(pointStates(HISTORY.points[3]!)).toEqual(['partial', 'incomplete']);
    // Marcador hueco y tramo discontinuo para el punto incompleto; cuadrado para el periodo en curso.
    expect(html).toContain('data-kind="incomplete"');
    expect(html).toContain('data-solid="false"');
  });

  it('[TC-REPORTING-NETWORTH-009] el periodo cerrado se identifica con texto y candado', () => {
    const html = render(HISTORY, 'full');
    const jan = html.match(/<tr data-testid="net-worth-row" data-period="2026-01"[\s\S]*?<\/tr>/)![0];
    expect(textOf(jan)).toContain('Cerrado');
    expect(html).toContain('class="pf-nw-lock"');
    expect(pointStates(HISTORY.points[0]!)).toEqual(['closed']);
  });

  it('el gráfico tiene título y descripción accesibles y una tabla equivalente', () => {
    const html = render(HISTORY, 'full');
    expect(html).toMatch(/<svg role="img" aria-labelledby="nw-full-title nw-full-desc"/);
    expect(html).toContain('<title id="nw-full-title">Evolución del patrimonio neto en BOB</title>');
    const desc = html.match(/<desc id="nw-full-desc">([^<]*)<\/desc>/)![1]!;
    expect(desc).toContain('De ene 26 a abr 26');
    expect(desc).toContain('2.700,00 BOB');
    expect(desc).toContain('1.800,00 BOB');
    expect(html).toContain('<table data-testid="net-worth-table"');
    expect(html).toMatch(/<caption>Patrimonio por periodo financiero, en BOB<\/caption>/);
    // Cada columna lleva su descripción como <title> (tooltip) con el estado en texto.
    expect(html).toContain('Estado: En curso (parcial), Incompleto.');
  });

  it('la vista completa informa las tasas usadas por periodo, sus atribuciones y la fecha de cálculo', () => {
    const html = render(HISTORY, 'full');
    const rates = html.match(/<section[^>]*data-testid="net-worth-rates"[\s\S]*?<\/section>/)![0];
    expect(textOf(rates)).toContain('USDT/BOB 10,50');
    expect(textOf(rates)).toContain('PARALLEL');
    expect(html).toContain('data-provider="PARALELO_BO"');
    expect(html).toContain('href="https://paralelo.bo"');
    expect(textOf(html)).toContain('ventana de 7 días');
  });

  it('[D103] avisa que las cuentas se consideran según su configuración actual de «Incluir en el patrimonio»', () => {
    for (const variant of ['compact', 'full'] as const) {
      const notice = render(HISTORY, variant).match(/data-testid="net-worth-flag-notice"[^>]*>([^<]*)/)![1]!;
      expect(notice).toContain('configuración actual');
      expect(notice).toContain('congelada en su cierre');
    }
  });

  it('[D104] la tarjeta del Home muestra 6 periodos con enlace a la vista completa y tabla solo para lectores de pantalla', () => {
    const many: NetWorthHistory = {
      ...HISTORY,
      points: Array.from({ length: 12 }, (_, i) =>
        point({ period: `2025-${String(i + 1).padStart(2, '0')}`, netWorth: `${1000 + i}.00` }),
      ),
    };
    const html = render(many, 'compact');
    expect(lastPoints(many, COMPACT_PERIODS).points.map((p) => p.period)).toEqual([
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
    ]);
    expect((html.match(/data-testid="net-worth-row"/g) ?? []).length).toBe(6);
    expect(html).toContain('<h3 id="nw-card-heading">');
    expect(html).toContain('href="/patrimonio"');
    expect(html).toMatch(/<div class="pf-home-sr"><table data-testid="net-worth-table"/);
    expect(textOf(html)).toContain('Últimos 6 periodos');
    // La vista completa usa h1 y la tabla visible.
    const full = render(many, 'full');
    expect(full).toContain('<h1 id="nw-full-heading">');
    expect(full).toContain('class="pf-nw-table-wrap"');
    expect((full.match(/data-testid="net-worth-row"/g) ?? []).length).toBe(12);
  });

  it('sin periodos muestra el estado vacío y sin gráfico', () => {
    const html = render({ ...HISTORY, points: [] }, 'compact');
    expect(html).toContain('data-testid="net-worth-evolution-empty"');
    expect(html).not.toContain('<svg');
  });

  it('un solo periodo se describe sin variación', () => {
    const html = render({ ...HISTORY, points: [HISTORY.points[0]!] }, 'full');
    expect(html).toContain('Un solo periodo, ene 26');
  });
});

describe('Geometría del gráfico', () => {
  const geometry = { width: 640, height: 300, left: 80, right: 12, top: 14, bottom: 34 };

  it('la escala incluye el cero: las barras parten de la línea base y el neto mayor queda más arriba', () => {
    const model = buildChart(HISTORY.points, geometry);
    expect(model.columns).toHaveLength(4);
    const [jan, feb, mar] = model.columns;
    for (const c of model.columns) {
      expect(c.assets.y + c.assets.h).toBeCloseTo(model.baseline, 0);
    }
    expect(feb!.netY).toBeLessThan(jan!.netY);
    expect(mar!.netY).toBeLessThan(feb!.netY);
    expect(model.highest).toBe('3720.00');
    expect(model.lowest).toBe('0');
  });

  it('con un neto negativo la escala baja del cero y las barras de pasivos suben desde la línea base', () => {
    const model = buildChart(
      [point({ period: '2026-01', netWorth: '-500.00', assets: '100.00', liabilities: '600.00' })],
      geometry,
    );
    expect(model.lowest).toBe('-500.00');
    expect(model.columns[0]!.netY).toBeGreaterThan(model.baseline);
  });

  it('la variación total es exacta (sin number) y nula con menos de dos puntos', () => {
    expect(totalChange(HISTORY.points)).toBe('-900.00');
    expect(totalChange([HISTORY.points[0]!])).toBeNull();
  });
});
