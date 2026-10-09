'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemMessage } from '../../errors/error-messages';
import type { Transaction } from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { categoryOptions, type Catalogs } from './catalogs';
import {
  BULK_EDIT_MAX_ITEMS,
  bulkChanges,
  bulkEditItems,
  bulkFilter,
  CLEAR_COUNTERPARTY,
  conflictingTags,
  EMPTY_BULK_DRAFT,
  itemErrors,
  splitPreview,
  type BulkDraft,
  type BulkPreview,
} from './bulk-edit-logic';
import type { TransactionFilters } from './logic';
import { describe } from './TransactionsListView';

/** Qué transacciones alcanza la edición: las elegidas en el registro o todo lo que devuelve el filtro (≤ 500). */
export type BulkTarget =
  { readonly kind: 'items'; readonly ids: readonly string[] } | { readonly kind: 'filter' };

export type BulkFocus = 'category' | 'tags' | 'counterparty' | 'state';

const MAX_LISTED_ERRORS = 20;

interface Applied {
  readonly count: number;
  readonly bulkOperationId: string;
}

/**
 * Panel de edición masiva (openspec add-bulk-edit 6.1): cambios → vista previa obligatoria (cantidad, aplicables y no
 * aplicables con su motivo) → ejecución todo o nada → resultado o errores por ítem. La ejecución envía exactamente las
 * transacciones y versiones que la vista previa mostró (equivale a `If-Match` por ítem).
 */
