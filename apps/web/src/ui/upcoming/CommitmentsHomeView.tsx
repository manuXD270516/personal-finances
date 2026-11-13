import { homeCashFlowSummary } from '../cash-flow/logic';
import type { CashFlowHomeBlock } from '../cash-flow/types';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext, HomeQuestionStatus } from '../dashboard/types';
import { homeSlice, amountText } from './logic';
import { UPCOMING_CSS } from './styles';
import type { UpcomingPayments } from './types';
import {
  CommittedSummary,
  IncompleteNote,
  ItemName,
  StatusBadge,
  fromCommitment,
  type CardOf,
} from './UpcomingParts';

export interface CommitmentsHomeViewProps {
  /** Respuesta de `getUpcomingPayments?days=7`; `'error'` si la lectura falló; `undefined` mientras carga. */
  readonly upcoming: UpcomingPayments | 'error' | undefined;
  /** Estado de Q4 y Q8 en `getReportSummary` (`NO_DATA` con `CREATE_COMMITMENT` ⇒ sin compromisos ni pendientes). */
  readonly q4: HomeQuestionStatus | undefined;
  readonly q8: HomeQuestionStatus | undefined;
  readonly f: FormatContext;
  /** Vista completa `/pagos-proximos`. */
  readonly fullHref: string;
  /** Pantalla de pagos recurrentes: crear un compromiso. */
  readonly createHref: string;
  /** Crear la primera cuenta (workspace sin cuentas: Q4/Q8 `NO_DATA` con `CREATE_ACCOUNT`). */
  readonly createAccountHref?: string | undefined;
  /** Localiza la ruta de un ítem (ocurrencia o transacción) con el prefijo de idioma. */
  readonly href: (path: string) => string;
  /** Tarjeta de un pago del plan de pago de una tarjeta (add-credit-cards). */
  readonly cardOf?: CardOf | undefined;
  /**
   * Bloque `cashFlow` del resumen (add-cash-flow-forecast): saldo más bajo esperado y riesgo de 30 días. `null` o ausente
   * (sin cuentas líquidas): la tarjeta no muestra saldo esperado ni riesgo.
   */
  readonly cashFlow?: CashFlowHomeBlock | null | undefined;
  /** Calendario de flujo de caja (`/flujo-de-caja`), con el horizonte y la moneda del riesgo cuando los hay. */
  readonly cashFlowHref?: ((currency?: string) => string) | undefined;
}

/**
 * Saldo más bajo esperado de los próximos 30 días: la moneda con riesgo, su mínimo y la fecha o, sin riesgo, el mínimo
 * consolidado; enlaza al calendario. Sin bloque (`null`) no dice nada (nunca un saldo inventado).
 */
