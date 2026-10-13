import { formatDecimal } from '../AuditHistory';
import { formatAge, formatInstant } from './format';
import { mutedStyle } from './styles';
import type { FormatContext, RateAttribution, ResolvedRate } from './types';

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * Atribución de la fuente de una tasa de provider (FR-FX-014, NFR-COMP-007): texto enlazado ("Fuente: paralelo.bo" →
 * https://paralelo.bo) y licencia enlazada si la hay (CC BY 4.0). Única pieza de atribución de la UI: la usan el
 * Home, la pantalla de tasas y la de proveedores.
 */
export function RateAttributionLink({ attribution }: { attribution: RateAttribution }) {
  return (
    <>
      <a href={attribution.url} {...external}>
        {attribution.text}
      </a>
      {attribution.license ? (
        <>
          {' '}
          (
          {attribution.licenseUrl ? (
            <a href={attribution.licenseUrl} {...external}>
              {attribution.license}
            </a>
          ) : (
            attribution.license
          )}
          )
        </>
      ) : null}
    </>
  );
}

/**
 * Atribución de cada tasa componente de una tasa cruzada (BTC/USDT del provider cripto y USDT/BOB de paralelo.bo;
 * FR-FX-014, add-crypto-rate-providers): sin repetir y solo las componentes que vienen de un provider.
 */
function ComponentAttributions({ rate, ctx }: { rate: ResolvedRate; ctx: FormatContext }) {
  const byProvider = new Map<string, RateAttribution>();
  for (const c of rate.components ?? [])
    if (c.attribution) byProvider.set(c.attribution.provider, c.attribution);
  if (byProvider.size === 0) return null;
  return (
    <>
      {' · '}
      <span data-testid="rate-components">
        {ctx.t('rate.components')}:{' '}
        {[...byProvider.values()].map((a, i) => (
          <span key={a.provider} data-testid="rate-component-attribution" data-provider={a.provider}>
            {i > 0 ? ' · ' : null}
            <RateAttributionLink attribution={a} />
          </span>
        ))}
      </span>
    </>
  );
}

/**
 * Tasa usada en una valoración (FR-FX-014, FR-REPORTING-003): par, valor y tipo, fuente con atribución enlazada
 * (y licencia, p. ej. CC BY 4.0), vigencia en la zona del workspace, antigüedad e indicador textual de tasa
 * obsoleta. Una tasa manual muestra su origen.
 */
export function RateSourceBadge({ rate, ctx }: { rate: ResolvedRate; ctx: FormatContext }) {
  const { locale, timeZone, t } = ctx;
  const pair = `${rate.rate.base}/${rate.rate.quote}`;
  const stale = rate.stale === true;
  const attribution = rate.attribution ?? null;
  return (
    <span
      data-testid="rate-badge"
      data-pair={pair}
      data-rate-type={rate.rateType}
      data-source={rate.source}
      data-stale={stale ? 'true' : 'false'}
      data-selection={rate.selection ?? ''}
      style={{ ...mutedStyle, display: 'block' }}
    >
      <span data-testid="rate-value">
        {pair} {formatDecimal(rate.rate.value, locale)} · {rate.rateType}
      </span>
      {rate.approx ? <> · {t('rate.approx')}</> : null}
      {' · '}
      {attribution ? (
        <span data-testid="rate-attribution">
          <RateAttributionLink attribution={attribution} />
        </span>
      ) : (
        <span data-testid="rate-attribution">
          {rate.sourceLabel ? <>{t('rate.sourceLabel', { label: rate.sourceLabel })} · </> : null}
          {t(`rate.origin.${rate.source}`)}
        </span>
      )}
      {rate.derivation === 'CROSS' ? <ComponentAttributions rate={rate} ctx={ctx} /> : null}
      {rate.selection === 'FALLBACK' ? (
        <>
          {' · '}
          <span data-testid="rate-level">{t('rate.fallback')}</span>
        </>
      ) : rate.selection === 'LAST_KNOWN_STALE' ? (
        <>
          {' · '}
          <span data-testid="rate-level">{t('rate.lastKnown')}</span>
        </>
      ) : null}
      {rate.requestedRateType && rate.requestedRateType !== rate.rateType ? (
        <> · {t('rate.requested', { type: rate.requestedRateType })}</>
      ) : null}
      {' · '}
      <span data-testid="rate-as-of">
        {t('rate.asOf', { date: formatInstant(rate.asOf, locale, timeZone) })}
      </span>
      {rate.ageSeconds !== undefined ? (
        <>
          {' · '}
          <span data-testid="rate-age">{formatAge(rate.ageSeconds, t)}</span>
        </>
      ) : null}
      {stale ? (
        <>
          {' · '}
          <strong data-testid="rate-stale">{t('rate.stale')}</strong>
        </>
      ) : null}
    </span>
  );
}
