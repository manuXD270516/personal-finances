import {
  barRatio,
  compareCategory,
  maxAmount,
  type CategoryComparison,
  type PreviousCategories,
} from './category-comparison';
import { TREND_ICON } from './FlowCards';
import { formatMoney, formatSignedMoney, isNegative } from './format';
import { statusOf } from './QuestionWidgets';
import type { FormatContext, ReportSummary, TopCategory } from './types';

const UNAVAILABLE: PreviousCategories = { status: 'unavailable' };

/** Tono de la variación de una categoría de gasto (docs/28 §5.2: más gasto = atención, menos = en orden). */
const toneOf = (c: CategoryComparison): 'ok' | 'warning' | 'neutral' =>
  c.trend === 'up' || c.trend === 'new' ? 'warning' : c.trend === 'down' ? 'ok' : 'neutral';

/** Variación de la categoría contra el mismo tramo del mes anterior: glifo decorativo + monto con signo + texto. */
function CategoryTrendLine({ comparison, ctx }: { comparison: CategoryComparison; ctx: FormatContext }) {
  const { t, locale } = ctx;
  if (comparison.trend === 'unknown') {
    return (
      <p data-testid="top-category-trend" data-trend="unknown" className="pf-home-muted">
        {t('topCategories.trend.unknown')}
      </p>
    );
  }
  return (
    <p data-testid="top-category-trend" data-trend={comparison.trend} className="pf-home-muted">
      <span className="pf-home-trend" data-tone={toneOf(comparison)}>
        <span aria-hidden="true" className="pf-home-trend-icon">
          {TREND_ICON[comparison.trend]}
        </span>{' '}
        {comparison.trend === 'flat' ? null : (
          <>
            <span data-testid="top-category-delta" className="pf-home-num">
              {formatSignedMoney(comparison.delta!, locale)}
            </span>{' '}
          </>
        )}
        <strong data-testid="top-category-trend-label">{t(`topCategories.trend.${comparison.trend}`)}</strong>
      </span>
      {comparison.trend === 'new' ? null : (
        <>
          {' · '}
          <span data-testid="top-category-previous">
            {t('topCategories.previous', { amount: formatMoney(comparison.previous!, locale) })}
          </span>
        </>
      )}
    </p>
  );
}

function CategoryRow({
  category,
  comparison,
  scale,
  loading,
  ctx,
}: {
  category: TopCategory;
  comparison: CategoryComparison | undefined;
  scale: string;
  loading: boolean;
  ctx: FormatContext;
}) {
  const { t, locale } = ctx;
  const ratio = barRatio(category.amount.amount, scale);
  const prevRatio = comparison?.previous ? barRatio(comparison.previous.amount, scale) : 0;
  return (
    <li
      data-testid="top-category"
      data-category-id={category.categoryId}
      data-negative={isNegative(category.amount.amount) ? 'true' : 'false'}
      className="pf-home-cat"
    >
      <div className="pf-home-cat-head">
        <span className="pf-home-cat-name">{category.name}</span>
        <span className="pf-home-num">
          <span className="pf-home-sr">: </span>
          <strong data-testid="top-category-amount">{formatMoney(category.amount, locale)}</strong>
          {!category.complete ? <span className="pf-home-muted"> · {t('incomplete')}</span> : null}
        </span>
      </div>
      <div className="pf-home-meter" aria-hidden="true">
        <span className="pf-home-meter-fill" style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
        {prevRatio > 0 ? (
          <span
            className="pf-home-meter-prev"
            data-testid="top-category-previous-marker"
            style={{ left: `calc(${(prevRatio * 100).toFixed(1)}% - 1px)` }}
          />
        ) : null}
      </div>
      {comparison ? (
        <CategoryTrendLine comparison={comparison} ctx={ctx} />
      ) : loading ? (
        <p className="pf-home-muted" data-testid="top-category-trend-loading">
          {t('topCategories.comparing')}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Q3/Q7 básico (FR-REPORTING-004, D50): principales categorías de gasto neto del mes con barras proporcionales a la
 * mayor y, si hay comparación, la variación contra el mismo tramo del mes anterior (glifo + signo + texto, nunca solo
 * color) con una marca en la barra donde quedó el mes anterior. Un neto negativo (reembolso > gasto) se muestra tal
 * cual y sin barra. Sin gastos: estado vacío con la acción de registrar uno.
 */
export function TopCategoriesWidget({
  summary,
  ctx,
  previous = UNAVAILABLE,
  registerExpenseHref,
}: {
  summary: ReportSummary;
  ctx: FormatContext;
  previous?: PreviousCategories | undefined;
  registerExpenseHref?: string | undefined;
}) {
  const { t } = ctx;
  if (statusOf(summary, 'Q3').status === 'NO_DATA') return null;
  const categories = summary.topExpenseCategories;
  const comparisons = categories.map((c) => compareCategory(c, previous));
  const scale = maxAmount([
    ...categories.map((c) => c.amount.amount),
    ...comparisons.flatMap((c) => (c?.previous ? [c.previous.amount] : [])),
  ]);
  const hasMarkers = comparisons.some((c) => c?.previous && barRatio(c.previous.amount, scale) > 0);
  return (
    <section
      data-testid="top-categories"
      data-comparison={previous.status}
      aria-labelledby="top-categories-title"
      className="pf-home-card"
    >
      <h3 id="top-categories-title">{t('topCategories.title')}</h3>
      {categories.length === 0 ? (
        <div data-testid="top-categories-empty" className="pf-home-empty">
          <p>{t('topCategories.empty')}</p>
          {registerExpenseHref ? (
            <p>
              <a href={registerExpenseHref} data-testid="register-expense-action">
                {t('topCategories.emptyAction')}
              </a>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="pf-home-muted">{t('topCategories.caption', { n: categories.length })}</p>
          <ol className="pf-home-cats">
            {categories.map((c, i) => (
              <CategoryRow
                key={c.categoryId}
                category={c}
                comparison={comparisons[i]}
                scale={scale}
                loading={previous.status === 'loading'}
                ctx={ctx}
              />
            ))}
          </ol>
          {hasMarkers ? (
            <p className="pf-home-muted pf-home-legend" aria-hidden="true">
              <span>
                <span className="pf-home-legend-mark" />
                {t('topCategories.legendPrevious')}
              </span>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
