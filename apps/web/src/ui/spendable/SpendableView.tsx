import type { ReactNode } from 'react';
import type { Money } from '../common/fx-types';
import { formatMoney, formatLocalDate, formatInstant, isNegative } from '../dashboard/format';
import { ActionHint } from '../dashboard/QuestionWidgets';
import type { FormatContext } from '../dashboard/types';
import { horizonView, isShort, nearPeriodEnd, subtracted } from './logic';
import type { Spendable, SpendableCurrencyTerms, SpendableEssentialWarning, SpendableSummary } from './types';

export interface SpendableLinks {
  /** Vista de detalle del disponible. */
  readonly detailHref?: string | undefined;
  /** Alta de presupuesto (segunda vista sin plan). */
  readonly createBudgetHref?: string | undefined;
  /** Próximos pagos (Q8), cerca del fin del periodo. */
  readonly upcomingHref?: string | undefined;
  readonly createAccountHref?: string | undefined;
  /** Inicio (vuelta desde la vista de detalle). */
  readonly homeHref?: string | undefined;
  /** Ajustes del disponible (horizonte y esenciales; add-cash-flow-forecast). */
  readonly settingsHref?: string | undefined;
}

type TermKey =
  | 'liquid'
  | 'reservedForGoals'
  | 'committed'
  | 'plannedGoalContributions'
  | 'essentials'
  | 'minimumReserve'
  | 'spendable';

/** Desglose de una moneda: cada término por separado y el disponible (siempre visible, sin ocultar términos en cero). */
function TermsList({ terms, ctx }: { terms: SpendableCurrencyTerms; ctx: FormatContext }) {
  const { t, locale } = ctx;
  const rows: { key: TermKey; value: Money }[] = [];
  rows.push({ key: 'liquid', value: terms.liquid });
  rows.push({ key: 'reservedForGoals', value: subtracted(terms.reservedForGoals) });
  rows.push({ key: 'committed', value: subtracted(terms.committed) });
  rows.push({ key: 'plannedGoalContributions', value: subtracted(terms.plannedGoalContributions) });
  // Con los esenciales desactivados (`null`) el término no se muestra y el disponible no cambia.
  if (terms.essentials) rows.push({ key: 'essentials', value: subtracted(terms.essentials) });
  // Sin reserva mínima en esta moneda el término no se muestra (no un 0.00 en el desglose).
  if (terms.minimumReserve) rows.push({ key: 'minimumReserve', value: subtracted(terms.minimumReserve) });
  rows.push({ key: 'spendable', value: terms.spendable });
  return (
    <ul className="pf-home-list" data-testid="spendable-terms" data-currency={terms.currency}>
      {rows.map((r) => (
        <li
          key={r.key}
          data-testid={`spendable-term-${r.key}`}
          data-negative={isNegative(r.value.amount) ? 'true' : 'false'}
          style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}
        >
          <span>{t(`spendable.terms.${r.key}`)}</span>
          <strong className="pf-home-num" data-testid={`spendable-term-${r.key}-amount`}>
            {formatMoney(r.value, locale)}
          </strong>
        </li>
      ))}
    </ul>
  );
}

/** Horizonte del disponible: periodo financiero, «hasta el próximo ingreso» o el respaldo de 30 días sin ingreso esperado. */
function HorizonLine({ summary, ctx }: { summary: SpendableSummary; ctx: FormatContext }) {
  const { t, locale } = ctx;
  const view = horizonView(summary);
  if (!view) return null;
  const range = { from: formatLocalDate(view.from, locale), to: formatLocalDate(view.to, locale) };
  return (
    <p className="pf-home-muted" data-testid="spendable-horizon" data-horizon={view.kind}>
      {view.kind === 'PERIOD'
        ? t('spendable.horizon.period', { label: view.label, ...range })
        : view.kind === 'NEXT_INCOME'
          ? t('spendable.horizon.nextIncome', {
              name: view.name,
              date: formatLocalDate(view.date, locale),
              ...range,
            })
          : t('spendable.horizon.fallback', range)}
    </p>
  );
}

