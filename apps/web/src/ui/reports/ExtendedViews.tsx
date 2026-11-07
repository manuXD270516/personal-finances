import type { ReactNode } from 'react';
import { formatDecimal } from '../AuditHistory';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { mutedStyle } from '../common/ui';
import { BarsChart, LineChart } from './ReportChart';
import { ConsolidatedCell, DataTable, IncompleteNote, NativeList, Td, VariationCell } from './ReportParts';
import type { ViewProps } from './ReportViews';
import type {
  AccountsReport,
  ConversionsReport,
  DebtsReport,
  DrillCell,
  FeesReport,
  GoalsReport,
  RecurringCostsReport,
  SubscriptionsReport,
  TagsReport,
  TrendsReport,
} from './logic';

/**
 * Vistas de los nueve reportes ampliados (add-financial-reports-extended; docs/28 "Reportes"): como las del núcleo, un
 * gráfico SVG con su tabla de datos equivalente, cifras por moneda nativa y consolidadas con aviso de incompletas,
 * drill-down por celda cuando el reporte lo ofrece y textos (no solo color) para los estados. Presentacionales.
 */
export interface LinkProps {
  /** Ruta de la aplicación con el prefijo del espacio (enlaces a metas, compromisos y costos de conversión). */
  readonly href?: (path: string) => string;
}

