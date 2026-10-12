'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { formatMoney } from '../../dashboard/format';
import type { FormatContext } from '../../dashboard/types';
import { formatBusinessDate } from '../../planning/logic';
import { localized, useSession } from '../../session-context';
import { debtFreeMonth, hasInterest, interestYear, joinMoney, joinNames, nextDue } from './logic';
import type { DebtSummary } from './types';

/**
 * Tarjeta "Deudas" del Home (openspec add-debt-summary, FR-DEBT-018): "¿cuánto debo y cuándo termino?" con el total
 * adeudado consolidado, el interés del año, la fecha estimada libre de deudas y el próximo vencimiento, y un enlace al
 * resumen. Sin cuentas de pasivo o sin saldo adeudado dice eso, sin montos en cero inventados. Presentacional: textos
 * del namespace `DebtSummary` (`card.*`) y montos formateados desde el string decimal.
 */
export function DebtSummaryCardView({
  summary,
  f,
  href,
  registerLoanHref,
  registerCardHref,
}: {
  summary: DebtSummary;
  f: FormatContext;
  href: string;
  registerLoanHref: string;
  registerCardHref: string;
}) {
  const { t, locale } = f;
  const due = nextDue(summary);
  const excluded = summary.debtFree.excluded.map((e) => e.name);
  const consolidated = summary.totals.consolidated;
  return (
    <section
      data-testid="debt-card"
      data-state={summary.status}
      aria-labelledby="debt-card-title"
      className="pf-home-group"
    >
      <div className="pf-home-group-head">
        <h2 id="debt-card-title">{t('card.title')}</h2>
        {summary.status !== 'NO_LIABILITIES' ? (
          <p className="pf-home-muted" style={{ margin: 0 }}>
            <a href={href} data-testid="debt-card-link">
              {t('card.viewAll')}
            </a>
          </p>
        ) : null}
      </div>
      {summary.status === 'NO_LIABILITIES' ? (
        <div className="pf-home-empty" data-testid="debt-card-no-liabilities">
          <p>{t('card.noLiabilities')}</p>
          <p>
            <a href={registerLoanHref} data-testid="debt-card-register-loan">
              {t('card.registerLoan')}
            </a>
            {' · '}
            <a href={registerCardHref} data-testid="debt-card-register-card">
              {t('card.registerCard')}
            </a>
          </p>
        </div>
      ) : summary.status === 'NO_DEBT' ? (
        <div className="pf-home-empty" data-testid="debt-card-no-debt">
          <p>{t('card.noDebt')}</p>
          {hasInterest(summary) ? (
            <p className="pf-home-muted" data-testid="debt-card-interest">
              {t('card.interest', {
                amount: formatMoney(summary.interestYtd.consolidated.amount, locale),
                year: interestYear(summary),
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="pf-home-card">
          <p className="pf-home-muted">{t('card.owedLabel')}</p>
          <p className="pf-home-amount" data-testid="debt-card-owed">
            {t('card.owed', { amount: formatMoney(consolidated.amount, locale) })}
          </p>
          {!consolidated.complete ? (
            <p className="pf-home-warning" role="status" data-testid="debt-card-incomplete">
              <span aria-hidden="true">⚠</span>{' '}
              {t('card.unconverted', { amounts: joinMoney(consolidated.unconverted, locale) })}
            </p>
          ) : null}
          {hasInterest(summary) ? (
            <p data-testid="debt-card-interest">
              {t('card.interest', {
                amount: formatMoney(summary.interestYtd.consolidated.amount, locale),
                year: interestYear(summary),
              })}
            </p>
          ) : null}
          <p data-testid="debt-card-debt-free" data-estimable={summary.debtFree.date ? 'true' : 'false'}>
            {summary.debtFree.date
              ? excluded.length > 0
                ? t('card.debtFreeExcluding', {
                    month: debtFreeMonth(summary.debtFree.date, locale),
                    names: joinNames(excluded),
                  })
                : t('card.debtFree', { month: debtFreeMonth(summary.debtFree.date, locale) })
              : t('card.debtFreeUnknown', { names: joinNames(excluded) })}
          </p>
          {summary.debtFree.date ? <p className="pf-home-muted">{t('card.debtFreeAssumption')}</p> : null}
          {due ? (
            <p data-testid="debt-card-next-due" data-overdue={due.overdueDays > 0 ? 'true' : 'false'}>
              <span className="pf-home-muted">{t('card.nextDue')}: </span>
              {t('card.nextDueValue', {
                name: due.name,
                date: formatBusinessDate(due.dueDate),
                amount: formatMoney(due.amount, locale),
              })}
              {due.estimated ? ` ${t('card.estimatedTag')}` : ''}
              {due.overdueDays > 0 ? (
                <>
                  {' '}
                  <span className="pf-home-badge" data-tone="warn" data-testid="debt-card-overdue">
                    <span aria-hidden="true">⚠</span> {t('card.overdueDays', { days: due.overdueDays })}
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Carga el resumen de deudas del workspace activo y lo presenta; si la lectura falla el Home sigue funcionando. */
export function DebtSummaryCard({
  locale,
  timeZone,
  uiLocale,
}: {
  locale: string;
  timeZone: string;
  uiLocale: string;
}) {
  const t = useTranslations('DebtSummary');
  const currentLocale = useLocale();
  const { state } = useSession();
  const ready = state.status === 'ready' ? state : undefined;
  const api = ready?.api;
  const workspaceId = ready?.active?.workspaceId;
  const [summary, setSummary] = useState<DebtSummary | null | undefined>();

  useEffect(() => {
    if (!api || !workspaceId) return;
    let cancelled = false;
    api
      .get<DebtSummary>(`/workspaces/${workspaceId}/debts/summary`)
      .then((r) => {
        if (!cancelled) setSummary(r.data ?? null);
      })
      .catch(() => {
        // Si la lectura falla el Home sigue funcionando: la tarjeta lo dice.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId]);

  if (summary === undefined) return null;
  const f: FormatContext = {
    locale,
    timeZone,
    t: (key, values) => t(key as never, values as never),
    has: (key) => t.has(key as never),
  };
  if (summary === null) {
    return (
      <section
        data-testid="debt-card"
        data-state="ERROR"
        aria-labelledby="debt-card-title"
        className="pf-home-group"
      >
        <h2 id="debt-card-title">{f.t('card.title')}</h2>
        <p className="pf-home-muted" role="status">
          {f.t('card.loadError')}
        </p>
      </section>
    );
  }
  const lang = uiLocale || currentLocale;
  return (
    <DebtSummaryCardView
      summary={summary}
      f={f}
      href={localized(lang, '/debts?vista=resumen')}
      registerLoanHref={localized(lang, '/debts/nuevo')}
      registerCardHref={localized(lang, '/debts/tarjetas/nueva')}
    />
  );
}
