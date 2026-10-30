'use client';

import { useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  Field,
  cardStyle,
  cellStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
} from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { coverageRows, percentText, rulesPath } from './logic';
import type { Coverage } from './types';

/** Cociente «clasificadas por reglas ÷ total» junto a la meta, con el desglose por origen y por regla. */
export function CoverageView({
  coverage,
  f,
  locale,
}: {
  coverage: Coverage;
  f: FormatContext;
  locale: string;
}) {
  return (
    <div
      style={{ display: 'grid', gap: 'var(--pf-space-3)' }}
      data-testid="coverage-view"
      data-meets={coverage.meetsTarget ? 'true' : 'false'}
    >
      <div style={cardStyle}>
        <p style={{ margin: 0, fontSize: 'var(--pf-text-lg)' }}>
          <strong data-testid="coverage-ratio">{percentText(coverage.ruleCoverage, locale)}</strong>{' '}
          <span style={mutedStyle}>
            ({coverage.ruleCoverage}) ·{' '}
            {f.t('coverage.target', { target: percentText(coverage.target, locale) })}
          </span>
        </p>
        <p style={{ margin: 0 }} data-testid="coverage-verdict">
          <span aria-hidden="true">{coverage.meetsTarget ? '✔' : '✘'}</span>{' '}
          {coverage.meetsTarget ? f.t('coverage.meets') : f.t('coverage.notMeets')}
        </p>
        <p style={mutedStyle}>{f.t('coverage.total', { count: coverage.count })}</p>
      </div>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('coverage.originRegion')}>
        <table style={tableStyle} data-testid="coverage-origins">
          <caption className="pf-sr-only">{f.t('coverage.originCaption')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('coverage.origin')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('coverage.count')}
              </th>
            </tr>
          </thead>
          <tbody>
            {coverageRows(coverage).map((r) => (
              <tr key={r.origin} data-testid="coverage-origin" data-origin={r.origin}>
                <th scope="row" style={cellStyle}>
                  {f.t(`coverage.origins.${r.origin}`)}
                </th>
                <td style={numCellStyle}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {coverage.byRule.length > 0 ? (
        <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('coverage.ruleRegion')}>
          <table style={tableStyle} data-testid="coverage-rules">
            <caption className="pf-sr-only">{f.t('coverage.ruleCaption')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {f.t('coverage.rule')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('coverage.count')}
                </th>
              </tr>
            </thead>
            <tbody>
              {coverage.byRule.map((r) => (
                <tr key={r.ruleId} data-testid="coverage-rule" data-rule-id={r.ruleId}>
                  <th scope="row" style={cellStyle}>
                    {r.name}
                    {r.archived ? <span style={mutedStyle}> ({f.t('coverage.archived')})</span> : null}
                  </th>
                  <td style={numCellStyle}>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Cobertura por rango de fechas de las transacciones importadas (la medida del criterio de salida del 70 %). */
export function CoveragePanel({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Rules', ctx);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [coverage, setCoverage] = useState<Coverage | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const { api, base } = ctx;

  const load = async () => {
    setBusy(true);
    try {
      const r = await api.get<Coverage>(`${rulesPath(base, '/coverage')}?from=${from}&to=${to}`);
      setCoverage(r.data);
      setProblem(undefined);
    } catch (err) {
      setCoverage(undefined);
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="coverage-panel">
      <p style={mutedStyle}>{f.t('coverage.intro')}</p>
      <div style={rowStyle}>
        <Field label={f.t('coverage.from')}>
          {(p) => (
            <input
              {...p}
              type="date"
              style={inputStyle}
              value={from}
              data-testid="coverage-from"
              onChange={(e) => setFrom(e.target.value)}
            />
          )}
        </Field>
        <Field label={f.t('coverage.to')}>
          {(p) => (
            <input
              {...p}
              type="date"
              style={inputStyle}
              value={to}
              data-testid="coverage-to"
              onChange={(e) => setTo(e.target.value)}
            />
          )}
        </Field>
        <button
          type="button"
          disabled={busy || from === '' || to === ''}
          onClick={() => void load()}
          data-testid="coverage-submit"
        >
          {f.t('coverage.load')}
        </button>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {coverage ? (
        coverage.count === 0 ? (
          <p style={mutedStyle} data-testid="coverage-empty">
            {f.t('coverage.empty')}
          </p>
        ) : (
          <CoverageView coverage={coverage} f={f} locale={ctx.formatLocale} />
        )
      ) : null}
    </div>
  );
}
