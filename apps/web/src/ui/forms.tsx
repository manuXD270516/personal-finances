'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { FinanceApiError, uuidv7, type ApiProblemBody } from '../bff/finance-api-client';
import { ProblemMessage } from '../errors/ProblemMessage';
import { AuditHistory } from './AuditHistory';
import { pageStyle } from './common/ui';
import { PreferencesView, WorkspaceSettingsView, type FormNotice } from './identity/IdentityViews';
import {
  BASE_CURRENCIES,
  buildPreferencesPatch,
  buildSettingsPatch,
  settingsFormOf,
  switchLocalePath,
  uiLocaleFor,
  type PreferencesError,
  type PreferencesField,
  type PreferencesValues,
  type SettingsError,
  type SettingsField,
  type SettingsForm,
} from './identity/logic';
import { useSession } from './session-context';

interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly baseCurrency: string;
  readonly timezone: string;
  readonly locale: string;
  readonly fiscalMonthStartDay: number;
  readonly minimumLiquidityReserve: { amount: string; currency: string } | null;
  readonly role: string;
  readonly version: number;
}

const problemOf = (err: unknown): ApiProblemBody =>
  err instanceof FinanceApiError ? err.problem : { code: 'SERVICE_UNAVAILABLE' };

/** Query con la que la página de preferencias, ya en el idioma nuevo, confirma que se guardó. */
const SAVED_FLAG = 'guardado';

/**
 * Configuración del workspace activo (FR-IDENTITY-005). Se edita con `If-Match`: si otra pestaña guardó antes, la
 * API responde 412 y se muestra el mensaje del catálogo con la opción de cargar la versión vigente. Solo se envían
 * los campos que cambiaron (merge-patch). La autorización la decide la API (403 `INSUFFICIENT_ROLE`).
 */
