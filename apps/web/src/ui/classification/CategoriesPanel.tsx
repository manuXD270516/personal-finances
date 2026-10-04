'use client';

import { useState, type DragEvent, type FormEvent } from 'react';
import type { Category } from '../common/types';
import { badgeStyle, cardStyle, Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import type { WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import type { ClassificationData, Run } from './types';
import { ColorField, ColorSwatch, IconField, IconGlyph } from './fields';
import { activeSiblings, categoryTree, moveBy, moveTo } from './logic';

const KINDS = ['EXPENSE', 'INCOME'] as const;
const DRAG_TYPE = 'application/x-pfos-category';

/** Árbol de categorías con creación, edición (nombre, icono, color), orden persistente y archivado. */
export function CategoriesPanel({
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
  const { groups, categories } = data;
  const activeGroups = groups.filter((g) => !g.archivedAt);
  const [form, setForm] = useState({ groupId: '', parentId: '', name: '', icon: '', color: '' });
  const [group, setGroup] = useState({ name: '', kind: 'EXPENSE' as (typeof KINDS)[number] });
  const [dragged, setDragged] = useState<string | null>(null);
  const groupId = form.groupId || activeGroups[0]?.id || '';
  const parents = categories.filter(
    (c) => !c.parentId && c.groupId === groupId && !c.archivedAt && !c.isSystem,
  );

  const createCategory = (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name || !groupId) return;
    void run(
      () =>
        ctx.api.command('POST', `${ctx.base}/categories`, {
          groupId,
          name,
          ...(form.parentId ? { parentId: form.parentId } : {}),
          ...(form.icon ? { icon: form.icon } : {}),
          ...(form.color ? { color: form.color } : {}),
        }),
      t('categoryCreated', { name }),
    ).then((ok) => ok && setForm({ ...form, name: '' }));
  };

  const createGroup = (e: FormEvent) => {
    e.preventDefault();
    const name = group.name.trim();
    if (!name) return;
    void run(
      () => ctx.api.command('POST', `${ctx.base}/category-groups`, { name, kind: group.kind }),
      t('groupCreated', { name }),
    ).then((ok) => ok && setGroup({ ...group, name: '' }));
  };

  const reorder = (c: Category, orderedIds: readonly string[] | null) => {
    if (!orderedIds) return;
    void run(
      () =>
        ctx.api.command('POST', `${ctx.base}/categories/reorder`, {
          groupId: c.groupId,
          parentId: c.parentId ?? null,
          orderedIds,
        }),
      t('reordered', { name: c.name }),
    );
  };

  const save = (c: Category, patch: { name?: string; icon: string | null; color: string | null }) =>
    run(
      () => ctx.api.command('PATCH', `${ctx.base}/categories/${c.id}`, patch, { ifMatch: c.version }),
      t('categoryUpdated', { name: patch.name ?? c.name }),
    );

  const toggleArchive = (c: Category) =>
    void run(
      () =>
        ctx.api.command(
          'POST',
          `${ctx.base}/categories/${c.id}/${c.archivedAt ? 'unarchive' : 'archive'}`,
          undefined,
          {
            ifMatch: c.version,
            idempotent: false,
          },
        ),
      t(c.archivedAt ? 'unarchived' : 'archived', { name: c.name }),
    );

  const rowProps = (c: Category) => {
    const ids = activeSiblings(categories, c).map((x) => x.id);
    return {
      c,
      f,
      canEdit: ctx.canEdit,
      position: ids.indexOf(c.id),
      count: ids.length,
      onMove: (delta: -1 | 1) => reorder(c, moveBy(ids, c.id, delta)),
      onToggle: () => toggleArchive(c),
      onSave: (patch: { name?: string; icon: string | null; color: string | null }) => save(c, patch),
      drag:
        ctx.canEdit && !c.archivedAt
          ? {
              onDragStart: (e: DragEvent) => {
                e.stopPropagation();
                e.dataTransfer.setData(DRAG_TYPE, c.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragged(c.id);
              },
              onDragOver: (e: DragEvent) => {
                if (dragged && ids.includes(dragged)) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              },
              onDrop: (e: DragEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const id = e.dataTransfer.getData(DRAG_TYPE) || dragged;
                setDragged(null);
                if (id && ids.includes(id)) reorder(c, moveTo(ids, id, ids.indexOf(c.id)));
              },
              onDragEnd: () => setDragged(null),
            }
          : undefined,
    };
  };

  return (
    <section
      aria-labelledby="categories-title"
      style={{ display: 'grid', gap: '1rem' }}
      data-testid="categories"
    >
      <h2 id="categories-title" style={{ fontSize: '1.1rem', margin: 0 }}>
        {t('categories')}
      </h2>
      {ctx.canEdit ? (
        <>
          <div style={{ ...cardStyle, display: 'grid', gap: '0.5rem' }}>
            <p style={{ ...mutedStyle, margin: 0 }}>{t('catalogHint')}</p>
            <div>
              <button
                type="button"
                onClick={() =>
                  void run(
                    () => ctx.api.command('POST', `${ctx.base}/categories/apply-default-catalog`, {}),
                    t('catalogApplied'),
                  )
                }
              >
                {t('applyCatalog')}
              </button>
            </div>
          </div>
          <form onSubmit={createCategory} style={formStyle} aria-labelledby="category-new-title" noValidate>
            <h3 id="category-new-title" style={{ margin: 0, fontSize: '1rem' }}>
              {t('newCategory')}
            </h3>
            <div style={rowStyle}>
              <Field label={t('group')}>
                {(p) => (
                  <select
                    {...p}
                    name="groupId"
                    style={inputStyle}
                    value={groupId}
                    onChange={(e) => setForm({ ...form, groupId: e.target.value, parentId: '' })}
                  >
                    {activeGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({t(`kinds.${g.kind}`)})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t('parent')}>
                {(p) => (
                  <select
                    {...p}
                    name="parentId"
                    style={inputStyle}
                    value={form.parentId}
                    onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                  >
                    <option value="">{t('noParent')}</option>
                    {parents.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t('name')}>
                {(p) => (
                  <input
                    {...p}
                    name="categoryName"
                    maxLength={80}
                    style={inputStyle}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <div style={rowStyle}>
              <IconField f={f} value={form.icon} onChange={(icon) => setForm({ ...form, icon })} />
              <ColorField f={f} value={form.color} onChange={(color) => setForm({ ...form, color })} />
              <button type="submit">{t('create')}</button>
            </div>
          </form>
          <form onSubmit={createGroup} style={formStyle} aria-labelledby="group-new-title" noValidate>
            <h3 id="group-new-title" style={{ margin: 0, fontSize: '1rem' }}>
              {t('newGroup')}
            </h3>
            <div style={rowStyle}>
              <Field label={t('name')}>
                {(p) => (
                  <input
                    {...p}
                    name="groupName"
                    maxLength={80}
                    style={inputStyle}
                    value={group.name}
                    onChange={(e) => setGroup({ ...group, name: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('kind')}>
                {(p) => (
                  <select
                    {...p}
                    name="groupKind"
                    style={inputStyle}
                    value={group.kind}
                    onChange={(e) => setGroup({ ...group, kind: e.target.value as (typeof KINDS)[number] })}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`kinds.${k}`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <button type="submit">{t('create')}</button>
            </div>
          </form>
          <p style={{ ...mutedStyle, margin: 0 }}>{t('reorderHint')}</p>
        </>
      ) : null}
      {categoryTree(groups, categories).map(({ group: g, categories: nodes }) => (
        <section
          key={g.id}
          aria-labelledby={`group-${g.id}`}
          style={cardStyle}
          data-testid="category-group"
          data-group={g.name}
        >
          <h3 id={`group-${g.id}`} style={{ fontSize: '1rem', marginTop: 0 }}>
            {g.name} <span style={mutedStyle}>({t(`kinds.${g.kind}`)})</span>
            {g.archivedAt ? <span style={badgeStyle}> {t('archivedBadge')}</span> : null}
          </h3>
          {nodes.length === 0 ? <p style={mutedStyle}>{t('emptyGroup')}</p> : null}
          <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.25rem' }}>
            {nodes.map(({ category, children }) => {
              const props = rowProps(category);
              return (
                <li key={category.id} {...props.drag} draggable={!!props.drag}>
                  <CategoryRow {...props} />
                  {children.length > 0 ? (
                    <ul style={{ paddingLeft: '1.25rem', display: 'grid', gap: '0.25rem' }}>
                      {children.map((s) => {
                        const child = rowProps(s);
                        return (
                          <li key={s.id} {...child.drag} draggable={!!child.drag}>
                            <CategoryRow {...child} />
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}

/**
 * Fila de una categoría: icono y color decorativos, nombre, marcas (sistema protegida, archivada) y acciones:
 * editar, subir/bajar (alternativa por teclado a arrastrar) y archivar/desarchivar. Las de sistema solo cambian
 * icono, color y orden (`SYSTEM_CATEGORY_IMMUTABLE`).
 */
export function CategoryRow({
  c,
  f,
  canEdit,
  position,
  count,
  onMove,
  onToggle,
  onSave,
}: {
  c: Category;
  f: FormatContext;
  canEdit: boolean;
  /** Posición entre las hermanas activas (−1 si está archivada). */
  position: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onToggle: () => void;
  onSave: (patch: { name?: string; icon: string | null; color: string | null }) => Promise<boolean>;
  /** Manejadores de arrastre del `<li>` contenedor (no los usa la fila). */
  drag?: unknown;
}) {
  const { t } = f;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: c.name, icon: c.icon ?? '', color: c.color ?? '' });
  const archived = !!c.archivedAt;
  return (
    <div
      data-testid="category"
      data-category={c.name}
      data-system={c.isSystem ? 'true' : 'false'}
      data-archived={archived ? 'true' : 'false'}
      style={{ display: 'grid', gap: '0.25rem' }}
    >
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
        <span data-testid="category-name">
          <ColorSwatch color={c.color} />
          <IconGlyph icon={c.icon} />
          {c.name}
        </span>
        {c.isSystem ? <span style={badgeStyle}>{t('system')}</span> : null}
        {archived ? <span style={badgeStyle}>{t('archivedBadge')}</span> : null}
        {canEdit ? (
          <>
            {!archived ? (
              <>
                <button
                  type="button"
                  aria-label={t('moveUp', { name: c.name })}
                  disabled={position <= 0}
                  onClick={() => onMove(-1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t('moveDown', { name: c.name })}
                  disabled={position < 0 || position >= count - 1}
                  onClick={() => onMove(1)}
                >
                  ↓
                </button>
              </>
            ) : null}
            <button
              type="button"
              aria-expanded={editing}
              aria-label={t('editNamed', { name: c.name })}
              onClick={() => {
                setDraft({ name: c.name, icon: c.icon ?? '', color: c.color ?? '' });
                setEditing(!editing);
              }}
            >
              {t('edit')}
            </button>
            {!c.isSystem ? (
              <button
                type="button"
                aria-label={t(archived ? 'unarchiveNamed' : 'archiveNamed', { name: c.name })}
                onClick={onToggle}
              >
                {archived ? t('unarchive') : t('archive')}
              </button>
            ) : null}
          </>
        ) : null}
      </span>
      {editing ? (
        <form
          style={{ ...rowStyle, ...mutedStyle }}
          aria-label={t('editNamed', { name: c.name })}
          data-testid="category-edit-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.name.trim();
            void onSave({
              ...(c.isSystem || !name || name === c.name ? {} : { name }),
              icon: draft.icon || null,
              color: draft.color || null,
            }).then((ok) => ok && setEditing(false));
          }}
        >
          <Field label={t('name')} hint={c.isSystem ? t('systemNameHint') : undefined}>
            {(p) => (
              <input
                {...p}
                name="name"
                maxLength={80}
                style={inputStyle}
                value={draft.name}
                disabled={c.isSystem}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            )}
          </Field>
          <IconField f={f} value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} />
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
