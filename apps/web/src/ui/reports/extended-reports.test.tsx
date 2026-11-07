import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import {
  AccountsView,
  ConversionsView,
  DebtsView,
  FeesView,
  GoalsView,
  RecurringCostsView,
  SubscriptionsView,
  TagsView,
  TrendsView,
} from './ExtendedViews';
import {
  defaultFilters,
  drillQuery,
  exportApiPath,
  filtersFromSearch,
  filtersFromView,
  filtersToParams,
  reportApiPath,
  savedViewParams,
  slugOf,
  type AccountsReport,
  type ConversionsReport,
  type DebtsReport,
  type FeesReport,
  type GoalsReport,
  type RecurringCostsReport,
  type ReportAmount,
  type ReportMeta,
  type SubscriptionsReport,
  type TagsReport,
  type TrendsReport,
} from './logic';

const f = esContext('Reports');
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const noop = () => undefined;
const amount = (consolidated: string, natives: string[] = [consolidated]): ReportAmount => ({
  byCurrency: natives.map(bob),
  consolidated: bob(consolidated),
  complete: true,
  unconverted: [],
});
const META: ReportMeta = {
  reportId: 'EXPENSES_BY_TAG',
  reportingCurrency: 'BOB',
  grouping: 'FINANCIAL_PERIOD',
  from: '2026-10-01',
  to: '2026-10-31',
  periods: [],
  comparison: null,
  conversion: {
    policy: 'TRANSACTION_DATE',
    cutoffDate: null,
    rateWindowDays: 7,
    ratesUsed: [],
    attributions: [],
  },
  complete: true,
  unconverted: [],
  generatedAt: '2026-11-15T16:00:00Z',
};
const OCT = { label: '2026-10', from: '2026-10-01', to: '2026-10-31', partial: false, days: 31 };
const SEP = { label: '2026-09', from: '2026-09-01', to: '2026-09-30', partial: false, days: 30 };

