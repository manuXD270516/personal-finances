'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import {
  cellStyle,
  Field,
  formStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  pageStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import {
  buildSimulationInput,
  chartPaths,
  emptyExtra,
  emptySimulatorForm,
  simulationToCsv,
  simulationsPath,
  loansPath,
  type ChartGeometry,
  type ExtraForm,
  type LoanFormErrors,
  type SimulatorForm,
} from './logic';
import type { Loan, PayoffSimulation, PayoffStrategiesSimulation, PayoffStrategyResult } from './types';

export function SimulatorPage() {
  return <WithWorkspace>{(ctx) => <Simulator ctx={ctx} />}</WithWorkspace>;
}

/** Estilo de línea por estrategia: además del color, el trazo distingue las series (no solo color). */
const SERIES_STYLE: Readonly<Record<string, { color: string; dash: string }>> = {
  NONE: { color: 'var(--pf-fg-muted)', dash: '6 4' },
  AVALANCHE: { color: 'var(--pf-primary)', dash: '' },
  SNOWBALL: { color: 'var(--pf-fin-income)', dash: '2 3' },
};

const GEOMETRY: ChartGeometry = { width: 640, height: 260, left: 70, right: 14, top: 14, bottom: 30 };

/** Saldo total por mes de cada estrategia (SVG con leyenda; la tabla comparativa y el detalle son la alternativa textual). */
export function BalanceChart({
  f,
  currency,
  strategies,
}: {
  f: FormatContext;
  currency: string;
  strategies: readonly PayoffStrategyResult[];
}) {
  const scale = scaleFor(currency);
  const model = chartPaths(
    strategies.map((s) => ({ key: s.strategy, points: s.series })),
    GEOMETRY,
    scale,
  );
  const plotBottom = GEOMETRY.height - GEOMETRY.bottom;
  const first = model.periods[0];
  const last = model.periods.at(-1);
  return (
    <figure style={{ margin: 0 }} data-testid="simulator-chart">
      <figcaption style={{ fontWeight: 600 }}>{f.t('simulator.chart.title', { currency })}</figcaption>
      <svg
        viewBox={`0 0 ${GEOMETRY.width} ${GEOMETRY.height}`}
        role="img"
        aria-label={f.t('simulator.chart.desc', {
          from: first ?? '',
          to: last ?? '',
          max: formatMoney({ amount: model.max, currency }, f.locale),
        })}
        style={{ width: '100%', height: 'auto', maxWidth: '40rem' }}
      >
        <line
          x1={GEOMETRY.left}
          x2={GEOMETRY.width - GEOMETRY.right}
          y1={plotBottom}
          y2={plotBottom}
          stroke="var(--pf-border-strong)"
          strokeWidth="1"
        />
        <line
          x1={GEOMETRY.left}
          x2={GEOMETRY.left}
          y1={GEOMETRY.top}
          y2={plotBottom}
          stroke="var(--pf-border-strong)"
          strokeWidth="1"
        />
        <text
          x={GEOMETRY.left - 6}
          y={GEOMETRY.top + 8}
          textAnchor="end"
          fontSize="11"
          fill="var(--pf-fg-muted)"
        >
          {formatMoney({ amount: model.max, currency }, f.locale)}
        </text>
        <text x={GEOMETRY.left - 6} y={plotBottom} textAnchor="end" fontSize="11" fill="var(--pf-fg-muted)">
          0
        </text>
        <text x={GEOMETRY.left} y={GEOMETRY.height - 8} fontSize="11" fill="var(--pf-fg-muted)">
          {first}
        </text>
        <text
          x={GEOMETRY.width - GEOMETRY.right}
          y={GEOMETRY.height - 8}
          textAnchor="end"
          fontSize="11"
          fill="var(--pf-fg-muted)"
        >
          {last}
        </text>
        {strategies.map((s) => {
          const style = SERIES_STYLE[s.strategy] ?? SERIES_STYLE['NONE']!;
          return (
            <path
              key={s.strategy}
              d={model.paths[s.strategy] ?? ''}
              fill="none"
              stroke={style.color}
              strokeWidth="2"
              strokeLinejoin="round"
              {...(style.dash ? { strokeDasharray: style.dash } : {})}
              data-series={s.strategy}
            />
          );
        })}
      </svg>
      <ul
        style={{
          display: 'flex',
          gap: 'var(--pf-space-4)',
          listStyle: 'none',
          padding: 0,
          margin: 0,
          flexWrap: 'wrap',
        }}
        data-testid="simulator-legend"
      >
        {strategies.map((s) => {
          const style = SERIES_STYLE[s.strategy] ?? SERIES_STYLE['NONE']!;
          return (
            <li key={s.strategy} style={{ display: 'flex', alignItems: 'center', gap: 'var(--pf-space-1)' }}>
              <svg width="28" height="8" aria-hidden="true">
                <line
                  x1="0"
                  x2="28"
                  y1="4"
                  y2="4"
                  stroke={style.color}
                  strokeWidth="2"
                  {...(style.dash ? { strokeDasharray: style.dash } : {})}
                />
              </svg>
              {f.t(`simulator.strategies.${s.strategy}`)}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/** Tabla comparativa de estrategias: interés total, ahorro, fecha libre de deudas y fin de cada préstamo. */
export function StrategiesResult({ f, result }: { f: FormatContext; result: PayoffStrategiesSimulation }) {
  const { currency } = result;
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-4)' }} data-testid="simulator-strategies">
      <p style={{ ...mutedStyle, margin: 0 }}>
        {f.t('simulator.startBalance', {
          amount: formatMoney({ amount: result.startBalance, currency }, f.locale),
        })}
      </p>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('simulator.compareTitle')}>
        <table style={tableStyle} data-testid="simulator-table">
          <caption className="pf-sr-only">{f.t('simulator.compareTitle')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('simulator.columns.strategy')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('simulator.columns.interest')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('simulator.columns.saved')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('simulator.columns.debtFree')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('simulator.columns.loans')}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.strategies.map((s) => (
              <tr key={s.strategy} data-testid="simulator-row" data-strategy={s.strategy}>
                <th scope="row" style={cellStyle}>
                  {f.t(`simulator.strategies.${s.strategy}`)}
                </th>
                <td style={numCellStyle} data-field="interest">
                  {formatMoney({ amount: s.totalInterest, currency }, f.locale)}
                </td>
                <td style={numCellStyle} data-field="saved">
                  {formatMoney({ amount: s.interestSaved, currency }, f.locale)}
                </td>
                <td style={cellStyle} data-field="debtFree">
                  {s.debtFreeDate ? formatBusinessDate(s.debtFreeDate) : '—'}
                </td>
                <td style={cellStyle}>
                  {s.loans
                    .map((l) => `${l.name}: ${l.endDate ? formatBusinessDate(l.endDate) : '—'}`)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BalanceChart f={f} currency={currency} strategies={result.strategies} />
      {result.outOfStrategy.length > 0 ? (
        <section role="note" style={warningStyle} data-testid="simulator-out">
          <h3 style={{ fontSize: '1rem', marginTop: 0 }}>
            <span aria-hidden="true">⚠</span> {f.t('simulator.outTitle')}
          </h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {result.outOfStrategy.map((l) => (
              <li key={l.loanId}>
                {f.t(`simulator.out.${l.reason}`, { name: l.name, currency: l.currency })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ExtrasResult({
  f,
  result,
}: {
  f: FormatContext;
  result: Extract<PayoffSimulation, { type: 'LOAN_EXTRAS' }>;
}) {
  const { currency } = result;
  const rows = [['current', result.current] as const, ['scenario', result.scenario] as const];
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="simulator-extras">
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('simulator.compareTitle')}>
        <table style={tableStyle} data-testid="simulator-table">
          <caption className="pf-sr-only">{f.t('simulator.compareTitle')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('simulator.columns.scenario')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('simulator.columns.interest')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('simulator.columns.end')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('simulator.columns.installments')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, p]) => (
              <tr key={key} data-testid="simulator-row" data-scenario={key}>
                <th scope="row" style={cellStyle}>
                  {f.t(`simulator.scenarios.${key}`)}
                </th>
                <td style={numCellStyle} data-field="interest">
                  {formatMoney({ amount: p.totalInterest, currency }, f.locale)}
                </td>
                <td style={cellStyle} data-field="end">
                  {p.endDate ? formatBusinessDate(p.endDate) : '—'}
                </td>
                <td style={numCellStyle}>{p.installments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0 }} data-testid="simulator-saved">
        {f.t('simulator.saved', {
          amount: formatMoney({ amount: result.interestSaved, currency }, f.locale),
          months: result.monthsSaved,
        })}
      </p>
    </div>
  );
}

function Simulator({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Debt', ctx);
  const [loans, setLoans] = useState<readonly Loan[]>([]);
  const [form, setForm] = useState<SimulatorForm>(() => emptySimulatorForm(ctx.ws.baseCurrency));
  const [errors, setErrors] = useState<LoanFormErrors>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PayoffSimulation | undefined>();
  const set = (patch: Partial<SimulatorForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setResult(undefined);
  };
  const err = (k: string) => (errors[k] ? f.t(`errors.${errors[k]}`) : undefined);

  useEffect(() => {
    void ctx.api
      .get<{ data: Loan[] }>(`${loansPath(ctx.base)}?status=ACTIVE`)
      .then((r) => setLoans(r.data?.data ?? []))
      .catch(() => setLoans([]));
  }, [ctx.api, ctx.base]);

  const currencies = useMemo(() => {
    const codes = ctx.currencies.filter((c) => c.enabled && c.kind === 'FIAT').map((c) => c.code);
    return codes.length > 0 ? codes : [ctx.ws.baseCurrency];
  }, [ctx.currencies, ctx.ws.baseCurrency]);
  const eligible = loans.filter((l) => l.method !== 'CUSTOM');

  async function run() {
    setProblem(undefined);
    const loanCurrency =
      form.mode === 'LOAN' ? loans.find((l) => l.id === form.loanId)?.principal.currency : undefined;
    const built = buildSimulationInput(loanCurrency ? { ...form, currency: loanCurrency } : form, {
      locale: ctx.formatLocale,
      scale: scaleFor(loanCurrency ?? form.currency, ctx.scales),
    });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await ctx.api.command<PayoffSimulation>('POST', simulationsPath(ctx.base), built.input, {
        idempotent: false,
      });
      setResult(r.data);
    } catch (e) {
      setResult(undefined);
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!result) return;
    const header = [
      f.t('simulator.csv.scenario'),
      f.t('simulator.csv.interest'),
      f.t('simulator.csv.saved'),
      f.t('simulator.csv.end'),
      f.t('simulator.csv.months'),
    ];
    const blob = new Blob([simulationToCsv(result, header)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'simulacion.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const setExtra = (i: number, patch: Partial<ExtraForm>) =>
    set({ extras: form.extras.map((e, k) => (k === i ? { ...e, ...patch } : e)) });

  return (
    <section aria-labelledby="simulator-title" style={pageStyle} data-testid="simulator-page">
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/debts')}>{f.t('back')}</a>
      </p>
      <h1 id="simulator-title">{f.t('simulator.title')}</h1>
      <p style={mutedStyle}>{f.t('simulator.intro')}</p>
      <form
        style={formStyle}
        noValidate
        data-testid="simulator-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div role="radiogroup" aria-label={f.t('simulator.mode')} style={rowStyle}>
          {(['STRATEGIES', 'LOAN'] as const).map((m) => (
            <label key={m} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
              <input
                type="radio"
                name="simulator-mode"
                checked={form.mode === m}
                data-testid={`simulator-mode-${m}`}
                onChange={() => set({ mode: m })}
              />
              {f.t(`simulator.modes.${m}`)}
            </label>
          ))}
        </div>
        {form.mode === 'STRATEGIES' ? (
          <div style={rowStyle}>
            <Field label={f.t('simulator.currency')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={form.currency}
                  data-testid="simulator-currency"
                  onChange={(e) => set({ currency: e.target.value })}
                >
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label={f.t('simulator.monthlyExtra')}
              error={err('monthlyExtra')}
              hint={f.t('simulator.monthlyHint')}
            >
              {(p) => (
                <input
                  {...p}
                  style={inputStyle}
                  inputMode="decimal"
                  value={form.monthlyExtra}
                  data-testid="simulator-monthly-extra"
                  onChange={(e) => set({ monthlyExtra: e.target.value })}
                />
              )}
            </Field>
          </div>
        ) : (
          <>
            <Field label={f.t('simulator.loan')} error={err('loanId')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={form.loanId}
                  data-testid="simulator-loan"
                  onChange={(e) => set({ loanId: e.target.value })}
                >
                  <option value="">{f.t('form.choose')}</option>
                  {eligible.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.principal.currency})
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {form.extras.map((e, i) => (
              <div key={i} style={rowStyle} data-testid="simulator-extra">
                <Field label={f.t('simulator.extraType')}>
                  {(p) => (
                    <select
                      {...p}
                      style={inputStyle}
                      value={e.type}
                      onChange={(ev) => setExtra(i, { type: ev.target.value as ExtraForm['type'] })}
                    >
                      <option value="ONE_TIME">{f.t('simulator.extraTypes.ONE_TIME')}</option>
                      <option value="MONTHLY">{f.t('simulator.extraTypes.MONTHLY')}</option>
                    </select>
                  )}
                </Field>
                <Field
                  label={
                    e.type === 'ONE_TIME'
                      ? f.t('simulator.afterInstallment')
                      : f.t('simulator.fromInstallment')
                  }
                  error={err(`extras.${i}.installmentNo`)}
                >
                  {(p) => (
                    <input
                      {...p}
                      style={inputStyle}
                      inputMode="numeric"
                      value={e.installmentNo}
                      data-testid={`simulator-extra-no-${i}`}
                      onChange={(ev) => setExtra(i, { installmentNo: ev.target.value })}
                    />
                  )}
                </Field>
                <Field label={f.t('simulator.extraAmount')} error={err(`extras.${i}.amount`)}>
                  {(p) => (
                    <input
                      {...p}
                      style={inputStyle}
                      inputMode="decimal"
                      value={e.amount}
                      data-testid={`simulator-extra-amount-${i}`}
                      onChange={(ev) => setExtra(i, { amount: ev.target.value })}
                    />
                  )}
                </Field>
                <button
                  type="button"
                  disabled={form.extras.length === 1}
                  onClick={() => set({ extras: form.extras.filter((_, k) => k !== i) })}
                >
                  {f.t('custom.remove')}
                </button>
              </div>
            ))}
            <div>
              <button type="button" onClick={() => set({ extras: [...form.extras, emptyExtra()] })}>
                {f.t('simulator.addExtra')}
              </button>
            </div>
          </>
        )}
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('simulator.notSaved')}</p>
        <div style={rowStyle}>
          <button type="submit" disabled={busy} data-testid="simulator-run">
            {busy ? f.t('simulator.running') : f.t('simulator.run')}
          </button>
          {result ? (
            <button type="button" onClick={exportCsv} data-testid="simulator-export">
              {f.t('simulator.export')}
            </button>
          ) : null}
        </div>
      </form>
      {Object.keys(errors).length > 0 ? (
        <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
          {f.t('form.fixErrors', { count: Object.keys(errors).length })}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div aria-live="polite">
        {result?.type === 'STRATEGIES' ? <StrategiesResult f={f} result={result} /> : null}
        {result?.type === 'LOAN_EXTRAS' ? <ExtrasResult f={f} result={result} /> : null}
      </div>
    </section>
  );
}
