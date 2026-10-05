import {
  barRatio,
  compareCategory,
  hasCategoryComparison,
  maxAmount,
  type CategoryComparison,
} from './category-comparison';
import { TREND_ICON } from './FlowCards';
import { formatMoney, formatSignedMoney, isNegative } from './format';
import { statusOf } from './QuestionWidgets';
import type { FormatContext, ReportSummary, TopCategory } from './types';

/** Top de gasto (Q3) o de ingreso (Q2): cambia el namespace de textos, el tono y el color de la barra. */
export type TopCategoriesKind = 'expense' | 'income';

const KEYS: Record<TopCategoriesKind, string> = {
  expense: 'topCategories',
  income: 'topIncomeCategories',
};

/**
 * Tono de la variación (docs/28 §5.2): en gasto, más = atención y menos = en orden; en ingreso, al revés. Nunca es la
 * única señal: siempre va con glifo y texto.
 */
const toneOf = (c: CategoryComparison, kind: TopCategoriesKind): 'ok' | 'warning' | 'neutral' => {
  if (c.trend === 'flat' || c.trend === 'unknown') return 'neutral';
  const more = c.trend === 'up' || c.trend === 'new';
  return more === (kind === 'expense') ? 'warning' : 'ok';
};

/** Variación de la categoría contra el mismo tramo del mes anterior: glifo decorativo + monto con signo + texto. */
function CategoryTrendLine({
  comparison,
  kind,
  ctx,
}: {
  comparison: CategoryComparison;
  kind: TopCategoriesKind;
  ctx: FormatContext;
}) {
  const { t, locale } = ctx;
  const ns = KEYS[kind];
  if (comparison.trend === 'unknown') {
    return (
      <p data-testid="top-category-trend" data-trend="unknown" className="pf-home-muted">
        {t(`${ns}.trend.unknown`)}
      </p>
    );
  }
  return (
    <p data-testid="top-category-trend" data-trend={comparison.trend} className="pf-home-muted">
      <span className="pf-home-trend" data-tone={toneOf(comparison, kind)}>
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
        <strong data-testid="top-category-trend-label">{t(`${ns}.trend.${comparison.trend}`)}</strong>
      </span>
      {comparison.trend === 'new' ? null : (
        <>
          {' · '}
          <span data-testid="top-category-previous">
            {t(`${ns}.previous`, { amount: formatMoney(comparison.previous!, locale) })}
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
  kind,
  ctx,
}: {
  category: TopCategory;
  comparison: CategoryComparison | undefined;
  scale: string;
  kind: TopCategoriesKind;
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
        <span
          className="pf-home-meter-fill"
          data-kind={kind}
          style={{ width: `${(ratio * 100).toFixed(1)}%` }}
        />
        {prevRatio > 0 ? (
          <span
            className="pf-home-meter-prev"
            data-testid="top-category-previous-marker"
            style={{ left: `calc(${(prevRatio * 100).toFixed(1)}% - 1px)` }}
          />
        ) : null}
      </div>
      {comparison ? <CategoryTrendLine comparison={comparison} kind={kind} ctx={ctx} /> : null}
    </li>
  );
}

/**
 * Q2/Q3/Q7 básico (FR-REPORTING-004, D50): principales categorías de gasto (o de ingreso) neto del mes con barras
 * proporcionales a la mayor y, si hay comparación, la variación contra el mismo tramo del mes anterior (glifo + signo +
 * texto, nunca solo color) con una marca en la barra donde quedó el mes anterior. El monto anterior llega en la misma
 * respuesta (`previousAmount`, sin una segunda consulta). Un neto negativo se muestra tal cual y sin barra. Sin
 * movimientos: estado vacío (en gasto, con la acción de registrar uno).
 */
export function TopCategoriesWidget({
  summary,
  ctx,
  kind = 'expense',
  registerExpenseHref,
}: {
  summary: ReportSummary;
  ctx: FormatContext;
  kind?: TopCategoriesKind;
  registerExpenseHref?: string | undefined;
}) {
  const { t } = ctx;
  const ns = KEYS[kind];
  const categories = kind === 'expense' ? summary.topExpenseCategories : summary.topIncomeCategories;
  if (!categories || statusOf(summary, kind === 'expense' ? 'Q3' : 'Q2').status === 'NO_DATA') return null;
  const comparable = hasCategoryComparison(summary);
  const comparisons = categories.map((c) => (comparable ? compareCategory(c) : undefined));
  const scale = maxAmount([
    ...categories.map((c) => c.amount.amount),
    ...comparisons.flatMap((c) => (c?.previous ? [c.previous.amount] : [])),
  ]);
  const hasMarkers = comparisons.some((c) => c?.previous && barRatio(c.previous.amount, scale) > 0);
  const testId = kind === 'expense' ? 'top-categories' : 'top-income-categories';
  const titleId = `${testId}-title`;
  return (
    <section
      data-testid={testId}
      data-comparison={comparable ? 'ready' : 'unavailable'}
      aria-labelledby={titleId}
      className="pf-home-card"
    >
      <h3 id={titleId}>{t(`${ns}.title`)}</h3>
      {categories.length === 0 ? (
        <div data-testid={`${testId}-empty`} className="pf-home-empty">
          <p>{t(`${ns}.empty`)}</p>
          {kind === 'expense' && registerExpenseHref ? (
            <p>
              <a href={registerExpenseHref} data-testid="register-expense-action">
                {t('topCategories.emptyAction')}
              </a>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="pf-home-muted">{t(`${ns}.caption`, { n: categories.length })}</p>
          <ol className="pf-home-cats">
            {categories.map((c, i) => (
              <CategoryRow
                key={c.categoryId}
                category={c}
                comparison={comparisons[i]}
                scale={scale}
                kind={kind}
                ctx={ctx}
              />
            ))}
          </ol>
          {hasMarkers ? (
            <p className="pf-home-muted pf-home-legend" aria-hidden="true">
              <span>
                <span className="pf-home-legend-mark" />
                {t(`${ns}.legendPrevious`)}
              </span>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
