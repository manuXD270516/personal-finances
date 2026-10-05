'use client';

import { useState, type FormEvent } from 'react';
import type { Counterparty } from '../common/types';
import { badgeStyle, cardStyle, Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import type { WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { categoryOptions } from '../transactions/catalogs';
import { ClassificationDetail, type DetailMode } from './ClassificationDetail';
import type { ClassificationData, Run } from './types';
import { parseAliases } from './logic';

export const COUNTERPARTY_KINDS = [
  'MERCHANT',
  'PERSON',
  'EMPLOYER',
  'SERVICE_PROVIDER',
  'FINANCIAL_INSTITUTION',
  'LENDER',
  'EXCHANGE',
  'P2P_TRADER',
  'GOVERNMENT',
  'OTHER',
] as const;

interface Draft {
  readonly name: string;
  readonly kind: string;
  readonly aliases: string;
  readonly defaultCategoryId: string;
}

const empty: Draft = { name: '', kind: 'MERCHANT', aliases: '', defaultCategoryId: '' };

/** Contrapartes: tipo, alias (reconocimiento en descripciones) y categoría por defecto; archivar/desarchivar. */
export function CounterpartiesPanel({
  ctx,
  f,
  data,
  run,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  data: ClassificationData;
  run: Run;
}) {
  const { t } = f;
  const [form, setForm] = useState<Draft>(empty);
  const [error, setError] = useState<string | undefined>();
  const sorted = [...data.counterparties].sort((a, b) => a.name.localeCompare(b.name));
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));

  const create = (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const aliases = parseAliases(form.aliases);
    if (!aliases.ok) return setError(t(`errors.${aliases.error}`));
    setError(undefined);
    void run(
      () =>
        ctx.api.command('POST', `${ctx.base}/counterparties`, {
          name,
          kind: form.kind,
          ...(aliases.aliases.length ? { aliases: aliases.aliases } : {}),
          ...(form.defaultCategoryId ? { defaultCategoryId: form.defaultCategoryId } : {}),
        }),
      t('counterpartyCreated', { name }),
    ).then((ok) => ok && setForm(empty));
  };

  return (
    <section
      aria-labelledby="counterparties-title"
      style={{ display: 'grid', gap: '1rem' }}
      data-testid="counterparties"
    >
      <h2 id="counterparties-title" style={{ fontSize: '1.1rem', margin: 0 }}>
        {t('counterparties')}
      </h2>
      {ctx.canEdit ? (
        <form style={formStyle} aria-labelledby="cp-new-title" onSubmit={create} noValidate>
          <h3 id="cp-new-title" style={{ margin: 0, fontSize: '1rem' }}>
            {t('newCounterparty')}
          </h3>
          <CounterpartyFields f={f} data={data} draft={form} onChange={setForm} aliasError={error} />
          <div>
            <button type="submit">{t('create')}</button>
          </div>
        </form>
      ) : null}
      <ul style={{ ...cardStyle, margin: 0, paddingLeft: '1.75rem', display: 'grid', gap: '0.5rem' }}>
        {sorted.length === 0 ? <li>{t('emptyCounterparties')}</li> : null}
        {sorted.map((c) => (
          <li key={c.id} data-testid="counterparty" data-counterparty={c.name}>
            <CounterpartyRow
              c={c}
              f={f}
              ctx={ctx}
              data={data}
              run={run}
              categoryName={(id) => categoryName.get(id) ?? t('unknownCategory')}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Campos comunes del alta y la edición: nombre, tipo, alias y categoría por defecto (solo activas). */
export function CounterpartyFields({
  f,
  data,
  draft,
  onChange,
  aliasError,
}: {
  f: FormatContext;
  data: ClassificationData;
  draft: Draft;
  onChange: (d: Draft) => void;
  aliasError?: string | undefined;
}) {
  const { t } = f;
  const groups = (['EXPENSE', 'INCOME'] as const).flatMap((kind) =>
    categoryOptions(data.categories, data.groups, kind).map((g) => ({ ...g, kind })),
  );
  return (
    <>
      <div style={rowStyle}>
        <Field label={t('name')}>
          {(p) => (
            <input
              {...p}
              name="counterpartyName"
              maxLength={120}
              style={inputStyle}
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('counterpartyKind')}>
          {(p) => (
            <select
              {...p}
              name="counterpartyKind"
              style={inputStyle}
              value={draft.kind}
              onChange={(e) => onChange({ ...draft, kind: e.target.value })}
            >
              {COUNTERPARTY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`counterpartyKinds.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('defaultCategory')} hint={t('defaultCategoryHint')}>
          {(p) => (
            <select
              {...p}
              name="defaultCategoryId"
              style={inputStyle}
              value={draft.defaultCategoryId}
              onChange={(e) => onChange({ ...draft, defaultCategoryId: e.target.value })}
            >
              <option value="">{t('noDefaultCategory')}</option>
              {groups.map((g) => (
                <optgroup key={`${g.kind}-${g.group}`} label={`${g.group} (${t(`kinds.${g.kind}`)})`}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label={t('aliases')} hint={t('aliasesHint')} error={aliasError}>
        {(p) => (
          <textarea
            {...p}
            name="aliases"
            rows={2}
            style={inputStyle}
            value={draft.aliases}
            onChange={(e) => onChange({ ...draft, aliases: e.target.value })}
          />
        )}
      </Field>
    </>
  );
}

function CounterpartyRow({
  c,
  f,
  ctx,
  data,
  run,
  categoryName,
}: {
  c: Counterparty;
  f: FormatContext;
  ctx: WorkspaceContext;
  data: ClassificationData;
  run: Run;
  categoryName: (id: string) => string;
}) {
  const { t } = f;
  const [mode, setMode] = useState<DetailMode | null>(null);
  const editing = mode === 'edit';
  const setEditing = (on: boolean) => setMode(on ? 'edit' : null);
  const toDraft = (): Draft => ({
    name: c.name,
    kind: c.kind,
    aliases: (c.aliases ?? []).join(', '),
    defaultCategoryId: c.defaultCategoryId ?? '',
  });
  const [draft, setDraft] = useState<Draft>(toDraft);
  const [error, setError] = useState<string | undefined>();
  return (
    <div style={{ display: 'grid', gap: '0.25rem' }}>
      <CounterpartySummary c={c} f={f} categoryName={categoryName} />
      {ctx.canEdit ? (
        <span style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            aria-expanded={editing}
            aria-label={t('editNamed', { name: c.name })}
            onClick={() => {
              setDraft(toDraft());
              setError(undefined);
              setEditing(!editing);
            }}
          >
            {t('edit')}
          </button>
          <button
            type="button"
            aria-label={t(c.archivedAt ? 'unarchiveNamed' : 'archiveNamed', { name: c.name })}
            onClick={() =>
              void run(
                () =>
                  ctx.api.command(
                    'POST',
                    `${ctx.base}/counterparties/${c.id}/${c.archivedAt ? 'unarchive' : 'archive'}`,
                    undefined,
                    { ifMatch: c.version, idempotent: false },
                  ),
                t(c.archivedAt ? 'unarchived' : 'archived', { name: c.name }),
              )
            }
          >
            {c.archivedAt ? t('unarchive') : t('archive')}
          </button>
        </span>
      ) : null}
      <span>
        <button
          type="button"
          aria-expanded={mode === 'lifecycle'}
          aria-label={t('lifecycleNamed', { name: c.name })}
          onClick={() => setMode(mode === 'lifecycle' ? null : 'lifecycle')}
        >
          {t('lifecycle')}
        </button>
      </span>
      {mode ? (
        <ClassificationDetail
          ctx={ctx}
          f={f}
          mode={mode}
          name={c.name}
          path={`counterparties/${c.id}`}
          version={c.version}
          idPrefix={`counterparty-${c.id}`}
          {...(ctx.canEdit ? { edit: editForm() } : {})}
        />
      ) : null}
    </div>
  );

  function editForm() {
    return (
      <form
        style={{ ...formStyle, padding: '0.5rem' }}
        aria-label={t('editNamed', { name: c.name })}
        data-testid="counterparty-edit-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const aliases = parseAliases(draft.aliases);
          if (!aliases.ok) return setError(t(`errors.${aliases.error}`));
          setError(undefined);
          const name = draft.name.trim();
          void run(
            () =>
              ctx.api.command(
                'PATCH',
                `${ctx.base}/counterparties/${c.id}`,
                {
                  ...(name && name !== c.name ? { name } : {}),
                  kind: draft.kind,
                  aliases: aliases.aliases,
                  defaultCategoryId: draft.defaultCategoryId || null,
                },
                { ifMatch: c.version },
              ),
            t('counterpartyUpdated', { name: name || c.name }),
          ).then((ok) => ok && setEditing(false));
        }}
      >
        <CounterpartyFields f={f} data={data} draft={draft} onChange={setDraft} aliasError={error} />
        <div style={rowStyle}>
          <button type="submit">{t('save')}</button>
          <button type="button" onClick={() => setEditing(false)}>
            {t('cancel')}
          </button>
        </div>
      </form>
    );
  }
}

/** Resumen de una contraparte: nombre, tipo, marca de archivada, alias y categoría por defecto. */
export function CounterpartySummary({
  c,
  f,
  categoryName,
}: {
  c: Counterparty;
  f: FormatContext;
  categoryName: (id: string) => string;
}) {
  const { t } = f;
  return (
    <span>
      <strong>{c.name}</strong> <span style={mutedStyle}>({t(`counterpartyKinds.${c.kind}`)})</span>{' '}
      {c.archivedAt ? <span style={badgeStyle}>{t('archivedBadge')}</span> : null}
      {c.aliases && c.aliases.length > 0 ? (
        <span style={{ ...mutedStyle, display: 'block' }} data-testid="counterparty-aliases">
          {t('aliasesList', { aliases: c.aliases.join(', ') })}
        </span>
      ) : null}
      {c.defaultCategoryId ? (
        <span style={{ ...mutedStyle, display: 'block' }} data-testid="counterparty-default-category">
          {t('defaultCategoryIs', { name: categoryName(c.defaultCategoryId) })}
        </span>
      ) : null}
    </span>
  );
}
