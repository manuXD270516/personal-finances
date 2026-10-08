'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  cardStyle,
  cellStyle,
  errorStyle,
  inputStyle,
  mutedStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { problemOf } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { useNotificationsContext, useNotificationsFormat, type NotificationsContext } from './context';
import { loadPreferences, savePreferences, type SavedPreferences } from './service';
import {
  draftFromPreferences,
  hasQuietHoursServerError,
  preferencesChanged,
  quietHoursError,
  setChannel,
  type PreferencesDraft,
  type QuietHoursError,
} from './logic';

/** Preferencias de notificaciones del usuario en el workspace activo (se muestra bajo el formulario de perfil). */
export function NotificationPreferencesPanel() {
  const ctx = useNotificationsContext();
  return ctx ? <Loader ctx={ctx} /> : null;
}

type Notice = 'saved' | 'noChanges' | 'reloaded' | undefined;

function Loader({ ctx }: { ctx: NotificationsContext }) {
  const f = useNotificationsFormat(ctx);
  const [saved, setSaved] = useState<SavedPreferences | undefined>();
  const [draft, setDraft] = useState<PreferencesDraft | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [notice, setNotice] = useState<Notice>();
  const [localError, setLocalError] = useState<QuietHoursError | 'server' | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (after?: Notice) => {
      loadPreferences(ctx.api, ctx.base)
        .then((loaded) => {
          if (!loaded) return;
          setSaved(loaded);
          setDraft(draftFromPreferences(loaded.prefs));
          setProblem(undefined);
          setLocalError(undefined);
          setNotice(after);
        })
        .catch((err: unknown) => setProblem(problemOf(err)));
    },
    [ctx],
  );
  useEffect(() => load(), [load]);

  async function save() {
    if (!saved || !draft || busy) return;
    setNotice(undefined);
    setProblem(undefined);
    const invalid = quietHoursError(draft);
    setLocalError(invalid);
    if (invalid) return;
    if (!preferencesChanged(saved.prefs, draft)) {
      setNotice('noChanges');
      return;
    }
    setBusy(true);
    try {
      const next = await savePreferences(ctx.api, ctx.base, saved, draft);
      if (next) {
        setSaved(next);
        setDraft(draftFromPreferences(next.prefs));
      }
      setNotice('saved');
    } catch (err) {
      const p = problemOf(err);
      if (p.code === 'VALIDATION_FAILED' && hasQuietHoursServerError(p)) setLocalError('server');
      else setProblem(p);
    } finally {
      setBusy(false);
    }
  }

  return (
    <NotificationPreferencesView
      f={f}
      uiLocale={ctx.uiLocale}
      draft={draft}
      busy={busy}
      problem={problem}
      notice={notice}
      quietError={localError}
      conflict={problem?.code === 'PRECONDITION_FAILED' || problem?.code === 'CONCURRENCY_CONFLICT'}
      onChange={(next) => {
        setDraft(next);
        setNotice(undefined);
        setLocalError(undefined);
      }}
      onSave={() => void save()}
      onReload={() => load('reloaded')}
    />
  );
}

