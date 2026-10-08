import type { CSSProperties } from 'react';
import {
  badgeStyle,
  cardStyle,
  cellStyle,
  mutedStyle,
  numCellStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { formatInstant, formatMoney, formatSignedMoney } from '../dashboard/format';
import type { FormatContext, Money } from '../dashboard/types';
import {
  basisOf,
  formatPercent,
  isMoney,
  KPI_ORDER,
  signed,
  type CloseDelta,
  type CloseReport,
  type CloseSnapshot,
  type CloseSnapshotDiff,
  type DeltaKpi,
} from './closing-logic';
import { formatBusinessDate } from './logic';

const stackStyle = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0 } as const;
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
  gap: 'var(--pf-space-3)',
  margin: 0,
};

/** Variación respecto al periodo anterior: absoluta y %, o el motivo por el que no hay comparación. */
function DeltaText({ delta, f }: { delta: CloseDelta | undefined; f: FormatContext }) {
  if (!delta) return null;
  const abs = delta.absolute;
  if (abs === null) return <>{f.t('report.variation.unavailable')}</>;
  const absText = isMoney(abs)
    ? formatSignedMoney(abs, f.locale)
    : f.t('report.variation.points', { value: signed(abs, f.locale) });
  return (
    <>
      {absText}
      {delta.percentage !== null && isMoney(abs)
        ? ` (${signed(delta.percentage, f.locale)} %)`
        : isMoney(abs)
          ? ` (${f.t('report.variation.noPercent')})`
          : ''}
    </>
  );
}

function Kpi({
  label,
  value,
  testId,
  delta,
  f,
  incomplete,
}: {
  label: string;
  value: string;
  testId: string;
  delta?: CloseDelta | undefined;
  f: FormatContext;
  incomplete?: boolean;
}) {
  return (
    <div style={{ ...cardStyle, padding: 'var(--pf-space-3)' }} data-testid={`kpi-${testId}`}>
      <dt style={mutedStyle}>
        {label}
        {incomplete ? (
          <>
            {' '}
            <span
              style={{ ...badgeStyle, borderColor: 'var(--pf-warning-border)' }}
              data-testid="kpi-incomplete"
            >
              {f.t('report.incomplete')}
            </span>
          </>
        ) : null}
      </dt>
      <dd
        style={{ margin: 0, fontSize: 'var(--pf-text-xl)', fontVariantNumeric: 'tabular-nums' }}
        data-testid={`kpi-${testId}-value`}
      >
        {value}
      </dd>
      {delta ? (
        <dd style={{ ...mutedStyle, margin: 0 }} data-testid={`kpi-${testId}-delta`}>
          {f.t('report.variation.vs')} <DeltaText delta={delta} f={f} />
        </dd>
      ) : null}
    </div>
  );
}

const unconvertedText = (list: readonly Money[], f: FormatContext) =>
  list.map((m) => formatMoney(m, f.locale)).join(', ');

/**
 * Reporte de cierre de una versión (openspec add-month-closing 6.2): KPIs (ingresos, gastos, ahorro, tasa de ahorro y
 * patrimonio neto; "incompleto" con los montos sin convertir cuando falta una tasa), saldos por cuenta con su base de
 * conciliación, variación respecto al periodo anterior (absoluta y %, o el motivo de que no exista), presupuesto vs
 * real o "no disponible" y las advertencias reconocidas. Presentacional: recibe el reporte ya cargado.
 */
