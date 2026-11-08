import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { activeNav } from '../shell/nav';
import { esContext } from '../test-support';
import { CashFlowView } from './CashFlowView';
import {
  BANCO_ID,
  BOB_CURRENCY,
  BOB_SERIES,
  CALENDAR,
  HIGH_RISK_BOB,
  TODAY,
  USD_CURRENCY,
  bob,
  usd,
} from './fixtures';
import {
  accountsOf,
  calendarApiPath,
  cashFlowHref,
  compareDecimal,
  eventsByDay,
  hasNoAmount,
  isBelow,
  occurrencePathOf,
  parseHorizon,
  pickCurrency,
  selectionFromSearch,
  selectionToSearch,
  seriesRows,
  type CashFlowSelection,
} from './logic';
import type { CashFlowCalendar, CashFlowEvent } from './types';

const f = esContext('CashFlow');
const rateCtx = esContext('Dashboard');
const href = (path: string) => `/es${path}`;
const strip = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '');

const view = (
  over: Partial<CashFlowCalendar> = {},
  selection: CashFlowSelection = { horizon: 30, currency: undefined, accountId: undefined },
) =>
  renderToStaticMarkup(
    <CashFlowView
      calendar={{ ...CALENDAR, ...over }}
      selection={selection}
      f={f}
      rateCtx={rateCtx}
      onSelect={() => undefined}
      href={href}
      createAccountHref="/es/cuentas/nueva"
    />,
  );

describe('selección de la vista y parámetros de URL (add-cash-flow-forecast, tarea 6.1)', () => {
  it('[TC-REPORTING-FORECAST-001] solo se admiten los horizontes 7, 30, 60 y 90; cualquier otro cae a 30', () => {
    expect([7, 30, 60, 90].map((n) => parseHorizon(String(n)))).toEqual([7, 30, 60, 90]);
    for (const raw of ['45', '0', '-30', '30.5', 'abc', '', null, undefined, '300'])
      expect(parseHorizon(raw)).toBe(30);
  });

  it('[TC-REPORTING-FORECAST-001] la URL de la notificación de riesgo (?horizonte=<n>&moneda=<código>) se interpreta y se reescribe igual', () => {
    const sel = selectionFromSearch(new URLSearchParams('horizonte=60&moneda=usd'));
    expect(sel).toEqual({ horizon: 60, currency: 'USD', accountId: undefined });
    expect(selectionToSearch(sel).toString()).toBe('horizonte=60&moneda=USD');
    expect(selectionToSearch({ horizon: 30, currency: undefined, accountId: undefined }).toString()).toBe('');
    // Una moneda con formato inválido se ignora; la cuenta viaja como `cuenta`.
    expect(selectionFromSearch(new URLSearchParams('moneda=%3Cb%3E&cuenta=abc')).currency).toBeUndefined();
    expect(selectionFromSearch(new URLSearchParams('cuenta=abc')).accountId).toBe('abc');
  });

  it('[TC-REPORTING-FORECAST-001] la API recibe solo horizon y accountId', () => {
    const base = '/workspaces/w1';
    expect(calendarApiPath(base, { horizon: 30, currency: 'USD', accountId: undefined })).toBe(
      '/workspaces/w1/reports/cash-flow-calendar?horizon=30',
    );
    expect(calendarApiPath(base, { horizon: 7, currency: undefined, accountId: BANCO_ID })).toBe(
      `/workspaces/w1/reports/cash-flow-calendar?horizon=7&accountId=${BANCO_ID}`,
    );
  });

  it('[TC-REPORTING-FORECAST-001] el calendario de 30 días muestra un punto por día, de hoy a hoy más 30, y el selector 7/30/60/90 con el actual marcado', () => {
    expect(BOB_SERIES).toHaveLength(31);
    expect(BOB_SERIES[0]!.date).toBe(TODAY);
    expect(BOB_SERIES[30]!.date).toBe('2026-11-19');
    const html = view();
    expect([...html.matchAll(/data-testid="cash-flow-row"/g)]).toHaveLength(31);
    for (const n of [7, 30, 60, 90]) expect(html).toContain(`data-testid="cash-flow-horizon-${n}"`);
    expect(html).toMatch(/data-testid="cash-flow-horizon-30"[^>]*checked=""/);
    expect(html).not.toMatch(/data-testid="cash-flow-horizon-60"[^>]*checked=""/);
  });
});

