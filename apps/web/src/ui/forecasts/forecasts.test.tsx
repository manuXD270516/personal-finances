import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { ForecastsView, type ForecastsViewProps } from './ForecastsView';
import {
  formatForecastMoney,
  formatSigned,
  knownItemsApiPath,
  latestApiPath,
  parseHorizon,
  pickSeries,
  selectionFromSearch,
  selectionToSearch,
  sortSeries,
} from './logic';
import type { ForecastPoint, ForecastSeries, LatestForecast, Money } from './types';

const f = esContext('Forecasts');
const href = (path: string) => `/es${path}`;
const bob = (amount: string): Money => ({ amount, currency: 'BOB' });

const point = (period: string, monthsAhead: number, over: Partial<ForecastPoint> = {}): ForecastPoint => ({
  period,
  periodStart: `${period}-01`,
  periodEnd: `${period}-28`,
  monthsAhead,
  prediction: bob('4408.00'),
  interval80: { lower: bob('4038.00'), upper: bob('4788.00') },
  interval95: { lower: bob('3848.00'), upper: bob('5048.00') },
  baseline: { method: 'MEAN_LAST_N', n: 6, value: bob('4300.00') },
  components: {
    knownFuture: bob('2748.00'),
    predictedVariable: bob('1660.00'),
    predictedVariableInterval80: { lower: bob('1290.00'), upper: bob('2040.00') },
    knownWithoutAmountCount: 0,
  },
  drivers: [
    { type: 'HISTORICAL_AVERAGE', value: bob('1552.00'), effect: null, periods: [], refCount: 0 },
    { type: 'SEASONALITY', value: null, effect: bob('120.00'), periods: [], refCount: 0 },
    { type: 'TREND_AND_LEVEL', value: null, effect: bob('-12.00'), periods: [], refCount: 0 },
    { type: 'KNOWN_RECURRING', value: bob('2748.00'), effect: null, periods: [], refCount: 3 },
  ],
  coherenceGap: null,
  ...over,
});

const total: ForecastSeries = {
  scope: 'TOTAL_EXPENSE',
  scopeRef: null,
  name: 'TOTAL_EXPENSE',
  readiness: 'MODEL',
  readinessReasons: [],
  historyFrom: '2024-05',
  historyTo: '2026-10',
  historyPeriods: 30,
  groupedCategoryIds: [],
  currency: 'BOB',
  model: { name: 'ETS_DAMPED', version: '1', selectedBy: 'BACKTEST', mase: '0.7200', baselineMase: '0.9000' },
  confidence: 'HIGH',
  points: [point('2026-11', 1), point('2026-12', 2), point('2027-01', 3), point('2027-02', 4)],
};

const restaurants: ForecastSeries = {
  scope: 'CATEGORY',
  scopeRef: '0198f0aa-0000-7000-8000-000000000001',
  name: 'Restaurantes',
  readiness: 'SIMPLE',
  readinessReasons: [{ code: 'TOO_FEW_PERIODS', missingForSimple: 0, missingForModel: 2 }],
  historyFrom: '2026-07',
  historyTo: '2026-10',
  historyPeriods: 4,
  groupedCategoryIds: [],
  currency: 'BOB',
  model: { name: 'MEAN_LAST_6', version: '1', selectedBy: 'SIMPLE', mase: null, baselineMase: null },
  confidence: 'LOW',
  points: [point('2026-11', 1, { prediction: bob('900.00'), components: null, drivers: null })],
};

const latest = (over: Partial<LatestForecast> = {}): LatestForecast => ({
  status: 'AVAILABLE',
  stale: false,
  lastAttempt: null,
  run: { id: 'r1', status: 'COMPLETED', completedAt: '2026-11-05T15:00:00.000Z', asOfPeriod: '2026-10' },
  reportingCurrency: 'BOB',
  generatedAt: '2026-11-05T15:00:00.000Z',
  series: [restaurants, total],
  disclaimerKey: 'forecast.disclaimer',
  meta: { conversion: null },
  ...over,
});