export function CloseReportView({
  report,
  f,
  href,
}: {
  report: CloseReport;
  f: FormatContext;
  href: (path: string) => string;
}) {
  const s = report.snapshot;
  const c = s.flows.consolidated;
  const deltas = new Map<DeltaKpi, CloseDelta>(report.comparison?.deltas.map((d) => [d.kpi, d]));
  const incomplete = !c.complete || !s.netWorth.complete;
  return (
    <>
      <p style={mutedStyle} data-testid="report-version-info">
        {f.t('report.versionInfo', {
          closeNo: s.closeNo,
          current: f.t(s.isCurrent ? 'report.current' : 'report.previous'),
          at: formatInstant(s.closedAt, f.locale, f.timeZone),
          from: formatBusinessDate(s.periodStart),
          to: formatBusinessDate(s.periodEnd),
        })}
      </p>
      {incomplete ? (
        <div role="status" style={warningStyle} data-testid="report-incomplete">
          <strong>{f.t('report.incompleteTitle')}</strong>{' '}
          {f.t('report.unconverted', {
            amounts: unconvertedText([...c.unconverted, ...s.netWorth.unconverted], f) || '—',
          })}
        </div>
      ) : null}
      <section aria-labelledby="report-kpis-title" style={{ ...stackStyle, gap: 'var(--pf-space-3)' }}>
        <h2 id="report-kpis-title">{f.t('report.kpis')}</h2>
        <dl style={gridStyle}>
          {KPI_ORDER.map((kpi) => {
            const delta = deltas.get(kpi);
            switch (kpi) {
              case 'INCOME':
                return (
                  <Kpi
                    key={kpi}
                    label={f.t('report.kpi.INCOME')}
                    testId="income"
                    value={formatMoney(c.income, f.locale)}
                    delta={delta}
                    f={f}
                    incomplete={!c.complete}
                  />
                );
              case 'EXPENSE':
                return (
                  <Kpi
                    key={kpi}
                    label={f.t('report.kpi.EXPENSE')}
                    testId="expense"
                    value={formatMoney(c.expense, f.locale)}
                    delta={delta}
                    f={f}
                    incomplete={!c.complete}
                  />
                );
              case 'SAVINGS':
                return (
                  <Kpi
                    key={kpi}
                    label={f.t('report.kpi.SAVINGS')}
                    testId="savings"
                    value={formatMoney(c.savings, f.locale)}
                    delta={delta}
                    f={f}
                    incomplete={!c.complete}
                  />
                );
              case 'SAVINGS_RATE':
                return (
                  <Kpi
                    key={kpi}
                    label={f.t('report.kpi.SAVINGS_RATE')}
                    testId="savings-rate"
                    value={
                      c.savingsRate === null ? f.t('report.noIncome') : formatPercent(c.savingsRate, f.locale)
                    }
                    delta={delta}
                    f={f}
                    incomplete={!c.complete}
                  />
                );
              default:
                return (
                  <Kpi
                    key={kpi}
                    label={f.t('report.kpi.NET_WORTH')}
                    testId="net-worth"
                    value={formatMoney(s.netWorth.amount, f.locale)}
                    delta={delta}
                    f={f}
                    incomplete={!s.netWorth.complete}
                  />
                );
            }
          })}
        </dl>
        {!report.comparison ? (
          <p style={mutedStyle} data-testid="report-comparison-unavailable">
            {report.comparisonUnavailableReason
              ? f.t(`report.comparisonReason.${report.comparisonUnavailableReason}`)
              : f.t('report.comparisonReason.UNKNOWN')}
          </p>
        ) : (
          <p style={mutedStyle} data-testid="report-comparison-with">
            {f.t('report.comparedWith', {
              label: report.comparison.previousLabel,
              closeNo: report.comparison.previousCloseNo,
            })}
          </p>
        )}
      </section>
      <FlowsTable snapshot={s} f={f} />
      <BalancesTable snapshot={s} f={f} href={href} />
      <BudgetSection snapshot={s} f={f} />
      <AcknowledgedSection snapshot={s} f={f} />
    </>
  );
}