describe('decimales y riesgo (solo presentación)', () => {
  it('compara decimales exactos sin pasar por number', () => {
    expect(compareDecimal('-679.00', '1500')).toBe(-1);
    expect(compareDecimal('1500.00', '1500')).toBe(0);
    expect(compareDecimal('0.10', '0.1')).toBe(0);
    expect(compareDecimal('9007199254740993.01', '9007199254740993.02')).toBe(-1);
    expect(isBelow(bob('1499.99'), bob('1500.00'))).toBe(true);
    expect(isBelow(bob('1500.00'), bob('1500.00'))).toBe(false);
  });

  it('elige la moneda pedida o, si no existe, la de mayor riesgo', () => {
    const currencies = [BOB_CURRENCY, { ...USD_CURRENCY, risk: 'POSSIBLE' as const }];
    expect(pickCurrency(currencies, 'BOB')?.currency).toBe('BOB');
    expect(pickCurrency(currencies, undefined)?.currency).toBe('USD');
    expect(pickCurrency(currencies, 'EUR')?.currency).toBe('USD');
    expect(pickCurrency([], 'BOB')).toBeUndefined();
  });

  it('las filas de la tabla alinean la serie del plan y marcan los días bajo el umbral', () => {
    const rows = seriesRows(HIGH_RISK_BOB.series, HIGH_RISK_BOB.planned, bob('4000.00'));
    expect(rows).toHaveLength(31);
    expect(rows.find((r) => r.date === '2026-10-28')?.belowThreshold).toBe(true);
    expect(rows.find((r) => r.date === '2026-10-20')?.belowThreshold).toBe(false);
    expect(rows[0]!.planned).not.toBeNull();
    expect(seriesRows(BOB_SERIES, null, null).every((r) => r.planned === null && !r.belowThreshold)).toBe(
      true,
    );
  });
});

