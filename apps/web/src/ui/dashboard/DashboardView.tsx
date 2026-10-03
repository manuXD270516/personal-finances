import { AccountBalancesList } from './AccountBalancesList';
import { ExpenseCard, IncomeCard, SavingsCard } from './FlowCards';
import { formatInstant, formatLocalDate } from './format';
import { LiquidBalanceCard } from './LiquidBalanceCard';
import { NetWorthCard } from './NetWorthCard';
import { NotAvailableWidget } from './QuestionWidgets';
import { cardStyle, gridStyle, mutedStyle } from './styles';
import { TopCategoriesWidget } from './TopCategoriesWidget';
import type { FormatContext, ReportSummary } from './types';

export interface DashboardViewProps extends FormatContext {
  readonly summary: ReportSummary;
  /** Destino de la acción "crear cuenta" (si existe la pantalla). */
  readonly createAccountHref?: string | undefined;
  /** Destino de la acción "registrar tasa" (si existe la pantalla). */
  readonly registerRateHref?: string | undefined;
}

/**
 * Home (reporting/dashboard, tareas 6.1 y 6.2): responde las preguntas de docs/00 §6 habilitadas en Phase 1 y
 * declara explícitamente las no disponibles, sin montos. Presentacional: textos del namespace `Dashboard`, montos
 * formateados desde el string decimal en el locale del workspace e instantes en su zona horaria.
 */
export function DashboardView({ summary, createAccountHref, registerRateHref, ...ctx }: DashboardViewProps) {
  const { t, locale } = ctx;
  const timeZone = summary.meta.timeZone || ctx.timeZone;
  const fctx: FormatContext = { ...ctx, timeZone };
  const unavailable = summary.questions.filter((q) => q.status === 'NOT_AVAILABLE_IN_PHASE');
  const attributions = summary.meta.attributions ?? [];
  const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

  return (
    <div data-testid="dashboard" data-complete={summary.meta.complete ? 'true' : 'false'}>
      <p data-testid="dashboard-period" style={mutedStyle}>
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
      <div style={gridStyle}>
        <LiquidBalanceCard
          summary={summary}
          ctx={fctx}
          createAccountHref={createAccountHref}
          registerRateHref={registerRateHref}
        />
        <IncomeCard summary={summary} ctx={fctx} />
        <ExpenseCard summary={summary} ctx={fctx} />
        <SavingsCard summary={summary} ctx={fctx} />
        <TopCategoriesWidget summary={summary} ctx={fctx} />
        <NetWorthCard summary={summary} ctx={fctx} />
        <AccountBalancesList summary={summary} ctx={fctx} />
        {unavailable.map((q) => (
          <NotAvailableWidget key={q.question} status={q} ctx={fctx} />
        ))}
      </div>
      <footer data-testid="dashboard-meta" style={{ ...mutedStyle, marginTop: '1rem' }}>
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
          <ul data-testid="attributions" style={{ paddingLeft: '1.25rem' }}>
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

/** Esqueleto mientras carga el resumen (sin cifras). */
export function DashboardSkeleton({ label }: { label: string }) {
  const block = { ...cardStyle, height: '6rem', background: '#f6f8fa' };
  return (
    <div data-testid="dashboard-skeleton" aria-busy="true" aria-label={label} style={gridStyle}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={block} />
      ))}
    </div>
  );
}
