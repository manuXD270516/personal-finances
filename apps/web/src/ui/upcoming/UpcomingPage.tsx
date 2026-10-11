'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemOf, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { HOME_CSS } from '../dashboard/styles';
import type { FormatContext, HomeQuestionStatus } from '../dashboard/types';
import { looksLikeCardPayment } from '../debt/cards/logic';
import { useCardLookup } from '../debt/cards/useCardLookup';
import { localized, useSession } from '../session-context';
import { CommitmentsHomeView } from './CommitmentsHomeView';
import { DEFAULT_DAYS, HOME_DAYS, UPCOMING_PATH, RECURRING_PATH } from './logic';
import type { SurprisePayments, UpcomingPayments } from './types';
import { UpcomingFullView } from './UpcomingFullView';

function useUpcomingFormat(locale: string, timeZone: string): FormatContext {
  const t = useTranslations('Upcoming');
  return useMemo(
    () => ({
      locale,
      timeZone,
      t: (key, values) => t(key as never, values as never),
      has: (key) => t.has(key as never),
    }),
    [t, locale, timeZone],
  );
}

/**
 * Tarjetas Q4/Q8 del Home (docs/35 D148): una sola lectura de `getUpcomingPayments?days=7` en paralelo con el resumen.
 * Si la lectura falla el Home sigue funcionando y la tarjeta lo dice. Con Q4/Q8 `NO_DATA` en el resumen no se consulta
 * nada: se ofrece crear un compromiso.
 */
export function HomeCommitments({
  questions,
  locale,
  timeZone,
  uiLocale,
}: {
  questions: readonly HomeQuestionStatus[];
  locale: string;
  timeZone: string;
  uiLocale: string;
}) {
  const f = useUpcomingFormat(locale, timeZone);
  const { state } = useSession();
  const ready = state.status === 'ready' ? state : undefined;
  const api = ready?.api;
  const workspaceId = ready?.active?.workspaceId;
  const q4 = questions.find((q) => q.question === 'Q4');
  const q8 = questions.find((q) => q.question === 'Q8');
  const available = q4?.status === 'AVAILABLE' || q8?.status === 'AVAILABLE';
  const [upcoming, setUpcoming] = useState<UpcomingPayments | 'error' | undefined>();

  useEffect(() => {
    if (!api || !workspaceId || !available) return;
    let cancelled = false;
    api
      .get<UpcomingPayments>(`/workspaces/${workspaceId}/reports/upcoming-payments?days=${HOME_DAYS}`)
      .then((r) => {
        if (!cancelled) setUpcoming(r.data ?? 'error');
      })
      .catch(() => {
        if (!cancelled) setUpcoming('error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, available]);

  const hasCardPayments =
    upcoming !== undefined &&
    upcoming !== 'error' &&
    upcoming.items.some((i) => looksLikeCardPayment(i.name));
  const cards = useCardLookup(api, workspaceId ? `/workspaces/${workspaceId}` : undefined, hasCardPayments);

  if (!q4 && !q8) return null;
  return (
    <CommitmentsHomeView
      upcoming={available ? upcoming : undefined}
      q4={q4}
      q8={q8}
      f={f}
      fullHref={localized(uiLocale, UPCOMING_PATH)}
      createHref={localized(uiLocale, RECURRING_PATH)}
      createAccountHref={localized(uiLocale, '/cuentas/nueva')}
      href={(path) => localized(uiLocale, path)}
      cardOf={cards.ofDefinition}
    />
  );
}

function Upcoming({ ctx }: { ctx: WorkspaceContext }) {
  const f = useUpcomingFormat(ctx.formatLocale, ctx.timeZone);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [upcoming, setUpcoming] = useState<UpcomingPayments | undefined>();
  const [surprise, setSurprise] = useState<SurprisePayments | 'error' | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<UpcomingPayments>(`${ctx.base}/reports/upcoming-payments?days=${days}`)
      .then((r) => {
        if (cancelled) return;
        setProblem(undefined);
        setUpcoming(r.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, days]);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<SurprisePayments>(`${ctx.base}/reports/surprise-payments`)
      .then((r) => {
        if (!cancelled) setSurprise(r.data ?? 'error');
      })
      .catch(() => {
        if (!cancelled) setSurprise('error');
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);

  const cards = useCardLookup(
    ctx.api,
    ctx.base,
    upcoming !== undefined && upcoming.items.some((i) => looksLikeCardPayment(i.name)),
  );

  return (
    <div className="pf-home" data-testid="upcoming-payments-page">
      <style>{HOME_CSS}</style>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {!upcoming && !problem ? (
        <p aria-busy="true" role="status">
          {f.t('loading')}
        </p>
      ) : null}
      {upcoming ? (
        <UpcomingFullView
          upcoming={upcoming}
          surprise={surprise}
          days={days}
          onDaysChange={setDays}
          f={f}
          href={ctx.href}
          cardOf={cards.ofDefinition}
        />
      ) : null}
    </div>
  );
}

/** Vista completa `/pagos-proximos`: lista de próximos pagos con comprometido, saldo proyectado y pagos sorpresa. */
export function UpcomingPaymentsPage() {
  return <WithWorkspace>{(ctx) => <Upcoming ctx={ctx} />}</WithWorkspace>;
}
