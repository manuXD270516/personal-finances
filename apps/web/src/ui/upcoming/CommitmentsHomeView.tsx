import { formatLocalDate } from '../dashboard/format';
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
}: Pick<
  CommitmentsHomeViewProps,
  'upcoming' | 'q8' | 'f' | 'fullHref' | 'createHref' | 'createAccountHref' | 'href' | 'cardOf'
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