describe('vistas de los reportes ampliados (TC-REPORTING-REPORTS-054)', () => {
  it('[TC-REPORTING-REPORTS-054] gastos por etiqueta: cifras, aviso de no aditividad y drill-down con nombre accesible', () => {
    const data: TagsReport = {
      meta: META,
      nonAdditive: true,
      tagMatch: 'ANY',
      tags: [
        { tagId: 't1', name: 'Viaje Cusco', archived: false, amount: amount('1000.00'), comparison: null },
        { tagId: 't2', name: 'Trabajo', archived: true, amount: amount('800.00'), comparison: null },
      ],
    };
    const html = renderToStaticMarkup(<TagsView f={f} data={data} onDrill={noop} />);
    const text = textOf(html);
    expect(text).toContain('1.000,00 BOB');
    expect(text).toContain('800,00 BOB');
    expect(text).toContain('no son aditivos');
    expect(text).toContain('archivada');
    expect(html).toContain('role="img"');
    expect(html).toContain('<caption');
    expect(html).toContain('aria-label="Ver el detalle de Viaje Cusco"');
  });

  it('[TC-REPORTING-REPORTS-054] gastos por cuenta: cuenta, tipo, desglose por categoría y total de las cuentas', () => {
    const data: AccountsReport = {
      meta: META,
      accounts: [
        {
          accountId: 'a1',
          name: 'Banco BOB',
          type: 'BANK',
          institutionId: null,
          amount: amount('3300.00'),
          comparison: null,
          byCategory: [{ categoryId: 'c1', name: 'Supermercado', amount: amount('3300.00') }],
        },
        {
          accountId: 'a2',
          name: 'Tarjeta Andina',
          type: 'CREDIT_CARD',
          institutionId: null,
          amount: amount('500.00'),
          comparison: null,
          byCategory: [],
        },
      ],
      total: amount('3800.00'),
      totalComparison: null,
    };
    const text = textOf(renderToStaticMarkup(<AccountsView f={f} data={data} onDrill={noop} />));
    expect(text).toContain('Banco BOB');
    expect(text).toContain('Supermercado');
    expect(text).toContain('Total de las cuentas');
    expect(text).toContain('3.800,00 BOB');
  });

  it('[TC-REPORTING-REPORTS-054] tendencias: una fila por serie con "Otras categorías" y celdas con drill-down salvo la agrupada', () => {
    const cell = (period: typeof OCT, value: string) => ({ period, amount: amount(value) });
    const data: TrendsReport = {
      meta: META,
      normalized: true,
      series: [
        {
          categoryId: 'c1',
          name: 'Supermercado',
          total: amount('200.00'),
          cells: [cell(SEP, '100.00'), cell(OCT, '100.00')],
        },
        {
          categoryId: null,
          name: 'Otras categorías',
          total: amount('30.00'),
          cells: [cell(SEP, '10.00'), cell(OCT, '20.00')],
        },
      ],
    };
    const html = renderToStaticMarkup(<TrendsView f={f} data={data} onDrill={noop} />);
    expect(textOf(html)).toContain('Otras categorías');
    expect(textOf(html)).toContain('Cifras por día');
    expect(html.match(/data-testid="drill-open"/gu)).toHaveLength(2);
  });

  it('[TC-REPORTING-REPORTS-054] comisiones: columnas por tipo, total del mes y de los últimos 12 periodos', () => {
    const data: FeesReport = {
      meta: META,
      months: [
        {
          period: OCT,
          byType: [
            { type: 'CONVERSION', amount: amount('2.00') },
            { type: 'TRANSFER', amount: amount('5.00') },
            { type: 'LOAN', amount: amount('400.00') },
            { type: 'FEE_CATEGORY', amount: amount('15.00') },
          ],
          total: amount('422.00'),
        },
      ],
      last12Months: amount('422.00'),
    };
    const text = textOf(renderToStaticMarkup(<FeesView f={f} data={data} onDrill={noop} />));
    expect(text).toContain('Comisión de conversión');
    expect(text).toContain('422,00 BOB');
    expect(text).toContain('Últimos 12 periodos completos: 422,00 BOB');
    expect(text).toContain('intereses de tarjeta');
  });

  it('[TC-REPORTING-REPORTS-054] metas: acumulado mensual, esperado y estado en texto, con enlace a los movimientos', () => {
    const month = (period: string, acc: string, status: 'BEHIND' | 'AHEAD' | null) => ({
      period,
      monthEnd: `${period}-28`,
      contributions: bob('500.00'),
      withdrawals: bob('0.00'),
      accumulated: bob(acc),
      percent: '10.00',
      expected: bob('412.09'),
      status,
      complete: true,
    });
    const data: GoalsReport = {
      meta: META,
      goals: [
        {
          goalId: 'g1',
          name: 'Viaje',
          currency: 'BOB',
          target: bob('5000.00'),
          months: [month('2026-07', '500.00', 'AHEAD'), month('2026-08', '1000.00', null)],
        },
      ],
    };
    const html = renderToStaticMarkup(<GoalsView f={f} data={data} onDrill={noop} href={(p) => `/es${p}`} />);
    const text = textOf(html);
    expect(text).toContain('Objetivo 5.000,00 BOB');
    expect(text).toContain('Adelantada');
    expect(text).toContain('Sin seguimiento');
    expect(text).toContain('412,09 BOB');
    expect(html).toContain('href="/es/goals/g1"');
  });

  it('[TC-REPORTING-REPORTS-054] deudas: saldo pendiente, pagos del préstamo, tarjeta sin pagos y consolidado', () => {
    const data: DebtsReport = {
      meta: META,
      debts: [
        {
          debtId: 'l1',
          kind: 'LOAN',
          name: 'Crédito auto',
          currency: 'BOB',
          months: [
            {
              period: OCT,
              outstanding: bob('17790.00'),
              principalPaid: bob('1110.00'),
              interestPaid: bob('310.00'),
              chargesPaid: bob('0.00'),
            },
          ],
        },
        {
          debtId: 'c1',
          kind: 'CARD',
          name: 'Tarjeta Andina',
          currency: 'BOB',
          months: [
            {
              period: OCT,
              outstanding: bob('500.00'),
              principalPaid: null,
              interestPaid: null,
              chargesPaid: null,
            },
          ],
        },
      ],
      consolidated: [
        {
          period: OCT,
          outstanding: amount('18290.00'),
          principalPaid: amount('1110.00'),
          interestPaid: amount('310.00'),
        },
      ],
    };
    const text = textOf(renderToStaticMarkup(<DebtsView f={f} data={data} onDrill={noop} />));
    expect(text).toContain('17.790,00 BOB');
    expect(text).toContain('310,00 BOB');
    expect(text).toContain('Las tarjetas muestran solo el saldo pendiente');
    expect(text).toContain('Consolidado en BOB');
  });

  it('[TC-REPORTING-REPORTS-054] costos recurrentes: mensual y anual, monto variable aparte y total', () => {
    const data: RecurringCostsReport = {
      meta: { ...META, reportId: 'RECURRING_COSTS' },
      items: [
        {
          definitionId: 'd1',
          name: 'Streaming',
          cadence: 'MONTHLY',
          interval: 1,
          variable: false,
          monthly: bob('69.00'),
          annual: bob('828.00'),
          monthlyReporting: bob('69.00'),
        },
        {
          definitionId: 'd2',
          name: 'Luz',
          cadence: 'MONTHLY',
          interval: 2,
          variable: true,
          monthly: null,
          annual: null,
          monthlyReporting: null,
        },
      ],
      totals: { monthly: amount('69.00'), annual: amount('828.00') },
      variableCount: 1,
    };
    const text = textOf(renderToStaticMarkup(<RecurringCostsView f={f} data={data} onDrill={noop} />));
    expect(text).toContain('828,00 BOB');
    expect(text).toContain('Monto variable');
    expect(text).toContain('cada 2 mensual');
    expect(text).toContain('1 compromiso de monto variable no suma');
  });

  it('[TC-REPORTING-REPORTS-054] suscripciones: costo mensual al cierre y eventos de aumento, alta y baja en texto', () => {
    const data: SubscriptionsReport = {
      meta: META,
      months: [
        {
          period: SEP,
          monthlyCost: amount('149.00'),
          active: 3,
          events: [
            {
              date: '2026-09-01',
              subscriptionId: 's1',
              name: 'Música',
              kind: 'PRICE_CHANGED',
              previousPrice: bob('25.00'),
              newPrice: bob('30.00'),
            },
            {
              date: '2026-09-10',
              subscriptionId: 's2',
              name: 'Nueva',
              kind: 'STARTED',
              previousPrice: null,
              newPrice: bob('50.00'),
            },
          ],
        },
        {
          period: OCT,
          monthlyCost: amount('80.00'),
          active: 2,
          events: [
            {
              date: '2026-10-05',
              subscriptionId: 's3',
              name: 'Video',
              kind: 'CANCELLED',
              previousPrice: bob('69.00'),
              newPrice: null,
            },
          ],
        },
      ],
    };
    const text = textOf(renderToStaticMarkup(<SubscriptionsView f={f} data={data} onDrill={noop} />));
    expect(text).toContain('149,00 BOB');
    expect(text).toContain('Música: de 25,00 BOB a 30,00 BOB');
    expect(text).toContain('Nueva: alta a 50,00 BOB');
    expect(text).toContain('Video: baja');
  });

  it('[TC-REPORTING-REPORTS-054] conversiones: tasa efectiva frente a la de referencia, sin referencia explícito y enlace al costo', () => {
    const data: ConversionsReport = {
      meta: { ...META, reportId: 'FX_CONVERSIONS' },
      points: [
        {
          transactionId: 'x1',
          date: '2026-10-05',
          pair: 'USDT/BOB',
          effectiveRate: '11.90',
          referenceRate: '12.00',
        },
        {
          transactionId: 'x2',
          date: '2026-10-20',
          pair: 'USDT/BOB',
          effectiveRate: '11.80',
          referenceRate: null,
        },
      ],
      months: [{ period: OCT, cost: bob('30.00'), conversions: 2, excluded: 1, costComplete: true }],
      costTotal: bob('30.00'),
      costComplete: true,
    };
    const html = renderToStaticMarkup(
      <ConversionsView f={f} data={data} onDrill={noop} href={(p) => `/es${p}`} />,
    );
    const text = textOf(html);
    expect(text).toContain('11,90');
    expect(text).toContain('12,00');
    expect(text).toContain('sin referencia');
    expect(text).toContain('30,00 BOB');
    expect(html).toContain('href="/es/fx/costos"');
  });

  it('[TC-REPORTING-REPORTS-054] un reporte sin datos dice que no hay datos del rango', () => {
    const data: TagsReport = { meta: META, nonAdditive: true, tagMatch: 'ANY', tags: [] };
    expect(textOf(renderToStaticMarkup(<TagsView f={f} data={data} onDrill={noop} />))).toContain(
      'No hay datos',
    );
  });
});