export function BulkEditPanel({
  ctx,
  f,
  catalogs,
  target: initialTarget,
  filters,
  customFilter,
  known,
  focus,
  onClose,
  onApplied,
  onTargetChange,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  catalogs: Catalogs;
  target: BulkTarget;
  filters: TransactionFilters;
  customFilter: Parameters<typeof bulkFilter>[1];
  /** Transacciones cargadas en el registro, para mostrar su descripción en motivos y errores. */
  known: ReadonlyMap<string, Transaction>;
  focus: BulkFocus;
  onClose: () => void;
  onApplied: (result: Applied) => void;
  /** Avisa al registro cuando la selección cambia (p. ej. al quitar las no aplicables). */
  onTargetChange?: (ids: readonly string[]) => void;
}) {
  const { t } = f;
  const [target, setTarget] = useState<BulkTarget>(initialTarget);
  const [draft, setDraft] = useState<BulkDraft>(EMPTY_BULK_DRAFT);
  const [phase, setPhase] = useState<'edit' | 'previewing' | 'preview' | 'applying' | 'done'>('edit');
  const [preview, setPreview] = useState<BulkPreview | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [sentIds, setSentIds] = useState<readonly string[]>([]);
  const [applied, setApplied] = useState<Applied | undefined>();
  const form = useRef<HTMLFormElement>(null);
  // El botón de acción que abrió el panel lleva el foco al control de ese cambio.
  useEffect(() => {
    const name = {
      category: 'categoryId',
      tags: 'addTagIds',
      counterparty: 'counterparty',
      state: 'cleared',
    }[focus];
    form.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
  }, [focus]);

  const changes = bulkChanges(draft);
  const conflicts = conflictingTags(draft);
  const cats = useMemo(
    () => [
      ...categoryOptions(catalogs.categories, catalogs.groups, 'EXPENSE'),
      ...categoryOptions(catalogs.categories, catalogs.groups, 'INCOME'),
    ],
    [catalogs.categories, catalogs.groups],
  );
  const activeTags = catalogs.tags.filter((x) => !x.archivedAt);
  const counterparties = catalogs.counterparties.filter((c) => !c.archivedAt);
  const parts = preview ? splitPreview(preview) : undefined;
  const nameOf = (id: string): string => {
    const tx = known.get(id);
    return tx ? describe(tx, catalogs.names, f) : t('bulk.unknownItem', { id: id.slice(0, 8) });
  };

  const selection = (): unknown =>
    target.kind === 'items'
      ? { items: target.ids.map((id) => ({ id })) }
      : { filter: bulkFilter(filters, customFilter) };

  async function runPreview() {
    if (!changes) return;
    setPhase('previewing');
    setProblem(undefined);
    setPreview(undefined);
    try {
      const r = await ctx.api.command<BulkPreview>(
        'POST',
        `${ctx.base}/transactions/bulk-edit/preview`,
        { selection: selection(), changes },
        { idempotent: false },
      );
      setPreview(r.data);
      setPhase('preview');
    } catch (err) {
      setProblem(problemOf(err));
      setPhase('edit');
    }
  }

  async function apply() {
    if (!changes || !parts || parts.blocked.length > 0 || parts.applicable.length === 0) return;
    const items = bulkEditItems(parts.applicable);
    setPhase('applying');
    setProblem(undefined);
    setSentIds(items.map((i) => i.id));
    try {
      const r = await ctx.api.command<{ bulkOperationId: string; data: readonly Transaction[] }>(
        'POST',
        `${ctx.base}/transactions/bulk-edit`,
        { items, changes },
      );
      const done = {
        count: r.data?.data.length ?? items.length,
        bulkOperationId: r.data?.bulkOperationId ?? '',
      };
      setApplied(done);
      setPhase('done');
      onApplied(done);
    } catch (err) {
      setProblem(problemOf(err));
      setPhase('preview');
    }
  }

  /** Deja solo las transacciones que se pueden editar y vuelve a pedir la vista previa de esa selección. */
  function dropBlocked() {
    if (!parts) return;
    const ids = parts.applicable.map((i) => i.id);
    setTarget({ kind: 'items', ids });
    onTargetChange?.(ids);
    setPreview(undefined);
    setPhase('edit');
    setProblem(undefined);
  }

  const errors = itemErrors(problem);
  const shownCount = target.kind === 'items' ? target.ids.length : (preview?.count ?? undefined);
  const busy = phase === 'previewing' || phase === 'applying';
  const editable = phase === 'edit' || phase === 'preview';

  return (
    <section
      aria-labelledby="bulk-edit-title"
      style={formStyle}
      data-testid="bulk-edit-panel"
      data-phase={phase}
    >
      <h2 id="bulk-edit-title">
        {target.kind === 'items'
          ? t('bulk.title', { n: target.ids.length })
          : shownCount !== undefined
            ? t('bulk.title', { n: shownCount })
            : t('bulk.titleFiltered')}
      </h2>

      {phase === 'done' && applied ? (
        <div role="status" data-testid="bulk-result" data-bulk-operation-id={applied.bulkOperationId}>
          <h3>{t('bulk.resultTitle')}</h3>
          <p>{t('bulk.result', { n: applied.count, id: applied.bulkOperationId })}</p>
          <p style={mutedStyle}>{t('bulk.resultHint')}</p>
          <button type="button" onClick={onClose} data-testid="bulk-close">
            {t('bulk.close')}
          </button>
        </div>
      ) : (
        <>
          <form
            ref={form}
            aria-label={t('bulk.changes')}
            style={{ display: 'grid', gap: 'var(--pf-space-3)' }}
            onSubmit={(e) => {
              e.preventDefault();
              void runPreview();
            }}
          >
            <fieldset disabled={!editable || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend>{t('bulk.changes')}</legend>
              <div style={rowStyle}>
                <Field label={t('bulk.category')}>
                  {(p) => (
                    <select
                      {...p}
                      name="categoryId"
                      style={inputStyle}
                      value={draft.categoryId}
                      onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                    >
                      <option value="">{t('bulk.keep')}</option>
                      {cats.map((g) => (
                        <optgroup key={g.group} label={g.group}>
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
                <Field label={t('bulk.addTags')} hint={t('bulk.tagsHint')}>
                  {(p) => (
                    <select
                      {...p}
                      name="addTagIds"
                      multiple
                      size={Math.min(4, Math.max(2, activeTags.length))}
                      style={inputStyle}
                      value={[...draft.addTagIds]}
                      onChange={(e) =>
                        setDraft({ ...draft, addTagIds: [...e.target.selectedOptions].map((o) => o.value) })
                      }
                    >
                      {activeTags.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label={t('bulk.removeTags')} hint={t('bulk.tagsHint')}>
                  {(p) => (
                    <select
                      {...p}
                      name="removeTagIds"
                      multiple
                      size={Math.min(4, Math.max(2, catalogs.tags.length))}
                      style={inputStyle}
                      value={[...draft.removeTagIds]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          removeTagIds: [...e.target.selectedOptions].map((o) => o.value),
                        })
                      }
                    >
                      {catalogs.tags.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label={t('bulk.counterparty')}>
                  {(p) => (
                    <select
                      {...p}
                      name="counterparty"
                      style={inputStyle}
                      value={draft.counterparty}
                      onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })}
                    >
                      <option value="">{t('bulk.keep')}</option>
                      <option value={CLEAR_COUNTERPARTY}>{t('bulk.counterpartyClear')}</option>
                      {counterparties.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label={t('bulk.state')}>
                  {(p) => (
                    <select
                      {...p}
                      name="cleared"
                      style={inputStyle}
                      value={draft.cleared}
                      onChange={(e) =>
                        setDraft({ ...draft, cleared: e.target.value as BulkDraft['cleared'] })
                      }
                    >
                      <option value="">{t('bulk.keep')}</option>
                      <option value="cleared">{t('bulk.stateCleared')}</option>
                      <option value="uncleared">{t('bulk.stateUncleared')}</option>
                    </select>
                  )}
                </Field>
              </div>
            </fieldset>
            {conflicts.length > 0 ? (
              <p role="alert" style={warningStyle} data-testid="bulk-tag-conflict">
                {t('bulk.tagConflict')}
              </p>
            ) : null}
            <div style={rowStyle}>
              <button
                type="submit"
                disabled={!changes || conflicts.length > 0 || busy || !editable}
                data-testid="bulk-preview"
              >
                {phase === 'previewing' ? t('bulk.previewing') : t('bulk.preview')}
              </button>
              {!changes ? <span style={mutedStyle}>{t('bulk.noChanges')}</span> : null}
              <button type="button" onClick={onClose} data-testid="bulk-close">
                {t('bulk.close')}
              </button>
            </div>
          </form>

          {problem && errors.length === 0 ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}

          {preview && parts ? (
            <div
              data-testid="bulk-preview-result"
              data-count={preview.count}
              data-blocked={parts.blocked.length}
            >
              <h3>{t('bulk.previewTitle')}</h3>
              <p role="status">
                {t('bulk.previewSummary', { applicable: parts.applicable.length, count: preview.count })}
              </p>
              {preview.truncated ? (
                <p style={warningStyle} data-testid="bulk-truncated">
                  {t('bulk.previewTruncated', { max: BULK_EDIT_MAX_ITEMS })}
                </p>
              ) : null}
              {parts.blocked.length > 0 ? (
                <div data-testid="bulk-blocked">
                  <h4>{t('bulk.blockedTitle', { n: parts.blocked.length })}</h4>
                  <ul>
                    {parts.blocked.slice(0, MAX_LISTED_ERRORS).map((i) => (
                      <li key={i.id} data-testid="bulk-blocked-item" data-reasons={i.reasons.join(',')}>
                        <a href={ctx.href(`/transacciones/${i.id}`)}>{nameOf(i.id)}</a>
                        {': '}
                        {i.reasons.map((code) => problemMessage({ code }, ctx.uiLocale)).join(' ')}
                      </li>
                    ))}
                  </ul>
                  {parts.blocked.length > MAX_LISTED_ERRORS ? (
                    <p style={mutedStyle}>
                      {t('bulk.moreErrors', { n: parts.blocked.length - MAX_LISTED_ERRORS })}
                    </p>
                  ) : null}
                  <button type="button" onClick={dropBlocked} disabled={busy} data-testid="bulk-drop-blocked">
                    {t('bulk.dropBlocked')}
                  </button>
                </div>
              ) : null}
              <div style={rowStyle}>
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={busy || parts.blocked.length > 0 || parts.applicable.length === 0}
                  data-testid="bulk-apply"
                >
                  {phase === 'applying'
                    ? t('bulk.applying')
                    : t('bulk.apply', { n: parts.applicable.length })}
                </button>
              </div>
            </div>
          ) : null}

          {problem && errors.length > 0 ? (
            <div data-testid="bulk-errors" role="alert">
              <h3>{t('bulk.errorsTitle')}</h3>
              <ProblemMessage problem={problem} locale={ctx.uiLocale} />
              <p style={mutedStyle}>{t('bulk.errorsHint')}</p>
              <ul>
                {errors.slice(0, MAX_LISTED_ERRORS).map((e, n) => (
                  <li key={`${e.index}-${n}`} data-testid="bulk-item-error" data-error-code={e.code}>
                    {nameOf(sentIds[e.index] ?? '')}
                    {': '}
                    {problemMessage({ code: e.code }, ctx.uiLocale)}
                  </li>
                ))}
              </ul>
              {errors.length > MAX_LISTED_ERRORS ? (
                <p style={mutedStyle}>{t('bulk.moreErrors', { n: errors.length - MAX_LISTED_ERRORS })}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
