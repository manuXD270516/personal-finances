import type { ReactNode } from 'react';
import { formatInstant } from '../dashboard/format';
import type { FormatContext, ResolvedRate } from '../dashboard/types';
import { formatDecimal } from '../AuditHistory';
import { businessDate, NetWorthChart, NetWorthTable, shortPeriod } from './NetWorthEvolutionChart';
import { NETWORTH_CSS } from './styles';
import type { NetWorthHistory, NetWorthPoint } from './types';

/** Periodos de la tarjeta compacta del Home (docs/33 D104) y de la vista completa. */
export const COMPACT_PERIODS = 6;
export const FULL_PERIODS = 12;

/** Los últimos `n` puntos de la serie (la tarjeta del Home muestra 6 de los 12 que entrega la API por defecto). */
export function lastPoints(history: NetWorthHistory, n: number): NetWorthHistory {
  return history.points.length <= n ? history : { ...history, points: history.points.slice(-n) };
}

function rateLine(r: ResolvedRate, f: FormatContext): string {
  return f.t('rates.item', {
    base: r.rate.base,
    quote: r.rate.quote,
    value: formatDecimal(r.rate.value, f.locale),
    type: r.rateType,
    source: r.attribution?.text ?? r.sourceLabel ?? f.t(`rates.source.${r.source}`),
    date: businessDate(r.asOf.slice(0, 10)),
  });
}

function RatesUsed({ points, f }: { points: readonly NetWorthPoint[]; f: FormatContext }) {
  const rated = points.filter((p) => p.ratesUsed.length > 0);
  if (rated.length === 0) return null;
  return (
    <section aria-labelledby="nw-rates-title" data-testid="net-worth-rates" className="pf-home-group">
      <h3 id="nw-rates-title">{f.t('rates.title')}</h3>
      <p className="pf-home-muted">{f.t('rates.intro')}</p>
      <ul className="pf-home-list">
        {rated.map((p) => (
          <li key={p.periodId} data-period={p.period}>
            <strong>{shortPeriod(p.period, f.locale)}</strong>
            <ul>
              {p.ratesUsed.map((r) => (
                <li key={`${r.fxRateId ?? r.asOf}-${r.rate.base}-${r.rate.quote}`}>{rateLine(r, f)}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Attributions({ history }: { history: NetWorthHistory }) {
  const external = { target: '_blank', rel: 'noopener noreferrer' } as const;
  if (history.meta.attributions.length === 0) return null;
  return (
    <ul data-testid="net-worth-attributions" className="pf-home-list pf-home-muted">
      {history.meta.attributions.map((a) => (
        <li key={a.provider} data-provider={a.provider}>
          <a href={a.url} {...external}>
            {a.text}
          </a>
          {a.license ? (
            <>
              {' · '}
              {a.licenseUrl ? (
                <a href={a.licenseUrl} {...external}>
                  {a.license}
                </a>
              ) : (
                a.license
              )}
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Evolución del patrimonio neto (reporting/net-worth, FR-REPORTING-006). Dos variantes con los mismos datos:
 * `compact` (tarjeta del Home, últimos 6 periodos, h3 bajo el h2 de patrimonio, enlace a la vista completa) y `full`
 * (página `/patrimonio`, 12 periodos, h1, tabla de datos visible, tasas usadas y atribuciones).
 * Presentacional: textos del namespace `NetWorthEvolution`; montos desde el string decimal en el locale del workspace.
 */
export function NetWorthEvolutionView({
  history,
  f,
  variant,
  fullHref,
  homeHref,
  actions,
}: {
  history: NetWorthHistory;
  f: FormatContext;
  variant: 'compact' | 'full';
  /** Destino de la vista completa (solo `compact`). */
  fullHref?: string | undefined;
  /** Destino del Home (solo `full`). */
  homeHref?: string | undefined;
  actions?: ReactNode;
}) {
  const shown = variant === 'compact' ? lastPoints(history, COMPACT_PERIODS) : history;
  const Heading = variant === 'compact' ? 'h3' : 'h1';
  const empty = shown.points.length === 0;
  const incomplete = shown.points.filter((p) => !p.complete);
  const prefix = variant === 'compact' ? 'nw-card' : 'nw-full';
  return (
    <section
      data-testid={variant === 'compact' ? 'net-worth-evolution-card' : 'net-worth-evolution'}
      aria-labelledby={`${prefix}-heading`}
      className={variant === 'compact' ? 'pf-home-card' : 'pf-home-group'}
    >
      <style>{NETWORTH_CSS}</style>
      <div className="pf-home-group-head">
        <Heading id={`${prefix}-heading`}>{f.t('title')}</Heading>
        <p className="pf-home-muted" style={{ margin: 0 }}>
          {f.t(variant === 'compact' ? 'subtitle.compact' : 'subtitle.full', { n: shown.points.length })}
        </p>
      </div>
      {empty ? (
        <div data-testid="net-worth-evolution-empty" className="pf-home-empty">
          <p>{f.t('empty')}</p>
        </div>
      ) : (
        <>
          <NetWorthChart history={shown} f={f} variant={variant} idPrefix={prefix} />
          {incomplete.length > 0 ? (
            <div data-testid="net-worth-evolution-incomplete" role="status" className="pf-home-warning">
              <p>{f.t('incomplete', { n: incomplete.length })}</p>
            </div>
          ) : null}
          <NetWorthTable history={shown} f={f} hidden={variant === 'compact'} />
          <p data-testid="net-worth-flag-notice" className="pf-home-muted">
            {f.t('flagNotice')}
          </p>
          {variant === 'full' ? (
            <>
              <RatesUsed points={shown.points} f={f} />
              <Attributions history={shown} />
              <p data-testid="net-worth-evolution-meta" className="pf-home-muted">
                {f.t('meta', {
                  date: formatInstant(history.meta.generatedAt, f.locale, history.meta.timeZone),
                  window: history.meta.rateWindowDays,
                })}
              </p>
            </>
          ) : null}
        </>
      )}
      {variant === 'compact' && fullHref ? (
        <a href={fullHref} data-testid="net-worth-evolution-link">
          {f.t('viewFull')}
        </a>
      ) : null}
      {variant === 'full' && homeHref ? (
        <a href={homeHref} data-testid="net-worth-evolution-home">
          {f.t('backHome')}
        </a>
      ) : null}
      {actions}
    </section>
  );
}
