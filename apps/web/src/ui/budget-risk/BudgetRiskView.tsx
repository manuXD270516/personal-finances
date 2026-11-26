import type { CSSProperties } from 'react';
import { badgeStyle, mutedStyle } from '../common/ui';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { budgetLineHref, hasPossible, levelPresentation, riskDetails, riskSentence } from './logic';
import type { BudgetLineRisk, BudgetRiskHome } from './types';

const TONES: Record<'danger' | 'warn' | 'ok' | 'neutral', CSSProperties> = {
  danger: { color: 'var(--pf-fin-over-budget)', borderColor: 'var(--pf-fin-over-budget)' },
  warn: { color: 'var(--pf-fin-warning)', borderColor: 'var(--pf-fin-warning)' },
  ok: { color: 'var(--pf-fin-ok)', borderColor: 'var(--pf-fin-ok)' },
  neutral: { color: 'var(--pf-fg)', borderColor: 'var(--pf-border-strong)' },
};

/**
 * Indicador de riesgo de una línea del plan del periodo en curso (add-budget-overrun-risk): nivel con TEXTO + ICONO (el
 * color solo refuerza) y, bajo él, la proyección (y la alta si existe), la fecha estimada y la base del cálculo. Es un
 * texto visible (además del `title`) para que lo lean también los lectores de pantalla. No toca la columna de proyección
 * lineal del plan. Presentacional; `f` es el namespace `BudgetRisk`.
 */
export function BudgetRiskCell({ risk, f }: { risk: BudgetLineRisk | undefined; f: FormatContext }) {
  if (!risk) return <span aria-label={f.t('none')}>—</span>;
  const p = levelPresentation(risk.level);
  const d = riskDetails(risk, f);
  const unavailable = risk.level === 'NOT_AVAILABLE';
  const title = [
    d.projected ? f.t('detail.projected', { amount: d.projected }) : '',
    d.projectedHigh ? f.t('detail.projectedHigh', { amount: d.projectedHigh }) : '',
    d.date ? f.t('detail.date', { date: d.date }) : '',
    d.basis ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      data-testid="line-risk"
      data-level={risk.level}
      data-basis={risk.basis ?? undefined}
      title={title || undefined}
    >
      <span style={{ ...badgeStyle, ...TONES[p.tone] }} data-testid="line-risk-level">
        <span aria-hidden="true">{p.icon}</span> {f.t(`level.${risk.level}`)}
      </span>
      {unavailable && risk.reason ? (
        <>
          <br />
          <small style={mutedStyle} data-testid="line-risk-reason">
            {f.has(`reason.${risk.reason}`) ? f.t(`reason.${risk.reason}`) : ''}
          </small>
        </>
      ) : null}
      {d.projected ? (
        <>
          <br />
          <small data-testid="line-risk-projection">
            {f.t('detail.projected', { amount: d.projected })}
            {d.projectedHigh ? ` · ${f.t('detail.projectedHigh', { amount: d.projectedHigh })}` : ''}
          </small>
        </>
      ) : null}
      {d.date ? (
        <>
          <br />
          <small data-testid="line-risk-date">{f.t('detail.date', { date: d.date })}</small>
        </>
      ) : null}
      {d.basis && (risk.level === 'LIKELY' || risk.level === 'POSSIBLE' || risk.level === 'UNLIKELY') ? (
        <>
          <br />
          <small style={mutedStyle} data-testid="line-risk-basis">
            {d.basis}
          </small>
        </>
      ) : null}
      {!risk.projectionComplete ? (
        <>
          <br />
          <small data-testid="line-risk-incomplete" style={{ color: 'var(--pf-fin-warning)' }}>
            <span aria-hidden="true">⚠</span> {f.t('incomplete')}
          </small>
        </>
      ) : null}
    </span>
  );
}

/** Leyenda del riesgo bajo la tabla del plan: qué es una proyección y qué significa «posible». */
export function BudgetRiskLegend({ lines, f }: { lines: readonly BudgetLineRisk[]; f: FormatContext }) {
  return (
    <div data-testid="budget-risk-legend" style={mutedStyle}>
      <p style={{ margin: 0 }}>{f.t('legend.intro')}</p>
      {hasPossible(lines) ? (
        <p style={{ margin: 0 }} data-testid="budget-risk-legend-possible">
          {f.t('legend.possible')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Tarjeta de Q5 «Presupuestos en riesgo» (add-budget-overrun-risk): hasta 3 líneas con riesgo «probable» ordenadas por la
 * fecha estimada del exceso, cada una con el enlace al plan del periodo con la línea resaltada, y cuántas más hay. Sin
 * líneas en riesgo no se muestra. Presentacional; `f` es el namespace `BudgetRisk` y `href` arma la ruta localizada.
 */
export function BudgetRiskHomeCard({
  block,
  f,
  href,
}: {
  block: BudgetRiskHome | null | undefined;
  f: FormatContext;
  href: (path: string) => string;
}) {
  if (!block || block.lines.length === 0) return null;
  return (
    <section data-testid="budget-risk-card" aria-labelledby="budget-risk-title" className="pf-home-group">
      <div className="pf-home-group-head">
        <h2 id="budget-risk-title">{f.t('home.title')}</h2>
        <p className="pf-home-muted" style={{ margin: 0 }}>
          {f.t('home.subtitle', { period: block.periodLabel })}
        </p>
      </div>
      <div className="pf-home-card">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--pf-space-3)' }}>
          {block.lines.map((line) => {
            const d = riskDetails(line, f);
            return (
              <li key={line.budgetLineId} data-testid="budget-risk-item" data-line-id={line.budgetLineId}>
                <p style={{ margin: 0 }}>
                  <a
                    href={href(budgetLineHref(block.periodLabel, line.budgetLineId))}
                    data-testid="budget-risk-link"
                  >
                    {line.targetName}
                  </a>{' '}
                  <span style={{ ...badgeStyle, ...TONES.danger }}>
                    <span aria-hidden="true">▲</span> {f.t('level.LIKELY')}
                  </span>
                </p>
                <p className="pf-home-muted" style={{ margin: 0 }} data-testid="budget-risk-sentence">
                  {riskSentence(line, f)}
                </p>
                <p className="pf-home-muted" style={{ margin: 0 }}>
                  {f.t('home.figures', {
                    projected: d.projected ?? '',
                    reference: formatMoney(line.reference, f.locale),
                  })}
                  {d.basis ? ` · ${d.basis}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
        {block.moreCount > 0 ? (
          <p className="pf-home-muted" data-testid="budget-risk-more">
            {f.t('home.more', { count: block.moreCount })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
