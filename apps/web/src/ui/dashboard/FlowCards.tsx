import type { ReactNode } from 'react';
import { formatDecimal } from '../AuditHistory';
import { formatMoney, formatSignedDecimal, formatSignedMoney, isNegative, isZero } from './format';
import { NoDataMessage, statusOf } from './QuestionWidgets';
import { amountStyle, cardStyle, listStyle, mutedStyle } from './styles';
import type { FormatContext, HomeQuestion, Money, MoneyVariation, ReportSummary } from './types';

type Metric = 'income' | 'expense' | 'savings';
type Direction = 'up' | 'down' | 'flat';

const directionOf = (delta: Money): Direction =>
  isZero(delta.amount) ? 'flat' : isNegative(delta.amount) ? 'down' : 'up';

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
    <p data-testid={`${metric}-variation`} data-trend={`${metric}-${direction}`} style={mutedStyle}>
      <span data-testid={`${metric}-variation-abs`}>{formatSignedMoney(variation.deltaAbs, locale)}</span> (
      <span data-testid={`${metric}-variation-pct`}>{pct}</span>) ·{' '}
      <strong data-testid={`${metric}-variation-label`}>{t(`variation.${metric}.${direction}`)}</strong>{' '}
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
  children,
}: {
  summary: ReportSummary;
  ctx: FormatContext;
  metric: Metric;
  question: HomeQuestion;
  amount: Money;
  perCurrency: readonly Money[];
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
      style={cardStyle}
    >
      <h2 id={`${metric}-title`} style={{ fontSize: '1rem', margin: 0 }}>
        {t(`questions.${question}`)}
      </h2>
      {status.status === 'NO_DATA' ? (
        <NoDataMessage status={status} ctx={ctx} />
      ) : (
        <>
          <p data-testid={`${metric}-amount`} style={amountStyle}>
            {formatMoney(amount, locale)}
          </p>
          {children}
          {perCurrency.length > 1 ? (
            <ul data-testid={`${metric}-by-currency`} style={{ ...listStyle, ...mutedStyle }}>
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
      <p style={mutedStyle}>
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
