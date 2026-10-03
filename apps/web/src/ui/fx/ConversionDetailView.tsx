import { formatInstant, formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatDecimal } from '../AuditHistory';
import { roundForDisplay, trimRate } from '../common/money';
import type {
  ConversionDetail,
  ConversionPricing,
  ConversionRevision,
  Rate,
  TransactionLeg,
} from '../common/types';
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

export const formatRateValue = (rate: Rate, locale: string): string =>
  `${formatDecimal(trimRate(rate.value), locale)} ${rate.quote}/${rate.base}`;

/**
 * Resumen del precio de una conversión (docs/28 §4.3): tasa efectiva, cotizada, referencia (tipo y fuente), spread
 * contra la referencia, comisiones y costo total; advierte si la cotizada no cuadra con los montos (los montos
 * mandan). Se usa en la vista previa del formulario y en el detalle.
 */
export function PricingSummary({
  pricing,
  f,
  fees,
}: {
  pricing: ConversionPricing;
  f: FormatContext;
  fees?: ConversionDetail['fees'];
}) {
  const { t, locale } = f;
  const spread = pricing.spread;
  return (
    <dl
      data-testid="conversion-pricing"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(9rem, max-content) 1fr',
        gap: '0.25rem 1rem',
        margin: 0,
      }}
    >
      <dt>{t('pricing.sold')}</dt>
      <dd style={{ margin: 0 }} data-testid="pricing-source">
        {formatMoney(pricing.sourceAmount, locale)}
      </dd>
      <dt>{t('pricing.received')}</dt>
      <dd style={{ margin: 0 }} data-testid="pricing-target">
        {formatMoney(pricing.targetAmount, locale)}
        {pricing.grossTargetAmount.amount !== pricing.targetAmount.amount ? (
          <span style={mutedStyle}>
            {' '}
            ({t('pricing.gross', { amount: formatMoney(pricing.grossTargetAmount, locale) })})
          </span>
        ) : null}
      </dd>
      <dt>{t('pricing.effective')}</dt>
      <dd style={{ margin: 0 }} data-testid="pricing-effective">
        {formatRateValue(pricing.effectiveRate, locale)}
      </dd>
      {pricing.quotedRate ? (
        <>
          <dt>{t('pricing.quoted')}</dt>
          <dd style={{ margin: 0 }} data-testid="pricing-quoted">
            {formatRateValue(pricing.quotedRate, locale)}
          </dd>
        </>
      ) : null}
      <dt>{t('pricing.reference')}</dt>
      <dd style={{ margin: 0 }} data-testid="pricing-reference">
        {pricing.referenceRate
          ? `${formatRateValue(pricing.referenceRate.rate, locale)} · ${pricing.referenceRate.rateType ?? ''} · ${t(`sources.${pricing.referenceRate.source}`)}`
          : t('pricing.noReference')}
      </dd>
      <dt>{t('pricing.spread')}</dt>
      <dd style={{ margin: 0 }} data-testid="pricing-spread">
        {spread
          ? `${formatDecimal(roundForDisplay(spread.percentage, 2), locale)} % · ${formatMoney(spread.amount, locale)}`
          : t('pricing.noSpread')}
      </dd>
      {fees && fees.length > 0 ? (
        <>
          <dt>{t('pricing.fees')}</dt>
          <dd style={{ margin: 0 }} data-testid="pricing-fees">
            {fees.map((fee) => `${t(`feeTypes.${fee.type}`)} ${formatMoney(fee.amount, locale)}`).join(' · ')}
          </dd>
        </>
      ) : null}
      {pricing.totalCost ? (
        <>
          <dt>{t('pricing.totalCost')}</dt>
          <dd style={{ margin: 0 }} data-testid="pricing-total-cost">
            {formatMoney(pricing.totalCost!.amount, locale)}
            {!pricing.totalCost!.complete ? (
              <span style={mutedStyle}> · {t('pricing.incomplete')}</span>
            ) : null}
          </dd>
        </>
      ) : null}
      {pricing.quotedRateDeviation ? (
        <>
          <dt>{t('pricing.deviation')}</dt>
          <dd style={{ margin: 0, ...warningStyle }} data-testid="pricing-deviation" role="status">
            {t('pricing.deviationText', { amount: formatMoney(pricing.quotedRateDeviation, locale) })}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/**
 * Detalle de conversión (add-manual-conversions 6.3): precio inmutable de la revisión activa, historial de
 * revisiones (una enmienda crea otra; nunca se recalcula con tasas nuevas) y "Detalle contable" plegado.
 */
export function ConversionDetailView({
  detail,
  revisions,
  legs,
  f,
  accountName,
}: {
  detail: ConversionDetail;
  revisions: readonly ConversionRevision[];
  legs: readonly TransactionLeg[];
  f: FormatContext;
  accountName: (id: string) => string;
}) {
  const { t, locale, timeZone } = f;
  return (
    <section
      aria-labelledby="conversion-title"
      style={cardStyle}
      data-testid="conversion-detail"
      data-revision={detail.revision}
    >
      <h2 id="conversion-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        {t('detail.title', { revision: detail.revision })}
      </h2>
      <p style={mutedStyle}>
        {accountName(detail.sourceAccountId)} → {accountName(detail.targetAccountId)} ·{' '}
        {t('detail.executedAt', { date: formatInstant(detail.executedAt, locale, timeZone) })}
        {detail.provider?.name ? ` · ${detail.provider.name}` : ''}
      </p>
      <PricingSummary pricing={detail} f={f} fees={detail.fees} />
      {revisions.length > 1 ? (
        <div style={tableWrapStyle}>
          <table style={tableStyle} data-testid="conversion-revisions">
            <caption style={{ textAlign: 'left' }}>{t('detail.revisions')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {t('detail.revision')}
                </th>
                <th scope="col" style={numCellStyle}>
                  {t('pricing.received')}
                </th>
                <th scope="col" style={numCellStyle}>
                  {t('pricing.effective')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('detail.recordedAt')}
                </th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.revision} data-active={r.active ? 'true' : 'false'}>
                  <th scope="row" style={cellStyle}>
                    {r.revision} {r.active ? <span style={badgeStyle}>{t('detail.active')}</span> : null}
                  </th>
                  <td style={numCellStyle}>{formatMoney(r.detail.targetAmount, locale)}</td>
                  <td style={numCellStyle}>{formatRateValue(r.detail.effectiveRate, locale)}</td>
                  <td style={cellStyle}>{formatInstant(r.createdAt, locale, timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <details data-testid="accounting-detail">
        <summary>{t('detail.accounting')}</summary>
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
          {legs.map((l, i) => (
            <li key={`${l.accountId}-${i}`}>
              {accountName(l.accountId)}: {formatMoney(l.amount, locale)} ({l.role})
            </li>
          ))}
        </ul>
        <p style={mutedStyle}>{t('detail.accountingNote')}</p>
      </details>
    </section>
  );
}
