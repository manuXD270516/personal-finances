import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import { FiltersBar, ConversionBlock, DrillDownPanel } from './ReportParts';
import {
  AccountHistoryView,
  CashFlowView,
  ExpensesByCategoryView,
  IncomeExpensesView,
  NetWorthReportView,
  BudgetVsActualView,
} from './ReportViews';
import {
  defaultFilters,
  drillExportPath,
  drillPath,
  exportApiPath,
  filterError,
  filtersFromSearch,
  filtersToParams,
  highestAmount,
  lowestAmount,
  ratioBetween,
  reportApiPath,
  slugOf,
  toneOf,
  variationText,
  type ExpensesByCategoryReport,
  type IncomeExpensesReport,
  type ReportAmount,
  type ReportMeta,
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
  reportId: 'INCOME_EXPENSES',
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
    ratesUsed: [
      {
        rate: { base: 'USD', quote: 'BOB', value: '10.00' },
        rateType: 'P2P',
        source: 'MANUAL',
        provider: null,
        asOf: '2026-10-15T20:00:00Z',
      },
    ],
    attributions: [],
  },
  complete: true,
  unconverted: [],
  generatedAt: '2026-11-15T16:00:00Z',
};
const PERIOD = { label: '2026-10', from: '2026-10-01', to: '2026-10-31', partial: false, days: 31 };

const INCOME: IncomeExpensesReport = {
  meta: {
    ...META,
    comparison: {
      mode: 'PREVIOUS_PERIOD',
      from: '2026-09-01',
      to: '2026-09-30',
      days: 30,
      currentDays: 31,
      normalized: false,
    },
  },
  granularity: 'PERIOD',
  rows: [
    {
      period: PERIOD,
      income: amount('12000.00'),
      expenses: amount('3800.00', ['3300.00', '50.00']),
      savings: amount('8200.00'),
      savingsRate: '68.3',
      comparison: {
        income: { compared: amount('0.00'), deltaAbs: bob('12000.00'), deltaPct: null, isNew: true },
        expenses: { compared: amount('3000.00'), deltaAbs: bob('800.00'), deltaPct: '26.67', isNew: false },
        savings: { compared: amount('0.00'), deltaAbs: bob('0.00'), deltaPct: '0.00', isNew: false },
      },
      baseline: null,
    },
  ],
  totals: {
    income: amount('12000.00'),
    expenses: amount('3800.00'),
    savings: amount('8200.00'),
    savingsRate: '68.3',
    comparison: null,
  },
};

describe('vista Ingresos y gastos (reporting/financial-reports, TC-REPORTING-REPORTS-026)', () => {
  const html = renderToStaticMarkup(<IncomeExpensesView f={f} data={INCOME} onDrill={noop} />);
  const text = textOf(html);

  it('[TC-REPORTING-REPORTS-026] muestra las cifras de octubre en es-BO, la tasa de ahorro y los montos por moneda nativa', () => {
    expect(text).toContain('12.000,00 BOB');
    expect(text).toContain('3.800,00 BOB');
    expect(text).toContain('8.200,00 BOB');
    expect(text).toContain('68.3 %');
    expect(text).toContain('3.300,00 BOB');
    expect(text).toContain('50,00 BOB');
  });

  it('[TC-REPORTING-REPORTS-026] la variación del gasto lleva texto e icono además del color (+800,00 BOB y +26,67 %) y la categoría nueva dice "nuevo"', () => {
    expect(text).toContain('+800,00 BOB (+26,67 %)');
    expect(html).toContain('data-tone="up"');
    expect(html).toContain('▲');
    expect(variationText({ deltaAbs: bob('150.00'), deltaPct: null, isNew: true }, f)).toBe(
      '+150,00 BOB (nuevo)',
    );
    expect(text).toContain('Los rangos tienen distinta cantidad de días: 31 y 30.');
  });

  it('[TC-REPORTING-REPORTS-026] el gráfico es una imagen con título y descripción y hay una tabla equivalente con caption y encabezados', () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('<title id="ie-t">Ingresos y gastos por periodo</title>');
    expect(html).toContain('<caption');
    expect(html.match(/<th scope="col"/g)?.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
  });

  it('[TC-REPORTING-REPORTS-026] cada cifra abre su drill-down con un nombre accesible', () => {
    expect(html).toContain('aria-label="Ver el detalle de Ingresos · 2026-10"');
    expect(html).toContain('aria-label="Ver el detalle de Gastos · 2026-10"');
  });

  it('una tasa de ahorro sin definir se muestra como tal (nunca 0 %)', () => {
    const none = renderToStaticMarkup(
      <IncomeExpensesView
        f={f}
        data={{ ...INCOME, rows: [{ ...INCOME.rows[0]!, savingsRate: null }] }}
        onDrill={noop}
      />,
    );
    expect(textOf(none)).toContain('sin definir');
  });

  it('[TC-REPORTING-REPORTS-016] un consolidado incompleto avisa los montos sin tasa y los deja visibles por moneda', () => {
    const incomplete: IncomeExpensesReport = {
      ...INCOME,
      rows: [
        {
          ...INCOME.rows[0]!,
          expenses: {
            ...amount('3800.00', ['3300.00']),
            byCurrency: [bob('3300.00'), { amount: '20.000000', currency: 'USDT' }],
            complete: false,
            unconverted: [{ amount: '20.000000', currency: 'USDT' }],
          },
        },
      ],
    };
    const t = textOf(renderToStaticMarkup(<IncomeExpensesView f={f} data={incomplete} onDrill={noop} />));
    expect(t).toContain('Sin tasa para: 20,000000 USDT');
  });
});

