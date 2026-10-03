import { formatMoney, isNegative } from './format';
import { statusOf } from './QuestionWidgets';
import { cardStyle, mutedStyle } from './styles';
import type { FormatContext, ReportSummary } from './types';

/** Principales categorías de gasto neto del mes; un neto negativo (reembolso > gasto) se muestra tal cual. */
export function TopCategoriesWidget({ summary, ctx }: { summary: ReportSummary; ctx: FormatContext }) {
  const { t, locale } = ctx;
  if (statusOf(summary, 'Q3').status === 'NO_DATA') return null;
  const categories = summary.topExpenseCategories;
  return (
    <section data-testid="top-categories" aria-labelledby="top-categories-title" style={cardStyle}>
      <h2 id="top-categories-title" style={{ fontSize: '1rem', margin: 0 }}>
        {t('topCategories.title')}
      </h2>
      {categories.length === 0 ? (
        <p style={mutedStyle}>{t('topCategories.empty')}</p>
      ) : (
        <ol style={{ paddingLeft: '1.25rem' }}>
          {categories.map((c) => (
            <li
              key={c.categoryId}
              data-testid="top-category"
              data-category-id={c.categoryId}
              data-negative={isNegative(c.amount.amount) ? 'true' : 'false'}
            >
              <span>{c.name}</span>:{' '}
              <strong data-testid="top-category-amount">{formatMoney(c.amount, locale)}</strong>
              {!c.complete ? <span style={mutedStyle}> · {t('incomplete')}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
