'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { Category, CategoryGroup, Counterparty, Tag } from '../common/types';
import { badgeStyle, cardStyle, Field, inputStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';

export function ClassificationPage() {
  return <WithWorkspace>{(ctx) => <Classification ctx={ctx} />}</WithWorkspace>;
}

const COUNTERPARTY_KINDS = [
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

/**
 * Gestión mínima de clasificación (add-classification 8.1/8.2, lo necesario para los selectores): árbol grupo →
 * categoría → subcategoría con las de sistema protegidas, archivar/desarchivar, filtro de archivadas, "aplicar
 * catálogo sugerido"; tags y contrapartes (crear, archivar, desarchivar).
 */
function Classification({ ctx }: { ctx: WorkspaceContext }) {
  const { t } = useFormat('Classification', ctx);
  const [showArchived, setShowArchived] = useState(false);
  const [groups, setGroups] = useState<readonly CategoryGroup[]>([]);
  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [tags, setTags] = useState<readonly Tag[]>([]);
  const [counterparties, setCounterparties] = useState<readonly Counterparty[]>([]);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [newCategory, setNewCategory] = useState({ groupId: '', parentId: '', name: '' });
  const [newTag, setNewTag] = useState('');
  const [newCp, setNewCp] = useState({ name: '', kind: 'MERCHANT' as (typeof COUNTERPARTY_KINDS)[number] });

  const load = useCallback(() => {
    const q = new URLSearchParams(showArchived ? { includeArchived: 'true' } : {});
    Promise.all([
      listAll<CategoryGroup>(ctx.api, `${ctx.base}/category-groups`, q),
      listAll<Category>(ctx.api, `${ctx.base}/categories`, q),
      listAll<Tag>(ctx.api, `${ctx.base}/tags`, q),
      listAll<Counterparty>(ctx.api, `${ctx.base}/counterparties`, q),
    ])
      .then(([g, c, tg, cp]) => {
        setGroups(g);
        setCategories(c);
        setTags(tg);
        setCounterparties(cp);
      })
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx.api, ctx.base, showArchived]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setProblem(undefined);
    try {
      await fn();
      setStatus(done);
      load();
    } catch (err) {
      setProblem(problemOf(err));
    }
  }

  const toggleArchive = (
    path: string,
    item: { id: string; name: string; version: number; archivedAt?: string | null },
  ) =>
    run(
      () =>
        ctx.api.command(
          'POST',
          `${ctx.base}/${path}/${item.id}/${item.archivedAt ? 'unarchive' : 'archive'}`,
          undefined,
          {
            ifMatch: item.version,
            idempotent: false,
          },
        ),
      t(item.archivedAt ? 'unarchived' : 'archived', { name: item.name }),
    );

  const createCategory = (e: FormEvent) => {
    e.preventDefault();
    const group = newCategory.groupId || groups[0]?.id;
    if (!newCategory.name.trim() || !group) return;
    void run(
      () =>
        ctx.api.command('POST', `${ctx.base}/categories`, {
          groupId: group,
          name: newCategory.name.trim(),
          ...(newCategory.parentId ? { parentId: newCategory.parentId } : {}),
        }),
      t('categoryCreated', { name: newCategory.name.trim() }),
    ).then(() => setNewCategory({ ...newCategory, name: '' }));
  };

  const parentsOfGroup = categories.filter(
    (c) => !c.parentId && c.groupId === (newCategory.groupId || groups[0]?.id) && !c.archivedAt,
  );

  return (
    <section aria-labelledby="classification-title" style={pageStyle}>
      <h1 id="classification-title">{t('title')}</h1>
      <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        {t('showArchived')}
      </label>
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}

      <section aria-labelledby="categories-title" style={cardStyle}>
        <h2 id="categories-title" style={{ fontSize: '1.1rem', marginTop: 0 }}>
          {t('categories')}
        </h2>
        {ctx.canEdit ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
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
            <form onSubmit={createCategory} style={rowStyle} aria-label={t('newCategory')}>
              <Field label={t('group')}>
                {(p) => (
                  <select
                    {...p}
                    style={inputStyle}
                    value={newCategory.groupId}
                    onChange={(e) =>
                      setNewCategory({ ...newCategory, groupId: e.target.value, parentId: '' })
                    }
                  >
                    {groups
                      .filter((g) => !g.archivedAt)
                      .map((g) => (
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
                    style={inputStyle}
                    value={newCategory.parentId}
                    onChange={(e) => setNewCategory({ ...newCategory, parentId: e.target.value })}
                  >
                    <option value="">{t('noParent')}</option>
                    {parentsOfGroup.map((c) => (
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
                    value={newCategory.name}
                    onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  />
                )}
              </Field>
              <button type="submit">{t('create')}</button>
            </form>
          </div>
        ) : null}
        {groups.map((g) => (
          <div key={g.id} data-testid="category-group">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>
              {g.name} <span style={mutedStyle}>({t(`kinds.${g.kind}`)})</span>
            </h3>
            <ul style={{ margin: 0 }}>
              {categories
                .filter((c) => c.groupId === g.id && !c.parentId)
                .map((c) => (
                  <li key={c.id}>
                    <CategoryLine
                      c={c}
                      t={t}
                      canEdit={ctx.canEdit}
                      onToggle={() => void toggleArchive('categories', c)}
                    />
                    <ul>
                      {categories
                        .filter((s) => s.parentId === c.id)
                        .map((s) => (
                          <li key={s.id}>
                            <CategoryLine
                              c={s}
                              t={t}
                              canEdit={ctx.canEdit}
                              onToggle={() => void toggleArchive('categories', s)}
                            />
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="tags-title" style={cardStyle}>
        <h2 id="tags-title" style={{ fontSize: '1.1rem', marginTop: 0 }}>
          {t('tags')}
        </h2>
        {ctx.canEdit ? (
          <form
            style={rowStyle}
            aria-label={t('newTag')}
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTag.trim()) return;
              void run(
                () => ctx.api.command('POST', `${ctx.base}/tags`, { name: newTag.trim() }),
                t('tagCreated', { name: newTag.trim() }),
              ).then(() => setNewTag(''));
            }}
          >
            <Field label={t('name')}>
              {(p) => (
                <input
                  {...p}
                  name="tagName"
                  maxLength={50}
                  style={inputStyle}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                />
              )}
            </Field>
            <button type="submit">{t('create')}</button>
          </form>
        ) : null}
        <ul>
          {tags.map((tag) => (
            <li key={tag.id}>
              {tag.name} {tag.archivedAt ? <span style={badgeStyle}>{t('archivedBadge')}</span> : null}{' '}
              {ctx.canEdit ? (
                <button type="button" onClick={() => void toggleArchive('tags', tag)}>
                  {tag.archivedAt ? t('unarchive') : t('archive')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="counterparties-title" style={cardStyle}>
        <h2 id="counterparties-title" style={{ fontSize: '1.1rem', marginTop: 0 }}>
          {t('counterparties')}
        </h2>
        {ctx.canEdit ? (
          <form
            style={rowStyle}
            aria-label={t('newCounterparty')}
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCp.name.trim()) return;
              void run(
                () =>
                  ctx.api.command('POST', `${ctx.base}/counterparties`, {
                    name: newCp.name.trim(),
                    kind: newCp.kind,
                  }),
                t('counterpartyCreated', { name: newCp.name.trim() }),
              ).then(() => setNewCp({ ...newCp, name: '' }));
            }}
          >
            <Field label={t('name')}>
              {(p) => (
                <input
                  {...p}
                  name="counterpartyName"
                  maxLength={120}
                  style={inputStyle}
                  value={newCp.name}
                  onChange={(e) => setNewCp({ ...newCp, name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('counterpartyKind')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={newCp.kind}
                  onChange={(e) =>
                    setNewCp({ ...newCp, kind: e.target.value as (typeof COUNTERPARTY_KINDS)[number] })
                  }
                >
                  {COUNTERPARTY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`counterpartyKinds.${k}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button type="submit">{t('create')}</button>
          </form>
        ) : null}
        <ul>
          {counterparties.map((c) => (
            <li key={c.id}>
              {c.name} <span style={mutedStyle}>({t(`counterpartyKinds.${c.kind}`)})</span>{' '}
              {c.archivedAt ? <span style={badgeStyle}>{t('archivedBadge')}</span> : null}{' '}
              {ctx.canEdit ? (
                <button type="button" onClick={() => void toggleArchive('counterparties', c)}>
                  {c.archivedAt ? t('unarchive') : t('archive')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function CategoryLine({
  c,
  t,
  canEdit,
  onToggle,
}: {
  c: Category;
  t: (key: string, values?: Record<string, string | number>) => string;
  canEdit: boolean;
  onToggle: () => void;
}) {
  return (
    <span data-testid="category" data-system={c.isSystem ? 'true' : 'false'}>
      {c.name} {c.isSystem ? <span style={badgeStyle}>{t('system')}</span> : null}
      {c.archivedAt ? <span style={badgeStyle}>{t('archivedBadge')}</span> : null}{' '}
      {canEdit && !c.isSystem ? (
        <button type="button" onClick={onToggle}>
          {c.archivedAt ? t('unarchive') : t('archive')}
        </button>
      ) : null}
    </span>
  );
}