describe('vista /flujo-de-caja: saldo esperado, riesgo y gráfico (tarea 6.1)', () => {
  it('[TC-REPORTING-FORECAST-001] sin riesgo: saldo inicial, mínimo con fecha, final, umbral de la reserva mínima y la línea del umbral en el gráfico', () => {
    const html = view({}, { horizon: 30, currency: 'BOB', accountId: undefined });
    const text = strip(html);
    expect(html).toContain('data-testid="cash-flow-risk-card" data-risk="NONE"');
    expect(text).toContain('Sin riesgo');
    expect(text).toContain('reserva mínima de 1.500,00 BOB');
    const kpi = (id: string) =>
      new RegExp(`data-testid="${id}"[^>]*>.*?<strong[^>]*>([^<]*)<`).exec(html)?.[1];
    expect(kpi('cash-flow-start')).toBe('4.500,00 BOB');
    expect(kpi('cash-flow-lowest')).toBe('3.821,00 BOB');
    expect(kpi('cash-flow-end')).toBe('8.200,50 BOB');
    expect(text).toMatch(/28 oct de 2026/);
    expect(html).toContain('data-testid="cash-flow-threshold-line"');
    // El gráfico es una imagen con título y descripción; la tabla equivalente tiene caption y encabezados con scope.
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-labelledby="[^"]*"/);
    expect(html).toMatch(/<title[^>]*>Saldo esperado en BOB a 30 días<\/title>/);
    expect(html).toMatch(/<caption>Saldo esperado en BOB a 30 días<\/caption>/);
    expect(html).toContain('<th scope="col">Fecha</th>');
    expect(html).toMatch(/<th scope="row">20 oct de 2026<\/th>/);
  });

  it('[TC-REPORTING-FORECAST-001] la serie con el gasto planificado y el peor caso sin ingresos se muestran con sus cifras; sin plan, se avisa por periodo', () => {
    const html = view({}, { horizon: 30, currency: 'BOB', accountId: undefined });
    const text = strip(html);
    expect(html).toContain('data-testid="cash-flow-with-plan"');
    expect(text).toContain('3.221,00 BOB');
    expect(html).toContain('data-testid="cash-flow-without-income"');
    expect(text).toContain('200,50 BOB');
    expect(text).toContain('Sin plan en: 2026-11');
    // La tabla agrega la columna del plan.
    expect(text).toContain('Con gasto planificado');
  });

  it('[TC-REPORTING-FORECAST-014] riesgo alto: primera fecha bajo el umbral, faltante y mínimo negativo, con texto y glifo (no solo color)', () => {
    const html = view(
      { currencies: [HIGH_RISK_BOB, USD_CURRENCY] },
      { horizon: 30, currency: 'BOB', accountId: undefined },
    );
    const text = strip(html);
    expect(html).toContain('data-testid="cash-flow-risk-card" data-risk="HIGH"');
    expect(text).toContain('Riesgo alto');
    expect(text).toContain('Primera fecha bajo el umbral: 1 nov de 2026');
    expect(html).toMatch(/data-testid="cash-flow-shortfall"[^>]*>Faltante: 2\.179,00 BOB\./);
    expect(html).toContain('data-testid="cash-flow-below-zero"');
    expect(text).toContain('-679,00 BOB');
    expect(html).toMatch(/data-testid="cash-flow-lowest"[\s\S]*?data-negative="true"/);
    // El resumen por moneda deja a la vista el riesgo de cada una.
    expect(html).toMatch(/data-currency="BOB" data-risk="HIGH"/);
    expect(html).toMatch(/data-currency="USD" data-risk="NONE"/);
  });

  it('[TC-REPORTING-FORECAST-001] posible y bajo explican su causa', () => {
    const possible = strip(view({ currencies: [{ ...BOB_CURRENCY, risk: 'POSSIBLE' }] }));
    expect(possible).toContain('Riesgo posible');
    expect(possible).toContain('gasto planificado que resta del plan');
    expect(strip(view({ currencies: [{ ...BOB_CURRENCY, risk: 'LOW' }] }))).toContain('Riesgo bajo');
  });

  it('[TC-REPORTING-FORECAST-014] el cambio de moneda muestra la otra y el umbral cero cuando no hay reserva mínima', () => {
    const html = view({}, { horizon: 30, currency: 'USD', accountId: undefined });
    expect(html).toContain('data-testid="cash-flow-currency" data-currency="USD"');
    expect(strip(html)).toContain('Umbral: cero');
    expect(strip(html)).toContain('94,01 USD');
  });

  it('[TC-REPORTING-FORECAST-001] el estado vacío (sin cuentas líquidas) ofrece crear una cuenta y no muestra ninguna cifra', () => {
    const html = view({
      currencies: [],
      accounts: [],
      events: [],
      consolidated: { lowest: null, complete: true, unconverted: [] },
    });
    expect(html).toContain('data-testid="cash-flow-empty"');
    expect(html).toContain('href="/es/cuentas/nueva"');
    expect(strip(html)).toContain('Aún no tienes cuentas líquidas');
    expect(html).not.toContain('data-testid="cash-flow-lowest"');
    expect(html).not.toMatch(/0,00/);
  });

  it('[TC-REPORTING-FORECAST-001] cobertura incompleta avisa hasta qué fecha hay pagos generados', () => {
    const complete = view();
    expect(complete).not.toContain('cash-flow-coverage-incomplete');
    const html = view({ coverage: { through: '2026-11-10', complete: false } });
    expect(html).toContain('data-testid="cash-flow-coverage-incomplete"');
    expect(strip(html)).toContain('solo están generados hasta el 10 nov de 2026');
  });
});

