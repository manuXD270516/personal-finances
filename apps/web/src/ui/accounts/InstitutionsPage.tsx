'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { INSTITUTION_KINDS, type Institution, type InstitutionKind } from '../common/types';
import {
  badgeStyle,
  cardStyle,
  Field,
  formStyle,
  inputStyle,
  mutedStyle,
  pageStyle,
  rowStyle,
} from '../common/ui';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';

export function InstitutionsPage() {
  return <WithWorkspace>{(ctx) => <Institutions ctx={ctx} />}</WithWorkspace>;
}

/** Pantalla Instituciones (add-accounts-management 7.3): crear, renombrar, icono/color y archivar. */
function Institutions({ ctx }: { ctx: WorkspaceContext }) {
  const { t } = useFormat('Accounts', ctx);
  const [list, setList] = useState<readonly Institution[] | undefined>();
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'BANK' as InstitutionKind, color: '', icon: '' });
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());

  const load = useCallback(() => {
    listAll<Institution>(
      ctx.api,
      `${ctx.base}/institutions`,
      new URLSearchParams(showArchived ? { includeArchived: 'true' } : {}),
    )
      .then(setList)
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx.api, ctx.base, showArchived]);
  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command(
        'POST',
        `${ctx.base}/institutions`,
        {
          name: form.name.trim(),
          kind: form.kind,
          ...(form.color.trim() ? { color: form.color.trim() } : {}),
          ...(form.icon.trim() ? { icon: form.icon.trim() } : {}),
        },
        { idempotencyKey: key.current },
      );
      key.current = uuidv7();
      setForm({ name: '', kind: 'BANK', color: '', icon: '' });
      setStatus(t('institutions.created'));
      load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function archive(i: Institution) {
    setProblem(undefined);
    try {
      await ctx.api.command('POST', `${ctx.base}/institutions/${i.id}/archive`, undefined, {
        ifMatch: i.version,
        idempotent: false,
      });
      setStatus(t('institutions.archived', { name: i.name }));
      load();
    } catch (err) {
      setProblem(problemOf(err));
    }
  }

  async function rename(i: Institution, name: string) {
    if (!name.trim() || name.trim() === i.name) return;
    try {
      await ctx.api.command(
        'PATCH',
        `${ctx.base}/institutions/${i.id}`,
        { name: name.trim() },
        { ifMatch: i.version },
      );
      setStatus(t('institutions.saved'));
      load();
    } catch (err) {
      setProblem(problemOf(err));
    }
  }

  return (
    <section aria-labelledby="institutions-title" style={pageStyle}>
      <p>
        <a href={ctx.href('/cuentas')}>{t('backToList')}</a>
      </p>
      <h1 id="institutions-title">{t('institutions.title')}</h1>
      {ctx.canEdit ? (
        <form onSubmit={(e) => void create(e)} style={formStyle} aria-labelledby="institution-new">
          <h2 id="institution-new" style={{ margin: 0, fontSize: '1rem' }}>
            {t('institutions.new')}
          </h2>
          <div style={rowStyle}>
            <Field label={t('institutions.name')}>
              {(p) => (
                <input
                  {...p}
                  name="name"
                  required
                  maxLength={100}
                  style={inputStyle}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('institutions.kind')}>
              {(p) => (
                <select
                  {...p}
                  name="kind"
                  style={inputStyle}
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as InstitutionKind })}
                >
                  {INSTITUTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`institutions.kinds.${k}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('form.color')}>
              {(p) => (
                <input
                  {...p}
                  name="color"
                  maxLength={20}
                  style={inputStyle}
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('institutions.icon')}>
              {(p) => (
                <input
                  {...p}
                  name="icon"
                  maxLength={40}
                  style={inputStyle}
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div>
            <button type="submit" disabled={busy}>
              {t('institutions.create')}
            </button>
          </div>
        </form>
      ) : null}
      <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        {t('filters.showArchived')}
      </label>
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {list && list.length === 0 ? <p>{t('institutions.empty')}</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
        {(list ?? []).map((i) => (
          <li key={i.id} style={cardStyle} data-testid="institution-row">
            <InstitutionRow
              institution={i}
              canEdit={ctx.canEdit}
              labels={{
                kind: t(`institutions.kinds.${i.kind}`),
                archived: t('status.ARCHIVED'),
                rename: t('institutions.rename'),
                save: t('form.save'),
                archive: t('archive'),
                name: t('institutions.name'),
              }}
              onRename={(name) => void rename(i, name)}
              onArchive={() => void archive(i)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function InstitutionRow({
  institution: i,
  canEdit,
  labels,
  onRename,
  onArchive,
}: {
  institution: Institution;
  canEdit: boolean;
  labels: Record<'kind' | 'archived' | 'rename' | 'save' | 'archive' | 'name', string>;
  onRename: (name: string) => void;
  onArchive: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(i.name);
  return (
    <div style={rowStyle}>
      {i.color ? (
        <span
          aria-hidden="true"
          style={{ width: '0.75rem', height: '0.75rem', borderRadius: '50%', background: i.color }}
        />
      ) : null}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onRename(name);
            setEditing(false);
          }}
          style={rowStyle}
        >
          <label>
            {labels.name}{' '}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              maxLength={100}
            />
          </label>
          <button type="submit">{labels.save}</button>
        </form>
      ) : (
        <strong>{i.name}</strong>
      )}
      <span style={mutedStyle}>{labels.kind}</span>
      {i.archivedAt ? <span style={badgeStyle}>{labels.archived}</span> : null}
      {canEdit && !i.archivedAt ? (
        <>
          {!editing ? (
            <button type="button" onClick={() => setEditing(true)}>
              {labels.rename}
            </button>
          ) : null}
          <button type="button" onClick={onArchive}>
            {labels.archive}
          </button>
        </>
      ) : null}
    </div>
  );
}
