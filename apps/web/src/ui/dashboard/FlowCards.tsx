import type { ReactNode } from 'react';
import { formatDecimal } from '../AuditHistory';
import { formatMoney, formatSignedDecimal, formatSignedMoney, isNegative, isZero } from './format';
import { NoDataMessage, statusOf } from './QuestionWidgets';
import { barRatio, maxAmount } from './category-comparison';
import type { FormatContext, HomeQuestion, Money, MoneyVariation, ReportSummary } from './types';

type Metric = 'income' | 'expense' | 'savings';
type Direction = 'up' | 'down' | 'flat';

const directionOf = (delta: Money): Direction =>
  isZero(delta.amount) ? 'flat' : isNegative(delta.amount) ? 'down' : 'up';

/** Glifo de dirección (decorativo: el sentido siempre va también en texto). */
export const TREND_ICON: Readonly<Record<Direction | 'new', string>> = {
  up: '▲',
  down: '▼',
  flat: '=',
  new: '▲',
};

/**
 * Tono semántico (docs/28 §5.2): un aumento de gasto es "atención" (`--fin-warning`), no rojo; un aumento de ingreso
 * o ahorro es "en orden" (`--fin-ok`); sin cambio, neutro.
 */
export const toneOf = (metric: Metric, direction: Direction): 'ok' | 'warning' | 'neutral' => {
  if (direction === 'flat') return 'neutral';
  const good = metric === 'expense' ? direction === 'down' : direction === 'up';
  return good ? 'ok' : 'warning';
};

/**
 * Variación contra el periodo anterior (Q7 básico): absoluta y porcentual ("nuevo" si antes era cero). El sentido se
 * comunica con texto (p. ej. "aumento de gasto"), no solo con color; `data-trend` = `<métrica>-<up|down|flat>`.
 */
export function VariationLine({
  metric,
  variation,
  ctx,
}: {
  metric: Metric;
  variation: MoneyVariation;
  ctx: FormatContext;
}) {
  const { t, locale } = ctx;
  const direction = directionOf(variation.deltaAbs);
  const pct = variation.isNew
    ? t('variation.new')
    : variation.deltaPct === null || variation.deltaPct === undefined
      ? t('none')
      : `${formatSignedDecimal(variation.deltaPct, locale)} %`;
  return (
    <p data-testid={`${metric}-variation`} data-trend={`${metric}-${direction}`} className="pf-home-muted">
      <span className="pf-home-trend" data-tone={toneOf(metric, direction)}>
        <span aria-hidden="true" className="pf-home-trend-icon">
          {TREND_ICON[direction]}
        </span>{' '}
        <span data-testid={`${metric}-variation-abs`} className="pf-home-num">
          {formatSignedMoney(variation.deltaAbs, locale)}
        </span>{' '}
        (<span data-testid={`${metric}-variation-pct`}>{pct}</span>)
      </span>{' '}
      · <strong data-testid={`${metric}-variation-label`}>{t(`variation.${metric}.${direction}`)}</strong>{' '}
      {t('variation.vsPrevious')}
    </p>
  );
}

function KpiCard({
  summary,
  ctx,
  metric,
  question,
  amount,
  perCurrency,
  meter,
  children,
}: {
  summary: ReportSummary;
  ctx: FormatContext;
  metric: Metric;
  question: HomeQuestion;
  amount: Money;
  perCurrency: readonly Money[];
  /** Barra decorativa de magnitud relativa (ingresos vs gastos del mes); el monto ya está en texto. */
  meter?: number | undefined;
  children?: ReactNode;
}) {
  const { t, locale } = ctx;
  const status = statusOf(summary, question);
  const q7 = statusOf(summary, 'Q7');
  const variation = summary.comparison?.[metric];
  return (
    <section
      data-testid={metric}
      data-question={question}
      data-status={status.status}
      aria-labelledby={`${metric}-title`}
      className="pf-home-card"
    >
      <h3 id={`${metric}-title`}>{t(`questions.${question}`)}</h3>
      {status.status === 'NO_DATA' ? (
        <NoDataMessage status={status} ctx={ctx} />
      ) : (
        <>
          <p data-testid={`${metric}-amount`} className="pf-home-amount">
            {formatMoney(amount, locale)}
          </p>
          {meter !== undefined ? (
            <div className="pf-home-meter" aria-hidden="true">
              <span
                className="pf-home-meter-fill"
                data-kind={metric}
                style={{ width: `${(meter * 100).toFixed(1)}%` }}
              />
            </div>
          ) : null}
          {children}
          {perCurrency.length > 1 ? (
            <ul data-testid={`${metric}-by-currency`} className="pf-home-list pf-home-muted">
              {perCurrency.map((m) => (
                <li key={m.currency} data-currency={m.currency}>
                  {formatMoney(m, locale)}
                </li>
              ))}
            </ul>
          ) : null}
          {variation && q7.status === 'AVAILABLE' ? (
            <VariationLine metric={metric} variation={variation} ctx={ctx} />
          ) : null}
        </>
      )}
    </section>
  );
}

/** Escala común de las barras de ingresos y gastos del mes (consolidado en la moneda de reporte). */
const flowScale = (summary: ReportSummary): string =>
  maxAmount([summary.consolidated.income.amount, summary.consolidated.expense.amount]);

/** Q2 "¿Cuánto ingresó?". */
export function IncomeCard({ summary, ctx }: { summary: ReportSummary; ctx: FormatContext }) {
  return (
    <KpiCard
      summary={summary}
      ctx={ctx}
      metric="income"
      question="Q2"
      amount={summary.consolidated.income}
      perCurrency={summary.byCurrency.map((c) => c.income)}
      meter={barRatio(summary.consolidated.income.amount, flowScale(summary))}
    />
  );
}

/** Q3 "¿Cuánto gasté?" (neto de reembolsos). */
export function ExpenseCard({ summary, ctx }: { summary: ReportSummary; ctx: FormatContext }) {
  return (
    <KpiCard
      summary={summary}
      ctx={ctx}
      metric="expense"
      question="Q3"
      amount={summary.consolidated.expense}
      perCurrency={summary.byCurrency.map((c) => c.expense)}
      meter={barRatio(summary.consolidated.expense.amount, flowScale(summary))}
    />
  );
}

/** Q6 "¿Cuánto ahorré?" con la tasa de ahorro ("—" si no hubo ingresos: nunca 0 % ni infinito). */
export function SavingsCard({ summary, ctx }: { summary: ReportSummary; ctx: FormatContext }) {
  const { t, locale } = ctx;
  const savingsRate = summary.consolidated.savingsRate;
  return (
    <KpiCard
      summary={summary}
      ctx={ctx}
      metric="savings"
      question="Q6"
      amount={summary.consolidated.net}
      perCurrency={summary.byCurrency.map((c) => c.net)}
    >
      <p className="pf-home-muted">
        {t('savingsRate')}{' '}
        <strong data-testid="savings-rate">
          {savingsRate === null || savingsRate === undefined
            ? t('none')
            : `${formatDecimal(savingsRate, locale)} %`}
        </strong>
      </p>
    </KpiCard>
  );
}