describe('cuentas y eventos por día (tarea 6.1)', () => {
  it('[TC-REPORTING-FORECAST-013] lista cada cuenta líquida de la moneda con su saldo más bajo y permite pedir su serie', () => {
    expect(accountsOf(CALENDAR, 'BOB').map((a) => a.name)).toEqual(['Banco BOB', 'Efectivo BOB']);
    const html = view({}, { horizon: 30, currency: 'BOB', accountId: undefined });
    const row = new RegExp(`data-account-id="${BANCO_ID}".*?</tr>`).exec(html)?.[0] ?? '';
    expect(strip(row)).toContain('2.821,00 BOB');
    expect(strip(row)).toContain('28 oct de 2026');
    expect(strip(row)).toContain('7.200,50 BOB');
    expect(row).toContain('Ver la serie de Banco BOB');
    expect(html).toMatch(/<option value=""[^>]*>Total en BOB<\/option>/);
  });

  it('[TC-REPORTING-FORECAST-013] al elegir una cuenta el gráfico y la tabla muestran su serie y se puede volver al total', () => {
    const banco = CALENDAR.accounts[0]!;
    const accountSeries = BOB_SERIES.map((d) => ({
      ...d,
      balance: bob('3000.00'),
      low: bob('2821.00'),
    }));
    const html = view(
      { accounts: [{ ...banco, series: accountSeries }, ...CALENDAR.accounts.slice(1)] },
      { horizon: 30, currency: 'BOB', accountId: BANCO_ID },
    );
    expect(strip(html)).toContain('Saldo esperado de Banco BOB a 30 días');
    expect(html).toContain('data-testid="cash-flow-account-note"');
    expect(strip(html)).toContain('Ver el total en BOB');
    // Sin umbral ni plan en la serie de una cuenta.
    expect(html).not.toContain('cash-flow-threshold-line');
  });

  it('[TC-REPORTING-FORECAST-001] los eventos van por día, con egresos antes que ingresos, y los de otra moneda no se mezclan', () => {
    const days = eventsByDay(CALENDAR, 'BOB');
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-20',
      '2026-10-22',
      '2026-10-28',
      '2026-10-31',
      '2026-11-01',
      '2026-11-15',
    ]);
    expect(days.flatMap((d) => d.events.map((e) => e.id))).not.toContain('spotify');
    expect(eventsByDay(CALENDAR, 'USD').flatMap((d) => d.events.map((e) => e.id))).toEqual(['spotify']);
    const mixed: CashFlowEvent = { ...CALENDAR.events[5]!, id: 'sueldo2', date: '2026-10-28' };
    const day = eventsByDay({ ...CALENDAR, events: [mixed, ...CALENDAR.events] }, 'BOB').find(
      (d) => d.date === '2026-10-28',
    )!;
    expect(day.events.at(-1)!.kind).toBe('INCOME');
  });

  it('[TC-REPORTING-FORECAST-001] certeza, vencidos con sus días de atraso y variables sin monto (nunca un 0)', () => {
    const html = view({}, { horizon: 30, currency: 'BOB', accountId: undefined });
    const text = strip(html);
    expect([...html.matchAll(/data-testid="cash-flow-day"/g)]).toHaveLength(6);
    expect(html).toMatch(/data-certainty="KNOWN"/);
    expect(html).toMatch(/data-certainty="ESTIMATED"/);
    expect(html).toMatch(/data-certainty="EXPECTED"/);
    expect(text).toContain('Conocido');
    expect(text).toContain('Estimado');
    expect(text).toContain('Esperado');
    // Cena: pendiente de hace 2 días, se aplica hoy.
    const cena = /data-testid="cash-flow-event"[^>]*data-overdue="true".*?<\/li>/.exec(html)?.[0] ?? '';
    expect(strip(cena)).toContain('Vencido hace 2 días (era del 18 oct de 2026): se aplica hoy');
    expect(strip(cena)).toContain('-300,00 BOB');
    // Agua es VARIABLE sin monto: se lista, sin cifra.
    const agua = /data-testid="cash-flow-event"[^>]*>(?:(?!<\/li>).)*Agua.*?<\/li>/.exec(html)?.[0] ?? '';
    expect(strip(agua)).toContain('Sin monto');
    expect(strip(agua)).not.toMatch(/\d,\d\d/);
    expect(hasNoAmount(CALENDAR.events[4]!)).toBe(true);
    expect(hasNoAmount(CALENDAR.events[0]!)).toBe(false);
    // El ingreso lleva signo más y los egresos signo menos.
    expect(text).toContain('+8.000,00 BOB');
    expect(text).toContain('-199,00 BOB');
  });

  it('[TC-REPORTING-FORECAST-020] una ocurrencia enlaza a su detalle (para omitirla) y una pendiente no', () => {
    expect(occurrencePathOf(CALENDAR.events[1]!)).toBe('/recurring/occurrences/internet');
    expect(occurrencePathOf(CALENDAR.events[0]!)).toBeUndefined();
    const html = view({}, { horizon: 30, currency: 'BOB', accountId: undefined });
    expect(html).toContain('href="/es/recurring/occurrences/luz"');
  });

  it('[TC-REPORTING-FORECAST-001] sin movimientos en el horizonte lo dice, sin inventar filas', () => {
    const html = view({ events: [] });
    expect(html).toContain('data-testid="cash-flow-events-empty"');
  });
});

