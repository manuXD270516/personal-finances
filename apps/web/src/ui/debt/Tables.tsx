import type { CSSProperties } from 'react';
import { scaleFor, sumAmounts } from '../common/money';
import { cellStyle, mutedStyle, numCellStyle, tableStyle, tableWrapStyle } from '../common/ui';
import { formatDecimal } from '../AuditHistory';
import { formatMoney, formatSignedDecimal } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { Badge } from '../recurring/Badges';
import {
  INSTALLMENT_PRESENTATION,
  LOAN_PRESENTATION,
  installmentView,
  isDifferent,
  lastActivePaymentId,
  paymentHref,
} from './logic';
import {
  COMPONENT_KEYS,
  type LoanInstallment,
  type LoanPayment,
  type LoanStatus,
  type SchedulePreview,
} from './types';

const diffStyle: CSSProperties = { color: 'var(--pf-error)', fontWeight: 600 };

export function LoanStatusBadge({ status, f }: { status: LoanStatus; f: FormatContext }) {
  return (
    <Badge
      presentation={LOAN_PRESENTATION[status]}
      label={f.t(`status.${status}`)}
      status={status}
      testId="loan-status"
    />
  );
}

/** Pasivo presentado como "Deuda 48.137,15 BOB" (docs/28 §8.3): positivo con etiqueta, nunca negativo. */
export const debtText = (f: FormatContext, money: { amount: string; currency: string }): string =>
  f.t('debtAmount', { amount: formatMoney(money, f.locale) });

/**
 * Vista previa del cronograma (también el de un borrador): tabla accesible con totales; avisa si la cuota se niveló.
 * Los cargos aparecen como columnas solo si alguna cuota los trae.
 */