describe('vista Gastos por categoría y bloque de conversión', () => {
  const report: ExpensesByCategoryReport = {
    meta: META,
    groups: [
      {
        groupId: 'g1',
        name: 'Alimentación',
        amount: amount('3800.00'),
        negativeNet: false,
        comparison: null,
        categories: [
          {
            categoryId: 'c1',
            name: 'Supermercado',
            archived: false,
            amount: amount('3300.00'),
            negativeNet: false,
            comparison: null,
            subcategories: [
              {
                categoryId: 'c2',
                name: 'Mayorista',
                archived: true,
                amount: amount('-200.00'),
                negativeNet: true,
                comparison: null,
              },
            ],
          },
        ],
      },
    ],
    others: amount('500.00'),
    total: amount('3800.00'),
  };

  it('[TC-REPORTING-REPORTS-026] árbol grupo, categoría y subcategoría con neto negativo, archivada y "Otras categorías"', () => {
    const html = renderToStaticMarkup(<ExpensesByCategoryView f={f} data={report} onDrill={noop} />);
    const t = textOf(html);
    expect(t).toContain('Alimentación');
    expect(t).toContain('Supermercado');
    expect(t).toContain('3.300,00 BOB');
    expect(t).toContain('Mayorista');
    expect(t).toContain('-200,00 BOB');
    expect(t).toContain('neto negativo');
    expect(t).toContain('archivada');
    expect(t).toContain('Otras categorías');
    expect(html).toContain('data-depth="2"');
  });

  it('[TC-REPORTING-REPORTS-014] el bloque "Cómo se convirtió" declara la política, la moneda, la ventana y cada tasa con tipo, fuente y fecha', () => {
    const t = textOf(renderToStaticMarkup(<ConversionBlock meta={META} f={f} />));
    expect(t).toContain('Cómo se convirtió');
    expect(t).toContain('tasa vigente al cierre del día de cada movimiento');
    expect(t).toContain('ventana de vigencia de tasas de 7 días');
    expect(t).toContain('1 USD = 10,00 BOB');
    expect(t).toContain('tipo P2P');
    expect(t).toContain('fuente MANUAL');
    const cutoff = textOf(
      renderToStaticMarkup(
        <ConversionBlock
          meta={{
            ...META,
            conversion: { ...META.conversion, policy: 'CUTOFF_DATE', cutoffDate: '2026-10-31' },
          }}
          f={f}
        />,
      ),
    );
    expect(cutoff).toContain('fecha de corte 2026-10-31');
  });
});