describe('consolidado informativo, tasas, atribuciones y sugerencias (tarea 6.1)', () => {
  it('[TC-REPORTING-FORECAST-014] el consolidado informativo muestra 4.949,12 BOB el 28 oct con la tasa USD/BOB y su fuente', () => {
    const html = view();
    const text = strip(html);
    expect(html).toMatch(/data-testid="cash-flow-consolidated-lowest">4\.949,12 BOB</);
    expect(text).toContain('28 oct de 2026');
    expect(text).toContain('Informativo');
    expect(html).toContain('data-testid="cash-flow-rates"');
    expect(html).toMatch(/data-pair="USD\/BOB"/);
    expect(html).toContain('data-complete="true"');
  });

  it('[TC-REPORTING-FORECAST-014] sin tasa USD/BOB el consolidado queda incompleto con la moneda sin convertir (nunca 1:1)', () => {
    const html = view({
      consolidated: {
        lowest: { amount: bob('3821.00'), date: '2026-10-28' },
        complete: false,
        unconverted: [usd('94.01')],
      },
      meta: { ...CALENDAR.meta, ratesUsed: [], attributions: [] },
    });
    const text = strip(html);
    expect(html).toContain('data-complete="false"');
    expect(html).toMatch(/data-testid="cash-flow-consolidated-lowest">3\.821,00 BOB</);
    expect(html).toContain('data-testid="cash-flow-consolidated-incomplete"');
    expect(html).toMatch(/data-testid="cash-flow-unconverted" data-currency="USD"/);
    expect(text).toContain('94,01 USD sin convertir');
    expect(html).not.toContain('data-testid="cash-flow-rates"');
  });

  it('[TC-REPORTING-FORECAST-014] sin ninguna moneda convertible dice que no hay mínimo consolidado en vez de un cero', () => {
    const html = view({
      consolidated: { lowest: null, complete: false, unconverted: [usd('94.01')] },
    });
    expect(html).toContain('data-testid="cash-flow-consolidated-none"');
    expect(html).not.toContain('cash-flow-consolidated-lowest');
  });

  it('[TC-REPORTING-FORECAST-014] las atribuciones de las fuentes de tasa están siempre visibles, como en el Home', () => {
    const html = view();
    expect(html).toContain('data-testid="attributions"');
    expect(html).toMatch(
      /<a href="https:\/\/paralelo\.bo"[^>]*rel="noopener noreferrer"[^>]*>Fuente: paralelo\.bo<\/a>/,
    );
    expect(html).toContain('CC BY 4.0');
  });

  it('[TC-REPORTING-FORECAST-016] las sugerencias de conversión son aproximadas y solo informan: sin botones que ejecuten nada', () => {
    const html = view({
      suggestions: [
        {
          fromCurrency: 'USD',
          toCurrency: 'BOB',
          approxAmount: usd('226.04'),
          rate: CALENDAR.meta.ratesUsed[0]!,
          before: '2026-11-01',
        },
      ],
    });
    const section = /data-testid="cash-flow-suggestions".*?<\/section>/.exec(html)?.[0] ?? '';
    expect(strip(section)).toContain('226,04 USD');
    expect(strip(section)).toContain('1 nov de 2026');
    expect(strip(section)).toContain('no ejecutan nada');
    expect(section).not.toContain('<button');
    expect(section).toContain('data-pair="USD/BOB"');
    expect(view()).not.toContain('cash-flow-suggestions');
  });

  it('[TC-REPORTING-FORECAST-020] declara cuándo se generó, la frescura de los datos y la moneda de reporte', () => {
    const html = view();
    expect(html).toMatch(/data-testid="cash-flow-generated-at">Generado: [^<]*2026[^<]*10:00/);
    expect(html).toMatch(/data-testid="cash-flow-freshness">Datos al: [^<]*2026/);
    expect(strip(html)).toContain('Moneda de reporte: BOB');
  });
});

