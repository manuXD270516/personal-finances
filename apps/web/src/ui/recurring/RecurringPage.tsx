'use client';

import { useEffect, useRef, useState } from 'react';
import { Tabs } from '../common/Tabs';
import { todayIn } from '../common/dates';
import { mutedStyle, pageStyle } from '../common/ui';
import { useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { useCatalogs } from '../transactions/catalogs';
import { CommittedCard } from './CommittedCard';
import { DefinitionsPanel } from './DefinitionsPanel';
import { OccurrencesPanel } from './OccurrencesPanel';

export function RecurringPage() {
  return <WithWorkspace>{(ctx) => <Recurring ctx={ctx} />}</WithWorkspace>;
}

/**
 * Pantalla `/recurring` (openspec add-recurrence-engine 7.1; docs/28 §4.8): tarjeta "Comprometido del periodo" y las
 * pestañas Próximos (7/30/60/90 días), Por aprobar (bandeja) y Definiciones. Las acciones recargan las listas y el
 * comprometido (`refreshKey`) y avisan a la sidebar (evento de ventana).
 */
function Recurring({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Recurring', ctx);
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState<string | undefined>();
  const [tray, setTray] = useState<number | undefined>();
  const statusRef = useRef<HTMLParagraphElement>(null);

  const changed = (message: string) => {
    setStatus(message);
    setRefreshKey((k) => k + 1);
  };
  // El aviso de la acción recibe el foco (el panel que lo originó ya se cerró).
  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  const approvalLabel = tray ? f.t('tabs.approvalCount', { count: tray }) : f.t('tabs.approval');
  return (
    <section aria-labelledby="recurring-title" style={pageStyle}>
      <h1 id="recurring-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/recurring/suscripciones')} data-testid="subscriptions-link">
          {f.t('subscriptionsLink')}
        </a>
      </p>
      {status ? (
        <p ref={statusRef} tabIndex={-1} role="status" data-testid="recurring-status">
          {status}
        </p>
      ) : null}
      <CommittedCard ctx={ctx} f={f} refreshKey={refreshKey} />
      <Tabs
        idPrefix="recurring"
        label={f.t('tabs.label')}
        tabs={[
          {
            id: 'upcoming',
            label: f.t('tabs.upcoming'),
            content: (
              <OccurrencesPanel
                ctx={ctx}
                f={f}
                catalogs={catalogs}
                today={today}
                variant="upcoming"
                refreshKey={refreshKey}
                onChanged={changed}
              />
            ),
          },
          {
            id: 'approval',
            label: approvalLabel,
            content: (
              <OccurrencesPanel
                ctx={ctx}
                f={f}
                catalogs={catalogs}
                today={today}
                variant="tray"
                refreshKey={refreshKey}
                onChanged={changed}
                onCount={setTray}
              />
            ),
          },
          {
            id: 'definitions',
            label: f.t('tabs.definitions'),
            content: (
              <DefinitionsPanel
                ctx={ctx}
                f={f}
                catalogs={catalogs}
                today={today}
                refreshKey={refreshKey}
                onChanged={changed}
              />
            ),
          },
        ]}
      />
    </section>
  );
}