describe('otras vistas de reportes', () => {
  it('[TC-REPORTING-REPORTS-026] presupuesto vs real: línea con estado en texto y periodo "Sin presupuesto" sin referencias en cero', () => {
    const html = renderToStaticMarkup(
      <BudgetVsActualView
        f={f}
        onDrill={noop}
        data={{
          meta: META,
          periods: [
            {
              period: { ...PERIOD, label: '2026-09' },
              status: 'BUDGETED',
              periodId: 'p9',
              currency: 'BOB',
              lines: [
                {
                  budgetLineId: 'l1',
                  target: { kind: 'CATEGORY', id: 'c1', name: 'Supermercado' },
                  nature: 'EXPENSE',
                  reference: bob('3000.00'),
                  actual: bob('3200.00'),
                  actualComplete: true,
                  status: 'OVER',
                },
              ],
            },
            { period: PERIOD, status: 'NO_BUDGET', periodId: 'p10', currency: null, lines: [] },
          ],
        }}
      />,
    );
    const t = textOf(html);
    expect(t).toContain('3.000,00 BOB');
    expect(t).toContain('3.200,00 BOB');
    expect(t).toContain('Excedido');
    expect(t).toContain('Sin presupuesto');
    expect(html.match(/data-testid="no-budget"/g)).toHaveLength(1);
  });

  it('[TC-REPORTING-REPORTS-026] flujo de caja, historial de saldo y patrimonio muestran sus tablas con los componentes en texto', () => {
    const cash = textOf(
      renderToStaticMarkup(
        <CashFlowView
          f={f}
          onDrill={noop}
          data={{
            meta: META,
            periods: [
              {
                period: PERIOD,
                byCurrency: [
                  {
                    currency: 'BOB',
                    opening: bob('10000.00'),
                    operating: bob('8700.00'),
                    debt: bob('-500.00'),
                    savingsInvestments: bob('-1000.00'),
                    currencyExchange: bob('0.00'),
                    adjustments: bob('0.00'),
                    closing: bob('17200.00'),
                  },
                ],
                consolidated: {
                  opening: bob('10000.00'),
                  operating: bob('8700.00'),
                  debt: bob('-500.00'),
                  savingsInvestments: bob('-1000.00'),
                  currencyExchange: bob('0.00'),
                  adjustments: bob('0.00'),
                  revaluation: bob('0.00'),
                  closing: bob('17200.00'),
                  complete: true,
                  unconverted: [],
                },
                comparison: null,
              },
            ],
          }}
        />,
      ),
    );
    for (const s of [
      '10.000,00 BOB',
      '8.700,00 BOB',
      '-500,00 BOB',
      '-1.000,00 BOB',
      '17.200,00 BOB',
      'Operativo',
      'Deuda',
      'Ahorro e inversión',
      'Cambio de moneda',
    ]) {
      expect(cash).toContain(s);
    }
    const history = textOf(
      renderToStaticMarkup(
        <AccountHistoryView
          f={f}
          onDrill={noop}
          data={{
            meta: META,
            accountId: 'a1',
            currency: 'BOB',
            opening: bob('10000.00'),
            days: [
              {
                date: '2026-10-05',
                balance: bob('22000.00'),
                valued: null,
                hasMovements: true,
                reconciled: false,
              },
              {
                date: '2026-10-10',
                balance: bob('18500.00'),
                valued: null,
                hasMovements: true,
                reconciled: true,
              },
            ],
            closing: bob('18700.00'),
          }}
        />,
      ),
    );
    expect(history).toContain('22.000,00 BOB');
    expect(history).toContain('Conciliado');
    const worth = textOf(
      renderToStaticMarkup(
        <NetWorthReportView
          f={f}
          onDrill={noop}
          data={{
            meta: META,
            granularity: 'PERIOD',
            points: [{ date: '2026-10-31', netWorth: amount('31750.00') }],
            decomposition: [
              {
                period: PERIOD,
                opening: bob('23000.00'),
                closing: bob('31750.00'),
                savings: bob('8200.00'),
                conversionResult: bob('0.00'),
                adjustments: bob('0.00'),
                otherMovements: bob('0.00'),
                fxRevaluation: bob('50.00'),
                assetRevaluation: bob('500.00'),
                revaluationByCurrency: [{ currency: 'USDT', kind: 'ASSET', amount: bob('500.00') }],
                complete: false,
                unvalued: [{ amount: '0.01000000', currency: 'BTC' }],
              },
            ],
          }}
        />,
      ),
    );
    expect(worth).toContain('Revalorización cambiaria');
    expect(worth).toContain('Revalorización de activos');
    expect(worth).toContain('500,00 BOB');
    expect(worth).toContain('Descomposición incompleta: sin tasa para 0,01000000 BTC');
  });

  it('[TC-REPORTING-REPORTS-026] el panel de drill-down lista las filas con la transacción enlazada, los totales de la celda y la exportación', () => {
    const html = renderToStaticMarkup(
      <DrillDownPanel
        f={f}
        cell={{
          report: 'EXPENSES_BY_CATEGORY',
          title: 'Supermercado',
          from: '2026-10-01',
          to: '2026-10-31',
          extra: {},
        }}
        page={{
          rows: [
            {
              transactionId: 't1',
              splitId: 's1',
              journalEntryId: null,
              date: '2026-10-10',
              accountId: null,
              description: 'Compra',
              categoryId: null,
              component: null,
              amount: bob('3500.00'),
              valued: bob('3500.00'),
            },
            {
              transactionId: 't2',
              splitId: 's2',
              journalEntryId: null,
              date: '2026-10-12',
              accountId: null,
              description: null,
              categoryId: null,
              component: null,
              amount: bob('-200.00'),
              valued: bob('-200.00'),
            },
          ],
          totals: amount('3300.00'),
          count: 2,
          nextCursor: 'abc',
        }}
        loadingMore={false}
        hasError={null}
        transactionHref={(id) => `/es/transacciones/${id}`}
        exportHref="/api/bff/v1/x/export"
        onMore={noop}
        onClose={noop}
      />,
    );
    const t = textOf(html);
    expect(t).toContain('2 filas');
    expect(t).toContain('3.300,00 BOB');
    expect(html).toContain('href="/es/transacciones/t1"');
    expect(html).toContain('data-testid="drill-export"');
    expect(t).toContain('Cargar más filas');
  });
});

