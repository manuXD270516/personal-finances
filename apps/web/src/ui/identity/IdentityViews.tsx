import type { FormEvent } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import type { Membership } from '../session-context';
import {
  BASE_CURRENCIES,
  FORMAT_LOCALES,
  SUGGESTED_TIME_ZONES,
  withCurrent,
  type PreferencesError,
  type PreferencesField,
  type PreferencesValues,
  type SettingsError,
  type SettingsField,
  type SettingsForm,
} from './logic';

/**
 * Vistas presentacionales de identidad (add-workspace-identity 8.4): sin estado ni red, testeables con
 * `renderToStaticMarkup`. Los contenedores (`forms.tsx`, `AppFrame.tsx`) cargan datos, envían con `If-Match` y
 * deciden el locale de la UI.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Mensajes de estado del formulario tras guardar o recargar. */
export type FormNotice = 'saved' | 'noChanges' | 'reloaded' | undefined;

function TimeZoneSuggestions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {SUGGESTED_TIME_ZONES.map((tz) => (
        <option key={tz} value={tz} />
      ))}
    </datalist>
  );
}

const settingsErrorText = (t: Translate, e: SettingsError | undefined): string | undefined => {
  if (!e) return undefined;
  if (e.key === 'reserve')
    return t(`errors.amount.${e.amountError}`, { scale: e.scale, currency: e.currency });
  return t(`errors.${e.key}`);
};

/** Mensaje de error de la API; con 412 ofrece cargar la versión vigente (descartando lo editado). */
function SubmitProblem({
  problem,
  uiLocale,
  reloadLabel,
  onReloadLatest,
}: {
  problem: ApiProblemBody | undefined;
  uiLocale: string;
  reloadLabel: string;
  onReloadLatest: () => void;
}) {
  if (!problem) return null;
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <ProblemMessage problem={problem} locale={uiLocale} />
      {problem.code === 'PRECONDITION_FAILED' ? (
        <p style={{ margin: 0 }}>
          <button type="button" data-testid="reload-latest" onClick={onReloadLatest}>
            {reloadLabel}
          </button>
        </p>
      ) : null}
    </div>
  );
}

export interface WorkspaceSettingsViewProps {
  readonly t: Translate;
  /** Nombres de los locales de formato (`Locales.es-BO` → "Español (Bolivia)"). */
  readonly localeName: (tag: string) => string;
  readonly uiLocale: string;
  readonly form: SettingsForm;
  readonly original: { readonly baseCurrency: string };
  readonly errors: Partial<Record<SettingsField, SettingsError>>;
  /** Solo el OWNER modifica la configuración; la API decide igualmente (403 `INSUFFICIENT_ROLE`). */
  readonly isOwner: boolean;
  readonly busy: boolean;
  readonly notice: FormNotice;
  readonly problem: ApiProblemBody | undefined;
  readonly onChange: (patch: Partial<SettingsForm>) => void;
  readonly onSubmit: () => void;
  readonly onReloadLatest: () => void;
}

