'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { Page } from '../common/types';
import { Field, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { useLoanLookup } from '../debt/useLoanLookup';
import type { Catalogs } from '../transactions/catalogs';
import { OccurrenceActionPanel } from './OccurrenceActionPanel';
import { actionButtonId, OccurrencesTable } from './OccurrencesTable';
import {
  DEFAULT_UPCOMING_DAYS,
  isLoanInstallment,
  LIST_LIMIT,
  trayQuery,
  UPCOMING_DAYS,
  upcomingQuery,
  type OccurrenceAction,
  type UpcomingDays,
} from './logic';
import { OCCURRENCE_STATUSES, type RecurringOccurrence } from './types';

/**
 * Lista conectada de ocurrencias: **Próximos** (`?days=7|30|60|90`, atrasadas primero) o **Por aprobar** (bandeja,
 * `?requiresApproval=true`). Las acciones abren su panel sobre la tabla; al terminar se avisa a la pantalla para
 * recargar las demás listas, el comprometido y el contador.
 */
export function OccurrencesPanel({
  ctx,
  f,
  catalogs,
  today,
  variant,
  definitionId,
  refreshKey,
  onChanged,
  onCount,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  catalogs: Catalogs;
  today: string;
  variant: 'upcoming' | 'tray' | 'definition';
  /** Solo con `variant = 'definition'`: las ocurrencias de esa definición. */
  definitionId?: string;
  refreshKey: number;
  onChanged: (message: string) => void;
  onCount?: (count: number) => void;
}) {
  const [days, setDays] = useState<UpcomingDays>(DEFAULT_UPCOMING_DAYS);
  const [items, setItems] = useState<readonly RecurringOccurrence[] | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [active, setActive] = useState<
    { action: OccurrenceAction; occurrence: RecurringOccurrence } | undefined
  >();
  const countRef = useRef(onCount);
  countRef.current = onCount;

  const [statusFilter, setStatusFilter] = useState('');
  const url =
    variant === 'upcoming'
      ? `${ctx.base}/recurring/occurrences?${upcomingQuery(days)}`
      : variant === 'tray'
        ? `${ctx.base}/recurring/occurrences?${trayQuery()}`
        : `${ctx.base}/recurring/${definitionId ?? ''}/occurrences?limit=${LIST_LIMIT}${
            statusFilter ? `&status=${statusFilter}` : ''
          }`;
  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<Page<RecurringOccurrence>>(url)
      .then((r) => {
        if (cancelled) return;
        const data = r.data?.data ?? [];
        setItems(data);
        setHasMore(r.data?.page.hasMore ?? false);
        setProblem(undefined);
        countRef.current?.(data.length);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, url, refreshKey]);

  const close = useCallback((trigger?: { action: OccurrenceAction; id: string }) => {
    setActive(undefined);
    if (trigger) {
      // Devuelve el foco al botón que abrió el panel (si la fila sigue ahí).
      setTimeout(() => document.getElementById(actionButtonId(trigger.id, trigger.action))?.focus(), 0);
    }
  }, []);

  const loans = useLoanLookup(ctx, (items ?? []).some(isLoanInstallment));
  const accountName = (id: string) => catalogs.names.account(id);
  const currencyOf = (id: string) => catalogs.accounts.find((a) => a.id === id)?.currency;
  const loading = items === undefined;

  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid={`occurrences-${variant}`}>
      {variant === 'upcoming' ? (
        <div style={rowStyle}>
          <Field label={f.t('upcoming.range')} style={{ flex: '0 1 14rem' }}>
            {(p) => (
              <select
                {...p}
                name="days"
                style={inputStyle}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) as UpcomingDays)}
              >
                {UPCOMING_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {f.t('upcoming.days', { days: d })}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      ) : variant === 'tray' ? (
        <p style={mutedStyle}>{f.t('tray.intro')}</p>
      ) : (
        <div style={rowStyle}>
          <Field label={f.t('definitions.filterOccurrenceStatus')} style={{ flex: '0 1 14rem' }}>
            {(p) => (
              <select
                {...p}
                name="status"
                style={inputStyle}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">{f.t('definitions.all')}</option>
                {OCCURRENCE_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {f.t(`status.${st}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      )}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {active ? (
        <OccurrenceActionPanel
          key={`${active.action}-${active.occurrence.id}`}
          ctx={ctx}
          f={f}
          action={active.action}
          occurrence={active.occurrence}
          currencyOf={currencyOf}
          today={today}
          onCancel={() => close({ action: active.action, id: active.occurrence.id })}
          onDone={(_updated, message) => {
            close();
            onChanged(message);
          }}
        />
      ) : null}
      {loading ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : (
        <OccurrencesTable
          occurrences={items}
          f={f}
          uiLocale={ctx.uiLocale}
          canEdit={ctx.canEdit}
          accountName={(id) => accountName(id)}
          href={ctx.href}
          caption={
            variant === 'upcoming'
              ? f.t('upcoming.caption', { days })
              : variant === 'tray'
                ? f.t('tray.caption')
                : f.t('definitionOccurrences.caption')
          }
          empty={
            variant === 'upcoming'
              ? f.t('upcoming.empty', { days })
              : variant === 'tray'
                ? f.t('tray.empty')
                : f.t('definitionOccurrences.empty')
          }
          onAction={(action, occurrence) => setActive({ action, occurrence })}
          loanOf={loans.ofDefinition}
        />
      )}
      {hasMore ? (
        <p style={mutedStyle} data-testid="list-truncated">
          {f.t('truncated', { limit: LIST_LIMIT })}
        </p>
      ) : null}
    </div>
  );
}
