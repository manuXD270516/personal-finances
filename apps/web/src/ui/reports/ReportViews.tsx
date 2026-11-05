import type { ReactNode } from 'react';
import { barRatio, maxAmount } from '../dashboard/category-comparison';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext, Money } from '../dashboard/types';
import { mutedStyle } from '../common/ui';
import { BarsChart, LineChart } from './ReportChart';
import { ConsolidatedCell, DataTable, IncompleteNote, NativeList, Td, VariationCell } from './ReportParts';
import {
  shortDate,
  type AccountBalanceHistoryReport,
  type BudgetVsActualReport,
  type CashFlowReport,
  type CategoryLeaf,
  type DrillCell,
  type ExpensesByCategoryReport,
  type IncomeExpensesReport,
  type NetWorthReport,
  type ReportAmount,
  type ReportBaseline,
} from './logic';

/**
 * Vistas de los seis reportes disponibles (add-financial-reports; docs/28 "Reportes"): gráfico SVG con su tabla de datos
 * equivalente, variación con texto e icono, cifras por moneda nativa y consolidadas con aviso de incompletas, y un botón
 * por cifra que abre el drill-down. Presentacionales: los datos llegan por props (testeables con `renderToStaticMarkup`).
 */
export interface ViewProps<T> {
  readonly f: FormatContext;
  readonly data: T;
  readonly onDrill: (cell: DrillCell) => void;
}

