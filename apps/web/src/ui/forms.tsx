'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FinanceApiError, uuidv7, type ApiProblemBody } from '../bff/finance-api-client';
import { ProblemMessage } from '../errors/ProblemMessage';
import { useSession, type Me } from './session-context';

const CURRENCIES = ['BOB', 'USD', 'USDT', 'BTC', 'ETH'];
const TIMEZONES = [
  'America/La_Paz',
  'America/Sao_Paulo',
  'America/Lima',
  'America/Bogota',
  'America/Mexico_City',
  'America/New_York',
  'Europe/Madrid',
  'UTC',
];
const LOCALES = ['es-BO', 'en-US', 'pt-BR'];

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

function TimezoneOptions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {TIMEZONES.map((tz) => (
        <option key={tz} value={tz} />
      ))}
    </datalist>
  );
}

/**
 * Configuración del workspace activo (FR-IDENTITY-005). Se edita con `If-Match`: si otra pestaña guardó antes, la
 * API responde 412 y se muestra el mensaje en español del catálogo. La autorización la decide la API (403).
 */
export function WorkspaceSettingsForm() {
  const t = useTranslations('Workspace');
  const locale = useLocale();
  const { state, reload } = useSession();
  const [ws, setWs] = useState<Workspace | undefined>();
  const [etag, setEtag] = useState<string | undefined>();
  const [form, setForm] = useState({ name: '', baseCurrency: 'BOB', timezone: '', fiscal: '1', reserve: '' });
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const ready = state.status === 'ready' ? state : undefined;
  const workspaceId = ready?.active?.workspaceId;
  const api = ready?.api;

  useEffect(() => {
    if (!api || !workspaceId) return;
    api
      .get<Workspace>(`/workspaces/${workspaceId}`)
      .then((r) => {
        const w = r.data!;
        setWs(w);
        setEtag(r.etag);
        setForm({
          name: w.name,
          baseCurrency: w.baseCurrency,
          timezone: w.timezone,
          fiscal: String(w.fiscalMonthStartDay),
          reserve: w.minimumLiquidityReserve?.amount ?? '',
        });
      })
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [api, workspaceId]);

  if (!ready || !ws) return problem ? <ProblemMessage problem={problem} locale={locale} /> : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !ws || busy) return;
    setBusy(true);
    setProblem(undefined);
    setSaved(false);
    try {
      const r = await ready.api.command<Workspace>(
        'PATCH',
        `/workspaces/${ws.id}`,
        {
          name: form.name,
          baseCurrency: form.baseCurrency,
          timezone: form.timezone,
          fiscalMonthStartDay: Number(form.fiscal),
          minimumLiquidityReserve: form.reserve.trim()
            ? { amount: form.reserve.trim(), currency: form.baseCurrency }
            : null,
        },
        { ifMatch: etag ?? ws.version },
      );
      setWs(r.data);
      setEtag(r.etag);
      setSaved(true);
      if (r.data && r.data.name !== ws.name) await reload();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-labelledby="ws-settings-title">
      <h1 id="ws-settings-title">{t('settingsTitle')}</h1>
      {ws.role !== 'OWNER' ? <p>{t('readOnly')}</p> : null}
      <label>
        {t('name')}
        <input name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label>
        {t('baseCurrency')}
        <select
          name="baseCurrency"
          value={form.baseCurrency}
          onChange={(e) => setForm({ ...form, baseCurrency: e.target.value })}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        {t('timezone')}
        <input
          name="timezone"
          list="ws-timezones"
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        />
        <TimezoneOptions id="ws-timezones" />
      </label>
      <label>
        {t('fiscalMonthStartDay')}
        <input
          name="fiscalMonthStartDay"
          type="number"
          min={1}
          max={28}
          value={form.fiscal}
          onChange={(e) => setForm({ ...form, fiscal: e.target.value })}
        />
      </label>
      <label>
        {t('minimumReserve')}
        <input
          name="minimumReserve"
          inputMode="decimal"
          value={form.reserve}
          aria-describedby="reserve-hint"
          onChange={(e) => setForm({ ...form, reserve: e.target.value })}
        />
      </label>
      <small id="reserve-hint">{t('minimumReserveHint')}</small>
      <button type="submit" disabled={busy}>
        {busy ? t('saving') : t('save')}
      </button>
      {saved ? <p role="status">{t('saved')}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={locale} /> : null}
    </form>
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
        { name, baseCurrency },
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
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy}>
        {busy ? t('creating') : t('create')}
      </button>
      {created ? <p role="status">{t('created', { name: created })}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={locale} /> : null}
    </form>
  );
}

/** Preferencias personales (FR-IDENTITY-003): nombre visible, locale y zona horaria con `If-Match`. */
export function PreferencesForm() {
  const t = useTranslations('Preferences');
  const locale = useLocale();
  const { state, reload } = useSession();
  const me: Me | undefined = state.status === 'ready' ? state.me : undefined;
  const [form, setForm] = useState({
    displayName: me?.displayName ?? '',
    locale: me?.locale ?? 'es-BO',
    timezone: me?.timezone ?? '',
  });
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (state.status !== 'ready' || !me) return null;
  const { api } = state;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !me) return;
    setBusy(true);
    setProblem(undefined);
    setSaved(false);
    try {
      await api.command('PATCH', '/me', form, { ifMatch: me.version });
      setSaved(true);
      await reload();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-labelledby="prefs-title">
      <h1 id="prefs-title">{t('title')}</h1>
      <label>
        {t('displayName')}
        <input
          name="displayName"
          maxLength={100}
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
      </label>
      <label>
        {t('locale')}
        <select
          name="locale"
          value={form.locale}
          onChange={(e) => setForm({ ...form, locale: e.target.value })}
        >
          {LOCALES.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </label>
      <label>
        {t('timezone')}
        <input
          name="timezone"
          list="me-timezones"
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        />
        <TimezoneOptions id="me-timezones" />
      </label>
      <button type="submit" disabled={busy}>
        {t('save')}
      </button>
      {saved ? <p role="status">{t('saved')}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={locale} /> : null}
    </form>
  );
}
