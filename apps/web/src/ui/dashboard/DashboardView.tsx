import type { ReactNode } from 'react';
import { AccountBalancesList } from './AccountBalancesList';
import { ExpenseCard, IncomeCard, SavingsCard } from './FlowCards';
import { formatInstant, formatLocalDate } from './format';
import { LiquidBalanceCard } from './LiquidBalanceCard';
import { NetWorthCard } from './NetWorthCard';
import { ActionHint, NotAvailableWidget, statusOf } from './QuestionWidgets';
import { HOME_CSS } from './styles';
import { TopCategoriesWidget } from './TopCategoriesWidget';
import type { FormatContext, ReportSummary } from './types';

export interface DashboardViewProps extends FormatContext {
  readonly summary: ReportSummary;
  /** Destino de la acción "crear cuenta" (si existe la pantalla). */
  readonly createAccountHref?: string | undefined;
  /** Destino de la acción "registrar tasa" (si existe la pantalla). */
  readonly registerRateHref?: string | undefined;
  /** Destino de la acción "registrar un gasto" del estado vacío de categorías. */
  readonly registerExpenseHref?: string | undefined;
  /** Widget de presupuestos (add-budgets 6.2: disponible para gastar), entre "Este mes" y el patrimonio. */
  readonly budgetWidget?: ReactNode;
}

/** Hoja de estilos del Home (tokens de docs/28 §5). */
const HomeStyles = () => <style>{HOME_CSS}</style>;

/**
 * Home (reporting/dashboard, tareas 6.1 y 6.2; D50): jerarquía visual de lo más consultado a lo menos —
 * (1) "¿Cuánto dinero tengo?" destacado; (2) "Este mes" (FR-REPORTING-004): ingresos, gastos y ahorro con la
 * variación contra el mes anterior y los tops de categorías de gasto y de ingreso con barras y variación por
 * categoría (el monto anterior llega en la misma respuesta);
 * (3) patrimonio y cuentas; (4) preguntas que llegan en fases siguientes, sin montos. Encabezados h2 por grupo y h3
 * por tarjeta bajo el h1 de la página. Presentacional: textos del namespace `Dashboard`, montos formateados desde el
 * string decimal en el locale del workspace e instantes en su zona horaria.
 */