const view = (over: Partial<ForecastsViewProps> = {}, data: LatestForecast = latest()) =>
  renderToStaticMarkup(
    <ForecastsView
      latest={data}
      selection={{ horizon: 3, series: undefined }}
      selectedPeriod={undefined}
      known={{ items: [] }}
      f={f}
      canRun={false}
      run="idle"
      onSelect={() => undefined}
      onSelectPeriod={() => undefined}
      onRun={() => undefined}
      href={href}
      {...over}
    />,
  );
const strip = (html: string) => textOf(html.replace(/<style>[\s\S]*?<\/style>/g, ''));

describe('selección y rutas de la vista (add-expense-forecasts, tarea 7.1)', () => {
  it('[TC-FORECAST-EXPENSE-018] solo se admiten los horizontes 1, 3, 6 y 12; cualquier otro cae a 3', () => {
    expect([1, 3, 6, 12].map((n) => parseHorizon(String(n)))).toEqual([1, 3, 6, 12]);
    for (const raw of ['2', '0', '24', '-3', 'abc', '', null, undefined]) expect(parseHorizon(raw)).toBe(3);
  });

  it('[TC-FORECAST-EXPENSE-018] la URL refleja horizonte y serie sin escribir los valores por omisión', () => {
    const sel = selectionFromSearch(
      new URLSearchParams('horizonte=6&serie=CATEGORY:0198f0aa-0000-7000-8000-000000000001'),
    );
    expect(sel).toEqual({ horizon: 6, series: 'CATEGORY:0198f0aa-0000-7000-8000-000000000001' });
    expect(selectionToSearch(sel).toString()).toBe(
      'horizonte=6&serie=CATEGORY%3A0198f0aa-0000-7000-8000-000000000001',
    );
    expect(selectionToSearch({ horizon: 3, series: 'TOTAL_EXPENSE' }).toString()).toBe('');
    expect(selectionFromSearch(new URLSearchParams('serie=%3Cb%3E')).series).toBeUndefined();
  });

  it('[TC-FORECAST-EXPENSE-018] las rutas de la API piden el horizonte y los conocidos del periodo de la serie', () => {
    expect(latestApiPath('/workspaces/w1', 3)).toBe('/workspaces/w1/forecasts/latest?horizon=3');
    expect(knownItemsApiPath('/workspaces/w1', { scope: 'TOTAL_EXPENSE', scopeRef: null }, '2026-12')).toBe(
      '/workspaces/w1/forecasts/latest/known-items?scope=TOTAL_EXPENSE&period=2026-12',
    );
    expect(
      knownItemsApiPath('/workspaces/w1', { scope: 'CATEGORY', scopeRef: restaurants.scopeRef }, '2026-12'),
    ).toContain('scopeRef=0198f0aa');
  });

  it('[TC-FORECAST-EXPENSE-018] el selector ordena totales, grupos y categorías y elige el gasto total por omisión', () => {
    expect(sortSeries([restaurants, total]).map((s) => s.scope)).toEqual(['TOTAL_EXPENSE', 'CATEGORY']);
    expect(pickSeries([restaurants, total], undefined)?.scope).toBe('TOTAL_EXPENSE');
    expect(pickSeries([restaurants, total], `CATEGORY:${restaurants.scopeRef}`)?.name).toBe('Restaurantes');
  });

  it('[TC-FORECAST-EXPENSE-015] los montos se formatean sin pasar por number, con símbolo y separadores es-BO', () => {
    expect(formatForecastMoney(bob('4408.00'), 'es-BO')).toBe('Bs 4.408,00');
    expect(formatForecastMoney({ amount: '12345678901234567890.55', currency: 'BOB' }, 'es-BO')).toContain(
      '12.345.678.901.234.567.890,55',
    );
    expect(formatSigned(bob('120.00'), 'es-BO')).toBe('+Bs 120,00');
    expect(formatSigned(bob('-12.00'), 'es-BO')).toBe('−Bs 12,00');
  });
});