function CashFlowLine({
  cashFlow,
  f,
  href,
}: {
  cashFlow: CashFlowHomeBlock | null | undefined;
  f: FormatContext;
  href: ((currency?: string) => string) | undefined;
}) {
  const summary = homeCashFlowSummary(cashFlow);
  const predicted = cashFlow?.predictedShortfall ?? null;
  if (summary.kind === 'NONE' && !predicted) return null;
  const days = cashFlow?.horizonDays ?? 30;
  const link = href ? (
    <a href={href(summary.kind === 'RISK' ? summary.currency : undefined)} data-testid="cash-flow-link">
      {f.t('home.cashFlowLink')}
    </a>
  ) : null;
  return (
    <div
      data-testid="cash-flow-q8"
      data-kind={summary.kind}
      data-risk={summary.kind === 'RISK' ? summary.risk : 'NONE'}
    >
      {summary.kind === 'NONE' ? null : summary.kind === 'RISK' ? (
        <>
          <p>
            <strong data-testid="cash-flow-q8-risk">
              <span aria-hidden="true">⚠</span>{' '}
              {f.t(`home.risk.${summary.risk}`, { currency: summary.currency })}
            </strong>
          </p>
          <p data-testid="cash-flow-q8-lowest">
            {f.t('home.lowestOn', {
              amount: formatMoney(summary.lowest, f.locale),
              date: formatLocalDate(summary.date, f.locale),
              days,
            })}
          </p>
        </>
      ) : (
        <>
          <p>
            <strong data-testid="cash-flow-q8-risk">
              <span aria-hidden="true">✓</span> {f.t('home.risk.NONE')}
            </strong>
          </p>
          <p className="pf-home-muted">{f.t('home.lowestLabel', { days })}</p>
          <p data-testid="cash-flow-q8-lowest">
            {f.t('home.lowestOn', {
              amount: formatMoney(summary.lowest, f.locale),
              date: formatLocalDate(summary.date, f.locale),
              days,
            })}
            {!summary.complete ? (
              <>
                {' '}
                <span className="pf-home-muted" data-testid="cash-flow-q8-incomplete">
                  · {f.t('home.lowestIncomplete')}
                </span>
              </>
            ) : null}
          </p>
        </>
      )}
      {predicted ? (
        <p
          className="pf-home-muted"
          data-testid="cash-flow-q8-predicted"
          data-likelihood={predicted.likelihood}
        >
          <span aria-hidden="true">{predicted.likelihood === 'UNLIKELY' ? '✓' : '⚠'}</span>{' '}
          {f.t(`home.predictedShortfall.${predicted.likelihood}`, {
            currency: predicted.currency,
            date: predicted.date ? formatLocalDate(predicted.date, f.locale) : '',
          })}
        </p>
      ) : null}
      {link ? <p>{link}</p> : null}
    </div>
  );
}

/**
 * Pregunta sin datos: texto y acción (crear un compromiso, o la primera cuenta si aún no hay ninguna), nunca un cero
 * sustituto (FR-REPORTING-001).
 */
function NoData({
  question,
  status,
  f,
  createHref,
  createAccountHref,
}: {
  question: 'Q4' | 'Q8';
  status: HomeQuestionStatus | undefined;
  f: FormatContext;
  createHref: string;
  createAccountHref: string | undefined;
}) {
  const needsAccount = status?.actionHint === 'CREATE_ACCOUNT';
  const action = needsAccount ? 'CREATE_ACCOUNT' : 'CREATE_COMMITMENT';
  const link = needsAccount ? createAccountHref : createHref;
  const text = needsAccount ? f.t('home.createAccount') : f.t('home.createCommitment');
  return (
    <div data-testid={`question-${question}-no-data`} data-status="NO_DATA">
      <p>{needsAccount ? f.t('home.noAccounts') : f.t('home.noData')}</p>
      <p data-testid="action-hint" data-action={action}>
        {link ? <a href={link}>{text}</a> : text}
      </p>
    </div>
  );
}

function Q4Card({
  upcoming,
  q4,
  f,
  createHref,
  createAccountHref,
}: Pick<CommitmentsHomeViewProps, 'upcoming' | 'q4' | 'f' | 'createHref' | 'createAccountHref'>) {
  const noData = q4?.status === 'NO_DATA' || (upcoming && upcoming !== 'error' && !upcoming.hasCommitments);
  return (
    <section
      data-testid="question-Q4"
      data-question="Q4"
      data-status={noData ? 'NO_DATA' : 'AVAILABLE'}
      aria-labelledby="question-Q4-title"
      className="pf-home-card"
    >
      <h3 id="question-Q4-title">{f.t('home.q4Title')}</h3>
      {noData ? (
        <NoData
          question="Q4"
          status={q4}
          f={f}
          createHref={createHref}
          createAccountHref={createAccountHref}
        />
      ) : upcoming === undefined ? (
        <p aria-busy="true" role="status">
          {f.t('home.loading')}
        </p>
      ) : upcoming === 'error' ? (
        <p role="status" data-testid="question-Q4-error">
          {f.t('home.error')}
        </p>
      ) : upcoming.committed === null ? (
        <p data-testid="committed-no-period">{f.t('committed.noPeriod')}</p>
      ) : (
        <CommittedSummary committed={upcoming.committed} f={f} compact />
      )}
    </section>
  );
}

