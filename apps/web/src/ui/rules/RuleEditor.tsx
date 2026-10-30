'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  Field,
  cardStyle,
  formStyle,
  inputStyle,
  mutedStyle,
  pageStyle,
  rowStyle,
  warningStyle,
} from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { useCustomFields } from '../custom-fields/CustomFieldInputs';
import { formatBusinessDate } from '../planning/logic';
import { useCatalogs, type Catalogs } from '../transactions/catalogs';
import {
  ACTION_TYPES,
  CONDITION_FIELDS,
  FIELD_OPERATORS,
  OPERAND_KIND,
  TRIGGERS,
  draftBody,
  draftDefinition,
  draftFromSeed,
  emptyAction,
  emptyCondition,
  emptyDraft,
  errorAt,
  operandShape,
  rulesPath,
  ruleToDraft,
  seedFromQuery,
  validateDraft,
  type ActionDraft,
  type ConditionDraft,
  type ConditionItemDraft,
  type DraftError,
  type RuleDraft,
} from './logic';
import {
  RuleStatusBadge,
  accountOptions,
  allCategoryGroups,
  counterpartyOptions,
  tagOptions,
  type SelectOption,
} from './parts';
import type { ConditionField, Rule, RulePreview, RuleVersion } from './types';

/** Opciones de los selectores de destino, derivadas de los catálogos del workspace. */
interface Pickers {
  readonly categories: ReturnType<typeof allCategoryGroups>;
  readonly tags: SelectOption[];
  readonly counterparties: SelectOption[];
  readonly accounts: SelectOption[];
  readonly customFields: SelectOption[];
}

function OptionList({ options, empty }: { options: readonly SelectOption[]; empty: string }) {
  return (
    <>
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </>
  );
}

