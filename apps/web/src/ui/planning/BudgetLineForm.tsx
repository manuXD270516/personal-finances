import { Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import {
  BUDGET_LINE_KINDS,
  ROLLOVER_KINDS,
  THRESHOLD_KINDS,
  type BudgetLineKind,
  type BudgetNature,
  type BudgetTargetKind,
  type IncomeBasis,
  type LineFormErrors,
  type LineFormValues,
  type RolloverPolicy,
} from './budget-logic';

export interface TargetOption {
  readonly id: string;
  readonly name: string;
  readonly nature: BudgetNature;
}

export type TargetOptions = Readonly<Record<BudgetTargetKind, readonly TargetOption[]>>;

const TARGET_KINDS: readonly BudgetTargetKind[] = ['CATEGORY', 'GROUP', 'TAG'];
const POLICIES: readonly RolloverPolicy[] = ['NONE', 'CARRY_POSITIVE', 'CARRY_ALL'];
const BASES: readonly IncomeBasis[] = ['EXPECTED', 'ACTUAL'];

/** Naturaleza (gasto o ingreso) del objetivo elegido; los tags son siempre de gasto. */
export function natureOf(targets: TargetOptions, values: LineFormValues): BudgetNature {
  if (values.targetKind === 'TAG') return 'EXPENSE';
  return targets[values.targetKind].find((o) => o.id === values.targetId)?.nature ?? 'EXPENSE';
}

/**
 * Formulario de una línea del plan (alta y edición; openspec add-budgets 6.1). Muestra solo los campos que aplican al
 * tipo elegido: fijo/máximo piden el planificado, mínimo el mínimo, rango ambos, % de ingresos el porcentaje y su base;
 * el rollover y los umbrales solo en líneas de gasto que los admiten. Las líneas de ingreso solo admiten monto fijo.
 * Los errores por campo se pintan con `aria-describedby`; las reglas de negocio las devuelve la API por `code`.
 */
export function BudgetLineForm({
  mode,
  values,
  errors,
  targets,
  currency,
  f,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit';
  values: LineFormValues;
  errors: LineFormErrors;
  targets: TargetOptions;
  currency: string;
  f: FormatContext;
  busy?: boolean;
  onChange: (next: LineFormValues) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const set = <K extends keyof LineFormValues>(key: K, value: LineFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const nature = natureOf(targets, values);
  const kinds: readonly BudgetLineKind[] = nature === 'INCOME' ? ['FIXED'] : BUDGET_LINE_KINDS;
  const kind = nature === 'INCOME' ? 'FIXED' : values.kind;
  const err = (field: keyof LineFormValues) =>
    errors[field] ? f.t(`form.errors.${errors[field]}`) : undefined;
  const rolloverEligible = nature === 'EXPENSE' && ROLLOVER_KINDS.includes(kind);
  const thresholdsEligible = nature === 'EXPENSE' && THRESHOLD_KINDS.includes(kind);
  return (
    <form
      style={formStyle}
      aria-label={f.t(mode === 'add' ? 'form.titleAdd' : 'form.titleEdit')}
      data-testid={mode === 'add' ? 'budget-line-form-add' : 'budget-line-form-edit'}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h3 style={{ margin: 0 }}>{f.t(mode === 'add' ? 'form.titleAdd' : 'form.titleEdit')}</h3>
      <div style={rowStyle}>
        <Field label={f.t('form.targetKind')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={values.targetKind}
              disabled={mode === 'edit'}
              onChange={(e) =>
                onChange({ ...values, targetKind: e.target.value as BudgetTargetKind, targetId: '' })
              }
              data-testid="form-target-kind"
            >
              {TARGET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {f.t(`targetKind.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('form.target')} error={err('targetId')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={values.targetId}
              disabled={mode === 'edit'}
              required
              onChange={(e) => set('targetId', e.target.value)}
              data-testid="form-target"
            >
              <option value="">{f.t('form.targetPlaceholder')}</option>
              {targets[values.targetKind].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.nature === 'INCOME' ? ` (${f.t('lines.income')})` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('form.kind')} hint={nature === 'INCOME' ? f.t('form.incomeFixedOnly') : undefined}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={kind}
              onChange={(e) => set('kind', e.target.value as BudgetLineKind)}
              data-testid="form-kind"
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {f.t(`kind.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        {kind === 'FIXED' || kind === 'MAXIMUM' ? (
          <Field label={f.t('form.planned', { currency })} error={err('planned')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={values.planned}
                onChange={(e) => set('planned', e.target.value)}
                data-testid="form-planned"
              />
            )}
          </Field>
        ) : null}
        {kind === 'MINIMUM' || kind === 'RANGE' ? (
          <Field label={f.t('form.min', { currency })} error={err('min')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={values.min}
                onChange={(e) => set('min', e.target.value)}
                data-testid="form-min"
              />
            )}
          </Field>
        ) : null}
        {kind === 'RANGE' ? (
          <Field label={f.t('form.max', { currency })} error={err('max')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={values.max}
                onChange={(e) => set('max', e.target.value)}
                data-testid="form-max"
              />
            )}
          </Field>
        ) : null}
        {kind === 'PERCENT_OF_INCOME' ? (
          <>
            <Field label={f.t('form.percent')} error={err('percent')} hint={f.t('form.percentHint')}>
              {(p) => (
                <input
                  {...p}
                  style={inputStyle}
                  inputMode="decimal"
                  value={values.percent}
                  onChange={(e) => set('percent', e.target.value)}
                  data-testid="form-percent"
                />
              )}
            </Field>
            <Field label={f.t('form.incomeBasis')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={values.incomeBasis}
                  onChange={(e) => set('incomeBasis', e.target.value as IncomeBasis)}
                  data-testid="form-income-basis"
                >
                  {BASES.map((b) => (
                    <option key={b} value={b}>
                      {f.t(`basis.${b}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        ) : null}
      </div>
      {rolloverEligible ? (
        <div style={rowStyle}>
          <Field label={f.t('form.rolloverPolicy')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={values.rolloverPolicy}
                onChange={(e) => set('rolloverPolicy', e.target.value as RolloverPolicy)}
                data-testid="form-rollover-policy"
              >
                {POLICIES.map((r) => (
                  <option key={r} value={r}>
                    {f.t(`rolloverPolicy.${r}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {values.rolloverPolicy !== 'NONE' ? (
            <Field label={f.t('form.rolloverCap', { currency })} error={err('rolloverCap')}>
              {(p) => (
                <input
                  {...p}
                  style={inputStyle}
                  inputMode="decimal"
                  value={values.rolloverCap}
                  onChange={(e) => set('rolloverCap', e.target.value)}
                  data-testid="form-rollover-cap"
                />
              )}
            </Field>
          ) : null}
        </div>
      ) : null}
      {thresholdsEligible ? (
        <Field label={f.t('form.thresholds')} error={err('thresholds')} hint={f.t('form.thresholdsHint')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              value={values.thresholds}
              placeholder="50, 75, 90, 100"
              onChange={(e) => set('thresholds', e.target.value)}
              data-testid="form-thresholds"
            />
          )}
        </Field>
      ) : null}
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('form.currencyNote', { currency })}</p>
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="form-submit">
          {f.t(mode === 'add' ? 'form.add' : 'form.save')}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={busy}>
            {f.t('form.cancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