/** Configuración del workspace activo (FR-IDENTITY-005): nombre, moneda base, zona, locale, mes financiero y reserva. */
export function WorkspaceSettingsView(p: WorkspaceSettingsViewProps) {
  const { t, form } = p;
  const currencyChanged = form.baseCurrency !== p.original.baseCurrency;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    p.onSubmit();
  };
  return (
    <form
      onSubmit={submit}
      aria-labelledby="ws-settings-title"
      noValidate
      data-testid="workspace-settings-form"
      style={formStyle}
    >
      <h1 id="ws-settings-title" style={{ margin: 0 }}>
        {t('settingsTitle')}
      </h1>
      {!p.isOwner ? (
        <p data-testid="settings-read-only" style={mutedStyle}>
          {t('readOnly')}
        </p>
      ) : null}
      <div style={rowStyle}>
        <Field label={t('name')} error={settingsErrorText(t, p.errors.name)}>
          {(a) => (
            <input
              {...a}
              name="name"
              maxLength={100}
              required
              value={form.name}
              style={inputStyle}
              onChange={(e) => p.onChange({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('baseCurrency')}>
          {(a) => (
            <select
              {...a}
              name="baseCurrency"
              value={form.baseCurrency}
              style={inputStyle}
              onChange={(e) => p.onChange({ baseCurrency: e.target.value })}
            >
              {withCurrent(BASE_CURRENCIES, form.baseCurrency).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {currencyChanged ? (
        <p role="note" data-testid="base-currency-warning" style={{ ...warningStyle, margin: 0 }}>
          {t('baseCurrencyWarning')}
        </p>
      ) : null}
      <div style={rowStyle}>
        <Field label={t('timezone')} hint={t('timezoneHint')} error={settingsErrorText(t, p.errors.timezone)}>
          {(a) => (
            <input
              {...a}
              name="timezone"
              list="ws-timezones"
              autoComplete="off"
              spellCheck={false}
              value={form.timezone}
              style={inputStyle}
              onChange={(e) => p.onChange({ timezone: e.target.value })}
            />
          )}
        </Field>
        <TimeZoneSuggestions id="ws-timezones" />
        <Field label={t('locale')} hint={t('localeHint')} error={settingsErrorText(t, p.errors.locale)}>
          {(a) => (
            <select
              {...a}
              name="locale"
              value={form.locale}
              style={inputStyle}
              onChange={(e) => p.onChange({ locale: e.target.value })}
            >
              {withCurrent(FORMAT_LOCALES, form.locale).map((l) => (
                <option key={l} value={l}>
                  {p.localeName(l)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        <Field
          label={t('fiscalMonthStartDay')}
          hint={t('fiscalHint')}
          error={settingsErrorText(t, p.errors.fiscal)}
        >
          {(a) => (
            <input
              {...a}
              name="fiscalMonthStartDay"
              type="number"
              min={1}
              max={28}
              step={1}
              inputMode="numeric"
              value={form.fiscal}
              style={inputStyle}
              onChange={(e) => p.onChange({ fiscal: e.target.value })}
            />
          )}
        </Field>
        <Field
          label={t('minimumReserveIn', { currency: form.baseCurrency })}
          hint={t('minimumReserveHint')}
          error={settingsErrorText(t, p.errors.reserve)}
        >
          {(a) => (
            <input
              {...a}
              name="minimumReserve"
              inputMode="decimal"
              autoComplete="off"
              value={form.reserve}
              style={inputStyle}
              onChange={(e) => p.onChange({ reserve: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        <button type="submit" disabled={p.busy} aria-busy={p.busy || undefined}>
          {p.busy ? t('saving') : t('save')}
        </button>
      </div>
      {p.notice ? (
        <p role="status" data-testid="settings-notice" style={{ margin: 0 }}>
          {t(p.notice)}
        </p>
      ) : null}
      <SubmitProblem
        problem={p.problem}
        uiLocale={p.uiLocale}
        reloadLabel={t('reloadLatest')}
        onReloadLatest={p.onReloadLatest}
      />
      <p style={{ ...mutedStyle, margin: 0 }}>{t('membersNote')}</p>
    </form>
  );
}

export interface PreferencesViewProps {
  readonly t: Translate;
  readonly localeName: (tag: string) => string;
  readonly uiLocale: string;
  readonly form: PreferencesValues;
  readonly errors: Partial<Record<PreferencesField, PreferencesError>>;
  readonly busy: boolean;
  readonly notice: FormNotice;
  readonly problem: ApiProblemBody | undefined;
  readonly onChange: (patch: Partial<PreferencesValues>) => void;
  readonly onSubmit: () => void;
  readonly onReloadLatest: () => void;
}

/** Preferencias personales (FR-IDENTITY-003): nombre visible, locale (cambia el idioma de la UI) y zona horaria. */
export function PreferencesView(p: PreferencesViewProps) {
  const { t, form } = p;
  const err = (f: PreferencesField) => (p.errors[f] ? t(`errors.${p.errors[f]}`) : undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    p.onSubmit();
  };
  return (
    <form
      onSubmit={submit}
      aria-labelledby="prefs-title"
      noValidate
      data-testid="preferences-form"
      style={formStyle}
    >
      <h1 id="prefs-title" style={{ margin: 0 }}>
        {t('title')}
      </h1>
      <Field label={t('displayName')} error={err('displayName')}>
        {(a) => (
          <input
            {...a}
            name="displayName"
            maxLength={100}
            required
            autoComplete="name"
            value={form.displayName}
            style={inputStyle}
            onChange={(e) => p.onChange({ displayName: e.target.value })}
          />
        )}
      </Field>
      <div style={rowStyle}>
        <Field label={t('locale')} hint={t('localeHint')}>
          {(a) => (
            <select
              {...a}
              name="locale"
              value={form.locale}
              style={inputStyle}
              onChange={(e) => p.onChange({ locale: e.target.value })}
            >
              {withCurrent(FORMAT_LOCALES, form.locale).map((l) => (
                <option key={l} value={l}>
                  {p.localeName(l)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('timezone')} hint={t('timezoneHint')} error={err('timezone')}>
          {(a) => (
            <input
              {...a}
              name="timezone"
              list="me-timezones"
              autoComplete="off"
              spellCheck={false}
              value={form.timezone}
              style={inputStyle}
              onChange={(e) => p.onChange({ timezone: e.target.value })}
            />
          )}
        </Field>
        <TimeZoneSuggestions id="me-timezones" />
      </div>
      <div style={rowStyle}>
        <button type="submit" disabled={p.busy} aria-busy={p.busy || undefined}>
          {p.busy ? t('saving') : t('save')}
        </button>
      </div>
      {p.notice ? (
        <p role="status" data-testid="preferences-notice" style={{ margin: 0 }}>
          {t(p.notice)}
        </p>
      ) : null}
      <SubmitProblem
        problem={p.problem}
        uiLocale={p.uiLocale}
        reloadLabel={t('reloadLatest')}
        onReloadLatest={p.onReloadLatest}
      />
    </form>
  );
}

export interface WorkspaceSelectorProps {
  readonly t: Translate;
  readonly memberships: readonly Membership[];
  readonly activeId: string | undefined;
  readonly busy: boolean;
  readonly onSelect: (workspaceId: string) => void;
}

/**
 * Selector del workspace activo (FR-IDENTITY-007). La elección vive en la sesión del BFF y viaja explícita en la
 * ruta de cada petición de negocio: el servidor nunca infiere un workspace implícito.
 */
export function WorkspaceSelector(p: WorkspaceSelectorProps) {
  const active = p.memberships.find((m) => m.workspaceId === p.activeId);
  const nameOf = (m: Membership) =>
    m.isDemo ? p.t('demoOption', { name: m.workspaceName }) : m.workspaceName;
  return (
    <>
      <label>
        {p.t('activeWorkspace')}{' '}
        <select
          data-testid="workspace-selector"
          value={p.activeId ?? ''}
          disabled={p.busy}
          aria-busy={p.busy || undefined}
          onChange={(e) => {
            // Re-elegir el workspace activo no recarga la sesión ni repite peticiones.
            if (e.target.value !== p.activeId) p.onSelect(e.target.value);
          }}
        >
          {p.memberships.map((m) => (
            <option key={m.workspaceId} value={m.workspaceId}>
              {nameOf(m)}
            </option>
          ))}
        </select>
      </label>
      {active ? (
        <span data-testid="active-role"> {p.t('role', { role: p.t(`roles.${active.role}`) })}</span>
      ) : null}
      {/* Anuncio para lectores de pantalla al cambiar de workspace (la página recarga sus datos). */}
      {/* `aria-live` sin `role="status"`: no compite con los mensajes de estado de cada pantalla. */}
      <span aria-live="polite" data-testid="workspace-status" style={visuallyHidden}>
        {p.busy ? p.t('switching') : active ? p.t('workspaceSwitched', { name: nameOf(active) }) : ''}
      </span>
    </>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;