function Q8Card({
  upcoming,
  q8,
  f,
  fullHref,
  createHref,
  createAccountHref,
  href,
  cardOf,
  cashFlow,
  cashFlowHref,
}: Pick<
  CommitmentsHomeViewProps,
  | 'upcoming'
  | 'q8'
  | 'f'
  | 'fullHref'
  | 'createHref'
  | 'createAccountHref'
  | 'href'
  | 'cardOf'
  | 'cashFlow'
  | 'cashFlowHref'
>) {
  const noData = q8?.status === 'NO_DATA' || (upcoming && upcoming !== 'error' && !upcoming.hasCommitments);
  const body = () => {
    if (noData) {
      return (
        <NoData
          question="Q8"
          status={q8}
          f={f}
          createHref={createHref}
          createAccountHref={createAccountHref}
        />
      );
    }
    if (upcoming === undefined) {
      return (
        <p aria-busy="true" role="status">
          {f.t('home.loading')}
        </p>
      );
    }
    if (upcoming === 'error') {
      return (
        <p role="status" data-testid="question-Q8-error">
          {f.t('home.error')}
        </p>
      );
    }
    if (upcoming.items.length === 0) {
      return <p data-testid="upcoming-empty">{f.t('home.emptyWeek', { days: upcoming.window.days })}</p>;
    }
    const { shown, more } = homeSlice(upcoming.items);
    return (
      <>
        <ul className="pf-upc-list" data-testid="upcoming-list">
          {shown.map((item) => (
            <li
              key={`${item.kind}-${item.occurrenceId ?? item.transactionId}`}
              className="pf-upc-item"
              data-testid="upcoming-item"
              data-status={item.status}
            >
              <span>
                <ItemName item={item} f={f} href={href} cardOf={cardOf} />
                <br />
                <span className="pf-upc-date">
                  {formatLocalDate(item.date, f.locale)} · <StatusBadge item={item} f={f} />
                  {fromCommitment(item) ? <> · {f.t('fromCommitment')}</> : null}
                </span>
              </span>
              <span className="pf-upc-amount" data-testid="upcoming-amount">
                {amountText(item, f)}
              </span>
            </li>
          ))}
        </ul>
        {more > 0 ? (
          <p className="pf-upc-more" data-testid="upcoming-more">
            {f.t('home.more', { count: more })}
          </p>
        ) : null}
        <IncompleteNote
          complete={upcoming.totals.consolidated.complete}
          unconverted={upcoming.totals.consolidated.unconverted}
          f={f}
          testId="upcoming-incomplete"
        />
      </>
    );
  };
  return (
    <section
      data-testid="question-Q8"
      data-question="Q8"
      data-status={noData ? 'NO_DATA' : 'AVAILABLE'}
      aria-labelledby="question-Q8-title"
      className="pf-home-card"
    >
      <h3 id="question-Q8-title">{f.t('home.q8Title')}</h3>
      {noData ? null : <CashFlowLine cashFlow={cashFlow} f={f} href={cashFlowHref} />}
      {body()}
      {noData ? null : (
        <p style={{ margin: 0 }}>
          <a href={fullHref} data-testid="upcoming-full-link">
            {f.t('home.viewAll')}
          </a>
        </p>
      )}
    </section>
  );
}

/**
 * Tarjetas Q4 (total comprometido del periodo) y Q8 (pagos de los próximos 7 días, hasta 5 con "y N más" y enlace a la
 * vista completa) del Home (reporting/cash-flow-calendar). Presentacional: textos del namespace `Upcoming`. Sin
 * compromisos ni pendientes ambas dicen que no hay datos y ofrecen crear un compromiso, sin montos en cero.
 */
export function CommitmentsHomeView(props: CommitmentsHomeViewProps) {
  const { f } = props;
  return (
    <section data-testid="commitments" aria-labelledby="commitments-title" className="pf-home-group">
      <style>{UPCOMING_CSS}</style>
      <div className="pf-home-group-head">
        <h2 id="commitments-title">{f.t('home.title')}</h2>
        <p className="pf-home-muted" style={{ margin: 0 }}>
          {f.t('home.caption')}
        </p>
      </div>
      <div className="pf-home-grid">
        <Q4Card {...props} />
        <Q8Card {...props} />
      </div>
    </section>
  );
}