/** Operando de una condición según el campo: selector del catálogo o texto con el tipo de entrada adecuado. */
function OperandInput({
  field,
  value,
  onChange,
  pickers,
  f,
  label,
  props,
}: {
  field: ConditionField;
  value: string;
  onChange: (v: string) => void;
  pickers: Pickers;
  f: FormatContext;
  label: string;
  props: Record<string, unknown>;
}) {
  const kind = OPERAND_KIND[field];
  const choose = f.t('editor.choose');
  const common = { ...props, style: inputStyle, value, 'aria-label': undefined };
  if (kind === 'category') {
    return (
      <select {...common} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{choose}</option>
        {pickers.categories.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  }
  const list =
    kind === 'tag'
      ? pickers.tags
      : kind === 'counterparty'
        ? pickers.counterparties
        : kind === 'account'
          ? pickers.accounts
          : undefined;
  if (list) {
    return (
      <select {...common} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <OptionList options={list} empty={choose} />
      </select>
    );
  }
  if (kind === 'kind') {
    return (
      <select {...common} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{choose}</option>
        {(['INCOME', 'EXPENSE', 'REFUND'] as const).map((k) => (
          <option key={k} value={k}>
            {f.t(`kinds.${k}`)}
          </option>
        ))}
      </select>
    );
  }
  if (kind === 'weekday') {
    return (
      <select {...common} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{choose}</option>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <option key={d} value={String(d)}>
            {f.t(`weekdays.${d}`)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      {...common}
      type={kind === 'date' ? 'date' : kind === 'dayOfMonth' ? 'number' : 'text'}
      inputMode={kind === 'decimal' ? 'decimal' : kind === 'dayOfMonth' ? 'numeric' : undefined}
      min={kind === 'dayOfMonth' ? 1 : undefined}
      max={kind === 'dayOfMonth' ? 31 : undefined}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    />
  );
}

function ConditionEditor({
  index,
  draft,
  onChange,
  onRemove,
  pickers,
  f,
  error,
  testId,
  currencies,
}: {
  index: number;
  draft: ConditionDraft;
  onChange: (next: ConditionDraft) => void;
  onRemove: () => void;
  pickers: Pickers;
  f: FormatContext;
  error: string | undefined;
  testId: string;
  currencies: readonly string[];
}) {
  const shape = operandShape(draft.operator);
  const operators = FIELD_OPERATORS[draft.field];
  const set = (patch: Partial<ConditionDraft>) => onChange({ ...draft, ...patch });
  const changeField = (field: ConditionField) => {
    const ops = FIELD_OPERATORS[field];
    set({
      field,
      operator: ops.includes(draft.operator) ? draft.operator : (ops[0] as ConditionDraft['operator']),
      value: '',
      valueTo: '',
      values: '',
    });
  };
  const n = index + 1;
  return (
    <fieldset style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }} data-testid={testId}>
      <legend>{f.t('conditions.item', { n })}</legend>
      <div style={rowStyle}>
        <Field label={f.t('conditions.field')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={draft.field}
              data-testid="condition-field"
              onChange={(e) => changeField(e.target.value as ConditionField)}
            >
              {CONDITION_FIELDS.map((k) => (
                <option key={k} value={k}>
                  {f.t(`fields.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('conditions.operator')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={draft.operator}
              data-testid="condition-operator"
              onChange={(e) => set({ operator: e.target.value as ConditionDraft['operator'] })}
            >
              {operators.map((o) => (
                <option key={o} value={o}>
                  {f.t(`operators.${o}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {draft.field === 'AMOUNT' ? (
          <Field label={f.t('conditions.currency')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={draft.currency}
                data-testid="condition-currency"
                onChange={(e) => set({ currency: e.target.value })}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        {draft.field === 'CUSTOM_FIELD' ? (
          <Field label={f.t('conditions.customField')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={draft.fieldId}
                data-testid="condition-custom-field"
                onChange={(e) => set({ fieldId: e.target.value })}
              >
                <OptionList options={pickers.customFields} empty={f.t('editor.choose')} />
              </select>
            )}
          </Field>
        ) : null}
      </div>
      {shape === 'single' || shape === 'range' ? (
        <div style={rowStyle}>
          <Field label={shape === 'range' ? f.t('conditions.from') : f.t('conditions.value')} error={error}>
            {(p) => (
              <OperandInput
                field={draft.field}
                value={draft.value}
                onChange={(value) => set({ value })}
                pickers={pickers}
                f={f}
                label={f.t('conditions.value')}
                props={{ ...p, 'data-testid': 'condition-value' }}
              />
            )}
          </Field>
          {shape === 'range' ? (
            <Field label={f.t('conditions.to')}>
              {(p) => (
                <OperandInput
                  field={draft.field}
                  value={draft.valueTo}
                  onChange={(valueTo) => set({ valueTo })}
                  pickers={pickers}
                  f={f}
                  label={f.t('conditions.to')}
                  props={{ ...p, 'data-testid': 'condition-value-to' }}
                />
              )}
            </Field>
          ) : null}
        </div>
      ) : null}
      {shape === 'list' ? (
        <Field label={f.t('conditions.values')} hint={f.t('conditions.valuesHint')} error={error}>
          {(p) => (
            <textarea
              {...p}
              style={inputStyle}
              rows={3}
              value={draft.values}
              data-testid="condition-values"
              onChange={(e) => set({ values: e.target.value })}
            />
          )}
        </Field>
      ) : null}
      {draft.operator === 'matches_regex' ? (
        <small style={mutedStyle}>{f.t('conditions.regexHint')}</small>
      ) : null}
      <div>
        <button type="button" onClick={onRemove} data-testid="condition-remove">
          {f.t('conditions.remove', { n })}
        </button>
      </div>
    </fieldset>
  );
}

function ActionEditor({
  index,
  draft,
  onChange,
  onRemove,
  pickers,
  f,
  error,
}: {
  index: number;
  draft: ActionDraft;
  onChange: (next: ActionDraft) => void;
  onRemove: () => void;
  pickers: Pickers;
  f: FormatContext;
  error: string | undefined;
}) {
  const set = (patch: Partial<ActionDraft>) => onChange({ ...draft, ...patch });
  const n = index + 1;
  const choose = f.t('editor.choose');
  return (
    <fieldset style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="action-row">
      <legend>{f.t('actions.item', { n })}</legend>
      <div style={rowStyle}>
        <Field label={f.t('actions.type')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={draft.type}
              data-testid="action-type"
              onChange={(e) => onChange(emptyAction({ type: e.target.value as ActionDraft['type'] }))}
            >
              {ACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {f.t(`actionTypes.${t}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {draft.type === 'SET_CATEGORY' ? (
          <Field label={f.t('actions.category')} error={error}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={draft.categoryId}
                data-testid="action-category"
                onChange={(e) => set({ categoryId: e.target.value })}
              >
                <option value="">{choose}</option>
                {pickers.categories.map((g) => (
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
        ) : null}
        {draft.type === 'ADD_TAG' || draft.type === 'REMOVE_TAG' ? (
          <Field label={f.t('actions.tag')} error={error}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={draft.tagId}
                data-testid="action-tag"
                onChange={(e) => set({ tagId: e.target.value })}
              >
                <OptionList options={pickers.tags} empty={choose} />
              </select>
            )}
          </Field>
        ) : null}
        {draft.type === 'SET_COUNTERPARTY' ? (
          <Field label={f.t('actions.counterparty')} error={error}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={draft.counterpartyId}
                data-testid="action-counterparty"
                onChange={(e) => set({ counterpartyId: e.target.value })}
              >
                <OptionList options={pickers.counterparties} empty={choose} />
              </select>
            )}
          </Field>
        ) : null}
        {draft.type === 'SET_CUSTOM_FIELD' ? (
          <>
            <Field label={f.t('actions.customField')} error={error}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={draft.fieldId}
                  data-testid="action-custom-field"
                  onChange={(e) => set({ fieldId: e.target.value })}
                >
                  <OptionList options={pickers.customFields} empty={choose} />
                </select>
              )}
            </Field>
            <Field label={f.t('actions.customValue')}>
              {(p) => (
                <input
                  {...p}
                  style={inputStyle}
                  value={draft.value}
                  data-testid="action-custom-value"
                  onChange={(e) => set({ value: e.target.value })}
                />
              )}
            </Field>
          </>
        ) : null}
        {draft.type === 'SET_DESCRIPTION' || draft.type === 'APPEND_NOTE' ? (
          <Field label={f.t('actions.text')} error={error}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                maxLength={500}
                value={draft.text}
                data-testid="action-text"
                onChange={(e) => set({ text: e.target.value })}
              />
            )}
          </Field>
        ) : null}
      </div>
      {draft.type === 'EXCLUDE_FROM_IMPORT' ? (
        <small style={mutedStyle}>{f.t('actions.excludeHint')}</small>
      ) : null}
      {draft.type === 'SET_DESCRIPTION' ? (
        <small style={mutedStyle}>{f.t('actions.descriptionHint')}</small>
      ) : null}
      <div>
        <button type="button" onClick={onRemove} data-testid="action-remove">
          {f.t('actions.remove', { n })}
        </button>
      </div>
    </fieldset>
  );
}

/** Resultado de probar la definición vigente del editor contra un ejemplo (sin guardar nada). */
export function PreviewResult({
  preview,
  f,
  names,
}: {
  preview: RulePreview;
  f: FormatContext;
  names: Catalogs['names'];
}) {
  const describe = (a: RulePreview['actions'][number]): string => {
    const target =
      a.type === 'SET_CATEGORY'
        ? (names.category(a.categoryId ?? '') ?? a.categoryId)
        : a.type === 'ADD_TAG' || a.type === 'REMOVE_TAG'
          ? (names.tag(a.tagId ?? '') ?? a.tagId)
          : a.type === 'SET_COUNTERPARTY'
            ? (names.counterparty(a.counterpartyId ?? '') ?? a.counterpartyId)
            : (a.text ?? (a.value === undefined ? '' : String(a.value)));
    return target ? `${f.t(`actionTypes.${a.type}`)}: ${target}` : f.t(`actionTypes.${a.type}`);
  };
  return (
    <div data-testid="preview-result" data-matched={preview.matched ? 'true' : 'false'}>
      <p>
        <strong>{preview.matched ? f.t('preview.matched') : f.t('preview.notMatched')}</strong>
      </p>
      <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
        {preview.conditions.map((c) => (
          <li key={c.path} data-testid="preview-condition" data-met={c.met ? 'true' : 'false'}>
            <span aria-hidden="true">{c.met ? '✔' : '✘'}</span>{' '}
            {c.met ? f.t('preview.conditionMet') : f.t('preview.conditionNotMet')}
            {c.actual !== null
              ? ` — ${f.t('preview.actual', { value: c.actual })}`
              : ` — ${f.t('preview.noValue')}`}
          </li>
        ))}
      </ul>
      {preview.matched ? (
        preview.actions.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="preview-actions">
            {preview.actions.map((a, i) => (
              <li key={`${a.type}-${i}`}>{describe(a)}</li>
            ))}
          </ul>
        ) : (
          <p style={mutedStyle}>{f.t('preview.noActions')}</p>
        )
      ) : null}
      {preview.skipped.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="preview-skipped">
          {preview.skipped.map((s, i) => (
            <li key={`${s.action}-${i}`}>
              {f.t(`actionTypes.${s.action}`)}:{' '}
              {f.has(`skip.${s.reason}`) ? f.t(`skip.${s.reason}`) : s.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function VersionsPanel({ versions, f }: { versions: readonly RuleVersion[]; f: FormatContext }) {
  return (
    <section aria-labelledby="rule-versions-title" style={cardStyle} data-testid="rule-versions">
      <h2 id="rule-versions-title" style={{ marginTop: 0 }}>
        {f.t('versions.title')}
      </h2>
      <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
        {versions.map((v) => (
          <li key={v.version} data-testid="rule-version" data-version={v.version}>
            {f.t('versions.item', {
              version: v.version,
              date: formatBusinessDate(v.createdAt.slice(0, 10)),
              conditions: v.conditions.length,
              actions: v.actions.length,
            })}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** `/reglas/nueva` y `/reglas/{ruleId}`: editor de condiciones y acciones con vista previa en vivo e historial de versiones. */
export function RuleEditorPage({ ruleId }: { ruleId?: string }) {
  return <WithWorkspace>{(ctx) => <RuleEditor ctx={ctx} ruleId={ruleId} />}</WithWorkspace>;
}

function RuleEditor({ ctx, ruleId }: { ctx: WorkspaceContext; ruleId: string | undefined }) {
  const f = useFormat('Rules', ctx);
  const catalogs = useCatalogs(ctx);
  const customFields = useCustomFields(ctx);
  const search = useSearchParams();
  const seed = useMemo(() => seedFromQuery(new URLSearchParams(search?.toString() ?? '')), [search]);
  const [rule, setRule] = useState<Rule | undefined>();
  const [versions, setVersions] = useState<readonly RuleVersion[]>([]);
  const [draft, setDraft] = useState<RuleDraft>(() => (ruleId ? emptyDraft() : draftFromSeed(seed)));
  const [loaded, setLoaded] = useState(ruleId === undefined);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [errors, setErrors] = useState<readonly DraftError[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const { api, base } = ctx;
  const editable = ctx.canEdit && rule?.status !== 'ARCHIVED';

  const load = useCallback(async () => {
    if (!ruleId) return;
    try {
      const [r, v] = await Promise.all([
        api.get<Rule>(rulesPath(base, `/${ruleId}`)),
        api.get<{ data: RuleVersion[] }>(rulesPath(base, `/${ruleId}/versions`)),
      ]);
      if (r.data) {
        setRule(r.data);
        setDraft(ruleToDraft(r.data));
      }
      setVersions(v.data?.data ?? []);
      setProblem(undefined);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setLoaded(true);
    }
  }, [api, base, ruleId]);
  useEffect(() => {
    void load();
  }, [load]);

  const pickers: Pickers = useMemo(
    () => ({
      categories: allCategoryGroups(catalogs.categories, catalogs.groups, f),
      tags: tagOptions(catalogs.tags),
      counterparties: counterpartyOptions(catalogs.counterparties),
      accounts: accountOptions(catalogs.accounts),
      customFields: customFields.active('TRANSACTION').map((d) => ({ id: d.id, label: d.label })),
    }),
    [
      catalogs.categories,
      catalogs.groups,
      catalogs.tags,
      catalogs.counterparties,
      catalogs.accounts,
      customFields,
      f,
    ],
  );
  const currencies = useMemo(
    () => [...new Set([ctx.ws.baseCurrency, ...ctx.currencies.map((c) => c.code)])],
    [ctx.ws.baseCurrency, ctx.currencies],
  );

  const setConditions = (conditions: readonly ConditionItemDraft[]) =>
    setDraft((d) => ({ ...d, conditions }));
  const setActions = (actions: readonly ActionDraft[]) => setDraft((d) => ({ ...d, actions }));
  const nameError = errorAt(errors, 'name');
  const summaryRef = useRef<HTMLDivElement>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validateDraft(draft);
    setErrors(found);
    setSaved(false);
    if (found.length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setBusy(true);
    try {
      const body = draftBody(draft);
      if (ruleId && rule) {
        const r = await api.command<Rule>('PUT', rulesPath(base, `/${ruleId}`), body, {
          ifMatch: rule.rowVersion,
        });
        if (r.data) {
          setRule(r.data);
          setDraft(ruleToDraft(r.data));
        }
        await load();
        setSaved(true);
      } else {
        const r = await api.command<Rule>('POST', rulesPath(base), body);
        if (r.data) window.location.assign(ctx.href(`/reglas/${r.data.id}`));
      }
      setProblem(undefined);
    } catch (err) {
      setProblem(problemOf(err));
      // 412: otro EDITOR cambió la regla; se recarga para volver a editar sobre la versión vigente.
      if (problemOf(err).code === 'PRECONDITION_FAILED') await load();
    } finally {
      setBusy(false);
    }
  };

  const transition = async (action: 'enable' | 'disable' | 'archive') => {
    if (!rule) return;
    setBusy(true);
    try {
      await api.command('POST', rulesPath(base, `/${rule.id}/${action}`), undefined, {
        ifMatch: rule.rowVersion,
        idempotent: false,
      });
      await load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  };

  // ── vista previa en vivo (definición sin guardar)
  const [sample, setSample] = useState({
    description: '',
    amount: '100.00',
    currency: ctx.ws.baseCurrency,
    kind: 'EXPENSE',
  });
  const [preview, setPreview] = useState<RulePreview | undefined>();
  const [previewProblem, setPreviewProblem] = useState<ApiProblemBody | undefined>();
  const operandErrors = validateDraft(draft).some(
    (e) =>
      e.key === 'operandRequired' ||
      e.key === 'conditionsRequired' ||
      e.key === 'targetRequired' ||
      e.key === 'actionsRequired',
  );
  const definitionKey = JSON.stringify([draftDefinition(draft), sample]);
  useEffect(() => {
    if (operandErrors || sample.description.trim() === '') {
      setPreview(undefined);
      setPreviewProblem(undefined);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .command<RulePreview>(
          'POST',
          rulesPath(base, '/preview'),
          {
            definition: draftDefinition(draft),
            subject: {
              sample: {
                description: sample.description,
                amount: { amount: sample.amount, currency: sample.currency },
                kind: sample.kind,
              },
            },
          },
          { idempotent: false },
        )
        .then((r) => {
          if (cancelled) return;
          setPreview(r.data);
          setPreviewProblem(undefined);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPreview(undefined);
          setPreviewProblem(problemOf(err));
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // La definición y el ejemplo completos se resumen en `definitionKey`.
  }, [definitionKey, operandErrors, api, base]);

  if (!loaded) return <p aria-busy="true">{f.t('loading')}</p>;
  if (ruleId && !rule) {
    return problem ? (
      <ProblemMessage problem={problem} locale={ctx.uiLocale} />
    ) : (
      <p>{f.t('editor.notFound')}</p>
    );
  }

  return (
    <section aria-labelledby="rule-editor-title" style={pageStyle} data-testid="rule-editor">
      <p>
        <a href={ctx.href('/reglas')}>{f.t('editor.back')}</a>
      </p>
      <h1 id="rule-editor-title">
        {ruleId ? f.t('editor.editTitle', { name: rule?.name ?? '' }) : f.t('editor.newTitle')}
      </h1>
      {rule ? (
        <p style={mutedStyle} data-testid="rule-meta">
          <RuleStatusBadge status={rule.status} f={f} />{' '}
          {f.t('editor.versionInfo', { version: rule.version })}
          {rule.needsAttention ? <span data-testid="rule-attention"> · {f.t('list.attention')}</span> : null}
        </p>
      ) : null}
      {!ruleId && Object.keys(seed).length > 0 ? (
        <p style={warningStyle} role="status" data-testid="rule-seed-notice">
          {f.t('editor.seedNotice')}
        </p>
      ) : null}
      {!ctx.canEdit ? <p style={mutedStyle}>{f.t('viewerNotice')}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {saved ? (
        <p role="status" data-testid="rule-saved">
          {f.t('editor.saved')}
        </p>
      ) : null}
      {errors.length > 0 ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" style={warningStyle} data-testid="rule-errors">
          <strong>{f.t('editor.errorsTitle')}</strong>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {errors.map((e) => (
              <li key={`${e.path}-${e.key}`}>{f.t(`errors.${e.key}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <form onSubmit={(e) => void submit(e)} style={formStyle} noValidate aria-busy={busy}>
        <fieldset
          disabled={!editable || busy}
          style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-3)' }}
        >
          <div style={rowStyle}>
            <Field label={f.t('editor.name')} error={nameError ? f.t(`errors.${nameError}`) : undefined}>
              {(p) => (
                <input
                  {...p}
                  style={inputStyle}
                  maxLength={80}
                  value={draft.name}
                  data-testid="rule-name"
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              )}
            </Field>
            <Field
              label={f.t('editor.priority')}
              hint={f.t('editor.priorityHint')}
              error={errorAt(errors, 'priority') ? f.t('errors.priorityInvalid') : undefined}
            >
              {(p) => (
                <input
                  {...p}
                  style={inputStyle}
                  inputMode="numeric"
                  value={draft.priority}
                  data-testid="rule-priority"
                  onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
                />
              )}
            </Field>
          </div>
          <Field label={f.t('editor.description')}>
            {(p) => (
              <textarea
                {...p}
                style={inputStyle}
                rows={2}
                maxLength={500}
                value={draft.description}
                data-testid="rule-description"
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            )}
          </Field>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{f.t('editor.triggers')}</legend>
            <div style={rowStyle}>
              {TRIGGERS.map((t) => (
                <label key={t} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={draft.triggers.includes(t)}
                    data-testid={`rule-trigger-${t}`}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        triggers: TRIGGERS.filter((x) =>
                          x === t ? e.target.checked : d.triggers.includes(x),
                        ),
                      }))
                    }
                  />
                  {f.t(`triggers.${t}`)}
                </label>
              ))}
            </div>
            <small style={mutedStyle}>{f.t('editor.triggersHint')}</small>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
            <legend>
              <strong>{f.t('conditions.title')}</strong>
            </legend>
            <Field label={f.t('editor.matchMode')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={draft.matchMode}
                  data-testid="rule-match-mode"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, matchMode: e.target.value as RuleDraft['matchMode'] }))
                  }
                >
                  <option value="ALL">{f.t('match.ALL')}</option>
                  <option value="ANY">{f.t('match.ANY')}</option>
                </select>
              )}
            </Field>
            {draft.conditions.map((item, i) =>
              item.kind === 'condition' ? (
                <ConditionEditor
                  key={`c-${i}`}
                  index={i}
                  draft={item}
                  testId="condition-row"
                  pickers={pickers}
                  currencies={currencies}
                  f={f}
                  error={errorAt(errors, `conditions.${i}`) ? f.t('errors.operandRequired') : undefined}
                  onChange={(next) =>
                    setConditions(
                      draft.conditions.map((c, j) => (j === i ? { kind: 'condition', ...next } : c)),
                    )
                  }
                  onRemove={() => setConditions(draft.conditions.filter((_, j) => j !== i))}
                />
              ) : (
                <fieldset
                  key={`g-${i}`}
                  style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
                  data-testid="condition-group"
                >
                  <legend>{f.t('conditions.group', { n: i + 1 })}</legend>
                  <Field label={f.t('conditions.groupMatch')}>
                    {(p) => (
                      <select
                        {...p}
                        style={inputStyle}
                        value={item.match}
                        data-testid="group-match-mode"
                        onChange={(e) =>
                          setConditions(
                            draft.conditions.map((c, j) =>
                              j === i && c.kind === 'group'
                                ? { ...c, match: e.target.value as 'ALL' | 'ANY' }
                                : c,
                            ),
                          )
                        }
                      >
                        <option value="ALL">{f.t('match.ALL')}</option>
                        <option value="ANY">{f.t('match.ANY')}</option>
                      </select>
                    )}
                  </Field>
                  {item.items.map((c, k) => (
                    <ConditionEditor
                      key={`g-${i}-${k}`}
                      index={k}
                      draft={c}
                      testId="group-condition-row"
                      pickers={pickers}
                      currencies={currencies}
                      f={f}
                      error={
                        errorAt(errors, `conditions.${i}.items.${k}`)
                          ? f.t('errors.operandRequired')
                          : undefined
                      }
                      onChange={(next) =>
                        setConditions(
                          draft.conditions.map((g, j) =>
                            j === i && g.kind === 'group'
                              ? { ...g, items: g.items.map((x, m) => (m === k ? next : x)) }
                              : g,
                          ),
                        )
                      }
                      onRemove={() =>
                        setConditions(
                          draft.conditions.flatMap((g, j) =>
                            j !== i || g.kind !== 'group'
                              ? [g]
                              : g.items.length > 1
                                ? [{ ...g, items: g.items.filter((_, m) => m !== k) }]
                                : [],
                          ),
                        )
                      }
                    />
                  ))}
                  <div style={rowStyle}>
                    <button
                      type="button"
                      data-testid="group-add-condition"
                      onClick={() =>
                        setConditions(
                          draft.conditions.map((g, j) =>
                            j === i && g.kind === 'group'
                              ? { ...g, items: [...g.items, emptyCondition()] }
                              : g,
                          ),
                        )
                      }
                    >
                      {f.t('conditions.addToGroup')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConditions(draft.conditions.filter((_, j) => j !== i))}
                    >
                      {f.t('conditions.removeGroup', { n: i + 1 })}
                    </button>
                  </div>
                </fieldset>
              ),
            )}
            <div style={rowStyle}>
              <button
                type="button"
                data-testid="condition-add"
                onClick={() =>
                  setConditions([...draft.conditions, { kind: 'condition', ...emptyCondition() }])
                }
              >
                {f.t('conditions.add')}
              </button>
              <button
                type="button"
                data-testid="condition-add-group"
                onClick={() =>
                  setConditions([
                    ...draft.conditions,
                    { kind: 'group', match: 'ANY', items: [emptyCondition()] },
                  ])
                }
              >
                {f.t('conditions.addGroup')}
              </button>
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
            <legend>
              <strong>{f.t('actions.title')}</strong>
            </legend>
            {draft.actions.map((a, i) => (
              <ActionEditor
                key={`a-${i}`}
                index={i}
                draft={a}
                pickers={pickers}
                f={f}
                error={errorAt(errors, `actions.${i}`) ? f.t('errors.targetRequired') : undefined}
                onChange={(next) => setActions(draft.actions.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setActions(draft.actions.filter((_, j) => j !== i))}
              />
            ))}
            <div>
              <button
                type="button"
                data-testid="action-add"
                onClick={() => setActions([...draft.actions, emptyAction()])}
              >
                {f.t('actions.add')}
              </button>
            </div>
          </fieldset>

          <label style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={draft.stopProcessing}
              data-testid="rule-stop-processing"
              onChange={(e) => setDraft((d) => ({ ...d, stopProcessing: e.target.checked }))}
            />
            {f.t('editor.stopProcessing')}
          </label>
          <small style={mutedStyle}>{f.t('editor.stopProcessingHint')}</small>
        </fieldset>
        {editable ? (
          <div style={rowStyle}>
            <button type="submit" disabled={busy} data-testid="rule-submit">
              {busy ? f.t('editor.saving') : f.t('editor.save')}
            </button>
            {rule && ctx.canEdit ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void transition(rule.enabled ? 'disable' : 'enable')}
                  data-testid="rule-toggle"
                >
                  {rule.enabled ? f.t('list.disable') : f.t('list.enable')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void transition('archive')}
                  data-testid="rule-archive"
                >
                  {f.t('list.archive')}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </form>

      <section aria-labelledby="rule-preview-title" style={cardStyle} data-testid="rule-preview">
        <h2 id="rule-preview-title" style={{ marginTop: 0 }}>
          {f.t('preview.title')}
        </h2>
        <p style={mutedStyle}>{f.t('preview.intro')}</p>
        <div style={rowStyle}>
          <Field label={f.t('preview.description')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                value={sample.description}
                data-testid="preview-description"
                onChange={(e) => setSample((s) => ({ ...s, description: e.target.value }))}
              />
            )}
          </Field>
          <Field label={f.t('preview.amount')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={sample.amount}
                data-testid="preview-amount"
                onChange={(e) => setSample((s) => ({ ...s, amount: e.target.value }))}
              />
            )}
          </Field>
          <Field label={f.t('preview.currency')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={sample.currency}
                onChange={(e) => setSample((s) => ({ ...s, currency: e.target.value }))}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={f.t('preview.kind')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={sample.kind}
                data-testid="preview-kind"
                onChange={(e) => setSample((s) => ({ ...s, kind: e.target.value }))}
              >
                {(['EXPENSE', 'INCOME', 'REFUND'] as const).map((k) => (
                  <option key={k} value={k}>
                    {f.t(`kinds.${k}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div aria-live="polite">
          {previewProblem ? <ProblemMessage problem={previewProblem} locale={ctx.uiLocale} /> : null}
          {preview ? (
            <PreviewResult preview={preview} f={f} names={catalogs.names} />
          ) : (
            <p style={mutedStyle}>{f.t('preview.empty')}</p>
          )}
        </div>
      </section>
      {versions.length > 0 ? <VersionsPanel versions={versions} f={f} /> : null}
    </section>
  );
}