describe('vista de pronósticos (add-expense-forecasts, tareas 7.1 y 7.2)', () => {
  it('[TC-FORECAST-EXPENSE-015] muestra «Esperado: ~Bs 4.408,00 · Rango probable: Bs 4.038,00 – Bs 4.788,00 (80 %)»', () => {
    const html = view();
    expect(strip(html)).toContain(
      'Esperado: ~Bs 4.408,00 · Rango probable: Bs 4.038,00 – Bs 4.788,00 (80 %)',
    );
    expect(html).toContain('data-testid="forecast-headline"');
  });

  it('[TC-FORECAST-EXPENSE-015] el detalle muestra el rango del 95 %, los componentes y los motivos que suman', () => {
    const text = strip(view());
    expect(text).toContain('Rango probable del 95 %: Bs 3.848,00 – Bs 5.048,00');
    expect(text).toContain('Conocidos Bs 2.748,00 + variable Bs 1.660,00');
    expect(text).toContain('Promedio de los últimos 6 periodos de la parte variable: Bs 1.552,00');
    expect(text).toContain('Estacionalidad: +Bs 120,00');
    expect(text).toContain('Tendencia y nivel reciente: −Bs 12,00');
    expect(text).toContain('Costos conocidos: Bs 2.748,00 (3 compromisos)');
  });

  it('[TC-FORECAST-EXPENSE-015] la confianza va con texto e icono (no solo color), con el modelo, su versión y el instante', () => {
    const html = view();
    expect(strip(html)).toContain('Confianza: alta');
    expect(html).toMatch(/data-confidence="HIGH"[^>]*>\s*<span aria-hidden="true">●<\/span>/);
    const text = strip(html);
    expect(text).toContain('Modelo: ETS_DAMPED (versión 1)');
    expect(text).toContain('Elegido por validación temporal');
    expect(text).toMatch(/Generado el .*2026/);
  });

  it('[TC-FORECAST-EXPENSE-015] el gráfico es un SVG con título y descripción, con tabla accesible equivalente y filas con foco por teclado', () => {
    const html = view();
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-labelledby=/);
    expect(html).toContain('data-testid="forecast-band"');
    expect(html).toContain('<caption>Pronóstico de Gasto total por periodo</caption>');
    expect(html.match(/data-testid="forecast-row"/g)).toHaveLength(3); // horizonte 3
    expect(html).toContain('scope="row"');
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*name="forecast-period"/);
  });

  it('[TC-FORECAST-EXPENSE-016] el aviso de no asesoría financiera está en la vista en español', () => {
    expect(strip(view())).toContain(
      'Los pronósticos son estimaciones estadísticas y no constituyen asesoría financiera.',
    );
    expect(view()).toContain('data-testid="forecast-disclaimer"');
  });

  it('[TC-FORECAST-EXPENSE-018] un VIEWER ve gasto total, horizonte 3, conocidos, modelo e instante, y no ve el botón de corrida', () => {
    const html = view({ canRun: false });
    expect(html).not.toContain('data-testid="forecast-run"');
    expect(html.match(/data-testid="forecast-row"/g)).toHaveLength(3);
    expect(html).toContain('data-testid="forecast-horizon-3"');
    expect(html).toMatch(/data-testid="forecast-horizon-3"[^>]*checked/);
    expect(html).toContain('data-testid="forecast-known"');
    expect(html).toContain('data-testid="forecast-meta"');
  });

  it('[TC-FORECAST-EXPENSE-018] un EDITOR u OWNER ve el botón «Actualizar pronóstico» y se deshabilita mientras corre', () => {
    expect(strip(view({ canRun: true }))).toContain('Actualizar pronóstico');
    expect(view({ canRun: true })).toContain('data-testid="forecast-run"');
    const running = view({ canRun: true, run: 'pending' });
    expect(running).toMatch(/data-testid="forecast-run"[^>]*disabled/);
    expect(running).toContain('data-testid="forecast-run-pending"');
  });

  it('[TC-FORECAST-EXPENSE-017] con 4 periodos explica que faltan 2, muestra solo la estimación simple marcada y los conocidos', () => {
    const html = view({
      selection: { horizon: 3, series: `CATEGORY:${restaurants.scopeRef}` },
      known: { items: [] },
    });
    const text = strip(html);
    expect(text).toContain(
      'Se necesitan 2 periodos más de historia en «Restaurantes» para un pronóstico estadístico.',
    );
    expect(text).toContain('Se muestra solo la estimación simple, marcada como tal, y los costos conocidos.');
    expect(html).toContain('data-testid="forecast-simple-badge"');
    expect(html).toContain('data-testid="forecast-known"');
    expect(text).toContain('Confianza: baja');
  });

  it('[TC-FORECAST-EXPENSE-017] sin ningún punto (datos insuficientes) igual lista los conocidos del periodo en curso', () => {
    const insufficient: ForecastSeries = {
      ...restaurants,
      readiness: 'INSUFFICIENT',
      historyPeriods: 2,
      readinessReasons: [{ code: 'TOO_FEW_PERIODS', missingForSimple: 1, missingForModel: 4 }],
      model: null,
      confidence: null,
      points: [],
    };
    const html = view(
      {
        selection: { horizon: 3, series: `CATEGORY:${restaurants.scopeRef}` },
        selectedPeriod: '2026-11',
        known: {
          items: [
            {
              date: '2026-11-20',
              label: 'Seguro de viaje',
              kind: 'EXPENSE',
              amountType: 'FIXED',
              amount: bob('90.00'),
              originalAmount: null,
              managedBy: 'USER',
              sourceRef: { context: 'COMMITMENTS', id: 'x' },
            },
          ],
        },
      },
      latest({ series: [insufficient, total] }),
    );
    const text = strip(html);
    expect(text).toContain('Se necesitan 4 periodos más');
    expect(text).toContain('Se muestran solo los costos conocidos.');
    expect(text).toContain('Seguro de viaje');
    expect(text).toContain('Bs 90,00');
    expect(html).not.toContain('data-testid="forecast-table"');
  });

  it('[TC-FORECAST-EXPENSE-017] con clasificación incompleta enlaza las transacciones sin categoría', () => {
    const lowCat: ForecastSeries = {
      ...restaurants,
      readiness: 'INSUFFICIENT',
      readinessReasons: [{ code: 'LOW_CATEGORIZATION', missingForSimple: null, missingForModel: null }],
      points: [],
    };
    const html = view(
      { selection: { horizon: 3, series: `CATEGORY:${restaurants.scopeRef}` } },
      latest({ series: [lowCat, total] }),
    );
    expect(html).toContain('data-testid="forecast-low-categorization"');
    expect(html).toContain('href="/es/transacciones"');
  });

  it('[TC-FORECAST-EXPENSE-015] los conocidos en otra moneda muestran el original y declaran la tasa de hoy; sin monto, lo dicen', () => {
    const html = view(
      {
        known: {
          items: [
            {
              date: '2026-12-20',
              label: 'Spotify',
              kind: 'EXPENSE',
              amountType: 'ESTIMATED',
              amount: bob('69.53'),
              originalAmount: { amount: '9.99', currency: 'USD' },
              managedBy: 'SUBSCRIPTION',
              sourceRef: { context: 'COMMITMENTS', id: 's' },
            },
            {
              date: '2026-12-12',
              label: 'Luz',
              kind: 'EXPENSE',
              amountType: 'VARIABLE',
              amount: null,
              originalAmount: null,
              managedBy: 'USER',
              sourceRef: { context: 'COMMITMENTS', id: 'l' },
            },
          ],
        },
      },
      latest({ meta: { conversion: { rateDate: '2026-11-05', ratesUsed: [] } } }),
    );
    const text = strip(html);
    expect(text).toContain('Bs 69,53');
    expect(text).toContain('US$ 9,99 originales');
    expect(text).toContain('Sin monto');
    expect(html).toContain('data-testid="forecast-conversion"');
  });

  it('[TC-FORECAST-EXPENSE-020] informa la diferencia entre categorías y total (292.00) cuando la API la entrega', () => {
    const withGap: ForecastSeries = {
      ...total,
      points: [point('2026-12', 2, { coherenceGap: bob('-292.00') }), point('2027-01', 3)],
    };
    const text = strip(view({}, latest({ series: [withGap] })));
    expect(text).toContain(
      'En dic 2026 la suma de las categorías difiere del total en Bs 292,00. Cada serie se pronostica por separado.',
    );
  });

  it('[TC-FORECAST-EXPENSE-001] el pronóstico desactualizado, sin corridas o deshabilitado se explica sin romper la vista', () => {
    expect(strip(view({}, latest({ stale: true })))).toContain('Este pronóstico está desactualizado');
    const none = view({ canRun: true }, latest({ status: 'NONE', series: [], run: null, generatedAt: null }));
    expect(strip(none)).toContain('Todavía no hay un pronóstico.');
    expect(none).toContain('data-testid="forecast-run"');
    expect(strip(view({}, latest({ status: 'DISABLED', series: [] })))).toContain('no están habilitados');
  });
});

