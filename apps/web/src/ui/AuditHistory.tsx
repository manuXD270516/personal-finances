'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../bff/finance-api-client';
import { ProblemMessage } from '../errors/ProblemMessage';
import { useSession } from './session-context';

/** `AuditLogEntry` del contrato (`listAuditLog`). */
export interface AuditLogEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly actor: {
    readonly type: 'USER' | 'SYSTEM' | 'WORKER';
    readonly userId: string | null;
    readonly process: string | null;
  };
  readonly action: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number | null;
  readonly changes: readonly { readonly field: string; readonly before: unknown; readonly after: unknown }[];
  readonly reason: string | null;
  readonly origin: string;
  /** Correlación de la operación: agrupa las entradas de un mismo comando (p. ej. transacción + asiento). */
  readonly correlationId?: string;
}

interface Money {
  readonly amount: string;
  readonly currency: string;
}

const isMoney = (v: unknown): v is Money =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Money).amount === 'string' &&
  typeof (v as Money).currency === 'string';

/**
 * Formatea un decimal en string SIN pasar por `number` (INV-001): separadores del locale, misma escala que el valor.
 */
export function formatDecimal(amount: string, locale: string): string {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(12345.6);
  const group = parts.find((p) => p.type === 'group')?.value ?? ',';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const negative = amount.startsWith('-');
  const [int = '0', frac] = (negative ? amount.slice(1) : amount).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? '-' : ''}${grouped}${frac === undefined ? '' : `${decimal}${frac}`}`;
}

export function formatValue(value: unknown, locale: string, empty: string): string {
  if (value === null || value === undefined || value === '') return empty;
  if (isMoney(value)) return `${formatDecimal(value.amount, locale)} ${value.currency}`;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
    return String(value);
  return JSON.stringify(value);
}

type Translate = (key: string, values?: Record<string, string>) => string;

export interface AuditHistoryViewProps {
  readonly entries: readonly AuditLogEntry[];
  /** Locale de formato (montos y fechas), p. ej. `es-BO` del workspace. */
  readonly locale: string;
  /** Zona horaria del workspace para mostrar los instantes. */
  readonly timeZone: string;
  /** Usuario de la sesión (se muestra "Tú"). */
  readonly currentUserId?: string;
  readonly t: Translate;
  readonly has: (key: string) => boolean;
}

/**
 * Lista cronológica del historial de una entidad (tarea 7.1): actor, acción, instante en la zona del workspace y diff
 * antes/después con montos formateados por locale. Presentacional: textos por catálogo i18n (`AuditHistory.*`).
 */
export function AuditHistoryView({
  entries,
  locale,
  timeZone,
  currentUserId,
  t,
  has,
}: AuditHistoryViewProps) {
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const label = (group: string, key: string) => (has(`${group}.${key}`) ? t(`${group}.${key}`) : key);
  const actorOf = (e: AuditLogEntry) =>
    e.actor.type === 'USER'
      ? e.actor.userId === currentUserId
        ? t('actor.you')
        : t('actor.user', { id: (e.actor.userId ?? '').slice(-8) })
      : t('actor.system', { process: e.actor.process ?? '' });

  return (
    <section aria-labelledby="audit-history-title" data-testid="audit-history">
      <h2 id="audit-history-title">{t('title')}</h2>
      {entries.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ol>
          {entries.map((e) => (
            <li key={e.id} data-action={e.action}>
              <p>
                <strong>
                  {has(`actions.${e.action.replaceAll('.', '_')}`)
                    ? t(`actions.${e.action.replaceAll('.', '_')}`)
                    : e.action}
                </strong>{' '}
                <span>{actorOf(e)}</span> ·{' '}
                <time dateTime={e.occurredAt}>{when.format(new Date(e.occurredAt))}</time>
              </p>
              {e.reason ? <p>{t('reason', { reason: e.reason })}</p> : null}
              {e.changes.length > 0 ? (
                <table>
                  <caption>{t('changesCaption')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('field')}</th>
                      <th scope="col">{t('before')}</th>
                      <th scope="col">{t('after')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.changes.map((c) => (
                      <tr key={c.field} data-field={c.field}>
                        <th scope="row">{label('fields', c.field)}</th>
                        <td>{formatValue(c.before, locale, t('none'))}</td>
                        <td>{formatValue(c.after, locale, t('none'))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export interface AuditHistoryProps {
  readonly workspaceId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Rol del usuario en el workspace: el log solo lo leen OWNER/EDITOR (D28); a VIEWER no se le muestra. */
  readonly role: string;
  readonly locale: string;
  readonly timeZone: string;
  /** Cambia tras cada guardado para recargar el historial. */
  readonly refreshKey?: string | number;
}

/** Pestaña "Historial" reutilizable de una entidad (`GET /audit-log?aggregateType&aggregateId`). */
export function AuditHistory(props: AuditHistoryProps) {
  const t = useTranslations('AuditHistory');
  const uiLocale = useLocale();
  const { state } = useSession();
  const [entries, setEntries] = useState<readonly AuditLogEntry[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const allowed = props.role === 'OWNER' || props.role === 'EDITOR';
  const api = state.status === 'ready' ? state.api : undefined;
  const { workspaceId, aggregateType, aggregateId, refreshKey } = props;

  useEffect(() => {
    if (!api || !allowed) return;
    const q = new URLSearchParams({ aggregateType, aggregateId, limit: '50' });
    api
      .get<{ data: AuditLogEntry[] }>(`/workspaces/${workspaceId}/audit-log?${q.toString()}`)
      .then((r) => {
        setEntries(r.data?.data ?? []);
        setProblem(undefined);
      })
      .catch((err: unknown) =>
        setProblem(err instanceof FinanceApiError ? err.problem : { code: 'SERVICE_UNAVAILABLE' }),
      );
  }, [api, allowed, workspaceId, aggregateType, aggregateId, refreshKey]);

  if (!allowed) return null;
  if (problem) return <ProblemMessage problem={problem} locale={uiLocale} />;
  if (!entries) return null;
  return (
    <AuditHistoryView
      entries={entries}
      locale={props.locale}
      timeZone={props.timeZone}
      {...(state.status === 'ready' ? { currentUserId: state.me.id } : {})}
      t={(key, values) => t(key, values)}
      has={(key) => t.has(key)}
    />
  );
}