describe('enlace del calendario', () => {
  it('[TC-REPORTING-FORECAST-017] arma /flujo-de-caja con la moneda y el horizonte cuando no son los de omisión', () => {
    expect(cashFlowHref(href)).toBe('/es/flujo-de-caja');
    expect(cashFlowHref(href, { currency: 'BOB' })).toBe('/es/flujo-de-caja?moneda=BOB');
    expect(cashFlowHref(href, { horizon: 60, currency: 'USD' })).toBe(
      '/es/flujo-de-caja?horizonte=60&moneda=USD',
    );
  });

  it('la sección del marco es Flujo de caja en todas las rutas del calendario', () => {
    expect(activeNav('/flujo-de-caja')).toBe('cashFlow');
    expect(activeNav('/pt/flujo-de-caja')).toBe('cashFlow');
  });
});

describe('catálogos i18n del flujo de caja', () => {
  const load = (locale: string) =>
    JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), 'utf8')) as Record<
      string,
      Record<string, unknown>
    >;
  const keys = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix];

  it('CashFlow, los ajustes del disponible y la variación tienen las mismas claves en es, en y pt', () => {
    const [es, en, pt] = ['es', 'en', 'pt'].map(load) as [
      Record<string, Record<string, unknown>>,
      Record<string, Record<string, unknown>>,
      Record<string, Record<string, unknown>>,
    ];
    for (const pick of [
      (m: typeof es) => m['CashFlow'],
      (m: typeof es) => m['Dashboard']!['settings'],
      (m: typeof es) => m['Dashboard']!['spendable'],
      (m: typeof es) => m['Dashboard']!['topCategories'],
      (m: typeof es) => m['Dashboard']!['topIncomeCategories'],
      (m: typeof es) => m['Upcoming']!['home'],
    ]) {
      expect(keys(pick(en)).sort()).toEqual(keys(pick(es)).sort());
      expect(keys(pick(pt)).sort()).toEqual(keys(pick(es)).sort());
    }
    expect(es['App']!['cashFlow']).toBe('Flujo de caja');
    expect(en['App']!['cashFlow']).toBe('Cash flow');
    expect(pt['App']!['cashFlow']).toBe('Fluxo de caixa');
  });
});
