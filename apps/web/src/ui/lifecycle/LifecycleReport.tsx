import { formatInstant, formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { badgeStyle, cardStyle, mutedStyle, warningStyle } from '../common/ui';
import { LifecycleDiagram } from './LifecycleDiagram';
import { buildDiagramModel, layoutFor, timelineRows, type ActorView, type TimelineRow } from './logic';
import type { Lifecycle, LifecycleRevision, TransactionLifecycle } from './types';

const hasRevisions = (l: Lifecycle | TransactionLifecycle): l is TransactionLifecycle =>
  Array.isArray((l as TransactionLifecycle).revisions);

/** Muestra la orientación horizontal o la vertical (bajo 768 px) del diagrama; ambas son layouts fijos. */
const RESPONSIVE_CSS =
  '.pf-lifecycle-v{display:none}@media (max-width: 767.98px){.pf-lifecycle-h{display:none}.pf-lifecycle-v{display:block}}';

/**
 * Reporte "Recorrido" de un elemento (openspec add-lifecycle-timeline, decisión 11; tareas 6.1 y 6.2): diagrama de su
 * máquina de estados con el camino recorrido (horizontal; vertical bajo 768 px) y, debajo, la línea de tiempo —su
 * alternativa accesible— con cada transición (origen → destino, actor, instante en la zona del workspace, motivo,
 * chip "derivada"), enlace a la revisión y vista técnica de asientos; las anotaciones van como entradas atenuadas.
 * Presentacional: textos del namespace `Lifecycle`; los estados los rotula el contexto dueño (`stateLabel`).
 */
export function LifecycleReport({
  lifecycle,
  f,
  stateLabel,
  fieldLabel = (name) => name,
  currentUserId,
  idPrefix,
  accountName = () => undefined,
}: {
  lifecycle: Lifecycle | TransactionLifecycle;
  f: FormatContext;
  stateLabel: (code: string) => string;
  fieldLabel?: (name: string) => string;
  currentUserId?: string;
  idPrefix: string;
  accountName?: (id: string) => string | undefined;
}) {
  const { t, has, locale, timeZone } = f;
  const type = lifecycle.machine.aggregateType;
  const transitionLabel = (code: string) =>
    has(`transitions.${type}.${code}`) ? t(`transitions.${type}.${code}`) : code;
  const model = buildDiagramModel(lifecycle);
  const rows = timelineRows(lifecycle, currentUserId);
  const revisions = hasRevisions(lifecycle) ? lifecycle.revisions : [];
  const revisionOf = new Map(revisions.map((r) => [r.revision, r]));
  const timelineId = `${idPrefix}-timeline`;
  const revisionAnchor = (n: number) => `${idPrefix}-revision-${n}`;
  const diagramLabel = t('diagram.label', {
    current: lifecycle.currentState ? stateLabel(lifecycle.currentState) : t('diagram.noState'),
    path: lifecycle.path.length > 0 ? lifecycle.path.map(stateLabel).join(' → ') : t('timeline.none'),
  });
  const amountOf = (r: LifecycleRevision) =>
    r.fee
      ? t('timeline.amountWithFee', {
          amount: formatMoney(r.amount, locale),
          fee: formatMoney(r.fee, locale),
        })
      : formatMoney(r.amount, locale);
  const actorLabel = (a: ActorView) => t(`timeline.actor.${a.kind}`, { id: a.value });

  const revisionLine = (row: TimelineRow) => {
    if (row.revisionTo === null || revisions.length === 0) return null;
    const changed = row.revisionFrom !== null && row.revisionFrom !== row.revisionTo;
    const from = changed ? revisionOf.get(row.revisionFrom!) : undefined;
    const to = revisionOf.get(row.revisionTo);
    const head = changed
      ? t('timeline.revisionChange', { from: row.revisionFrom!, to: row.revisionTo })
      : t('timeline.revision', { revision: row.revisionTo });
    const amounts = changed
      ? from && to
        ? ` · ${amountOf(from)} → ${amountOf(to)}`
        : ''
      : to
        ? ` · ${amountOf(to)}`
        : '';
    return (
      <p style={{ margin: '0.25rem 0' }} data-testid="lifecycle-entry-revision">
        {head}
        {amounts}
        {to ? (
          <>
            {' · '}
            <a href={`#${revisionAnchor(row.revisionTo)}`}>
              {t('timeline.viewRevision', { revision: row.revisionTo })}
            </a>
          </>
        ) : null}
      </p>
    );
  };

  return (
    <section aria-labelledby={`${idPrefix}-title`} data-testid="lifecycle-report" style={cardStyle}>
      <h2 id={`${idPrefix}-title`} style={{ fontSize: '1.1rem', marginTop: 0 }}>
        {t('title')}
      </h2>
      <p style={mutedStyle}>{t('subtitle')}</p>
      {!lifecycle.historyComplete ? (
        <p role="note" style={warningStyle} data-testid="lifecycle-incomplete">
          {t('incomplete')}
        </p>
      ) : null}
      <style>{RESPONSIVE_CSS}</style>
      <figure style={{ margin: '0 0 1rem', overflowX: 'auto' }} data-testid="lifecycle-figure">
        {(['horizontal', 'vertical'] as const).map((orientation) => (
          <LifecycleDiagram
            key={orientation}
            model={model}
            layout={layoutFor(lifecycle.machine, orientation, transitionLabel)}
            idPrefix={idPrefix}
            label={diagramLabel}
            describedBy={timelineId}
            stateLabel={stateLabel}
            transitionLabel={transitionLabel}
            currentLabel={t('diagram.current')}
            className={orientation === 'horizontal' ? 'pf-lifecycle-h' : 'pf-lifecycle-v'}
          />
        ))}
        <figcaption style={mutedStyle}>{t('diagram.legend')}</figcaption>
      </figure>
      <h3 id={`${idPrefix}-timeline-title`} style={{ fontSize: '1rem' }}>
        {t('timeline.title')}
      </h3>
      {rows.length === 0 ? <p>{t('empty')}</p> : null}
      <ol
        id={timelineId}
        aria-labelledby={`${idPrefix}-timeline-title`}
        data-testid="lifecycle-timeline"
        style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}
      >
        {rows.map((row) => (
          <li
            data-testid="lifecycle-entry"
            key={row.sequence}
            data-kind={row.kind}
            data-transition={row.transition ?? ''}
            data-from={row.from ?? ''}
            data-to={row.to ?? ''}
            data-order={row.order ?? ''}
            data-derived={String(row.derived)}
            style={{
              borderLeft: `3px solid ${row.kind === 'TRANSITION' ? '#0969da' : '#d0d7de'}`,
              paddingLeft: '0.75rem',
              ...(row.kind === 'ANNOTATION' ? { color: '#57606a' } : {}),
            }}
          >
            <p style={{ margin: 0 }}>
              {row.kind === 'TRANSITION' ? (
                <strong data-testid="lifecycle-entry-title">
                  {row.order !== null ? `${row.order}. ` : ''}
                  {transitionLabel(row.transition!)}
                </strong>
              ) : (
                <span data-testid="lifecycle-entry-title">
                  {t('timeline.annotation', { fields: row.changedFields.map(fieldLabel).join(', ') })}
                </span>
              )}
              {row.derived ? (
                <>
                  {' '}
                  <span style={badgeStyle} data-testid="lifecycle-derived" title={t('timeline.derivedHint')}>
                    {t('timeline.derived')}
                  </span>
                </>
              ) : null}
            </p>
            {row.kind === 'TRANSITION' ? (
              <p style={{ margin: '0.25rem 0' }} data-testid="lifecycle-entry-states">
                <span style={badgeStyle}>{row.from ? stateLabel(row.from) : t('timeline.none')}</span> →{' '}
                <span style={badgeStyle}>{stateLabel(row.to!)}</span>
              </p>
            ) : null}
            {row.kind === 'TRANSITION' ? revisionLine(row) : null}
            <p style={{ ...mutedStyle, margin: '0.25rem 0' }} data-testid="lifecycle-entry-who">
              {actorLabel(row.actor)} ·{' '}
              <time dateTime={row.occurredAt}>{formatInstant(row.occurredAt, locale, timeZone)}</time>
            </p>
            {row.reason ? (
              <p style={{ margin: '0.25rem 0' }} data-testid="lifecycle-entry-reason">
                {t('timeline.reason', { reason: row.reason })}
              </p>
            ) : null}
            {row.journalEntries &&
            (row.journalEntries.reversed || row.journalEntries.reversal || row.journalEntries.posted) ? (
              <details data-testid="lifecycle-journal" style={{ ...mutedStyle, margin: '0.25rem 0' }}>
                <summary>{t('timeline.journal')}</summary>
                <div style={{ margin: '0.25rem 0 0 1rem', overflowWrap: 'anywhere' }}>
                  {(['reversed', 'reversal', 'posted'] as const).map((k) =>
                    row.journalEntries![k] ? (
                      <p key={k} data-entry={k} style={{ margin: 0 }}>
                        {t(`timeline.journalEntries.${k}`, { id: row.journalEntries![k]! })}
                      </p>
                    ) : null,
                  )}
                  {row.events.length > 0 ? (
                    <p style={{ margin: 0 }}>{t('timeline.events', { events: row.events.join(', ') })}</p>
                  ) : null}
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
      {revisions.length > 0 ? (
        <section aria-labelledby={`${idPrefix}-revisions-title`} data-testid="lifecycle-revisions">
          <h3 id={`${idPrefix}-revisions-title`} style={{ fontSize: '1rem' }}>
            {t('revisions.title')}
          </h3>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {revisions.map((r) => (
              <li
                key={r.revision}
                id={revisionAnchor(r.revision)}
                tabIndex={-1}
                data-testid="lifecycle-revision"
                data-revision={r.revision}
              >
                <strong>{t('revisions.item', { revision: r.revision })}</strong> · {amountOf(r)}
                {r.conversion ? (
                  <p style={{ margin: '0.25rem 0' }}>
                    {t('revisions.conversion', {
                      source: formatMoney(r.conversion.sourceAmount, locale),
                      target: formatMoney(r.conversion.targetAmount, locale),
                      rate: `${r.conversion.effectiveRate.base}/${r.conversion.effectiveRate.quote} ${r.conversion.effectiveRate.value}`,
                    })}
                    {r.conversion.fees.length > 0
                      ? ` · ${t('revisions.fees', {
                          fees: r.conversion.fees.map((x) => formatMoney(x.amount, locale)).join(', '),
                        })}`
                      : ''}
                  </p>
                ) : null}
                {r.legs.length > 0 ? (
                  <ul style={{ ...mutedStyle, margin: '0.25rem 0', paddingLeft: '1.25rem' }}>
                    {r.legs.map((l, i) => (
                      <li key={`${l.accountId}-${l.role}-${i}`}>
                        {accountName(l.accountId) ?? '…'}: {formatMoney(l.amount, locale)} (
                        {t(`legRoles.${l.role}`)})
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  );
}
