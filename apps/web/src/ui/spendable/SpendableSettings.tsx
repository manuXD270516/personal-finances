'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { SpendableSettings } from '../cash-flow/types';
import { cardStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import type { Category, CategoryGroup } from '../common/types';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import {
  categoryOptions,
  draftOf,
  HORIZON_MODES,
  MAX_ESSENTIAL_CATEGORIES,
  settingsApiPath,
  settingsChanged,
  toggleCategory,
  type CategoryOption,
  type SettingsDraft,
} from './settings-logic';

export type SettingsNotice = 'saved' | 'noChanges' | 'reloaded' | undefined;

export interface SpendableSettingsViewProps {
  readonly f: FormatContext;
  readonly draft: SettingsDraft;
  readonly options: readonly CategoryOption[];
  /** Solo el OWNER edita; el resto lee. */
  readonly canEdit: boolean;
  readonly busy?: boolean;
  readonly problem?: ApiProblemBody | undefined;
  readonly uiLocale: string;
  readonly notice?: SettingsNotice;
  readonly backHref?: string | undefined;
  readonly onChange?: (next: SettingsDraft) => void;
  readonly onSave?: () => void;
  readonly onReload?: () => void;
}

/**
 * Ajustes del disponible (add-cash-flow-forecast, D377/D378): modo de horizonte, esenciales presupuestados y sus categorías
 * (de gasto, no archivadas, hasta 50). El OWNER edita con control de versión; los demás roles ven los valores en solo
 * lectura. Presentacional (testeable con `renderToStaticMarkup`).
 */
export function SpendableSettingsView({
  f,
  draft,
  options,
  canEdit,
  busy = false,
  problem,
  uiLocale,
  notice,
  backHref,
  onChange,
  onSave,
  onReload,
}: SpendableSettingsViewProps) {
  const { t } = f;
  const selected = draft.essentialCategoryIds;
  const atMax = selected.length >= MAX_ESSENTIAL_CATEGORIES;
  const stale = problem?.code === 'PRECONDITION_FAILED' || problem?.code === 'CONCURRENCY_CONFLICT';
  const update = (patch: Partial<SettingsDraft>) => onChange?.({ ...draft, ...patch });
  return (
    <section style={pageStyle} aria-labelledby="spendable-settings-title" data-testid="spendable-settings">
      <header>
        <h1 id="spendable-settings-title">{t('settings.title')}</h1>
        <p style={mutedStyle}>{t('settings.subtitle')}</p>
      </header>
      {!canEdit ? (
        <p role="note" style={mutedStyle} data-testid="spendable-settings-readonly">
          {t('settings.readOnly')}
        </p>
      ) : null}
      <form
        style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-4)' }}
        onSubmit={(e) => {
          e.preventDefault();
          onSave?.();
        }}
      >
        <fieldset disabled={!canEdit || busy} style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
          <legend>{t('settings.horizon.legend')}</legend>
          {HORIZON_MODES.map((mode) => (
            <label key={mode} style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'flex-start' }}>
              <input
                type="radio"
                name="horizon-mode"
                data-testid={`settings-horizon-${mode}`}
                checked={draft.horizonMode === mode}
                onChange={() => update({ horizonMode: mode })}
              />
              <span>
                {t(`settings.horizon.${mode}`)}
                <br />
                <small style={mutedStyle}>{t(`settings.horizon.${mode}Help`)}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset disabled={!canEdit || busy} style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
          <legend>{t('settings.essentials.legend')}</legend>
          <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              data-testid="settings-subtract-essentials"
              checked={draft.subtractEssentials}
              onChange={(e) => update({ subtractEssentials: e.target.checked })}
            />
            <span>
              {t('settings.essentials.subtract')}
              <br />
              <small style={mutedStyle}>{t('settings.essentials.subtractHelp')}</small>
            </span>
          </label>
        </fieldset>

        <fieldset
          disabled={!canEdit || busy}
          style={{ display: 'grid', gap: 'var(--pf-space-2)' }}
          aria-describedby="settings-categories-count"
        >
          <legend>{t('settings.categories.legend')}</legend>
          <p id="settings-categories-count" style={mutedStyle} data-testid="settings-categories-count">
            {t('settings.categories.count', { count: selected.length, max: MAX_ESSENTIAL_CATEGORIES })}
          </p>
          {options.length === 0 ? (
            <p style={mutedStyle} data-testid="settings-categories-empty">
              {t('settings.categories.empty')}
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gap: 'var(--pf-space-1)',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 16rem), 1fr))',
              }}
            >
              {options.map((o) => {
                const checked = selected.includes(o.id);
                return (
                  <li key={o.id}>
                    <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        data-testid="settings-category"
                        data-category-id={o.id}
                        checked={checked}
                        disabled={!checked && atMax}
                        onChange={() => update({ essentialCategoryIds: toggleCategory(selected, o.id) })}
                      />
                      <span>
                        {o.label}
                        {o.archived ? (
                          <small style={mutedStyle}> · {t('settings.categories.archived')}</small>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {atMax ? (
            <p role="status" style={mutedStyle} data-testid="settings-categories-max">
              {t('settings.categories.max', { max: MAX_ESSENTIAL_CATEGORIES })}
            </p>
          ) : null}
        </fieldset>

        {problem ? (
          <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
            <ProblemMessage problem={problem} locale={uiLocale} />
            {stale && onReload ? (
              <p>
                <button type="button" onClick={onReload} data-testid="settings-reload">
                  {t('settings.reload')}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <p role="status" data-testid="settings-notice" data-notice={notice}>
            {t(`settings.notice.${notice}`)}
          </p>
        ) : null}
        <div style={rowStyle}>
          {canEdit ? (
            <button type="submit" disabled={busy} data-testid="settings-save">
              {t('settings.save')}
            </button>
          ) : null}
          {backHref ? (
            <a href={backHref} data-testid="settings-back">
              {t('settings.back')}
            </a>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function SettingsLoader({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Dashboard', ctx);
  const [saved, setSaved] = useState<SpendableSettings | undefined>();
  const [draft, setDraft] = useState<SettingsDraft | undefined>();
  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [groups, setGroups] = useState<readonly CategoryGroup[]>([]);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [notice, setNotice] = useState<SettingsNotice>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (after?: SettingsNotice) => {
      ctx.api
        .get<SpendableSettings>(settingsApiPath(ctx.base))
        .then((r) => {
          if (!r.data) return;
          setSaved(r.data);
          setDraft(draftOf(r.data));
          setProblem(undefined);
          setNotice(after);
        })
        .catch((err: unknown) => setProblem(problemOf(err)));
    },
    [ctx.api, ctx.base],
  );
  useEffect(() => load(), [load]);

  useEffect(() => {
    let cancelled = false;
    const all = new URLSearchParams({ includeArchived: 'true' });
    void Promise.all([
      listAll<Category>(ctx.api, `${ctx.base}/categories`, all).catch(() => [] as Category[]),
      listAll<CategoryGroup>(ctx.api, `${ctx.base}/category-groups`, all).catch(() => [] as CategoryGroup[]),
    ]).then(([cats, grps]) => {
      if (cancelled) return;
      setCategories(cats);
      setGroups(grps);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);

  const options = useMemo(
    () => categoryOptions(categories, groups, draft?.essentialCategoryIds ?? []),
    [categories, groups, draft?.essentialCategoryIds],
  );

  async function save() {
    if (!saved || !draft || busy) return;
    setNotice(undefined);
    setProblem(undefined);
    if (!settingsChanged(saved, draft)) {
      setNotice('noChanges');
      return;
    }
    setBusy(true);
    try {
      const r = await ctx.api.command<SpendableSettings>('PUT', settingsApiPath(ctx.base), draft, {
        ifMatch: saved.version,
      });
      if (r.data) {
        setSaved(r.data);
        setDraft(draftOf(r.data));
      }
      setNotice('saved');
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return problem ? (
      <ProblemMessage problem={problem} locale={ctx.uiLocale} />
    ) : (
      <p aria-busy="true" role="status">
        {f.t('settings.loading')}
      </p>
    );
  }
  return (
    <SpendableSettingsView
      f={f}
      draft={draft}
      options={options}
      canEdit={ctx.ws.role === 'OWNER'}
      busy={busy}
      problem={problem}
      uiLocale={ctx.uiLocale}
      notice={notice}
      backHref={ctx.href('/disponible')}
      onChange={(next) => {
        setDraft(next);
        setNotice(undefined);
      }}
      onSave={() => void save()}
      onReload={() => load('reloaded')}
    />
  );
}

/** `/disponible/ajustes`: ajustes del disponible del workspace (OWNER edita, el resto lee). */
export function SpendableSettingsPage() {
  return <WithWorkspace>{(ctx) => <SettingsLoader ctx={ctx} />}</WithWorkspace>;
}