describe('catálogo de mensajes de pronósticos (NFR-COMP-004, NFR-I18N)', () => {
  const read = (loc: string) =>
    JSON.parse(readFileSync(new URL(`../../../messages/${loc}.json`, import.meta.url), 'utf8')) as Record<
      string,
      Record<string, unknown>
    >;
  const flat = (o: unknown, prefix = ''): [string, string][] =>
    typeof o === 'string'
      ? [[prefix, o]]
      : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
          flat(v, prefix ? `${prefix}.${k}` : k),
        );

  it('[TC-FORECAST-EXPENSE-015] ningún texto dice «vas a gastar» ni «exactamente» (ni sus equivalentes en inglés y portugués)', () => {
    const forbidden =
      /vas a gastar|gastarás|exactamente|you will spend|you'll spend|exactly|vai gastar|vais gastar|exatamente/i;
    for (const loc of ['es', 'en', 'pt']) {
      for (const [key, text] of flat(read(loc)['Forecasts'])) {
        expect(text, `${loc}:${key}`).not.toMatch(forbidden);
      }
    }
  });

  it('[TC-FORECAST-EXPENSE-015] «Esperado» y «Rango probable» en es, y el aviso de no asesoría existe en los tres idiomas', () => {
    const es = read('es')['Forecasts'] as {
      headline: { expected: string; range: string };
      disclaimer: string;
    };
    expect(es.headline.expected).toBe('Esperado');
    expect(es.headline.range).toBe('Rango probable');
    for (const loc of ['es', 'en', 'pt']) {
      expect((read(loc)['Forecasts'] as { disclaimer: string }).disclaimer.length).toBeGreaterThan(20);
    }
  });

  it('[TC-FORECAST-EXPENSE-016] el aviso de no asesoría financiera existe en inglés y portugués', () => {
    expect((read('en')['Forecasts'] as { disclaimer: string }).disclaimer).toBe(
      'Forecasts are statistical estimates and are not financial advice.',
    );
    expect((read('pt')['Forecasts'] as { disclaimer: string }).disclaimer).toContain(
      'não constituem aconselhamento financeiro',
    );
  });

  it('[TC-FORECAST-EXPENSE-015] es, en y pt tienen exactamente las mismas claves', () => {
    const keys = (loc: string) =>
      flat(read(loc)['Forecasts'])
        .map(([k]) => k)
        .sort();
    expect(keys('en')).toEqual(keys('es'));
    expect(keys('pt')).toEqual(keys('es'));
  });
});
