'use client';

import { useState } from 'react';
import type { Tag } from '../common/types';
import { badgeStyle, cardStyle, Field, formStyle, inputStyle, rowStyle } from '../common/ui';
import type { WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import type { Run } from './types';
import { ColorField, ColorSwatch } from './fields';

/** Etiquetas (FR-CLASSIFICATION tags): crear con color, renombrar, cambiar color y archivar/desarchivar. */
export function TagsPanel({
  ctx,
  f,
  tags,
  run,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  tags: readonly Tag[];
  run: Run;
}) {
  const { t } = f;
  const [form, setForm] = useState({ name: '', color: '' });
  const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section aria-labelledby="tags-title" style={{ display: 'grid', gap: '1rem' }} data-testid="tags">
      <h2 id="tags-title" style={{ fontSize: '1.1rem', margin: 0 }}>
        {t('tags')}
      </h2>
      {ctx.canEdit ? (
        <form
          style={formStyle}
          aria-labelledby="tag-new-title"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const name = form.name.trim();
            if (!name) return;
            void run(
              () =>
                ctx.api.command('POST', `${ctx.base}/tags`, {
                  name,
                  ...(form.color ? { color: form.color } : {}),
                }),
              t('tagCreated', { name }),
            ).then((ok) => ok && setForm({ ...form, name: '' }));
          }}
        >
          <h3 id="tag-new-title" style={{ margin: 0, fontSize: '1rem' }}>
            {t('newTag')}
          </h3>
          <div style={rowStyle}>
            <Field label={t('name')}>
              {(p) => (
                <input
                  {...p}
                  name="tagName"
                  maxLength={50}
                  style={inputStyle}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              )}
            </Field>
            <ColorField
              f={f}
              name="tagColor"
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
            />
            <button type="submit">{t('create')}</button>
          </div>
        </form>
      ) : null}
      <ul style={{ ...cardStyle, margin: 0, paddingLeft: '1.75rem', display: 'grid', gap: '0.375rem' }}>
        {sorted.length === 0 ? <li>{t('emptyTags')}</li> : null}
        {sorted.map((tag) => (
          <li key={tag.id} data-testid="tag" data-tag={tag.name}>
            <TagRow tag={tag} f={f} ctx={ctx} run={run} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TagRow({ tag, f, ctx, run }: { tag: Tag; f: FormatContext; ctx: WorkspaceContext; run: Run }) {
  const { t } = f;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: tag.name, color: tag.color ?? '' });
  return (
    <div style={{ display: 'grid', gap: '0.25rem' }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
        <span>
          <ColorSwatch color={tag.color} />
          {tag.name}
        </span>
        {tag.archivedAt ? <span style={badgeStyle}>{t('archivedBadge')}</span> : null}
        {ctx.canEdit ? (
          <>
            <button
              type="button"
              aria-expanded={editing}
              aria-label={t('editNamed', { name: tag.name })}
              onClick={() => {
                setDraft({ name: tag.name, color: tag.color ?? '' });
                setEditing(!editing);
              }}
            >
              {t('edit')}
            </button>
            <button
              type="button"
              aria-label={t(tag.archivedAt ? 'unarchiveNamed' : 'archiveNamed', { name: tag.name })}
              onClick={() =>
                void run(
                  () =>
                    ctx.api.command(
                      'POST',
                      `${ctx.base}/tags/${tag.id}/${tag.archivedAt ? 'unarchive' : 'archive'}`,
                      undefined,
                      { ifMatch: tag.version, idempotent: false },
                    ),
                  t(tag.archivedAt ? 'unarchived' : 'archived', { name: tag.name }),
                )
              }
            >
              {tag.archivedAt ? t('unarchive') : t('archive')}
            </button>
          </>
        ) : null}
      </span>
      {editing ? (
        <form
          style={rowStyle}
          aria-label={t('editNamed', { name: tag.name })}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.name.trim();
            void run(
              () =>
                ctx.api.command(
                  'PATCH',
                  `${ctx.base}/tags/${tag.id}`,
                  { ...(name && name !== tag.name ? { name } : {}), color: draft.color || null },
                  { ifMatch: tag.version },
                ),
              t('tagUpdated', { name: name || tag.name }),
            ).then((ok) => ok && setEditing(false));
          }}
        >
          <Field label={t('name')}>
            {(p) => (
              <input
                {...p}
                name="name"
                maxLength={50}
                style={inputStyle}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            )}
          </Field>
          <ColorField f={f} value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
          <button type="submit">{t('save')}</button>
          <button type="button" onClick={() => setEditing(false)}>
            {t('cancel')}
          </button>
        </form>
      ) : null}
    </div>
  );
}