export function SchedulePreviewTable({ f, preview }: { f: FormatContext; preview: SchedulePreview }) {
  const { locale } = f;
  const scale = scaleFor(preview.currency);
  const sum = (key: 'principal' | 'interest' | 'fees' | 'insurance' | 'taxes' | 'total') =>
    sumAmounts(
      preview.installments.map((i) => i[key]),
      preview.currency,
      scale,
    );
  const extras = (['fees', 'insurance', 'taxes'] as const).filter((k) =>
    preview.installments.some((i) => isDifferent(i[k])),
  );
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="schedule-preview">
      <div aria-live="polite" style={{ display: 'grid', gap: 'var(--pf-space-1)' }}>
        <dl
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-1) var(--pf-space-4)', margin: 0 }}
        >
          <div>
            <dt style={mutedStyle}>{f.t('preview.installment')}</dt>
            <dd style={{ margin: 0 }} data-testid="preview-installment">
              {formatMoney({ amount: preview.installmentAmount, currency: preview.currency }, locale)}
            </dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('preview.totalInterest')}</dt>
            <dd style={{ margin: 0 }} data-testid="preview-total-interest">
              {formatMoney({ amount: preview.totalInterest, currency: preview.currency }, locale)}
            </dd>
          </div>
          <div>
            <dt style={mutedStyle}>{f.t('preview.totalAmount')}</dt>
            <dd style={{ margin: 0 }} data-testid="preview-total-amount">
              {formatMoney({ amount: preview.totalAmount, currency: preview.currency }, locale)}
            </dd>
          </div>
        </dl>
        {preview.leveled ? (
          <p role="status" style={{ margin: 0 }} data-testid="preview-leveled">
            <span aria-hidden="true">ℹ</span> {f.t('preview.leveled')}
          </p>
        ) : null}
      </div>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('preview.region')}>
        <table style={tableStyle} data-testid="schedule-preview-table">
          <caption className="pf-sr-only">{f.t('preview.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('columns.n')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.due')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('columns.total')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('components.principal')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('components.interest')}
              </th>
              {extras.map((k) => (
                <th key={k} scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t(`components.${k}`)}
                </th>
              ))}
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('columns.balance')}
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.installments.map((i) => (
              <tr key={i.n} data-testid="preview-row" data-n={i.n}>
                <th scope="row" style={cellStyle}>
                  {i.n}
                </th>
                <td style={cellStyle}>{formatBusinessDate(i.dueDate)}</td>
                <td style={numCellStyle}>{formatDecimal(i.total, locale)}</td>
                <td style={numCellStyle}>{formatDecimal(i.principal, locale)}</td>
                <td style={numCellStyle}>{formatDecimal(i.interest, locale)}</td>
                {extras.map((k) => (
                  <td key={k} style={numCellStyle}>
                    {formatDecimal(i[k], locale)}
                  </td>
                ))}
                <td style={numCellStyle}>{formatDecimal(i.closingBalance, locale)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="preview-totals">
              <th scope="row" colSpan={2} style={cellStyle}>
                {f.t('preview.totals')}
              </th>
              <td style={numCellStyle}>{formatDecimal(sum('total'), locale)}</td>
              <td style={numCellStyle} data-testid="preview-sum-principal">
                {formatDecimal(sum('principal'), locale)}
              </td>
              <td style={numCellStyle}>{formatDecimal(sum('interest'), locale)}</td>
              {extras.map((k) => (
                <td key={k} style={numCellStyle}>
                  {formatDecimal(sum(k), locale)}
                </td>
              ))}
              <td style={cellStyle} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

const sumPaid = (i: LoanInstallment, currency: string): string =>
  sumAmounts(
    COMPONENT_KEYS.map((k) => i.paid[k]),
    currency,
    scaleFor(currency),
  );

/**
 * Cronograma vigente con su estado (Pendiente, Parcial, Pagada, Atrasada) y, por cuota, esperado / pagado / diferencia
 * (pagado − esperado) total y por componente (detalle desplegable). Las diferencias se marcan con texto y signo.
 */
export function InstallmentsTable({
  f,
  items,
  currency,
  loanId,
  canPay,
}: {
  f: FormatContext;
  items: readonly LoanInstallment[];
  currency: string;
  loanId: string;
  canPay: boolean;
}) {
  const { locale } = f;
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('installments.region')}>
      <table style={tableStyle} data-testid="installments-table">
        <caption className="pf-sr-only">{f.t('installments.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('columns.n')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.due')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.state')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('installments.expected')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('installments.paid')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('installments.difference')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('installments.detail')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const view = installmentView(i);
            const paidTotal = sumPaid(i, currency);
            const diffTotal = sumAmounts(
              COMPONENT_KEYS.map((k) => i.differences[k]),
              currency,
              scaleFor(currency),
            );
            return (
              <tr key={i.n} data-testid="installment-row" data-n={i.n} data-state={view}>
                <th scope="row" style={cellStyle}>
                  {i.n}
                </th>
                <td style={cellStyle}>{formatBusinessDate(i.dueDate)}</td>
                <td style={cellStyle}>
                  <Badge
                    presentation={INSTALLMENT_PRESENTATION[view]}
                    label={f.t(`installments.state.${view}`)}
                    status={view}
                    testId="installment-state"
                  />
                </td>
                <td style={numCellStyle}>{formatDecimal(i.total, locale)}</td>
                <td style={numCellStyle}>{formatDecimal(paidTotal, locale)}</td>
                <td
                  style={{
                    ...numCellStyle,
                    ...(isDifferent(diffTotal) && i.status !== 'UNPAID' ? diffStyle : {}),
                  }}
                >
                  {i.status === 'UNPAID' ? '—' : formatSignedDecimal(diffTotal, locale)}
                </td>
                <td style={cellStyle}>
                  <details>
                    <summary>
                      {f.t('installments.components')}
                      <span className="pf-sr-only"> {i.n}</span>
                    </summary>
                    <table style={{ ...tableStyle, fontSize: '0.875rem' }}>
                      <caption className="pf-sr-only">
                        {f.t('installments.componentsCaption', { n: i.n })}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col" style={cellStyle}>
                            {f.t('installments.component')}
                          </th>
                          <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                            {f.t('installments.expected')}
                          </th>
                          <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                            {f.t('installments.paid')}
                          </th>
                          <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                            {f.t('installments.difference')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {COMPONENT_KEYS.map((k) => (
                          <tr key={k} data-component={k}>
                            <th scope="row" style={cellStyle}>
                              {f.t(`components.${k}`)}
                            </th>
                            <td style={numCellStyle}>{formatDecimal(i.expected[k], locale)}</td>
                            <td style={numCellStyle}>{formatDecimal(i.paid[k], locale)}</td>
                            <td
                              style={{ ...numCellStyle, ...(isDifferent(i.differences[k]) ? diffStyle : {}) }}
                            >
                              {formatSignedDecimal(i.differences[k], locale)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                  {canPay && i.status !== 'PAID' ? (
                    <div>
                      <a
                        href={paymentHref(loanId, { installmentNo: i.n })}
                        data-testid="installment-pay"
                        data-pay-n={i.n}
                      >
                        {f.t('installments.pay', { n: i.n })}
                      </a>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Pagos del préstamo (más antiguo primero, con los anulados); solo el último pago activo ofrece "Anular". */
export function PaymentsTable({
  f,
  items,
  accountName,
  canVoid,
  onVoid,
  busy,
}: {
  f: FormatContext;
  items: readonly LoanPayment[];
  accountName: (id: string) => string | undefined;
  canVoid: boolean;
  onVoid: (payment: LoanPayment) => void;
  busy?: boolean;
}) {
  const { locale } = f;
  const latest = lastActivePaymentId(items);
  if (items.length === 0)
    return (
      <p style={mutedStyle} data-testid="payments-empty">
        {f.t('payments.empty')}
      </p>
    );
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('payments.region')}>
      <table style={tableStyle} data-testid="payments-table">
        <caption className="pf-sr-only">{f.t('payments.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('payments.no')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('payments.date')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('payments.account')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('payments.amount')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('payments.breakdown')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('payments.installments')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.state')}
            </th>
            {canVoid ? (
              <th scope="col" style={cellStyle}>
                {f.t('payments.actions')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} data-testid="payment-row" data-status={p.status} data-payment-no={p.paymentNo}>
              <th scope="row" style={cellStyle}>
                {p.paymentNo}
              </th>
              <td style={cellStyle}>{formatBusinessDate(p.businessDate)}</td>
              <td style={cellStyle}>{accountName(p.accountId) ?? '—'}</td>
              <td style={numCellStyle}>{formatMoney(p.amount, locale)}</td>
              <td style={cellStyle}>
                {COMPONENT_KEYS.filter((k) => isDifferent(p[k]))
                  .map((k) => `${f.t(`components.${k}`)} ${formatDecimal(p[k], locale)}`)
                  .join(' · ')}
                {p.explicitBreakdown ? ` (${f.t('payments.explicit')})` : ''}
              </td>
              <td style={cellStyle}>{p.installmentNos.join(', ')}</td>
              <td style={cellStyle}>
                {p.status === 'VOIDED' ? (
                  <>
                    {f.t('payments.voided')}
                    {p.voidedReason ? <div style={mutedStyle}>{p.voidedReason}</div> : null}
                  </>
                ) : (
                  f.t('payments.active')
                )}
              </td>
              {canVoid ? (
                <td style={cellStyle}>
                  {p.id === latest ? (
                    <button
                      type="button"
                      disabled={busy}
                      data-testid="payment-void"
                      aria-label={f.t('payments.voidLabel', { n: p.paymentNo })}
                      onClick={() => onVoid(p)}
                    >
                      {f.t('payments.void')}
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
