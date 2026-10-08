'use client';

import { useState } from 'react';
import { badgeStyle, cardStyle, Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { useFormat, type WorkspaceContext } from '../common/workspace';
import {
  CUSTOM_FIELD_DATA_TYPES,
  CUSTOM_FIELD_TARGETS,
  type CustomFieldDataType,
  type CustomFieldDefinition,
  type CustomFieldTarget,
} from '../custom-fields/logic';
import { optionsPayload, slugKey, type OptionDraft } from './custom-fields-logic';
import type { Run } from './types';

interface Draft {
  key: string;
  keyTouched: boolean;
  label: string;
  dataType: CustomFieldDataType;
  target: CustomFieldTarget;
  required: boolean;
  options: OptionDraft[];
}

const EMPTY: Draft = {
  key: '',
  keyTouched: false,
  label: '',
  dataType: 'TEXT',
  target: 'TRANSACTION',
  required: false,
  options: [{ key: '', label: '' }],
};

const draftOf = (d: CustomFieldDefinition): Draft => ({
  key: d.key,
  keyTouched: true,
  label: d.label,
  dataType: d.dataType,
  target: d.target,
  required: d.required,
  options: d.options.length
    ? d.options.map((o) => ({ key: o.key, label: o.label, stored: true }))
    : [{ key: '', label: '' }],
});

/**
 * Campos personalizados (openspec add-custom-fields 6.1, FR-CLASSIFICATION-009): definir (clave, etiqueta, tipo,
 * entidad, obligatoriedad y opciones de una selección), editar (la clave no cambia; con valores el tipo y las opciones
 * en uso quedan protegidas por la API), ordenar (↑/↓ por teclado) y archivar/desarchivar sin perder valores. La API
 * decide la autorización: la UI solo oculta las acciones a un VIEWER.
 */
export function CustomFieldsPanel({
  ctx,
  definitions,
  run,
}: {
  ctx: WorkspaceContext;
  definitions: readonly CustomFieldDefinition[];
  run: Run;
}) {
  const f = useFormat('CustomFields', ctx);
  const { t } = f;
  const [form, setForm] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | undefined>();
  const sorted = [...definitions].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  const activeSorted = sorted.filter((d) => !d.archivedAt);

  function submitCreate() {
    const opts = form.dataType === 'SELECT' ? optionsPayload(form.options) : { options: [] as OptionDraft[] };
    if (!form.label.trim()) return setError(t('errors.labelRequired'));
    if (!form.key) return setError(t('errors.keyRequired'));
    if (form.dataType === 'SELECT' && 'error' in opts) return setError(t(`errors.${opts.error}`));
    setError(undefined);
    void run(
      () =>
        ctx.api.command('POST', `${ctx.base}/custom-fields`, {
          key: form.key,
          label: form.label.trim(),
          dataType: form.dataType,
          target: form.target,
          required: form.required,
          ...(form.dataType === 'SELECT' && 'options' in opts ? { options: opts.options } : {}),
        }),
      t('created', { name: form.label.trim() }),
    ).then((ok) => ok && setForm(EMPTY));
  }

  /** Intercambia la posición con la vecina activa (dos PATCH con `If-Match` de cada una). */
  function move(d: CustomFieldDefinition, delta: -1 | 1) {
    const i = activeSorted.findIndex((x) => x.id === d.id);
    const other = activeSorted[i + delta];
    if (!other) return;
    void run(async () => {
      await ctx.api.command(
        'PATCH',
        `${ctx.base}/custom-fields/${d.id}`,
        { position: other.position },
        { ifMatch: d.version },
      );
      await ctx.api.command(
        'PATCH',
        `${ctx.base}/custom-fields/${other.id}`,
        { position: d.position },
        { ifMatch: other.version },
      );
    }, t('reordered'));
  }

  return (
    <section
      aria-labelledby="custom-fields-title"
      style={{ display: 'grid', gap: '1rem' }}
      data-testid="custom-fields"
    >
      <h2 id="custom-fields-title" style={{ fontSize: '1.1rem', margin: 0 }}>
        {t('title')}
      </h2>
      <p style={mutedStyle}>{t('intro')}</p>
      {ctx.canEdit ? (
        <form
          style={formStyle}
          aria-labelledby="custom-field-new-title"
          noValidate
          data-testid="custom-field-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitCreate();
          }}
        >
          <h3 id="custom-field-new-title" style={{ margin: 0, fontSize: '1rem' }}>
            {t('new')}
          </h3>
          <DraftFields f={f} draft={form} onChange={setForm} idPrefix="new" />
          {error ? (
            <p role="alert" data-testid="custom-field-error" style={{ color: 'var(--pf-error)', margin: 0 }}>
              {error}
            </p>
          ) : null}
          <div style={rowStyle}>
            <button type="submit">{t('create')}</button>
          </div>
        </form>
      ) : null}
      <ul style={{ ...cardStyle, margin: 0, paddingLeft: '1.75rem', display: 'grid', gap: '0.5rem' }}>
        {sorted.length === 0 ? <li>{t('empty')}</li> : null}
        {sorted.map((d) => (
          <li
            key={d.id}
            data-testid="custom-field"
            data-key={d.key}
            data-archived={d.archivedAt ? 'true' : 'false'}
          >
            <CustomFieldRow
              ctx={ctx}
              def={d}
              run={run}
              onMove={(delta) => move(d, delta)}
              canUp={!d.archivedAt && activeSorted[0]?.id !== d.id}
              canDown={!d.archivedAt && activeSorted.at(-1)?.id !== d.id}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Campos del borrador compartidos por el alta y la edición (la clave solo se escribe al crear). */
function DraftFields({
  f,
  draft,
  onChange,
  idPrefix,
  editing = false,
}: {
  f: ReturnType<typeof useFormat>;
  draft: Draft;
  onChange: (d: Draft) => void;
  idPrefix: string;
  editing?: boolean;
}) {
  const { t } = f;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div style={rowStyle}>
        <Field label={t('label')}>
          {(p) => (
            <input
              {...p}
              name={`${idPrefix}-label`}
              maxLength={80}
              style={inputStyle}
              value={draft.label}
              onChange={(e) =>
                set({
                  label: e.target.value,
                  ...(draft.keyTouched || editing ? {} : { key: slugKey(e.target.value) }),
                })
              }
            />
          )}
        </Field>
        <Field label={t('key')} hint={editing ? t('keyImmutable') : t('keyHint')}>
          {(p) => (
            <input
              {...p}
              name={`${idPrefix}-key`}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              style={inputStyle}
              value={draft.key}
              readOnly={editing}
              onChange={(e) => set({ key: e.target.value, keyTouched: true })}
            />
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        <Field label={t('dataType')} hint={editing ? t('lockedHint') : undefined}>
          {(p) => (
            <select
              {...p}
              name={`${idPrefix}-dataType`}
              style={inputStyle}
              value={draft.dataType}
              onChange={(e) => set({ dataType: e.target.value as CustomFieldDataType })}
            >
              {CUSTOM_FIELD_DATA_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`dataTypes.${x}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('target')}>
          {(p) => (
            <select
              {...p}
              name={`${idPrefix}-target`}
              style={inputStyle}
              value={draft.target}
              onChange={(e) => set({ target: e.target.value as CustomFieldTarget })}
            >
              {CUSTOM_FIELD_TARGETS.map((x) => (
                <option key={x} value={x}>
                  {t(`targets.${x}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            name={`${idPrefix}-required`}
            checked={draft.required}
            onChange={(e) => set({ required: e.target.checked })}
          />
          {t('requiredField')}
        </label>
      </div>
      {draft.dataType === 'SELECT' ? (
        <fieldset
          style={{
            border: '1px solid var(--pf-border)',
            padding: '0.5rem',
            display: 'grid',
            gap: '0.5rem',
            minWidth: 0,
          }}
        >
          <legend>{t('options')}</legend>
          {draft.options.map((o, i) => (
            <div key={i} style={rowStyle} data-testid="option-row">
              <Field label={t('optionLabel', { n: i + 1 })}>
                {(p) => (
                  <input
                    {...p}
                    name={`${idPrefix}-option-${i}-label`}
                    maxLength={80}
                    style={inputStyle}
                    value={o.label}
                    onChange={(e) =>
                      set({
                        options: draft.options.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                label: e.target.value,
                                ...(x.touched || x.stored ? {} : { key: slugKey(e.target.value) }),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                )}
              </Field>
              <Field label={t('optionKey', { n: i + 1 })}>
                {(p) => (
                  <input
                    {...p}
                    name={`${idPrefix}-option-${i}-key`}
                    maxLength={40}
                    autoComplete="off"
                    spellCheck={false}
                    style={inputStyle}
                    value={o.key}
                    readOnly={Boolean(o.stored)}
                    onChange={(e) =>
                      set({
                        options: draft.options.map((x, j) =>
                          j === i ? { ...x, key: e.target.value, touched: true } : x,
                        ),
                      })
                    }
                  />
                )}
              </Field>
              <button
                type="button"
                aria-label={t('removeOption', { n: i + 1 })}
                disabled={draft.options.length <= 1}
                onClick={() => set({ options: draft.options.filter((_, j) => j !== i) })}
              >
                {t('removeOptionShort')}
              </button>
            </div>
          ))}
          <div style={rowStyle}>
            <button
              type="button"
              onClick={() => set({ options: [...draft.options, { key: '', label: '' }] })}
            >
              {t('addOption')}
            </button>
          </div>
        </fieldset>
      ) : null}
    </>
  );
}

function CustomFieldRow({
  ctx,
  def,
  run,
  onMove,
  canUp,
  canDown,
}: {
  ctx: WorkspaceContext;
  def: CustomFieldDefinition;
  run: Run;
  onMove: (delta: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const f = useFormat('CustomFields', ctx);
  const { t } = f;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(def));
  const [error, setError] = useState<string | undefined>();
  const archived = Boolean(def.archivedAt);

  function submitEdit() {
    const opts =
      draft.dataType === 'SELECT' ? optionsPayload(draft.options) : { options: [] as OptionDraft[] };
    if (!draft.label.trim()) return setError(t('errors.labelRequired'));
    if (draft.dataType === 'SELECT' && 'error' in opts) return setError(t(`errors.${opts.error}`));
    setError(undefined);
    void run(
      () =>
        ctx.api.command(
          'PATCH',
          `${ctx.base}/custom-fields/${def.id}`,
          {
            label: draft.label.trim(),
            required: draft.required,
            ...(draft.dataType !== def.dataType ? { dataType: draft.dataType } : {}),
            ...(draft.target !== def.target ? { target: draft.target } : {}),
            ...(draft.dataType === 'SELECT' && 'options' in opts ? { options: opts.options } : {}),
          },
          { ifMatch: def.version },
        ),
      t('updated', { name: draft.label.trim() }),
    ).then((ok) => ok && setEditing(false));
  }

  return (
    <div style={{ display: 'grid', gap: '0.25rem' }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
        <strong>{def.label}</strong>
        <code>{def.key}</code>
        <span style={badgeStyle}>{t(`dataTypes.${def.dataType}`)}</span>
        <span style={badgeStyle}>{t(`targets.${def.target}`)}</span>
        {def.required ? <span style={badgeStyle}>{t('requiredBadge')}</span> : null}
        {archived ? <span style={badgeStyle}>{t('archivedBadge')}</span> : null}
        {ctx.canEdit ? (
          <>
            <button
              type="button"
              aria-label={t('moveUpNamed', { name: def.label })}
              disabled={!canUp}
              onClick={() => onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={t('moveDownNamed', { name: def.label })}
              disabled={!canDown}
              onClick={() => onMove(1)}
            >
              ↓
            </button>
            {!archived ? (
              <button
                type="button"
                aria-expanded={editing}
                aria-label={t('editNamed', { name: def.label })}
                onClick={() => {
                  setDraft(draftOf(def));
                  setEditing(!editing);
                }}
              >
                {t('edit')}
              </button>
            ) : null}
            <button
              type="button"
              aria-label={t(archived ? 'unarchiveNamed' : 'archiveNamed', { name: def.label })}
              onClick={() =>
                void run(
                  () =>
                    ctx.api.command(
                      'POST',
                      `${ctx.base}/custom-fields/${def.id}/${archived ? 'unarchive' : 'archive'}`,
                      undefined,
                      { ifMatch: def.version, idempotent: false },
                    ),
                  t(archived ? 'unarchived' : 'archivedDone', { name: def.label }),
                )
              }
            >
              {archived ? t('unarchive') : t('archive')}
            </button>
          </>
        ) : null}
      </span>
      {def.options.length > 0 ? (
        <span style={mutedStyle}>{def.options.map((o) => o.label).join(' · ')}</span>
      ) : null}
      {editing ? (
        <form
          style={{ display: 'grid', gap: '0.5rem' }}
          aria-label={t('editNamed', { name: def.label })}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submitEdit();
          }}
        >
          <DraftFields f={f} draft={draft} onChange={setDraft} idPrefix={`edit-${def.key}`} editing />
          {error ? (
            <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
              {error}
            </p>
          ) : null}
          <div style={rowStyle}>
            <button type="submit">{t('save')}</button>
            <button type="button" onClick={() => setEditing(false)}>
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