describe('lógica de URL de los reportes ampliados', () => {
  const today = '2026-11-15';
  const defaults = defaultFilters(today);

  it('[TC-REPORTING-REPORTS-049] cada reporte ampliado tiene su ruta y solo envía los parámetros que acepta su API', () => {
    expect(slugOf('EXPENSES_BY_TAG')).toBe('gastos-por-etiqueta');
    expect(slugOf('FX_CONVERSIONS')).toBe('conversiones');
    const filters = {
      ...defaults,
      from: '2026-10-01',
      to: '2026-10-31',
      topN: '5',
      compare: 'PREVIOUS_PERIOD' as const,
    };
    expect(reportApiPath('/workspaces/w', 'metas', filters, defaults)).toBe(
      '/workspaces/w/reports/goals?from=2026-10-01&to=2026-10-31',
    );
    expect(reportApiPath('/workspaces/w', 'costos-recurrentes', filters, defaults)).toBe(
      '/workspaces/w/reports/recurring',
    );
    expect(exportApiPath('/workspaces/w', 'suscripciones', filters, defaults)).toBe(
      '/workspaces/w/reports/subscriptions/export?from=2026-10-01&to=2026-10-31',
    );
    expect(
      reportApiPath(
        '/workspaces/w',
        'gastos-por-etiqueta',
        { ...filters, tagMatch: 'ALL', tagIds: 'a,b' },
        defaults,
      ),
    ).toContain('tagMatch=ALL');
  });

  it('[TC-REPORTING-REPORTS-041] las tendencias envían la normalización por día sin necesidad de comparación', () => {
    const filters = { ...defaults, normalize: true };
    expect(reportApiPath('/w', 'tendencias', filters, defaults)).toContain('normalize=PER_DAY');
    expect(reportApiPath('/w', 'comisiones', filters, defaults)).not.toContain('normalize');
  });

  it('[TC-REPORTING-REPORTS-049] una vista guardada solo lleva ids y filtros y se restaura a los mismos filtros', () => {
    const filters = {
      ...defaults,
      from: '2026-08-01',
      to: '2026-10-31',
      tagIds: '0190a000-0000-7000-8000-0000000000e1',
      tagMatch: 'ALL' as const,
      reportingCurrency: 'USD',
    };
    const relative = savedViewParams(filters, 'LAST_3', 'gastos-por-etiqueta');
    expect(relative).toEqual({
      range: { kind: 'LAST_N_PERIODS', periods: 3 },
      reportingCurrency: 'USD',
      tagIds: ['0190a000-0000-7000-8000-0000000000e1'],
      tagMatch: 'ALL',
    });
    expect(JSON.stringify(relative)).not.toMatch(/amount|total/u);
    expect(savedViewParams(filters, 'FIXED', 'gastos-por-etiqueta')['range']).toEqual({
      kind: 'FIXED',
      from: '2026-08-01',
      to: '2026-10-31',
    });
    expect(savedViewParams(filters, 'LAST_6', 'costos-recurrentes')['range']).toBeUndefined();
    const restored = filtersFromView(
      {
        from: '2026-08-01',
        to: '2026-10-31',
        tagId: ['0190a000-0000-7000-8000-0000000000e1'],
        tagMatch: 'ALL',
      },
      today,
    );
    expect(restored).toMatchObject({ from: '2026-08-01', to: '2026-10-31', tagMatch: 'ALL' });
    expect(restored.tagIds).toBe('0190a000-0000-7000-8000-0000000000e1');
    expect(filtersFromSearch(filtersToParams(restored, defaults), today).tagMatch).toBe('ALL');
  });

  it('[TC-REPORTING-REPORTS-039] el drill-down de una etiqueta usa solo esa etiqueta y no la coincidencia de los filtros', () => {
    const q = drillQuery(
      {
        report: 'EXPENSES_BY_TAG',
        title: 'Viaje',
        from: '2026-10-01',
        to: '2026-10-31',
        extra: { tagId: 't1' },
      },
      { ...defaults, tagIds: 'a,b', tagMatch: 'ALL' },
      defaults,
    );
    expect(q.getAll('tagId')).toEqual(['t1']);
    expect(q.get('tagMatch')).toBeNull();
    expect(q.get('report')).toBe('EXPENSES_BY_TAG');
  });
});