/** Cifra principal con estado de alerta (texto + icono) cuando el consolidado es negativo. */
function MainFigure({ summary, ctx }: { summary: SpendableSummary; ctx: FormatContext }) {
  const { t, locale } = ctx;
  const warning = summary.status === 'WARNING';
  return (
    <>
      <p data-testid="spendable-amount" data-status={summary.status} className="pf-home-amount">
        {formatMoney(summary.consolidated.total, locale)}
      </p>
      <p className="pf-home-muted">{t('spendable.caption')}</p>
      {warning ? (
        <div role="alert" data-testid="spendable-warning" className="pf-home-warning">
          <p>
            <span aria-hidden="true">⚠</span> <strong>{t('spendable.negative')}</strong>
          </p>
          <p>{t('spendable.negativeHelp')}</p>
        </div>
      ) : null}
      {!summary.consolidated.complete ? (
        <div data-testid="spendable-incomplete" className="pf-home-warning">
          <p>{t('spendable.incomplete')}</p>
          <ul className="pf-home-list">
            {summary.consolidated.unconverted.map((m) => (
              <li key={m.currency} data-currency={m.currency} data-testid="spendable-unconverted">
                {t('spendable.unconverted', { amount: formatMoney(m, locale) })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/** Avisos bajo la cifra: faltante por moneda, pagos sin monto y tarjetas sin pago programado. */
function Notices({ summary, ctx }: { summary: SpendableSummary; ctx: FormatContext }) {
  const { t, locale } = ctx;
  return (
    <>
      {summary.shortfalls.map((m) => (
        <p
          key={m.currency}
          className="pf-home-warning"
          role="status"
          data-testid="spendable-shortfall"
          data-currency={m.currency}
        >
          <span aria-hidden="true">ⓘ</span>{' '}
          {t('spendable.shortfall', { currency: m.currency, amount: formatMoney(m, locale) })}
        </p>
      ))}
      {summary.withoutAmountCount > 0 ? (
        <p className="pf-home-muted" data-testid="spendable-without-amount">
          <span aria-hidden="true">ⓘ</span>{' '}
          {t('spendable.withoutAmount', { count: summary.withoutAmountCount })}
        </p>
      ) : null}
      {summary.cardsWithoutPaymentCount > 0 ? (
        <p className="pf-home-muted" data-testid="spendable-cards-without-payment">
          <span aria-hidden="true">ⓘ</span>{' '}
          {t('spendable.cardsWithoutPayment', { count: summary.cardsWithoutPaymentCount })}
        </p>
      ) : null}
    </>
  );
}

/** Segunda vista "según tu presupuesto" (FR-PLANNING-024); sin plan ofrece crearlo, sin 0.00 y sin quitar la primera vista. */
function BudgetView({
  summary,
  ctx,
  createBudgetHref,
}: {
  summary: SpendableSummary;
  ctx: FormatContext;
  createBudgetHref: string | undefined;
}) {
  const { t, locale } = ctx;
  const view = summary.budgetView;
  if (view.status === 'AVAILABLE' && view.amount) {
    return (
      <div data-testid="spendable-budget-view" data-status="AVAILABLE">
        <p className="pf-home-muted">{t('spendable.budget.title')}</p>
        <p className="pf-home-num">
          <strong data-testid="spendable-budget-amount">{formatMoney(view.amount, locale)}</strong>
        </p>
        {view.complete === false ? (
          <p className="pf-home-muted" data-testid="spendable-budget-partial">
            <span aria-hidden="true">ⓘ</span> {t('spendable.budget.partial')}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div data-testid="spendable-budget-view" data-status="NO_PLAN">
      <p className="pf-home-muted">{t('spendable.budget.title')}</p>
      <p>{t('spendable.budget.none')}</p>
      {createBudgetHref ? (
        <p>
          <a href={createBudgetHref} data-testid="spendable-create-budget" data-action="CREATE_BUDGET">
            {t('spendable.budget.create')}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Q5 "¿Cuánto puedo gastar?" del Home (add-spendable-amount): cifra principal "libre de compromisos" con su desglose por
 * moneda, la segunda vista "según tu presupuesto" (o "Crear presupuesto"), el faltante por moneda con "conviene
 * convertir", el estado de alerta (texto + icono) del disponible negativo y los avisos de pagos sin monto y tarjetas
 * sin pago programado; cerca del fin del periodo enlaza a los próximos pagos (Q8). Sin cuentas líquidas, un estado vacío
 * con la acción de crear una cuenta (nunca un 0.00 inventado). Presentacional.
 */
export function SpendableCard({
  summary,
  noData,
  generatedAt,
  ctx,
  links = {},
}: {
  /** Bloque `spendable` del resumen; `null` si la API no lo trajo. */
  summary: SpendableSummary | null | undefined;
  /** Q5 `NO_DATA` (con su `actionHint`). */
  noData: { readonly actionHint: string | null } | undefined;
  generatedAt: string;
  ctx: FormatContext;
  links?: SpendableLinks;
}) {
  const { t, locale, timeZone } = ctx;
  if (!summary) {
    if (!noData) return null;
    return (
      <section
        data-testid="question-Q5"
        data-question="Q5"
        data-status="NO_DATA"
        aria-labelledby="question-Q5-title"
        className="pf-home-group"
      >
        <div className="pf-home-group-head">
          <h2 id="question-Q5-title">{t('questions.Q5')}</h2>
        </div>
        <div className="pf-home-empty" data-testid="question-Q5-no-data">
          <p>{t('spendable.empty')}</p>
          <ActionHint
            code={noData.actionHint ?? 'CREATE_ACCOUNT'}
            ctx={ctx}
            href={links.createAccountHref}
            testId="spendable-action"
          />
        </div>
      </section>
    );
  }
  const near = links.upcomingHref !== undefined && nearPeriodEnd(summary.period.end, generatedAt, timeZone);
  return (
    <section
      data-testid="question-Q5"
      data-question="Q5"
      data-status="AVAILABLE"
      data-alert={summary.status === 'WARNING' ? 'true' : 'false'}
      aria-labelledby="question-Q5-title"
      className="pf-home-group"
    >
      <div className="pf-home-group-head">
        <h2 id="question-Q5-title">{t('questions.Q5')}</h2>
        <p className="pf-home-muted" style={{ margin: 0 }} data-testid="spendable-period">
          {t('spendable.period', {
            label: summary.period.label,
            from: formatLocalDate(summary.period.start, locale),
            to: formatLocalDate(summary.period.end, locale),
          })}
        </p>
      </div>
      <HorizonLine summary={summary} ctx={ctx} />
      <div className="pf-home-grid">
        <div className="pf-home-card pf-home-hero" data-testid="spendable-main">
          <MainFigure summary={summary} ctx={ctx} />
          <Notices summary={summary} ctx={ctx} />
        </div>
        <div className="pf-home-card" data-testid="spendable-breakdown">
          <p className="pf-home-muted">{t('spendable.breakdown')}</p>
          {summary.byCurrency.map((terms) => (
            <div
              key={terms.currency}
              data-currency={terms.currency}
              data-short={isShort(terms) ? 'true' : 'false'}
            >
              {summary.byCurrency.length > 1 ? (
                <p className="pf-home-muted">
                  {t('spendable.currencyHeading', { currency: terms.currency })}
                </p>
              ) : null}
              <TermsList terms={terms} ctx={ctx} />
            </div>
          ))}
        </div>
        <div className="pf-home-card" data-testid="spendable-secondary">
          <BudgetView summary={summary} ctx={ctx} createBudgetHref={links.createBudgetHref} />
          <p className="pf-home-muted">{t('spendable.captionHelp')}</p>
          {links.detailHref ? (
            <p>
              <a href={links.detailHref} data-testid="spendable-detail-link">
                {t('spendable.detailLink')}
              </a>
            </p>
          ) : null}
          {links.settingsHref ? (
            <p>
              <a href={links.settingsHref} data-testid="spendable-settings-link">
                {t('spendable.settingsLink')}
              </a>
            </p>
          ) : null}
          {near ? (
            <p>
              <a href={links.upcomingHref} data-testid="spendable-upcoming-link">
                {t('spendable.upcomingLink')}
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const warningKey = (w: SpendableEssentialWarning): string => `spendable.essentials.warning.${w.reason}`;

/**
 * Detalle de los esenciales presupuestados (add-cash-flow-forecast): por categoría y periodo, la referencia del plan, lo
 * gastado, lo ya comprometido (sin doble conteo) y lo que resta del disponible, con los avisos de categorías sin plan,
 * sin línea o archivadas. Con los esenciales desactivados solo ofrece activarlos en los ajustes.
 */
function EssentialsSection({
  spendable,
  ctx,
  categoryNames,
  links,
}: {
  spendable: Spendable;
  ctx: FormatContext;
  categoryNames: ReadonlyMap<string, string> | undefined;
  links: SpendableLinks;
}) {
  const { t, locale } = ctx;
  const items = spendable.essentialItems ?? [];
  const warnings = spendable.essentialWarnings ?? [];
  const active = spendable.byCurrency.some((c) => c.essentials);
  return (
    <section
      aria-labelledby="spendable-essentials-title"
      data-testid="spendable-essentials"
      data-active={active ? 'true' : 'false'}
      className="pf-home-card"
    >
      <h2 id="spendable-essentials-title">{t('spendable.essentials.title')}</h2>
      {!active && warnings.length === 0 ? (
        <p className="pf-home-muted" data-testid="spendable-essentials-off">
          {t('spendable.essentials.off')}
        </p>
      ) : null}
      {items.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table
            data-testid="spendable-essential-items"
            style={{ width: '100%', borderCollapse: 'collapse' }}
          >
            <caption style={{ textAlign: 'left' }}>{t('spendable.essentials.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('spendable.essentials.category')}</th>
                <th scope="col">{t('spendable.essentials.period')}</th>
                <th scope="col">{t('spendable.essentials.reference')}</th>
                <th scope="col">{t('spendable.essentials.actual')}</th>
                <th scope="col">{t('spendable.essentials.committed')}</th>
                <th scope="col">{t('spendable.essentials.counted')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.categoryId}-${i.periodLabel}`} data-testid="spendable-essential-item">
                  <th scope="row">{i.name}</th>
                  <td>
                    {i.periodLabel}
                    {i.prorated ? (
                      <>
                        {' '}
                        <span className="pf-home-badge" data-testid="spendable-essential-prorated">
                          {t('spendable.essentials.prorated')}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td className="pf-home-num">{formatMoney(i.reference, locale)}</td>
                  <td className="pf-home-num">{formatMoney(i.actual, locale)}</td>
                  <td className="pf-home-num">{formatMoney(i.committed, locale)}</td>
                  <td className="pf-home-num">
                    <strong>{formatMoney(i.counted, locale)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="pf-home-list" data-testid="spendable-essential-warnings">
          {warnings.map((w) => (
            <li
              key={`${w.categoryId}-${w.reason}-${w.periodLabel ?? ''}`}
              className="pf-home-warning"
              data-testid="spendable-essential-warning"
              data-reason={w.reason}
            >
              <span aria-hidden="true">⚠</span>{' '}
              {t(warningKey(w), {
                name: categoryNames?.get(w.categoryId) ?? t('spendable.essentials.unknownCategory'),
                period: w.periodLabel ?? '',
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {links.settingsHref ? (
        <p>
          <a href={links.settingsHref} data-testid="spendable-settings-link-detail">
            {t('spendable.settingsLink')}
          </a>
        </p>
      ) : null}
    </section>
  );
}

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section aria-labelledby={`${id}-title`} data-testid={id} className="pf-home-card">
    <h2 id={`${id}-title`}>{title}</h2>
    {children}
  </section>
);

/**
 * Vista de detalle del disponible (`GET /reports/spendable`): el desglose por moneda, los compromisos descontados con su
 * fecha y marca de vencido, lo reservado por cuenta (con el tope en el saldo), los aportes planificados por meta y las
 * tasas usadas con su atribución. Presentacional.
 */
export function SpendableDetailView({
  spendable,
  ctx,
  links = {},
  categoryNames,
}: {
  spendable: Spendable;
  ctx: FormatContext;
  links?: SpendableLinks;
  /** Nombres de categoría (para los avisos de esenciales, que solo traen el id). */
  categoryNames?: ReadonlyMap<string, string> | undefined;
}) {
  const { t, locale, timeZone } = ctx;
  const attributions = spendable.meta.attributions;
  return (
    <div className="pf-home" data-testid="spendable-detail" data-status={spendable.status}>
      <section aria-labelledby="spendable-detail-title" className="pf-home-card pf-home-hero">
        <h2 id="spendable-detail-title">{t('questions.Q5')}</h2>
        <p className="pf-home-muted" data-testid="spendable-period">
          {t('spendable.period', {
            label: spendable.period.label,
            from: formatLocalDate(spendable.period.start, locale),
            to: formatLocalDate(spendable.period.end, locale),
          })}
        </p>
        <HorizonLine summary={spendable} ctx={ctx} />
        <MainFigure summary={spendable} ctx={ctx} />
        <Notices summary={spendable} ctx={ctx} />
        {spendable.byCurrency.map((terms) => (
          <div key={terms.currency} data-currency={terms.currency}>
            <p className="pf-home-muted">{t('spendable.currencyHeading', { currency: terms.currency })}</p>
            <TermsList terms={terms} ctx={ctx} />
          </div>
        ))}
        <BudgetView summary={spendable} ctx={ctx} createBudgetHref={links.createBudgetHref} />
      </section>

      <Section id="spendable-committed" title={t('spendable.detail.committed')}>
        {spendable.committedItems.length === 0 ? (
          <p className="pf-home-muted">{t('spendable.detail.committedEmpty')}</p>
        ) : (
          <ul className="pf-home-list" data-testid="spendable-committed-items">
            {spendable.committedItems.map((i) => (
              <li
                key={`${i.source}-${i.id}`}
                data-testid="spendable-committed-item"
                data-source={i.source}
                data-overdue={i.overdueFromPrevious ? 'true' : 'false'}
              >
                <strong>
                  {i.name ??
                    t(i.source === 'PENDING' ? 'spendable.detail.pending' : 'spendable.detail.occurrence')}
                </strong>
                {' · '}
                <span className="pf-home-num">{formatMoney(i.amount, locale)}</span>
                {' · '}
                <span className="pf-home-muted">{formatLocalDate(i.date, locale)}</span>
                {i.overdueFromPrevious ? (
                  <>
                    {' '}
                    <span className="pf-home-badge" data-tone="warn">
                      <span aria-hidden="true">⚠</span> {t('spendable.detail.overdue')}
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <EssentialsSection spendable={spendable} ctx={ctx} categoryNames={categoryNames} links={links} />

      <Section id="spendable-reserved" title={t('spendable.detail.reserved')}>
        {spendable.reservedByAccount.length === 0 ? (
          <p className="pf-home-muted">{t('spendable.detail.reservedEmpty')}</p>
        ) : (
          <ul className="pf-home-list" data-testid="spendable-reserved-accounts">
            {spendable.reservedByAccount.map((r) => (
              <li key={r.accountId} data-testid="spendable-reserved-account">
                {t('spendable.detail.reservedLine', {
                  name: r.name,
                  reserved: formatMoney(r.reserved, locale),
                  counted: formatMoney(r.counted, locale),
                  balance: formatMoney(r.balance, locale),
                })}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="spendable-planned" title={t('spendable.detail.planned')}>
        {spendable.plannedByGoal.length === 0 ? (
          <p className="pf-home-muted">{t('spendable.detail.plannedEmpty')}</p>
        ) : (
          <ul className="pf-home-list" data-testid="spendable-planned-goals">
            {spendable.plannedByGoal.map((g) => (
              <li key={g.goalId} data-testid="spendable-planned-goal">
                {g.goalName} · <span className="pf-home-num">{formatMoney(g.pending, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="spendable-rates" title={t('spendable.detail.rates')}>
        {spendable.meta.ratesUsed.length === 0 ? (
          <p className="pf-home-muted">{t('spendable.detail.ratesNone')}</p>
        ) : (
          <ul className="pf-home-list" data-testid="spendable-rates-used">
            {spendable.meta.ratesUsed.map((r) => (
              <li key={`${r.rate.base}/${r.rate.quote}/${r.asOf}`} data-testid="spendable-rate">
                {t('spendable.detail.rateLine', {
                  pair: `${r.rate.base}/${r.rate.quote}`,
                  value: r.rate.value,
                })}{' '}
                <span className="pf-home-muted">· {r.rateType}</span>
              </li>
            ))}
          </ul>
        )}
        {attributions.length > 0 ? (
          <ul className="pf-home-list" data-testid="spendable-attributions">
            {attributions.map((a) => (
              <li key={a.provider}>
                <a href={a.url} target="_blank" rel="noopener noreferrer">
                  {a.text}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <footer className="pf-home-footer" data-testid="spendable-meta">
        <p>
          {t('meta.generatedAt', { date: formatInstant(spendable.meta.generatedAt, locale, timeZone) })}
          {spendable.meta.dataFreshness
            ? ` · ${t('meta.freshness', { date: formatInstant(spendable.meta.dataFreshness, locale, timeZone) })}`
            : ''}
          {' · '}
          {t('meta.reportingCurrency', { currency: spendable.reportingCurrency })}
        </p>
        {links.homeHref ? (
          <p>
            <a href={links.homeHref} data-testid="spendable-back">
              {t('spendable.detail.back')}
            </a>
          </p>
        ) : null}
      </footer>
    </div>
  );
}