const checkStyle = { display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' } as const;

/** Vista del panel (presentacional y testeable con `renderToStaticMarkup`). */
export function NotificationPreferencesView({
  f,
  uiLocale,
  draft,
  busy = false,
  problem,
  notice,
  quietError,
  conflict = false,
  onChange,
  onSave,
  onReload,
}: {
  f: FormatContext;
  uiLocale: string;
  draft: PreferencesDraft | undefined;
  busy?: boolean;
  problem?: ApiProblemBody | undefined;
  notice?: Notice;
  quietError?: QuietHoursError | 'server' | undefined;
  conflict?: boolean;
  onChange?: (next: PreferencesDraft) => void;
  onSave?: () => void;
  onReload?: () => void;
}) {
  const id = useId();
  const quietErrorId = `${id}-quiet-error`;
  const quietHintId = `${id}-quiet-hint`;
  const channels = ['inApp', 'email'] as const;
  const typeName = (type: string) => (f.has(`prefs.types.${type}`) ? f.t(`prefs.types.${type}`) : type);

  return (
    <section
      aria-labelledby={`${id}-title`}
      style={{
        ...cardStyle,
        display: 'grid',
        gap: 'var(--pf-space-3)',
        maxWidth: '64rem',
        marginTop: 'var(--pf-space-6)',
      }}
      data-testid="notification-preferences"
    >
      <h2 id={`${id}-title`}>{f.t('prefs.title')}</h2>
      <p style={mutedStyle}>{f.t('prefs.intro')}</p>
      <p role="status" data-testid="notification-preferences-notice" style={{ margin: 0 }}>
        {notice
          ? f.t(
              notice === 'saved'
                ? 'prefs.saved'
                : notice === 'noChanges'
                  ? 'prefs.noChanges'
                  : 'prefs.reloaded',
            )
          : ''}
      </p>
      {problem ? <ProblemMessage problem={problem} locale={uiLocale} /> : null}
      {!draft ? (
        problem ? null : (
          <p aria-busy="true">{f.t('prefs.loading')}</p>
        )
      ) : (
        <form
          style={{ display: 'grid', gap: 'var(--pf-space-4)' }}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onSave?.();
          }}
        >
          <div style={tableWrapStyle}>
            <table style={tableStyle} data-testid="notification-preferences-table">
              <caption
                style={{ ...mutedStyle, textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}
              >
                {f.t('prefs.tableCaption')}
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={cellStyle}>
                    {f.t('prefs.columns.type')}
                  </th>
                  {channels.map((channel) => (
                    <th key={channel} scope="col" style={cellStyle}>
                      {f.t(`prefs.columns.${channel}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.types.map((row) => (
                  <tr key={row.type} data-type={row.type}>
                    <th scope="row" style={{ ...cellStyle, fontWeight: 600 }}>
                      {typeName(row.type)}
                    </th>
                    {channels.map((channel) => (
                      <td key={channel} style={cellStyle}>
                        <input
                          type="checkbox"
                          checked={row[channel]}
                          disabled={busy}
                          aria-label={f.t('prefs.checkbox', {
                            type: typeName(row.type),
                            channel: f.t(`prefs.channels.${channel}`),
                          })}
                          data-testid={`pref-${row.type}-${channel}`}
                          onChange={(e) => onChange?.(setChannel(draft, row.type, channel, e.target.checked))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={draft.includeDetailsInEmail}
                disabled={busy}
                aria-describedby={`${id}-privacy`}
                data-testid="pref-include-details"
                onChange={(e) => onChange?.({ ...draft, includeDetailsInEmail: e.target.checked })}
              />
              {f.t('prefs.includeDetails')}
            </label>
            <p
              id={`${id}-privacy`}
              role="note"
              style={{ ...warningStyle, margin: 0 }}
              data-testid="pref-privacy-warning"
            >
              {f.t('prefs.privacy')}
            </p>
          </div>

          <fieldset
            style={{
              border: 0,
              margin: 0,
              padding: 0,
              minWidth: 0,
              display: 'grid',
              gap: 'var(--pf-space-2)',
            }}
          >
            <legend style={{ fontWeight: 600 }}>{f.t('prefs.quiet.legend')}</legend>
            <label style={checkStyle}>
              <input
                type="checkbox"
                checked={draft.quietEnabled}
                disabled={busy}
                data-testid="pref-quiet-enabled"
                onChange={(e) => onChange?.({ ...draft, quietEnabled: e.target.checked })}
              />
              {f.t('prefs.quiet.enable')}
            </label>
            <div style={rowStyle}>
              {(['start', 'end'] as const).map((field) => (
                <div key={field} style={{ display: 'grid', gap: 'var(--pf-space-1)' }}>
                  <label htmlFor={`${id}-${field}`}>{f.t(`prefs.quiet.${field}`)}</label>
                  <input
                    id={`${id}-${field}`}
                    type="time"
                    value={draft[field]}
                    disabled={busy || !draft.quietEnabled}
                    style={inputStyle}
                    aria-invalid={quietError && draft.quietEnabled ? true : undefined}
                    aria-describedby={[quietHintId, quietError ? quietErrorId : null]
                      .filter(Boolean)
                      .join(' ')}
                    data-testid={`pref-quiet-${field}`}
                    onChange={(e) => onChange?.({ ...draft, [field]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <small id={quietHintId} style={mutedStyle} data-testid="pref-quiet-hint">
              {f.t('prefs.quiet.hint', { timezone: f.timeZone })}
            </small>
            {quietError ? (
              <p id={quietErrorId} style={errorStyle} data-testid="pref-quiet-error">
                {f.t(`prefs.errors.${quietError}`)}
              </p>
            ) : null}
          </fieldset>

          <div style={rowStyle}>
            <button type="submit" disabled={busy} data-testid="notification-preferences-save">
              {busy ? f.t('prefs.saving') : f.t('prefs.save')}
            </button>
            {conflict ? (
              <button type="button" onClick={onReload} data-testid="notification-preferences-reload">
                {f.t('prefs.reload')}
              </button>
            ) : null}
          </div>
        </form>
      )}
      {conflict && !draft ? (
        <button type="button" onClick={onReload} data-testid="notification-preferences-reload">
          {f.t('prefs.reload')}
        </button>
      ) : null}
    </section>
  );
}