function FlowsTable({ snapshot: s, f }: { snapshot: CloseSnapshot; f: FormatContext }) {
  if (s.flows.byCurrency.length === 0) return null;
  return (
    <section aria-labelledby="report-flows-title" style={{ ...stackStyle, gap: 'var(--pf-space-2)' }}>
      <h2 id="report-flows-title">{f.t('report.flows.title')}</h2>
      <div style={tableWrapStyle}>
        <table style={tableStyle} data-testid="report-flows">
          <caption
            style={{ ...mutedStyle, textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}
          >
            {f.t('report.flows.caption')}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('report.flows.currency')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('report.kpi.INCOME')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('report.kpi.EXPENSE')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('report.kpi.SAVINGS')}
              </th>
            </tr>
          </thead>
          <tbody>
            {s.flows.byCurrency.map((row) => (
              <tr key={row.currency}>
                <th scope="row" style={cellStyle}>
                  {row.currency}
                </th>
                <td style={numCellStyle}>{formatMoney(row.income, f.locale)}</td>
                <td style={numCellStyle}>{formatMoney(row.expense, f.locale)}</td>
                <td style={numCellStyle}>{formatMoney(row.savings, f.locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BalancesTable({
  snapshot: s,
  f,
  href,
}: {
  snapshot: CloseSnapshot;
  f: FormatContext;
  href: (path: string) => string;
}) {
  return (
    <section aria-labelledby="report-balances-title" style={{ ...stackStyle, gap: 'var(--pf-space-2)' }}>
      <h2 id="report-balances-title">{f.t('report.balances.title')}</h2>
      {s.balances.length === 0 ? (
        <p style={mutedStyle}>{f.t('report.balances.empty')}</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle} data-testid="report-balances">
            <caption
              style={{ ...mutedStyle, textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}
            >
              {f.t('report.balances.caption')}
            </caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {f.t('report.balances.account')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('report.balances.balance')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('report.balances.basis')}
                </th>
              </tr>
            </thead>
            <tbody>
              {s.balances.map((b) => {
                const basis = basisOf(b);
                return (
                  <tr key={b.accountId} data-testid="report-balance-row" data-basis={basis}>
                    <th scope="row" style={cellStyle}>
                      <a href={href(`/cuentas/${b.accountId}`)}>{b.accountName}</a>
                    </th>
                    <td style={numCellStyle}>{formatMoney(b.presented, f.locale)}</td>
                    <td style={cellStyle}>
                      <span style={badgeStyle} data-testid="report-basis">
                        {f.t(`report.balances.basisValue.${basis}`)}
                      </span>
                      {b.reconciliation ? (
                        <span style={mutedStyle}>
                          {' '}
                          {f.t('report.balances.statement', {
                            date: formatBusinessDate(b.reconciliation.statementDate),
                            balance: formatMoney(b.reconciliation.statementBalance, f.locale),
                          })}
                        </span>
                      ) : null}
                      {basis === 'WITHOUT_STATEMENT' ? (
                        <span style={mutedStyle}>
                          {' '}
                          <a href={href('/transacciones?sinExtracto=1')}>
                            {f.t('report.balances.reviewPending')}
                          </a>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BudgetSection({ snapshot: s, f }: { snapshot: CloseSnapshot; f: FormatContext }) {
  const b = s.budgetVsActual;
  return (
    <section aria-labelledby="report-budget-title" style={{ ...stackStyle, gap: 'var(--pf-space-2)' }}>
      <h2 id="report-budget-title">{f.t('report.budget.title')}</h2>
      {b === null ? (
        <p style={mutedStyle} data-testid="report-budget-unavailable">
          {f.t('report.budget.unavailable')}
        </p>
      ) : (
        <>
          <div style={tableWrapStyle}>
            <table style={tableStyle} data-testid="report-budget">
              <caption
                style={{ ...mutedStyle, textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}
              >
                {f.t('report.budget.caption')}
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={cellStyle}>
                    {f.t('report.budget.target')}
                  </th>
                  <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                    {f.t('report.budget.reference')}
                  </th>
                  <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                    {f.t('report.budget.actual')}
                  </th>
                  <th scope="col" style={cellStyle}>
                    {f.t('report.budget.status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.lines.map((l) => (
                  <tr key={`${l.target.kind}-${l.target.id}`}>
                    <th scope="row" style={cellStyle}>
                      {l.targetName}
                    </th>
                    <td style={numCellStyle}>{formatMoney(l.reference, f.locale)}</td>
                    <td style={numCellStyle}>{formatMoney(l.actual, f.locale)}</td>
                    <td style={cellStyle}>
                      {f.has(`report.budget.statusValue.${l.status}`)
                        ? f.t(`report.budget.statusValue.${l.status}`)
                        : l.status}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" style={cellStyle}>
                    {f.t('report.budget.totals')}
                  </th>
                  <td style={numCellStyle} data-testid="report-budget-planned">
                    {formatMoney(b.totals.planned, f.locale)}
                  </td>
                  <td style={numCellStyle} data-testid="report-budget-actual">
                    {formatMoney(b.totals.actual, f.locale)}
                  </td>
                  <td style={cellStyle}>{b.totals.complete ? '' : f.t('report.incomplete')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function AcknowledgedSection({ snapshot: s, f }: { snapshot: CloseSnapshot; f: FormatContext }) {
  const ack = s.acknowledgedWarnings;
  if (!ack || ack.items.length === 0) return null;
  return (
    <section aria-labelledby="report-ack-title" style={{ ...stackStyle, gap: 'var(--pf-space-2)' }}>
      <h2 id="report-ack-title">{f.t('report.acknowledged.title')}</h2>
      <p style={{ margin: 0 }} data-testid="report-acknowledged">
        {f.t('report.acknowledged.body', {
          items: ack.items.map((k) => f.t(`kinds.${k}`)).join(', '),
          at: formatInstant(ack.at, f.locale, f.timeZone),
        })}
      </p>
    </section>
  );
}

/**
 * Comparación entre dos versiones del snapshot (`compareCloseSnapshots`, "hasta" menos "desde"): variación de saldos
 * por cuenta, de los flujos por moneda y consolidados y del patrimonio neto. Presentacional.
 */
export function CloseDiffView({
  diff,
  accountName,
  f,
}: {
  diff: CloseSnapshotDiff;
  accountName: (accountId: string) => string;
  f: FormatContext;
}) {
  const money = (m: Money) => formatSignedMoney(m, f.locale);
  return (
    <div
      style={{ ...stackStyle, gap: 'var(--pf-space-3)' }}
      data-testid="close-diff"
      data-from={diff.from}
      data-to={diff.to}
    >
      <p style={mutedStyle}>{f.t('diff.summary', { from: diff.from, to: diff.to })}</p>
      <dl style={gridStyle}>
        <div style={{ ...cardStyle, padding: 'var(--pf-space-3)' }}>
          <dt style={mutedStyle}>{f.t('report.kpi.INCOME')}</dt>
          <dd style={{ margin: 0 }} data-testid="diff-income">
            {money(diff.flows.consolidated.income)}
          </dd>
        </div>
        <div style={{ ...cardStyle, padding: 'var(--pf-space-3)' }}>
          <dt style={mutedStyle}>{f.t('report.kpi.EXPENSE')}</dt>
          <dd style={{ margin: 0 }} data-testid="diff-expense">
            {money(diff.flows.consolidated.expense)}
          </dd>
        </div>
        <div style={{ ...cardStyle, padding: 'var(--pf-space-3)' }}>
          <dt style={mutedStyle}>{f.t('report.kpi.SAVINGS')}</dt>
          <dd style={{ margin: 0 }} data-testid="diff-savings">
            {money(diff.flows.consolidated.savings)}
          </dd>
        </div>
        <div style={{ ...cardStyle, padding: 'var(--pf-space-3)' }}>
          <dt style={mutedStyle}>{f.t('report.kpi.NET_WORTH')}</dt>
          <dd style={{ margin: 0 }} data-testid="diff-net-worth">
            {money(diff.netWorth.delta)}
          </dd>
        </div>
      </dl>
      <div style={tableWrapStyle}>
        <table style={tableStyle} data-testid="diff-balances">
          <caption
            style={{ ...mutedStyle, textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}
          >
            {f.t('diff.balancesCaption')}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('report.balances.account')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('diff.delta')}
              </th>
            </tr>
          </thead>
          <tbody>
            {diff.balances.length === 0 ? (
              <tr>
                <td style={cellStyle} colSpan={2}>
                  {f.t('diff.noChanges')}
                </td>
              </tr>
            ) : (
              diff.balances.map((b) => (
                <tr key={`${b.accountId}-${b.currency}`} data-testid="diff-balance-row">
                  <th scope="row" style={cellStyle}>
                    {accountName(b.accountId)}
                  </th>
                  <td style={numCellStyle}>{money(b.delta)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
