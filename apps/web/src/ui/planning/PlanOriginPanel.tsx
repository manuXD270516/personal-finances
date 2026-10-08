'use client';

import { useEffect, useState } from 'react';
import { cardStyle, Field, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import type { OmittedLine, Template, TemplateSummary } from './template-logic';
import { targetName, type TargetNames } from './BudgetLinesTable';

export type PlanSource =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'TEMPLATE'; readonly templateId: string; readonly versionNo?: number }
  | { readonly kind: 'CLONE_PREVIOUS' };

/**
 * Selector de origen del plan de un periodo sin plan (openspec add-budget-templates 6.1): vacío, desde una versión de
 * template (la última por defecto) o clonando el plan del mes anterior. Los errores de la API (p. ej. mes anterior sin
 * plan) los muestra la pantalla por `code`.
 */
export function PlanOriginPanel({
  ctx,
  f,
  busy,
  onCreate,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  busy: boolean;
  onCreate: (source: PlanSource) => void;
}) {
  const [templates, setTemplates] = useState<readonly TemplateSummary[]>([]);
  const [kind, setKind] = useState<PlanSource['kind']>('EMPTY');
  const [templateId, setTemplateId] = useState('');
  const [versions, setVersions] = useState<Template['versions']>([]);
  const [versionNo, setVersionNo] = useState('');

  useEffect(() => {
    ctx.api
      .get<{ data: TemplateSummary[] }>(`${ctx.base}/templates?status=ACTIVE&limit=100`)
      .then((r) => {
        const list = r.data?.data ?? [];
        setTemplates(list);
        setTemplateId((current) => current || (list.find((t) => t.isDefault) ?? list[0])?.id || '');
      })
      .catch((err: unknown) => void problemOf(err));
  }, [ctx]);

  useEffect(() => {
    if (!templateId) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    ctx.api
      .get<Template>(`${ctx.base}/templates/${templateId}`)
      .then((r) => {
        if (!cancelled) setVersions(r.data?.versions ?? []);
      })
      .catch((err: unknown) => void problemOf(err));
    setVersionNo('');
    return () => {
      cancelled = true;
    };
  }, [ctx, templateId]);

  function submit() {
    if (kind === 'TEMPLATE') {
      if (!templateId) return;
      onCreate({ kind, templateId, ...(versionNo ? { versionNo: Number(versionNo) } : {}) });
    } else onCreate({ kind });
  }

  const options: readonly PlanSource['kind'][] = ['EMPTY', 'TEMPLATE', 'CLONE_PREVIOUS'];
  return (
    <form
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
      data-testid="plan-origin"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
        <legend>{f.t('origin.title')}</legend>
        {options.map((o) => (
          <label key={o} style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
            <input
              type="radio"
              name="plan-origin"
              value={o}
              checked={kind === o}
              onChange={() => setKind(o)}
              disabled={o === 'TEMPLATE' && templates.length === 0}
              data-testid={`origin-${o}`}
            />
            {f.t(`origin.${o}`)}
          </label>
        ))}
      </fieldset>
      {kind === 'TEMPLATE' ? (
        templates.length === 0 ? (
          <p style={mutedStyle}>{f.t('origin.noTemplates')}</p>
        ) : (
          <div style={rowStyle}>
            <Field label={f.t('origin.template')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  data-testid="origin-template"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.isDefault ? ` (${f.t('origin.default')})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={f.t('origin.version')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={versionNo}
                  onChange={(e) => setVersionNo(e.target.value)}
                  data-testid="origin-version"
                >
                  <option value="">{f.t('origin.latest')}</option>
                  {versions.map((v) => (
                    <option key={v.versionNo} value={v.versionNo}>
                      {f.t('origin.versionOption', { versionNo: v.versionNo })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        )
      ) : null}
      {kind === 'CLONE_PREVIOUS' ? <p style={mutedStyle}>{f.t('origin.cloneHint')}</p> : null}
      <div style={rowStyle}>
        <button
          type="submit"
          disabled={busy || (kind === 'TEMPLATE' && !templateId)}
          data-testid="create-plan"
        >
          {f.t('createPlan')}
        </button>
      </div>
    </form>
  );
}

/** Líneas del origen que no se copiaron (objetivo archivado o de otra moneda): se informan, nunca fallan la creación. */
export function OmittedLinesNotice({
  omitted,
  names,
  f,
}: {
  omitted: readonly OmittedLine[];
  names: TargetNames;
  f: FormatContext;
}) {
  if (omitted.length === 0) return null;
  return (
    <div role="note" style={cardStyle} data-testid="omitted-lines">
      <p style={{ margin: 0 }}>
        <strong>{f.t('omitted.title')}</strong>
      </p>
      <ul>
        {omitted.map((o) => (
          <li key={`${o.target.kind}:${o.target.id}`} data-reason={o.reason}>
            {f.t(`omitted.${o.reason}`, { name: targetName(names, o.target.kind, o.target.id) })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Origen del plan en una frase: vacío, template y versión, o clonado del plan anterior. */
export function PlanOriginInfo({
  origin,
  templateVersion,
  f,
}: {
  origin: 'EMPTY' | 'TEMPLATE' | 'CLONE';
  templateVersion: { name: string; versionNo: number } | null | undefined;
  f: FormatContext;
}) {
  let text: string;
  if (origin === 'TEMPLATE' && templateVersion) {
    text = f.t('originInfo.TEMPLATE', { name: templateVersion.name, versionNo: templateVersion.versionNo });
  } else if (origin === 'CLONE') {
    text = templateVersion
      ? f.t('originInfo.CLONE_TEMPLATE', { name: templateVersion.name, versionNo: templateVersion.versionNo })
      : f.t('originInfo.CLONE');
  } else text = f.t('originInfo.EMPTY');
  return (
    <p style={mutedStyle} data-testid="plan-origin-info" data-origin={origin}>
      {text}
    </p>
  );
}