const DrillButton = ({
  f,
  cell,
  onDrill,
  children,
}: {
  f: FormatContext;
  cell: DrillCell;
  onDrill: (c: DrillCell) => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    className="pf-rp-link"
    aria-label={f.t('drill.open', { cell: cell.title })}
    onClick={() => onDrill(cell)}
    data-testid="drill-open"
  >
    {children}
  </button>
);

const periodTitle = (label: string, nature: string) => `${nature} · ${label}`;

function AmountWithNative({ amount, f }: { amount: ReportAmount; f: FormatContext }) {
  return (
    <>
      <ConsolidatedCell amount={amount} f={f} />
      {amount.byCurrency.length > 0 && (
        <small style={mutedStyle}>
          <NativeList amounts={amount.byCurrency} f={f} />
        </small>
      )}
    </>
  );
}

const baselineText = (b: ReportBaseline | undefined, f: FormatContext): string => {
  if (!b) return '—';
  if (b.insufficient || !b.average) return f.t('baseline.insufficient', { n: b.periods });
  const delta = b.deltaAbs ? `${b.deltaAbs.amount} ${b.deltaAbs.currency}` : '';
  return f.t('baseline.value', {
    n: b.periods,
    average: formatMoney(b.average, f.locale),
    delta: delta ? ` · ${delta}${b.deltaPct ? ` (${b.deltaPct} %)` : ''}` : '',
  });
};

export function IncomeExpensesView({ f, data, onDrill }: ViewProps<IncomeExpensesReport>) {
  const compared = data.meta.comparison !== null;
  const hasBaseline = data.rows.some((r) => r.baseline);
  const headers = [
    f.t('income.period'),
    f.t('income.income'),
    f.t('income.expenses'),
    f.t('income.savings'),
    f.t('income.savingsRate'),
  ];
  if (compared) headers.push(f.t('income.vsExpenses'));
  if (hasBaseline) headers.push(f.t('income.baseline'));
  const cell = (
    row: { from: string; to: string; label: string },
    nature: 'INCOME' | 'EXPENSE',
  ): DrillCell => ({
    report: 'INCOME_EXPENSES',
    title: periodTitle(row.label, f.t(nature === 'INCOME' ? 'income.income' : 'income.expenses')),
    from: row.from,
    to: row.to,
    extra: { nature },
  });
  return (
    <div className="pf-rp" data-testid="report-income-expenses">
      <BarsChart
        id="ie"
        locale={f.locale}
        title={f.t('income.chartTitle')}
        description={f.t('income.chartDesc', { n: data.rows.length, currency: data.meta.reportingCurrency })}
        categories={data.rows.map((r) => r.period.label)}
        series={[
          {
            name: f.t('income.income'),
            kind: 'a',
            values: data.rows.map((r) => r.income.consolidated.amount),
          },
          {
            name: f.t('income.expenses'),
            kind: 'b',
            values: data.rows.map((r) => r.expenses.consolidated.amount),
          },
        ]}
      />
      {data.meta.comparison &&
        data.meta.comparison.days !== data.meta.comparison.currentDays &&
        !data.meta.comparison.normalized && (
          <p role="note" data-testid="days-differ">
            {f.t('income.daysDiffer', {
              current: data.meta.comparison.currentDays,
              compared: data.meta.comparison.days,
            })}
          </p>
        )}
      <DataTable caption={f.t('income.caption')} label={f.t('income.caption')} headers={headers}>
        {data.rows.map((r) => (
          <tr key={r.period.label + r.period.from} data-testid="ie-row">
            <Td num={false}>
              {r.period.label}
              {r.period.partial && <small style={mutedStyle}> · {f.t('partial')}</small>}
            </Td>
            <Td>
              <DrillButton f={f} cell={cell(r.period, 'INCOME')} onDrill={onDrill}>
                {formatMoney(r.income.consolidated, f.locale)}
              </DrillButton>
              <br />
              <small style={mutedStyle}>
                <NativeList amounts={r.income.byCurrency} f={f} />
              </small>
            </Td>
            <Td>
              <DrillButton f={f} cell={cell(r.period, 'EXPENSE')} onDrill={onDrill}>
                {formatMoney(r.expenses.consolidated, f.locale)}
              </DrillButton>
              <IncompleteNote amount={r.expenses} f={f} />
              <br />
              <small style={mutedStyle}>
                <NativeList amounts={r.expenses.byCurrency} f={f} />
              </small>
            </Td>
            <Td>
              <AmountWithNative amount={r.savings} f={f} />
            </Td>
            <Td>{r.savingsRate === null ? f.t('income.rateUndefined') : `${r.savingsRate} %`}</Td>
            {compared && (
              <Td>{r.comparison ? <VariationCell v={r.comparison.expenses} kind="expense" f={f} /> : '—'}</Td>
            )}
            {hasBaseline && <Td>{baselineText(r.baseline?.expenses, f)}</Td>}
          </tr>
        ))}
        <tr data-testid="ie-total">
          <Td num={false}>
            <strong>{f.t('total')}</strong>
          </Td>
          <Td>{formatMoney(data.totals.income.consolidated, f.locale)}</Td>
          <Td>{formatMoney(data.totals.expenses.consolidated, f.locale)}</Td>
          <Td>{formatMoney(data.totals.savings.consolidated, f.locale)}</Td>
          <Td>
            {data.totals.savingsRate === null ? f.t('income.rateUndefined') : `${data.totals.savingsRate} %`}
          </Td>
          {compared && (
            <Td>
              {data.totals.comparison ? (
                <VariationCell v={data.totals.comparison.expenses} kind="expense" f={f} />
              ) : (
                '—'
              )}
            </Td>
          )}
          {hasBaseline && <Td>—</Td>}
        </tr>
      </DataTable>
    </div>
  );
}

function CategoryRows({
  leaf,
  depth,
  max,
  f,
  period,
  groupLabel,
  onDrill,
  compared,
}: {
  leaf: CategoryLeaf;
  depth: number;
  max: string;
  f: FormatContext;
  period: { from: string; to: string };
  groupLabel: string;
  onDrill: (c: DrillCell) => void;
  compared: boolean;
}) {
  const ratio = barRatio(leaf.amount.consolidated.amount, max);
  const cell: DrillCell = {
    report: 'EXPENSES_BY_CATEGORY',
    title: `${groupLabel} · ${leaf.name}`,
    from: period.from,
    to: period.to,
    extra: { categoryId: leaf.categoryId },
  };
  return (
    <>
      <tr data-testid="cat-row" data-depth={depth}>
        <Td num={false}>
          <span style={{ paddingLeft: `${depth * 1.25}rem` }}>
            <DrillButton f={f} cell={cell} onDrill={onDrill}>
              {leaf.name}
            </DrillButton>
            {leaf.archived && <small style={mutedStyle}> · {f.t('category.archived')}</small>}
            {leaf.negativeNet && <strong> · {f.t('category.negativeNet')}</strong>}
          </span>
        </Td>
        <Td>
          <AmountWithNative amount={leaf.amount} f={f} />
          <div
            aria-hidden="true"
            style={{
              height: 6,
              width: `${Math.round(ratio * 100)}%`,
              background: 'var(--pf-primary)',
              minWidth: ratio > 0 ? 2 : 0,
            }}
          />
        </Td>
        {compared && (
          <Td>{leaf.comparison ? <VariationCell v={leaf.comparison} kind="expense" f={f} /> : '—'}</Td>
        )}
      </tr>
      {(leaf.subcategories ?? []).map((s) => (
        <CategoryRows
          key={s.categoryId}
          leaf={s}
          depth={depth + 1}
          max={max}
          f={f}
          period={period}
          groupLabel={groupLabel}
          onDrill={onDrill}
          compared={compared}
        />
      ))}
    </>
  );
}

export function ExpensesByCategoryView({ f, data, onDrill }: ViewProps<ExpensesByCategoryReport>) {
  const compared = data.meta.comparison !== null;
  const period = { from: data.meta.from, to: data.meta.to };
  const max = maxAmount([
    ...data.groups.flatMap((g) => g.categories.map((c) => c.amount.consolidated.amount)),
    '0',
  ]);
  const headers = [f.t('category.name'), f.t('category.amount')];
  if (compared) headers.push(f.t('category.vs'));
  return (
    <div className="pf-rp" data-testid="report-by-category">
      <DataTable caption={f.t('category.caption')} label={f.t('category.caption')} headers={headers}>
        {data.groups.map((g) => (
          <GroupRows
            key={g.groupId}
            g={g}
            max={max}
            f={f}
            period={period}
            onDrill={onDrill}
            compared={compared}
          />
        ))}
        {data.others && (
          <tr data-testid="cat-others">
            <Td num={false}>{f.t('category.others')}</Td>
            <Td>
              <AmountWithNative amount={data.others} f={f} />
            </Td>
            {compared && <Td>—</Td>}
          </tr>
        )}
        <tr data-testid="cat-total">
          <Td num={false}>
            <strong>{f.t('total')}</strong>
          </Td>
          <Td>
            <AmountWithNative amount={data.total} f={f} />
          </Td>
          {compared && <Td>—</Td>}
        </tr>
      </DataTable>
    </div>
  );
}

function GroupRows({
  g,
  max,
  f,
  period,
  onDrill,
  compared,
}: {
  g: ExpensesByCategoryReport['groups'][number];
  max: string;
  f: FormatContext;
  period: { from: string; to: string };
  onDrill: (c: DrillCell) => void;
  compared: boolean;
}) {
  return (
    <>
      <tr data-testid="cat-group">
        <Td num={false}>
          <strong>{g.name}</strong>
          {g.negativeNet && <strong> · {f.t('category.negativeNet')}</strong>}
        </Td>
        <Td>
          <AmountWithNative amount={g.amount} f={f} />
        </Td>
        {compared && <Td>{g.comparison ? <VariationCell v={g.comparison} kind="expense" f={f} /> : '—'}</Td>}
      </tr>
      {g.categories.map((c) => (
        <CategoryRows
          key={c.categoryId}
          leaf={c}
          depth={1}
          max={max}
          f={f}
          period={period}
          groupLabel={g.name}
          onDrill={onDrill}
          compared={compared}
        />
      ))}
    </>
  );
}

export function BudgetVsActualView({ f, data, onDrill }: ViewProps<BudgetVsActualReport>) {
  if (data.periods.length === 0) return <p data-testid="report-empty">{f.t('empty')}</p>;
  return (
    <div className="pf-rp" data-testid="report-budget">
      {data.periods.map((p) => (
        <section key={p.periodId} aria-labelledby={`bva-${p.periodId}`}>
          <h2 id={`bva-${p.periodId}`}>{p.period.label}</h2>
          {p.status === 'NO_BUDGET' ? (
            <p data-testid="no-budget">{f.t('budget.noBudget')}</p>
          ) : (
            <DataTable
              caption={f.t('budget.caption', { period: p.period.label, currency: p.currency ?? '' })}
              label={p.period.label}
              headers={[
                f.t('budget.line'),
                f.t('budget.reference'),
                f.t('budget.actual'),
                f.t('budget.status'),
              ]}
            >
              {p.lines.map((l) => (
                <tr key={l.budgetLineId} data-testid="bva-line">
                  <Td num={false}>
                    <DrillButton
                      f={f}
                      cell={{
                        report: 'BUDGET_VS_ACTUAL',
                        title: `${p.period.label} · ${l.target.name}`,
                        from: p.period.from,
                        to: p.period.to,
                        extra: { budgetPeriodId: p.periodId, budgetLineId: l.budgetLineId },
                      }}
                      onDrill={onDrill}
                    >
                      {l.target.name}
                    </DrillButton>
                  </Td>
                  <Td>{formatMoney(l.reference, f.locale)}</Td>
                  <Td>
                    {formatMoney(l.actual, f.locale)}
                    {!l.actualComplete && <small role="note"> {f.t('incomplete.line')}</small>}
                  </Td>
                  <Td>
                    {f.has(`budget.statuses.${l.status}`) ? f.t(`budget.statuses.${l.status}`) : l.status}
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}
        </section>
      ))}
    </div>
  );
}

const COMPONENTS = ['operating', 'debt', 'savingsInvestments', 'currencyExchange', 'adjustments'] as const;

export function CashFlowView({ f, data, onDrill }: ViewProps<CashFlowReport>) {
  const compared = data.periods.some((p) => p.comparison);
  return (
    <div className="pf-rp" data-testid="report-cash-flow">
      <LineChart
        id="cf"
        locale={f.locale}
        title={f.t('cash.chartTitle')}
        description={f.t('cash.chartDesc', { n: data.periods.length, currency: data.meta.reportingCurrency })}
        points={data.periods.map((p) => ({
          label: p.period.label,
          value: (p.consolidated['closing'] as Money).amount,
          hollow: p.consolidated['complete'] === false,
        }))}
      />
      <p style={mutedStyle}>{f.t('cash.note')}</p>
      {data.periods.map((p) => {
        const c = p.consolidated as Record<string, Money>;
        return (
          <section key={p.period.label} aria-labelledby={`cf-${p.period.label}`}>
            <h2 id={`cf-${p.period.label}`}>{p.period.label}</h2>
            <DataTable
              caption={f.t('cash.caption', { period: p.period.label })}
              label={p.period.label}
              headers={[
                f.t('cash.currency'),
                f.t('cash.opening'),
                ...COMPONENTS.map((k) => f.t(`cash.${k}`)),
                f.t('cash.closing'),
              ]}
            >
              {p.byCurrency.map((b) => (
                <tr key={b['currency'] as string} data-testid="cf-currency">
                  <Td num={false}>{b['currency'] as string}</Td>
                  <Td>{formatMoney(b['opening'] as Money, f.locale)}</Td>
                  {COMPONENTS.map((k) => (
                    <Td key={k}>{formatMoney(b[k] as Money, f.locale)}</Td>
                  ))}
                  <Td>{formatMoney(b['closing'] as Money, f.locale)}</Td>
                </tr>
              ))}
              <tr data-testid="cf-consolidated">
                <Td num={false}>
                  <strong>{f.t('cash.consolidated', { currency: data.meta.reportingCurrency })}</strong>
                </Td>
                <Td>{formatMoney(c['opening'] as Money, f.locale)}</Td>
                {COMPONENTS.map((k) => (
                  <Td key={k}>
                    <DrillButton
                      f={f}
                      cell={{
                        report: 'CASH_FLOW',
                        title: `${p.period.label} · ${f.t(`cash.${k}`)}`,
                        from: p.period.from,
                        to: p.period.to,
                        extra: { component: k },
                      }}
                      onDrill={onDrill}
                    >
                      {formatMoney(c[k] as Money, f.locale)}
                    </DrillButton>
                    {compared && p.comparison?.[k] && (
                      <div>
                        <VariationCell v={p.comparison[k]!} kind="neutral" f={f} />
                      </div>
                    )}
                  </Td>
                ))}
                <Td>{formatMoney(c['closing'] as Money, f.locale)}</Td>
              </tr>
            </DataTable>
            <p style={mutedStyle} data-testid="cf-revaluation">
              {f.t('cash.revaluation', { amount: formatMoney(c['revaluation'] as Money, f.locale) })}
            </p>
          </section>
        );
      })}
    </div>
  );
}

export function AccountHistoryView({ f, data, onDrill }: ViewProps<AccountBalanceHistoryReport>) {
  const interesting = data.days.filter((d) => d.hasMovements || d.reconciled);
  return (
    <div className="pf-rp" data-testid="report-history">
      <LineChart
        id="ah"
        step
        locale={f.locale}
        title={f.t('history.chartTitle')}
        description={f.t('history.chartDesc', { n: data.days.length, currency: data.currency })}
        points={data.days.map((d) => ({
          label: shortDate(d.date),
          value: d.balance.amount,
          hollow: d.reconciled,
        }))}
      />
      <p>
        {f.t('history.summary', {
          opening: formatMoney(data.opening, f.locale),
          closing: formatMoney(data.closing, f.locale),
        })}
      </p>
      <DataTable
        caption={f.t('history.caption')}
        label={f.t('history.caption')}
        headers={[f.t('history.date'), f.t('history.balance'), f.t('history.valued'), f.t('history.marks')]}
      >
        {interesting.map((d) => (
          <tr key={d.date} data-testid="history-row">
            <Td num={false}>
              {d.hasMovements ? (
                <DrillButton
                  f={f}
                  cell={{
                    report: 'ACCOUNT_BALANCE_HISTORY',
                    title: `${data.currency} · ${formatLocalDate(d.date, f.locale)}`,
                    from: d.date,
                    to: d.date,
                    extra: { historyAccountId: data.accountId, date: d.date },
                  }}
                  onDrill={onDrill}
                >
                  {formatLocalDate(d.date, f.locale)}
                </DrillButton>
              ) : (
                formatLocalDate(d.date, f.locale)
              )}
            </Td>
            <Td>{formatMoney(d.balance, f.locale)}</Td>
            <Td>{d.valued ? formatMoney(d.valued, f.locale) : '—'}</Td>
            <Td>{d.reconciled ? f.t('history.reconciled') : ''}</Td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

export function NetWorthReportView({ f, data, onDrill }: ViewProps<NetWorthReport>) {
  return (
    <div className="pf-rp" data-testid="report-net-worth">
      <LineChart
        id="nw"
        locale={f.locale}
        title={f.t('worth.chartTitle')}
        description={f.t('worth.chartDesc', { n: data.points.length, currency: data.meta.reportingCurrency })}
        points={data.points.map((p) => ({
          label: data.granularity === 'DAY' ? shortDate(p.date) : p.date,
          value: p.netWorth.consolidated.amount,
          hollow: !p.netWorth.complete,
        }))}
      />
      {data.decomposition.map((d) => (
        <section key={d.period.label} aria-labelledby={`nwd-${d.period.label}`}>
          <h2 id={`nwd-${d.period.label}`}>{d.period.label}</h2>
          <p>
            {f.t('worth.change', {
              opening: formatMoney(d.opening, f.locale),
              closing: formatMoney(d.closing, f.locale),
            })}
          </p>
          <DataTable
            caption={f.t('worth.caption', { period: d.period.label })}
            label={d.period.label}
            headers={[f.t('worth.component'), f.t('worth.amount')]}
          >
            {(
              [
                'savings',
                'conversionResult',
                'adjustments',
                'otherMovements',
                'fxRevaluation',
                'assetRevaluation',
              ] as const
            ).map((k) => (
              <tr key={k} data-testid={`worth-${k}`}>
                <Td num={false}>{f.t(`worth.${k}`)}</Td>
                <Td>
                  <DrillButton
                    f={f}
                    cell={{
                      report: 'NET_WORTH',
                      title: `${d.period.label} · ${f.t(`worth.${k}`)}`,
                      from: d.period.from,
                      to: d.period.to,
                      extra: { component: k },
                    }}
                    onDrill={onDrill}
                  >
                    {formatMoney(d[k], f.locale)}
                  </DrillButton>
                </Td>
              </tr>
            ))}
          </DataTable>
          {d.revaluationByCurrency.length > 0 && (
            <ul>
              {d.revaluationByCurrency.map((r) => (
                <li key={r.currency}>
                  {f.t('worth.byCurrency', {
                    currency: r.currency,
                    kind: f.t(`worth.kind.${r.kind}`),
                    amount: formatMoney(r.amount, f.locale),
                  })}
                </li>
              ))}
            </ul>
          )}
          {!d.complete && (
            <p role="note" data-testid="worth-incomplete">
              {f.t('worth.incomplete', {
                amounts: d.unvalued.map((m) => formatMoney(m, f.locale)).join(', '),
              })}
            </p>
          )}
        </section>
      ))}
      <p style={mutedStyle}>{f.t('worth.excludedNote')}</p>
    </div>
  );
}