describe('barra de filtros y lógica de URL', () => {
  const defaults = defaultFilters('2026-10-15');

  it('[TC-REPORTING-REPORTS-026] los filtros tienen etiquetas, comparación personalizada y mensaje de error asociado', () => {
    const html = renderToStaticMarkup(
      <FiltersBar
        f={f}
        draft={{ ...defaults, compare: 'CUSTOM' }}
        onDraft={noop}
        onApply={noop}
        currencies={['BOB', 'USD']}
        show={{ grouping: true, compare: true, rolling: true, conversion: true, lists: true }}
      />,
    );
    const t = textOf(html);
    for (const label of [
      'Desde (fecha de negocio)',
      'Hasta (fecha de negocio)',
      'Moneda de reporte',
      'Comparar con',
      'Comparar desde',
      'Promedio móvil',
      'Aplicar filtros',
    ]) {
      expect(t).toContain(label);
    }
    expect(html).toContain('Periodo financiero');
    expect(html).toContain('Mes calendario');
  });

  it('el estado de los filtros viaja en la URL y vuelve igual (compartible)', () => {
    const f1 = {
      ...defaults,
      from: '2026-10-01',
      to: '2026-10-31',
      compare: 'PREVIOUS_PERIOD' as const,
      rolling: '3' as const,
      accountIds: 'a1,a2',
      reportingCurrency: 'USD',
    };
    const q = filtersToParams(f1, defaults);
    expect(q.getAll('accountId')).toEqual(['a1', 'a2']);
    expect(q.get('compare')).toBe('PREVIOUS_PERIOD');
    const back = filtersFromSearch(new URLSearchParams(q.toString()), '2026-10-15');
    expect(back).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      compare: 'PREVIOUS_PERIOD',
      rolling: '3',
      accountIds: 'a1,a2',
      reportingCurrency: 'USD',
    });
  });

  it('valida el rango y arma las rutas de la API, de la exportación y del drill-down', () => {
    expect(filterError({ ...defaults, from: '2026-10-31', to: '2026-10-01' })).toBe('range');
    expect(filterError({ ...defaults, compare: 'CUSTOM' })).toBe('custom');
    const base = { ...defaults, from: '2026-10-01', to: '2026-10-31' };
    expect(reportApiPath('/workspaces/w1', 'ingresos-gastos', base, defaults)).toBe(
      '/workspaces/w1/reports/income-expenses?from=2026-10-01&to=2026-10-31',
    );
    expect(
      exportApiPath('/workspaces/w1', 'historial-de-saldo', { ...base, accountId: 'acc' }, defaults),
    ).toBe('/workspaces/w1/reports/accounts/acc/balance-history/export?from=2026-10-01&to=2026-10-31');
    const cell = {
      report: 'EXPENSES_BY_CATEGORY',
      title: 't',
      from: '2026-10-01',
      to: '2026-10-31',
      extra: { categoryId: 'c1' },
    };
    expect(drillPath('/workspaces/w1', cell, base, defaults, 'cur')).toContain('report=EXPENSES_BY_CATEGORY');
    expect(drillPath('/workspaces/w1', cell, base, defaults, 'cur')).toContain('cursor=cur');
    expect(drillExportPath('/workspaces/w1', cell, base, defaults)).toContain('/reports/drill-down/export?');
    expect(slugOf('NET_WORTH')).toBe('patrimonio');
  });

  it('las proporciones de los gráficos usan enteros exactos y la dirección de una variación se decide por el signo', () => {
    expect(ratioBetween('50.00', '0', '100.00')).toBe(0.5);
    expect(ratioBetween('-10', '-10', '10')).toBe(0);
    expect(highestAmount(['1.50', '-3', '2'])).toBe('2');
    expect(lowestAmount(['1.50', '-3', '2'])).toBe('-3');
    expect(toneOf({ deltaAbs: bob('-0.00'), isNew: false })).toBe('same');
    expect(toneOf({ deltaAbs: bob('-5.00'), isNew: false })).toBe('down');
    expect(toneOf({ deltaAbs: bob('5.00'), isNew: true })).toBe('new');
  });
});
