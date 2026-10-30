import type { ReactNode } from 'react';
import type { Transaction, TransactionSplit } from '../common/types';
import { badgeStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { originOfRef, ruleRefFor, seedQuery, type RuleSeed } from './logic';
import { CategoryOriginText, OriginText } from './parts';
import type { SplitRuleRef } from './types';

const refsOf = (s: TransactionSplit): readonly SplitRuleRef[] =>
  (s.ruleRefs ?? []).map((r) => ({
    field: r.field,
    ruleId: r.ruleId,
    ruleVersion: r.ruleVersion,
    ruleName: r.ruleName ?? null,
    ...(r.ruleArchived !== undefined ? { ruleArchived: r.ruleArchived } : {}),
  }));

/**
 * Categoría de un split con su origen por campo (FR-RULES-010): «Supermercado — por la regla Supermercado (v1)» o
 * «— Manual»; cada etiqueta fijada por una regla lo dice a continuación. `f` es del namespace `Rules`.
 */
export function SplitClassificationView({
  split,
  categoryName,
  tagName,
  f,
}: {
  split: TransactionSplit;
  categoryName: string;
  tagName: (id: string) => string;
  f: FormatContext;
}) {
  const refs = refsOf(split);
  return (
    <div data-testid="split-classification" data-category-origin={split.categoryOrigin ?? 'UNKNOWN'}>
      <div>
        <strong data-testid="split-category">{categoryName}</strong>{' '}
        <span style={mutedStyle}>
          —{' '}
          <CategoryOriginText
            origin={split.categoryOrigin ?? 'UNKNOWN'}
            rule={originOfRef(ruleRefFor(refs, 'CATEGORY'))}
            f={f}
          />
        </span>
      </div>
      {(split.tagIds ?? []).map((id) => {
        const ref = ruleRefFor(refs, `TAG:${id}`);
        return ref ? (
          <div key={id} style={mutedStyle} data-testid="split-tag-origin">
            {f.t('origin.tag', { name: tagName(id) })} — <OriginText origin={originOfRef(ref)} f={f} />
          </div>
        ) : null;
      })}
      {(['COUNTERPARTY', 'DESCRIPTION', 'NOTES'] as const).map((field) => {
        const ref = ruleRefFor(refs, field);
        return ref ? (
          <div key={field} style={mutedStyle} data-testid="split-field-origin" data-field={field}>
            {f.t(`origin.field.${field}`)} — <OriginText origin={originOfRef(ref)} f={f} />
          </div>
        ) : null;
      })}
    </div>
  );
}

/** Marca de revisión pendiente: quién la puso (la regla con su versión o el usuario) y cómo quitarla. */
export function ReviewBanner({
  tx,
  f,
  canEdit,
  busy,
  onResolve,
  onMark,
}: {
  tx: Transaction;
  f: FormatContext;
  canEdit: boolean;
  busy: boolean;
  onResolve: () => void;
  onMark: () => void;
}) {
  if (!tx.needsReview || !tx.review) {
    return canEdit ? (
      <div style={rowStyle}>
        <button type="button" disabled={busy} onClick={onMark} data-testid="review-mark">
          {f.t('review.mark')}
        </button>
      </div>
    ) : null;
  }
  const byRule = tx.review.reason === 'RULE' && tx.review.ruleId;
  return (
    <div style={warningStyle} role="status" data-testid="review-banner" data-reason={tx.review.reason}>
      <strong>{f.t('review.pending')}</strong>{' '}
      {byRule
        ? f.t('review.byRule', {
            name: tx.review.ruleName ?? tx.review.ruleId ?? '',
            version: tx.review.ruleVersion ?? 1,
          })
        : f.t('review.byUser')}
      {canEdit ? (
        <div>
          <button type="button" disabled={busy} onClick={onResolve} data-testid="review-resolve">
            {f.t('review.resolve')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Insignia del listado: transacción pendiente de revisión (texto + icono, no solo color). `f` es de `Transactions`. */
export function NeedsReviewBadge({ f }: { f: FormatContext }): ReactNode {
  return (
    <span style={badgeStyle} data-testid="needs-review-badge">
      <span aria-hidden="true">⚑</span> {f.t('list.needsReviewBadge')}
    </span>
  );
}

/** «Crear regla desde esta transacción o fila» (Could): abre el editor prellenado; nada se guarda hasta confirmar. */
export function CreateRuleLink({
  seed,
  href,
  f,
}: {
  seed: RuleSeed;
  href: (path: string) => string;
  f: FormatContext;
}) {
  return (
    <a href={href(`/reglas/nueva?${seedQuery(seed)}`)} data-testid="create-rule-from">
      {f.t('review.createRule')}
    </a>
  );
}