export function WorkspaceSettingsForm() {
  const t = useTranslations('Workspace');
  const tLocales = useTranslations('Locales');
  const locale = useLocale();
  const { state, reload } = useSession();
  const [ws, setWs] = useState<Workspace | undefined>();
  const [etag, setEtag] = useState<string | undefined>();
  const [form, setForm] = useState<SettingsForm | undefined>();
  const [errors, setErrors] = useState<Partial<Record<SettingsField, SettingsError>>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [notice, setNotice] = useState<FormNotice>();
  const [busy, setBusy] = useState(false);

  const ready = state.status === 'ready' ? state : undefined;
  const workspaceId = ready?.active?.workspaceId;
  const api = ready?.api;

  const show = useCallback((w: Workspace, tag: string | undefined) => {
    setWs(w);
    setEtag(tag);
    setForm(settingsFormOf(w, w.locale));
    setErrors({});
  }, []);

  const load = useCallback(
    async (after?: FormNotice) => {
      if (!api || !workspaceId) return;
      try {
        const r = await api.get<Workspace>(`/workspaces/${workspaceId}`);
        show(r.data!, r.etag);
        setProblem(undefined);
        setNotice(after);
      } catch (err) {
        setProblem(problemOf(err));
      }
    },
    [api, workspaceId, show],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Mientras llega el workspace recién elegido en el selector no se muestra el formulario del anterior.
  if (!ready || !ws || !form || ws.id !== workspaceId)
    return problem ? <ProblemMessage problem={problem} locale={locale} /> : null;

  async function submit() {
    if (!ready || !ws || !form || busy) return;
    setProblem(undefined);
    setNotice(undefined);
    const built = buildSettingsPatch(ws, form, { locale: ws.locale });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    if (Object.keys(built.patch).length === 0) {
      setNotice('noChanges');
      return;
    }
    setBusy(true);
    try {
      const r = await ready.api.command<Workspace>('PATCH', `/workspaces/${ws.id}`, built.patch, {
        ifMatch: etag ?? ws.version,
      });
      show(r.data!, r.etag);
      setNotice('saved');
      // El nombre aparece en el selector de workspace (sesión).
      if (r.data && r.data.name !== ws.name) await reload();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={pageStyle}>
      <WorkspaceSettingsView
        t={(key, values) => t(key as never, values as never)}
        localeName={(tag) => (tLocales.has(tag as never) ? tLocales(tag as never) : tag)}
        uiLocale={locale}
        form={form}
        original={ws}
        errors={errors}
        isOwner={ws.role === 'OWNER'}
        busy={busy}
        notice={notice}
        problem={problem}
        onChange={(patch) => {
          setForm((prev) => (prev ? { ...prev, ...patch } : prev));
          setNotice(undefined);
        }}
        onSubmit={() => void submit()}
        onReloadLatest={() => void load('reloaded')}
      />
      <AuditHistory
        workspaceId={ws.id}
        aggregateType="Workspace"
        aggregateId={ws.id}
        role={ws.role}
        locale={ws.locale}
        timeZone={ws.timezone}
        refreshKey={ws.version}
      />
    </section>
  );
}

/**
 * Alta de un workspace (FR-IDENTITY-004). La `Idempotency-Key` es del INTENTO (se conserva hasta que el alta se
 * completa): un doble clic o un reintento producen un único workspace (INV-027, TC-PLATFORM-API-009).
 */
export function CreateWorkspaceForm() {
  const t = useTranslations('Workspace');
  const locale = useLocale();
  const { state, reload } = useSession();
  const attemptKey = useRef(uuidv7());
  const inFlight = useRef(false);
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('BOB');
  // Catálogo sugerido de categorías (add-classification 8.3): opcional; las de sistema se crean siempre.
  const [seedCatalog, setSeedCatalog] = useState(true);
  const [created, setCreated] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);

  if (state.status !== 'ready') return null;
  const { api } = state;

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Un segundo clic mientras el primero sigue en vuelo no envía otra petición.
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await api.command<{ id: string; name: string }>(
        'POST',
        '/workspaces',
        { name, baseCurrency, seedDefaultCategories: seedCatalog },
        { idempotencyKey: attemptKey.current },
      );
      setCreated(r.data?.name ?? name);
      attemptKey.current = uuidv7(); // intento completado: el siguiente envío es otro workspace
      setName('');
      await reload();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-labelledby="ws-create-title">
      <h1 id="ws-create-title">{t('createTitle')}</h1>
      <label>
        {t('name')}
        <input name="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t('baseCurrency')}
        <select name="baseCurrency" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
          {BASE_CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          name="seedDefaultCategories"
          checked={seedCatalog}
          onChange={(e) => setSeedCatalog(e.target.checked)}
        />
        {t('seedCatalog')}
      </label>
      <button type="submit" disabled={busy}>
        {busy ? t('creating') : t('create')}
      </button>
      {created ? <p role="status">{t('created', { name: created })}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={locale} /> : null}
    </form>
  );
}

/**
 * Preferencias personales (FR-IDENTITY-003): nombre visible, locale y zona horaria con `If-Match`. El locale
 * elegido es también el idioma de la UI: al guardarlo se navega a la misma pantalla en ese idioma (`/`, `/en`,
 * `/pt`) y se fija la cookie de locale de next-intl para que las rutas sin prefijo no vuelvan al idioma anterior.
 */
export function PreferencesForm() {
  const t = useTranslations('Preferences');
  const tLocales = useTranslations('Locales');
  const locale = useLocale();
  const { state, reload } = useSession();
  const me = state.status === 'ready' ? state.me : undefined;
  const [form, setForm] = useState<PreferencesValues>(() => ({
    displayName: me?.displayName ?? '',
    locale: me?.locale ?? 'es-BO',
    timezone: me?.timezone ?? '',
  }));
  const [errors, setErrors] = useState<Partial<Record<PreferencesField, PreferencesError>>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [notice, setNotice] = useState<FormNotice>();
  const [busy, setBusy] = useState(false);
  const pendingNotice = useRef<FormNotice>(undefined);
  const shownVersion = useRef<string | undefined>(me ? `${me.id}:${me.version}` : undefined);

  // Cada versión nueva del perfil (guardado, recarga tras 412) reemplaza lo editado.
  useEffect(() => {
    if (!me) return;
    const key = `${me.id}:${me.version}`;
    if (shownVersion.current !== key) {
      shownVersion.current = key;
      setForm({ displayName: me.displayName, locale: me.locale, timezone: me.timezone });
      setErrors({});
    }
    if (pendingNotice.current) {
      setNotice(pendingNotice.current);
      pendingNotice.current = undefined;
    }
  }, [me]);

  // Tras cambiar de idioma, la página nueva confirma el guardado (`?guardado=1`) y limpia la URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SAVED_FLAG)) return;
    setNotice('saved');
    url.searchParams.delete(SAVED_FLAG);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  if (state.status !== 'ready' || !me) return null;
  const { api } = state;

  async function submit() {
    if (busy || !me) return;
    setProblem(undefined);
    setNotice(undefined);
    const built = buildPreferencesPatch(
      { displayName: me.displayName, locale: me.locale, timezone: me.timezone },
      form,
    );
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    if (Object.keys(built.patch).length === 0) {
      setNotice('noChanges');
      return;
    }
    setBusy(true);
    try {
      await api.command('PATCH', '/me', built.patch, { ifMatch: me.version });
      const target = uiLocaleFor(form.locale);
      if (built.patch.locale !== undefined && target !== locale) {
        // Cookie de next-intl: sin ella, una ruta sin prefijo volvería a negociar el idioma anterior.
        document.cookie = `NEXT_LOCALE=${target}; path=/; SameSite=Lax`;
        const here = new URL(window.location.href);
        here.searchParams.set(SAVED_FLAG, '1');
        window.location.assign(switchLocalePath(`${here.pathname}${here.search}`, target));
        return;
      }
      pendingNotice.current = 'saved';
      await reload();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={pageStyle}>
      <PreferencesView
        t={(key, values) => t(key as never, values as never)}
        localeName={(tag) => (tLocales.has(tag as never) ? tLocales(tag as never) : tag)}
        uiLocale={locale}
        form={form}
        errors={errors}
        busy={busy}
        notice={notice}
        problem={problem}
        onChange={(patch) => {
          setForm((prev) => ({ ...prev, ...patch }));
          setNotice(undefined);
        }}
        onSubmit={() => void submit()}
        onReloadLatest={() => {
          pendingNotice.current = 'reloaded';
          setProblem(undefined);
          void reload();
        }}
      />
    </section>
  );
}
