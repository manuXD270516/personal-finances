'use client';

import { useEffect, useRef, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { todayIn } from '../common/dates';
import type { Page } from '../common/types';
import { mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { useCatalogs, type Catalogs } from '../transactions/catalogs';
import { CostSummaryCard } from './CostSummary';
import { SubscriptionFormView } from './SubscriptionForm';
import { SubscriptionsList } from './SubscriptionsList';
import { emptyForm, listQuery, SUBSCRIPTIONS_LIMIT } from './logic';
import type { Subscription } from './types';

export function SubscriptionsPage({ unavailable = false }: { unavailable?: boolean }) {
  return <WithWorkspace>{(ctx) => <Subscriptions ctx={ctx} unavailable={unavailable} />}</WithWorkspace>;
}

/**
 * Pantalla `/recurring/suscripciones` (openspec add-subscriptions 6.1 y 6.3; docs/28): vista "Costo de suscripciones",
 * listado (sin canceladas por omisión, con "Mostrar canceladas") y alta. `unavailable` muestra el aviso "esta
 * suscripción ya no está disponible" cuando el enlace de una notificación apunta a una inexistente o cancelada.
 */
function Subscriptions({ ctx, unavailable }: { ctx: WorkspaceContext; unavailable: boolean }) {
  const f = useFormat('Subscriptions', ctx);
  const df = useFormat('Dashboard', ctx);
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState<string | undefined>();
  const statusRef = useRef<HTMLParagraphElement>(null);

  // El aviso de la acción recibe el foco (el formulario que lo originó ya se cerró).
  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  return (
    <section aria-labelledby="subscriptions-title" style={pageStyle}>
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/recurring')} data-testid="subscriptions-back">
          {f.t('backToRecurring')}
        </a>
      </p>
      <h1 id="subscriptions-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {unavailable ? (
        <p role="status" data-testid="subscription-unavailable">
          <span aria-hidden="true">ℹ</span> {f.t('unavailable')}
        </p>
      ) : null}
      {status ? (
        <p ref={statusRef} tabIndex={-1} role="status" data-testid="subscriptions-status">
          {status}
        </p>
      ) : null}
      <CostSummaryCard ctx={ctx} f={f} df={df} refreshKey={refreshKey} />
      <SubscriptionsPanel
        ctx={ctx}
        f={f}
        catalogs={catalogs}
        today={today}
        refreshKey={refreshKey}
        onChanged={(message) => {
          setStatus(message);
          setRefreshKey((k) => k + 1);
        }}
      />
    </section>
  );
}

/** Listado con filtro "Mostrar canceladas" y alta de una suscripción nueva. */
function SubscriptionsPanel({
  ctx,
  f,
  catalogs,
  today,
  refreshKey,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  catalogs: Catalogs;
  today: string;
  refreshKey: number;
  onChanged: (message: string) => void;
}) {
  const [showCancelled, setShowCancelled] = useState(false);
  const [items, setItems] = useState<readonly Subscription[] | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<Page<Subscription>>(`${ctx.base}/subscriptions?${listQuery(showCancelled)}`)
      .then((r) => {
        if (cancelled) return;
        setItems(r.data?.data ?? []);
        setHasMore(r.data?.page.hasMore ?? false);
        setProblem(undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, showCancelled, refreshKey]);

  return (
    <section
      aria-labelledby="subscriptions-list-title"
      style={{ display: 'grid', gap: 'var(--pf-space-3)' }}
      data-testid="subscriptions-panel"
    >
      <h2 id="subscriptions-list-title" style={{ margin: 0 }}>
        {f.t('list.title')}
      </h2>
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            name="showCancelled"
            data-testid="show-cancelled"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
          />
          {f.t('list.showCancelled')}
        </label>
        {ctx.canEdit && !creating ? (
          <button type="button" data-testid="new-subscription" onClick={() => setCreating(true)}>
            {f.t('list.new')}
          </button>
        ) : null}
      </div>
      {creating ? (
        <SubscriptionFormView
          ctx={ctx}
          f={f}
          catalogs={catalogs}
          today={today}
          mode="create"
          initial={{ ...emptyForm(today), currency: ctx.ws.baseCurrency }}
          onCancel={() => setCreating(false)}
          onSaved={(sub) => {
            setCreating(false);
            onChanged(f.t('form.created', { name: sub.name }));
          }}
        />
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : (
        <>
          <SubscriptionsList subscriptions={items} f={f} href={ctx.href} />
          {hasMore ? <p style={mutedStyle}>{f.t('list.truncated', { limit: SUBSCRIPTIONS_LIMIT })}</p> : null}
        </>
      )}
    </section>
  );
}
