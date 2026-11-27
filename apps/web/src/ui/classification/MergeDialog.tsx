'use client';

import { useEffect, useState } from 'react';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ConfirmDialog, Field, inputStyle, mutedStyle, warningStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { canConfirmMerge, visibleCounts } from './logic';
import type { MergePreview, MergeTargetGroup, Run } from './types';

export type MergeKind = 'category' | 'counterparty';

const SEGMENT: Record<MergeKind, string> = { category: 'categories', counterparty: 'counterparties' };
const BODY_KEY: Record<MergeKind, string> = {
  category: 'targetCategoryId',
  counterparty: 'targetCounterpartyId',
};

/**
 * Vista previa de una fusión (decisión 7 del change): conteos legibles (sin los que valen 0; las claves nuevas se
 * muestran con su código), conflictos con sus referencias, aviso de que no se deshace y, en contrapartes, los alias
 * que se mueven y la nota de que el nombre de la origen pasa a ser alias de la destino. Presentacional.
 */
export function MergePreviewView({
  f,
  kind,
  preview,
  aliases = [],
}: {
  f: FormatContext;
  kind: MergeKind;
  preview: MergePreview;
  /** Alias de la origen (solo contrapartes). */
  aliases?: readonly string[];
}) {
  const { t, has, locale } = f;
  const counts = visibleCounts(preview.counts);
  const number = new Intl.NumberFormat(locale);
  const names = { source: preview.source.name, target: preview.target.name };
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }} data-testid="merge-preview">
      <p style={{ margin: 0 }}>{t('merge.previewIntro', names)}</p>
      {counts.length === 0 ? (
        <p style={mutedStyle} data-testid="merge-no-counts">
          {t('merge.noCounts')}
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }} aria-label={t('merge.countsLabel')}>
          {counts.map((c) => (
            <li key={c.key} data-count-key={c.key}>
              {has(`merge.counts.${c.key}`) ? t(`merge.counts.${c.key}`) : c.key}:{' '}
              <strong>{number.format(c.count)}</strong>
            </li>
          ))}
        </ul>
      )}
      {kind === 'counterparty' ? (
        <div data-testid="merge-aliases" style={{ display: 'grid', gap: '0.25rem' }}>
          {aliases.length > 0 ? (
            <p style={{ margin: 0 }}>{t('merge.aliasesMoved', { aliases: aliases.join(', ') })}</p>
          ) : null}
          <p style={{ margin: 0 }}>{t('merge.nameBecomesAlias', names)}</p>
        </div>
      ) : null}
      {preview.conflicts.length > 0 ? (
        <div role="note" style={warningStyle} data-testid="merge-conflicts">
          <strong>{t('merge.conflictsTitle')}</strong>
          <p style={{ margin: '0.25rem 0' }}>{t('merge.conflictsHint')}</p>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {preview.conflicts.map((c, i) => (
              <li key={`${c.reason}-${i}`} data-conflict={c.reason}>
                {has(`merge.reasons.${c.reason}`) ? t(`merge.reasons.${c.reason}`) : c.reason}
                {c.refs.length > 0 ? `: ${c.refs.map((r) => r.label).join(', ')}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p role="note" style={warningStyle} data-testid="merge-irreversible">
        {t('merge.irreversible', names)}
      </p>
    </div>
  );
}

/**
 * Diálogo «Fusionar en…» de una categoría o contraparte: selector de destino compatible, vista previa (solo lectura,
 * al elegir) y confirmación explícita (casilla «Entiendo que no se puede deshacer» y el nombre de la destino en el
 * botón; deshabilitado con conflictos). Confirma con `If-Match` (versión de la origen) e `Idempotency-Key` (la pone el
 * cliente). Si la fusión falla, se cierra y el problema queda en la región de errores de la página.
 */
export function MergeDialog({
  kind,
  ctx,
  f,
  source,
  targets,
  aliases,
  run,
  onClose,
}: {
  kind: MergeKind;
  ctx: WorkspaceContext;
  f: FormatContext;
  source: { readonly id: string; readonly name: string; readonly version: number };
  targets: readonly MergeTargetGroup[];
  aliases?: readonly string[];
  run: Run;
  onClose: () => void;
}) {
  const { t } = f;
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const path = `${ctx.base}/${SEGMENT[kind]}/${source.id}`;

  useEffect(() => {
    setPreview(null);
    setAck(false);
    setProblem(undefined);
    if (!targetId) {
      setLoading(false);
      return undefined;
    }
    let live = true;
    setLoading(true);
    ctx.api
      .get<MergePreview>(`${path}/merge-preview?targetId=${encodeURIComponent(targetId)}`)
      .then((r) => {
        if (!live) return;
        setPreview(r.data ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setProblem(problemOf(err));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [ctx.api, path, targetId]);

  const confirm = async () => {
    if (!preview || !canConfirmMerge(preview, ack)) return;
    setBusy(true);
    await run(
      () =>
        ctx.api.command(
          'POST',
          `${path}/merge`,
          { [BODY_KEY[kind]]: preview.target.id },
          { ifMatch: source.version },
        ),
      t(kind === 'category' ? 'merge.doneCategory' : 'merge.doneCounterparty', {
        source: source.name,
        target: preview.target.name,
      }),
    );
    onClose();
  };

  return (
    <ConfirmDialog
      testId={`merge-dialog-${source.id}`}
      title={t('merge.title', { name: source.name })}
      description={t(kind === 'category' ? 'merge.descriptionCategory' : 'merge.descriptionCounterparty', {
        name: source.name,
      })}
      confirmLabel={preview ? t('merge.confirm', { target: preview.target.name }) : t('merge.confirmEmpty')}
      cancelLabel={t('cancel')}
      busy={busy}
      confirmDisabled={!canConfirmMerge(preview, ack)}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    >
      <Field label={t('merge.target')} hint={t('merge.targetHint')}>
        {(p) => (
          <select
            {...p}
            name="mergeTarget"
            style={inputStyle}
            value={targetId}
            disabled={busy}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">{t('merge.chooseTarget')}</option>
            {targets.map((g) =>
              g.label ? (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ) : (
                g.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))
              ),
            )}
          </select>
        )}
      </Field>
      {targets.every((g) => g.options.length === 0) ? <p style={mutedStyle}>{t('merge.noTargets')}</p> : null}
      <div aria-live="polite" style={{ display: 'grid', gap: '0.5rem' }}>
        {loading ? <p role="status">{t('merge.loading')}</p> : null}
        {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
        {preview ? <MergePreviewView f={f} kind={kind} preview={preview} aliases={aliases ?? []} /> : null}
      </div>
      {preview ? (
        <label style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            name="mergeAck"
            checked={ack}
            disabled={busy || preview.conflicts.length > 0}
            onChange={(e) => setAck(e.target.checked)}
          />
          {t('merge.ack')}
        </label>
      ) : null}
    </ConfirmDialog>
  );
}