export function DashboardView({
  summary,
  createAccountHref,
  registerRateHref,
  registerExpenseHref,
  budgetWidget,
  ...ctx
}: DashboardViewProps) {
  const { t, locale } = ctx;
  const timeZone = summary.meta.timeZone || ctx.timeZone;
  const fctx: FormatContext = { ...ctx, timeZone };
  const unavailable = summary.questions.filter((q) => q.status === 'NOT_AVAILABLE_IN_PHASE');
  const attributions = summary.meta.attributions ?? [];
  const external = { target: '_blank', rel: 'noopener noreferrer' } as const;
  const q2 = statusOf(summary, 'Q2');
  const monthNoData = q2.status === 'NO_DATA' && statusOf(summary, 'Q3').status === 'NO_DATA';

  return (
    <div data-testid="dashboard" data-complete={summary.meta.complete ? 'true' : 'false'} className="pf-home">
      <HomeStyles />
      <LiquidBalanceCard
        summary={summary}
        ctx={fctx}
        createAccountHref={createAccountHref}
        registerRateHref={registerRateHref}
      />

      <section data-testid="month-overview" aria-labelledby="month-title" className="pf-home-group">
        <div className="pf-home-group-head">
          <h2 id="month-title">{t('month.title')}</h2>
          <p data-testid="dashboard-period" className="pf-home-muted" style={{ margin: 0 }}>
            {t('period', {
              from: formatLocalDate(summary.period.from, locale),
              to: formatLocalDate(summary.period.to, locale),
            })}
            {summary.comparison
              ? ` · ${t(`comparisonMode.${summary.comparison.mode}`, {
                  from: formatLocalDate(summary.comparison.previousPeriod.from, locale),
                  to: formatLocalDate(summary.comparison.previousPeriod.to, locale),
                })}`
              : ''}
          </p>
        </div>
        {monthNoData ? (
          <div data-testid="month-no-data" className="pf-home-empty">
            <p>{t('month.empty')}</p>
            <ActionHint
              code={q2.actionHint}
              ctx={fctx}
              href={q2.actionHint === 'CREATE_ACCOUNT' ? createAccountHref : undefined}
              testId="month-action"
            />
          </div>
        ) : (
          <div className="pf-home-month">
            <div className="pf-home-kpis">
              <IncomeCard summary={summary} ctx={fctx} />
              <ExpenseCard summary={summary} ctx={fctx} />
              <SavingsCard summary={summary} ctx={fctx} />
            </div>
            <div className="pf-home-tops">
              <TopCategoriesWidget
                summary={summary}
                ctx={fctx}
                kind="expense"
                registerExpenseHref={registerExpenseHref}
              />
              <TopCategoriesWidget summary={summary} ctx={fctx} kind="income" />
            </div>
          </div>
        )}
      </section>

      {budgetWidget ?? null}

      <section data-testid="wealth" aria-labelledby="wealth-title" className="pf-home-group">
        <h2 id="wealth-title">{t('sections.wealth')}</h2>
        <div className="pf-home-grid">
          <NetWorthCard summary={summary} ctx={fctx} />
          <AccountBalancesList summary={summary} ctx={fctx} />
        </div>
      </section>

      {unavailable.length > 0 ? (
        <section data-testid="upcoming" aria-labelledby="upcoming-title" className="pf-home-group">
          <div className="pf-home-group-head">
            <h2 id="upcoming-title">{t('sections.upcoming')}</h2>
            <p className="pf-home-muted" style={{ margin: 0 }}>
              {t('sections.upcomingCaption')}
            </p>
          </div>
          <div className="pf-home-grid">
            {unavailable.map((q) => (
              <NotAvailableWidget key={q.question} status={q} ctx={fctx} />
            ))}
          </div>
        </section>
      ) : null}

      <footer data-testid="dashboard-meta" className="pf-home-footer">
        <p>
          <span data-testid="dashboard-generated-at">
            {t('meta.generatedAt', { date: formatInstant(summary.meta.generatedAt, locale, timeZone) })}
          </span>
          {summary.meta.dataFreshness ? (
            <>
              {' · '}
              <span data-testid="dashboard-freshness">
                {t('meta.freshness', { date: formatInstant(summary.meta.dataFreshness, locale, timeZone) })}
              </span>
            </>
          ) : null}
          {' · '}
          {t('meta.reportingCurrency', { currency: summary.meta.reportingCurrency })}
          {summary.meta.approx ? <> · {t('meta.approx')}</> : null}
        </p>
        {attributions.length > 0 ? (
          <ul data-testid="attributions" style={{ paddingLeft: '1.25rem', margin: 0 }}>
            {attributions.map((a) => (
              <li key={a.provider} data-provider={a.provider}>
                <a href={a.url} {...external}>
                  {a.text}
                </a>
                {a.license ? (
                  <>
                    {' · '}
                    {a.licenseUrl ? (
                      <a href={a.licenseUrl} {...external}>
                        {a.license}
                      </a>
                    ) : (
                      a.license
                    )}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </footer>
    </div>
  );
}

/**
 * Esqueleto con la misma silueta del Home (destacado y "Este mes" con KPIs y categorías) mientras carga el resumen:
 * sin cifras, anunciado como estado ocupado y sin animación con `prefers-reduced-motion` (docs/28 §12).
 */
export function DashboardSkeleton({ label }: { label: string }) {
  const block = (height: string) => <div className="pf-home-skel" style={{ height }} />;
  return (
    <div data-testid="dashboard-skeleton" role="status" aria-busy="true" className="pf-home">
      <HomeStyles />
      <span className="pf-home-sr">{label}</span>
      <div aria-hidden="true" className="pf-home-group">
        {block('8.5rem')}
        {block('1.5rem')}
        <div className="pf-home-month">
          <div className="pf-home-kpis">
            {block('6.5rem')}
            {block('6.5rem')}
            {block('6.5rem')}
          </div>
          {block('16rem')}
        </div>
      </div>
    </div>
  );
}