const DrillBtn = ({
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

const Native = ({
  amount,
  f,
}: {
  amount: { byCurrency: never[] } | TagsReport['tags'][number]['amount'];
  f: FormatContext;
}) =>
  amount.byCurrency.length > 0 ? (
    <small style={mutedStyle}>
      <NativeList amounts={amount.byCurrency} f={f} />
    </small>
  ) : null;

const AmountCell = ({ amount, f }: { amount: TagsReport['tags'][number]['amount']; f: FormatContext }) => (
  <>
    <ConsolidatedCell amount={amount} f={f} />
    <Native amount={amount} f={f} />
  </>
);

const unit = (m: { amount: string }) => m.amount;
const empty = (f: FormatContext) => <p data-testid="report-empty">{f.t('empty')}</p>;

// ───────────────────────────────────────────── 4. gastos por etiqueta

export function TagsView({ f, data, onDrill, href }: ViewProps<TagsReport> & LinkProps) {
  if (data.tags.length === 0) return empty(f);
  const compared = data.meta.comparison !== null;
  const headers = [f.t('tags.tag'), f.t('tags.amount')];
  if (compared) headers.push(f.t('tags.vs'));
  return (
    <div className="pf-rp" data-testid="report-by-tag">
      <p role="note" data-testid="non-additive-note">
        {f.t('tags.nonAdditive')}
      </p>
      {data.tagMatch === 'ALL' && <p style={mutedStyle}>{f.t('tags.matchAll')}</p>}
      <BarsChart
        id="tags"
        locale={f.locale}
        title={f.t('tags.chartTitle')}
        description={f.t('tags.chartDesc', { n: data.tags.length, currency: data.meta.reportingCurrency })}
        categories={data.tags.map((t) => t.name)}
        series={[
          { name: f.t('tags.amount'), kind: 'b', values: data.tags.map((t) => unit(t.amount.consolidated)) },
        ]}
      />
      <DataTable caption={f.t('tags.caption')} label={f.t('tags.caption')} headers={headers}>
        {data.tags.map((t) => (
          <tr key={t.tagId} data-testid="tag-row">
            <Td num={false}>
              <DrillBtn
                f={f}
                onDrill={onDrill}
                cell={{
                  report: 'EXPENSES_BY_TAG',
                  title: t.name,
                  from: data.meta.from,
                  to: data.meta.to,
                  extra: { tagId: t.tagId },
                }}
              >
                {t.name}
              </DrillBtn>
              {t.archived && <small style={mutedStyle}> · {f.t('tags.archived')}</small>}
              {href && (
                <>
                  {' · '}
                  <a
                    data-testid="tag-by-category"
                    aria-label={f.t('tags.byCategoryOf', { name: t.name })}
                    href={href(
                      `/reportes/gastos-por-categoria?from=${data.meta.from}&to=${data.meta.to}&grouping=${data.meta.grouping}&tagId=${t.tagId}`,
                    )}
                  >
                    {f.t('tags.byCategory')}
                  </a>
                </>
              )}
            </Td>
            <Td>
              <AmountCell amount={t.amount} f={f} />
            </Td>
            {compared && (
              <Td>{t.comparison ? <VariationCell v={t.comparison} kind="expense" f={f} /> : '—'}</Td>
            )}
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

// ───────────────────────────────────────────── 5. gastos por cuenta

export function AccountsView({ f, data, onDrill }: ViewProps<AccountsReport>) {
  if (data.accounts.length === 0) return empty(f);
  const compared = data.meta.comparison !== null;
  const headers = [f.t('accounts.account'), f.t('accounts.type'), f.t('accounts.amount')];
  if (compared) headers.push(f.t('accounts.vs'));
  const cell = (id: string, title: string, extra: Record<string, string> = {}): DrillCell => ({
    report: 'EXPENSES_BY_ACCOUNT',
    title,
    from: data.meta.from,
    to: data.meta.to,
    extra: { accountId: id, ...extra },
  });
  return (
    <div className="pf-rp" data-testid="report-by-account">
      <BarsChart
        id="accounts"
        locale={f.locale}
        title={f.t('accounts.chartTitle')}
        description={f.t('accounts.chartDesc', {
          n: data.accounts.length,
          currency: data.meta.reportingCurrency,
        })}
        categories={data.accounts.map((a) => a.name)}
        series={[
          {
            name: f.t('accounts.amount'),
            kind: 'b',
            values: data.accounts.map((a) => unit(a.amount.consolidated)),
          },
        ]}
      />
      <DataTable caption={f.t('accounts.caption')} label={f.t('accounts.caption')} headers={headers}>
        {data.accounts.map((a) => (
          <AccountRows key={a.accountId} a={a} compared={compared} f={f} cell={cell} onDrill={onDrill} />
        ))}
        <tr data-testid="account-total">
          <Td num={false}>
            <strong>{f.t('accounts.total')}</strong>
          </Td>
          <Td num={false}>—</Td>
          <Td>
            <AmountCell amount={data.total} f={f} />
          </Td>
          {compared && (
            <Td>
              {data.totalComparison ? <VariationCell v={data.totalComparison} kind="expense" f={f} /> : '—'}
            </Td>
          )}
        </tr>
      </DataTable>
    </div>
  );
}

function AccountRows({
  a,
  compared,
  f,
  cell,
  onDrill,
}: {
  a: AccountsReport['accounts'][number];
  compared: boolean;
  f: FormatContext;
  cell: (id: string, title: string, extra?: Record<string, string>) => DrillCell;
  onDrill: (c: DrillCell) => void;
}) {
  return (
    <>
      <tr data-testid="account-row">
        <Td num={false}>
          <DrillBtn f={f} onDrill={onDrill} cell={cell(a.accountId, a.name)}>
            {a.name}
          </DrillBtn>
        </Td>
        <Td num={false}>{a.type}</Td>
        <Td>
          <AmountCell amount={a.amount} f={f} />
        </Td>
        {compared && <Td>{a.comparison ? <VariationCell v={a.comparison} kind="expense" f={f} /> : '—'}</Td>}
      </tr>
      {a.byCategory.map((c) => (
        <tr key={c.categoryId} data-testid="account-category-row">
          <Td num={false}>
            <span style={{ paddingInlineStart: 'var(--pf-space-4)' }}>
              <DrillBtn
                f={f}
                onDrill={onDrill}
                cell={cell(a.accountId, `${a.name} · ${c.name}`, { categoryId: c.categoryId })}
              >
                {c.name}
              </DrillBtn>
            </span>
          </Td>
          <Td num={false}>—</Td>
          <Td>
            <AmountCell amount={c.amount} f={f} />
          </Td>
          {compared && <Td>—</Td>}
        </tr>
      ))}
    </>
  );
}

// ───────────────────────────────────────────── 6. tendencias mensuales

export function TrendsView({ f, data, onDrill }: ViewProps<TrendsReport>) {
  if (data.series.length === 0) return empty(f);
  const first = data.series[0]!;
  const periods = first.cells.map((c) => c.period);
  const headers = [f.t('trends.category'), ...periods.map((p) => p.label), f.t('trends.total')];
  return (
    <div className="pf-rp" data-testid="report-trends">
      {data.normalized && <p style={mutedStyle}>{f.t('trends.normalized')}</p>}
      <LineChart
        id="trends"
        locale={f.locale}
        title={f.t('trends.chartTitle', { name: first.name })}
        description={f.t('trends.chartDesc', { n: periods.length, currency: data.meta.reportingCurrency })}
        points={first.cells.map((c) => ({
          label: c.period.label,
          value: unit(c.amount.consolidated),
          hollow: !c.amount.complete,
        }))}
      />
      <DataTable caption={f.t('trends.caption')} label={f.t('trends.caption')} headers={headers}>
        {data.series.map((s) => (
          <tr key={s.categoryId ?? 'others'} data-testid="trend-row">
            <Td num={false}>{s.categoryId === null ? f.t('trends.others') : s.name}</Td>
            {s.cells.map((c) => (
              <Td key={c.period.label}>
                {s.categoryId === null ? (
                  <ConsolidatedCell amount={c.amount} f={f} />
                ) : (
                  <DrillBtn
                    f={f}
                    onDrill={onDrill}
                    cell={{
                      report: 'MONTHLY_TRENDS',
                      title: `${s.name} · ${c.period.label}`,
                      from: c.period.from,
                      to: c.period.to,
                      extra: { categoryId: s.categoryId },
                    }}
                  >
                    {formatMoney(c.amount.consolidated, f.locale)}
                  </DrillBtn>
                )}
                {s.categoryId !== null && <IncompleteNote amount={c.amount} f={f} />}
              </Td>
            ))}
            <Td>
              <ConsolidatedCell amount={s.total} f={f} />
            </Td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

// ───────────────────────────────────────────── 14. comisiones

const FEE_TYPES = ['CONVERSION', 'TRANSFER', 'LOAN', 'FEE_CATEGORY'] as const;

export function FeesView({ f, data }: ViewProps<FeesReport>) {
  if (data.months.length === 0) return empty(f);
  const headers = [f.t('fees.period'), ...FEE_TYPES.map((t) => f.t(`fees.${t}`)), f.t('fees.total')];
  return (
    <div className="pf-rp" data-testid="report-fees">
      <BarsChart
        id="fees"
        locale={f.locale}
        title={f.t('fees.chartTitle')}
        description={f.t('fees.chartDesc', { n: data.months.length, currency: data.meta.reportingCurrency })}
        categories={data.months.map((m) => m.period.label)}
        series={[
          { name: f.t('fees.total'), kind: 'b', values: data.months.map((m) => unit(m.total.consolidated)) },
        ]}
      />
      <DataTable caption={f.t('fees.caption')} label={f.t('fees.caption')} headers={headers}>
        {data.months.map((m) => (
          <tr key={m.period.label} data-testid="fee-row">
            <Td num={false}>{m.period.label}</Td>
            {FEE_TYPES.map((t) => (
              <Td key={t}>
                <ConsolidatedCell amount={m.byType.find((b) => b.type === t)?.amount ?? m.total} f={f} />
              </Td>
            ))}
            <Td>
              <ConsolidatedCell amount={m.total} f={f} />
            </Td>
          </tr>
        ))}
      </DataTable>
      <p data-testid="fees-last12">
        {f.t('fees.last12', { amount: formatMoney(data.last12Months.consolidated, f.locale) })}
        <IncompleteNote amount={data.last12Months} f={f} />
      </p>
      <p style={mutedStyle}>{f.t('fees.cardNote')}</p>
    </div>
  );
}

// ───────────────────────────────────────────── 9. metas de ahorro

export function GoalsView({ f, data, href }: ViewProps<GoalsReport> & LinkProps) {
  if (data.goals.length === 0) return empty(f);
  return (
    <div className="pf-rp" data-testid="report-goals">
      {data.goals.map((g) => (
        <section key={g.goalId} aria-label={g.name} data-testid="goal-section">
          <h2 style={{ fontSize: 'var(--pf-text-lg)' }}>{g.name}</h2>
          <p style={mutedStyle}>{f.t('goals.target', { target: formatMoney(g.target, f.locale) })}</p>
          <LineChart
            id={`goal-${g.goalId}`}
            locale={f.locale}
            title={f.t('goals.chartTitle', { name: g.name })}
            description={f.t('goals.chartDesc', { n: g.months.length, currency: g.currency })}
            points={g.months.map((m) => ({
              label: m.period,
              value: unit(m.accumulated),
              hollow: !m.complete,
            }))}
          />
          <DataTable
            caption={f.t('goals.caption', { name: g.name, currency: g.currency })}
            label={g.name}
            headers={[
              f.t('goals.month'),
              f.t('goals.contributions'),
              f.t('goals.withdrawals'),
              f.t('goals.accumulated'),
              f.t('goals.percent'),
              f.t('goals.expected'),
              f.t('goals.status'),
            ]}
          >
            {g.months.map((m) => (
              <tr key={m.period} data-testid="goal-row">
                <Td num={false}>{m.period}</Td>
                <Td>{formatMoney(m.contributions, f.locale)}</Td>
                <Td>{formatMoney(m.withdrawals, f.locale)}</Td>
                <Td>
                  {formatMoney(m.accumulated, f.locale)}
                  {!m.complete && (
                    <small role="note" data-testid="incomplete-note">
                      {' '}
                      {f.t('goals.incomplete')}
                    </small>
                  )}
                </Td>
                <Td>{m.percent === null ? '—' : `${formatDecimal(m.percent, f.locale)} %`}</Td>
                <Td>{m.expected ? formatMoney(m.expected, f.locale) : '—'}</Td>
                <Td num={false}>{f.t(`goals.statuses.${m.status ?? 'NONE'}`)}</Td>
              </tr>
            ))}
          </DataTable>
          {href && <a href={href(`/goals/${g.goalId}`)}>{f.t('goals.movements')}</a>}
        </section>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────── 10. evolución de deudas

export function DebtsView({ f, data }: ViewProps<DebtsReport>) {
  if (data.debts.length === 0) return empty(f);
  const hasCard = data.debts.some((d) => d.kind === 'CARD');
  return (
    <div className="pf-rp" data-testid="report-debts">
      {data.debts.map((d) => (
        <section key={d.debtId} aria-label={d.name} data-testid="debt-section">
          <h2 style={{ fontSize: 'var(--pf-text-lg)' }}>
            {d.name} <small style={mutedStyle}>· {f.t(`debts.kind.${d.kind}`)}</small>
          </h2>
          <LineChart
            id={`debt-${d.debtId}`}
            locale={f.locale}
            title={f.t('debts.chartTitle', { name: d.name })}
            description={f.t('debts.chartDesc', { n: d.months.length, currency: d.currency })}
            points={d.months.map((m) => ({ label: m.period.label, value: unit(m.outstanding) }))}
          />
          <DataTable
            caption={f.t('debts.caption', { name: d.name, currency: d.currency })}
            label={d.name}
            headers={[
              f.t('debts.month'),
              f.t('debts.outstanding'),
              f.t('debts.principalPaid'),
              f.t('debts.interestPaid'),
              f.t('debts.chargesPaid'),
            ]}
          >
            {d.months.map((m) => (
              <tr key={m.period.label} data-testid="debt-row">
                <Td num={false}>{m.period.label}</Td>
                <Td>{formatMoney(m.outstanding, f.locale)}</Td>
                <Td>{m.principalPaid ? formatMoney(m.principalPaid, f.locale) : '—'}</Td>
                <Td>{m.interestPaid ? formatMoney(m.interestPaid, f.locale) : '—'}</Td>
                <Td>{m.chargesPaid ? formatMoney(m.chargesPaid, f.locale) : '—'}</Td>
              </tr>
            ))}
          </DataTable>
        </section>
      ))}
      <DataTable
        caption={f.t('debts.consolidated', { currency: data.meta.reportingCurrency })}
        label={f.t('debts.consolidated', { currency: data.meta.reportingCurrency })}
        headers={[
          f.t('debts.month'),
          f.t('debts.outstanding'),
          f.t('debts.principalPaid'),
          f.t('debts.interestPaid'),
        ]}
      >
        {data.consolidated.map((c) => (
          <tr key={c.period.label} data-testid="debt-consolidated-row">
            <Td num={false}>{c.period.label}</Td>
            <Td>
              <ConsolidatedCell amount={c.outstanding} f={f} />
            </Td>
            <Td>
              <ConsolidatedCell amount={c.principalPaid} f={f} />
            </Td>
            <Td>
              <ConsolidatedCell amount={c.interestPaid} f={f} />
            </Td>
          </tr>
        ))}
      </DataTable>
      {hasCard && <p style={mutedStyle}>{f.t('debts.cardNote')}</p>}
    </div>
  );
}

// ───────────────────────────────────────────── 11. costos recurrentes

export function RecurringCostsView({ f, data }: ViewProps<RecurringCostsReport>) {
  if (data.items.length === 0) return empty(f);
  const reporting = data.meta.reportingCurrency;
  const cadence = (cadenceKey: string, interval: number) =>
    [
      interval > 1 ? f.t('recurring.every', { n: interval }) : '',
      f.has(`recurring.cadences.${cadenceKey}`) ? f.t(`recurring.cadences.${cadenceKey}`) : cadenceKey,
    ]
      .filter(Boolean)
      .join(' ');
  const priced = data.items.filter((i) => i.monthlyReporting !== null);
  return (
    <div className="pf-rp" data-testid="report-recurring">
      <BarsChart
        id="recurring"
        locale={f.locale}
        title={f.t('recurring.chartTitle')}
        description={f.t('recurring.chartDesc', { n: priced.length, currency: reporting })}
        categories={priced.map((i) => i.name)}
        series={[
          { name: f.t('recurring.monthly'), kind: 'b', values: priced.map((i) => unit(i.monthlyReporting!)) },
        ]}
      />
      <DataTable
        caption={f.t('recurring.caption')}
        label={f.t('recurring.caption')}
        headers={[
          f.t('recurring.commitment'),
          f.t('recurring.cadence'),
          f.t('recurring.monthly'),
          f.t('recurring.annual'),
          f.t('recurring.monthlyReporting', { currency: reporting }),
        ]}
      >
        {data.items.map((i) => (
          <tr key={i.definitionId} data-testid="recurring-row">
            <Td num={false}>{i.name}</Td>
            <Td num={false}>{cadence(i.cadence, i.interval)}</Td>
            <Td>{i.variable || !i.monthly ? f.t('recurring.variable') : formatMoney(i.monthly, f.locale)}</Td>
            <Td>{i.variable || !i.annual ? '—' : formatMoney(i.annual, f.locale)}</Td>
            <Td>{i.monthlyReporting ? formatMoney(i.monthlyReporting, f.locale) : '—'}</Td>
          </tr>
        ))}
        <tr data-testid="recurring-total">
          <Td num={false}>
            <strong>{f.t('recurring.totals')}</strong>
          </Td>
          <Td num={false}>—</Td>
          <Td>
            <ConsolidatedCell amount={data.totals.monthly} f={f} />
          </Td>
          <Td>
            <ConsolidatedCell amount={data.totals.annual} f={f} />
          </Td>
          <Td>—</Td>
        </tr>
      </DataTable>
      {data.variableCount > 0 && (
        <p role="note" data-testid="recurring-variable">
          {f.t('recurring.variableCount', { count: data.variableCount })}
        </p>
      )}
    </div>
  );
}

// ───────────────────────────────────────────── 12. evolución de suscripciones

export function SubscriptionsView({ f, data }: ViewProps<SubscriptionsReport>) {
  if (data.months.length === 0) return empty(f);
  const eventText = (e: SubscriptionsReport['months'][number]['events'][number]) =>
    f.t(`subs.${e.kind}`, {
      name: e.name,
      price: e.newPrice ? formatMoney(e.newPrice, f.locale) : '',
      previous: e.previousPrice ? formatMoney(e.previousPrice, f.locale) : '',
    });
  return (
    <div className="pf-rp" data-testid="report-subscriptions">
      <LineChart
        id="subs"
        locale={f.locale}
        title={f.t('subs.chartTitle')}
        description={f.t('subs.chartDesc', { n: data.months.length, currency: data.meta.reportingCurrency })}
        points={data.months.map((m) => ({
          label: m.period.label,
          value: unit(m.monthlyCost.consolidated),
          hollow: !m.monthlyCost.complete,
        }))}
      />
      <DataTable
        caption={f.t('subs.caption')}
        label={f.t('subs.caption')}
        headers={[f.t('subs.month'), f.t('subs.monthlyCost'), f.t('subs.active'), f.t('subs.events')]}
      >
        {data.months.map((m) => (
          <tr key={m.period.label} data-testid="subscription-row">
            <Td num={false}>{m.period.label}</Td>
            <Td>
              <AmountCell amount={m.monthlyCost} f={f} />
            </Td>
            <Td>{m.active}</Td>
            <Td num={false}>
              {m.events.length === 0 ? (
                <span style={mutedStyle}>{f.t('subs.noEvents')}</span>
              ) : (
                <ul style={{ margin: 0, paddingInlineStart: 'var(--pf-space-4)' }}>
                  {m.events.map((e, i) => (
                    <li key={`${e.subscriptionId}-${e.kind}-${i}`} data-testid="subscription-event">
                      {formatLocalDate(e.date, f.locale)} · {eventText(e)}
                    </li>
                  ))}
                </ul>
              )}
            </Td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

// ───────────────────────────────────────────── 13. conversiones

export function ConversionsView({ f, data, href }: ViewProps<ConversionsReport> & LinkProps) {
  return (
    <div className="pf-rp" data-testid="report-conversions">
      {data.months.length > 0 && (
        <BarsChart
          id="conv"
          locale={f.locale}
          title={f.t('conv.chartTitle')}
          description={f.t('conv.chartDesc', {
            n: data.months.length,
            currency: data.meta.reportingCurrency,
          })}
          categories={data.months.map((m) => m.period.label)}
          series={[{ name: f.t('conv.cost'), kind: 'b', values: data.months.map((m) => unit(m.cost)) }]}
        />
      )}
      <DataTable
        caption={f.t('conv.monthsCaption')}
        label={f.t('conv.monthsCaption')}
        headers={[f.t('conv.month'), f.t('conv.cost'), f.t('conv.conversions'), f.t('conv.excluded')]}
      >
        {data.months.map((m) => (
          <tr key={m.period.label} data-testid="conversion-month">
            <Td num={false}>{m.period.label}</Td>
            <Td>
              {formatMoney(m.cost, f.locale)}
              {!m.costComplete && (
                <small role="note" data-testid="incomplete-note">
                  {' '}
                  {f.t('goals.incomplete')}
                </small>
              )}
            </Td>
            <Td>{m.conversions}</Td>
            <Td>{m.excluded}</Td>
          </tr>
        ))}
      </DataTable>
      {data.points.length === 0 ? (
        empty(f)
      ) : (
        <DataTable
          caption={f.t('conv.pointsCaption')}
          label={f.t('conv.pointsCaption')}
          headers={[f.t('conv.date'), f.t('conv.pair'), f.t('conv.effective'), f.t('conv.reference')]}
        >
          {data.points.map((p) => (
            <tr key={p.transactionId} data-testid="conversion-point">
              <Td num={false}>{formatLocalDate(p.date, f.locale)}</Td>
              <Td num={false}>{p.pair}</Td>
              <Td>{formatDecimal(p.effectiveRate, f.locale)}</Td>
              <Td>
                {p.referenceRate === null
                  ? f.t('conv.noReference')
                  : formatDecimal(p.referenceRate, f.locale)}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      {href && <a href={href('/fx/costos')}>{f.t('conv.detail')}</a>}
    </div>
  );
}
