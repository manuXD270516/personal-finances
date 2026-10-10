'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { FormatContext } from '../dashboard/types';
import {
  Field,
  cellStyle,
  errorStyle,
  formStyle,
  inputStyle,
  mutedStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
} from '../common/ui';
import {
  DATE_FORMAT_EXAMPLE,
  DATE_FORMAT_OPTIONS,
  MAPPING_FIELD_ORDER,
  columnNames,
  roleOfColumn,
  sampleRecords,
  truncate,
  type AmountMode,
  type MappingErrors,
  type MappingField,
  type MappingForm,
} from './logic';

/** Selector de columna: "Columna 3 — Monto" (el encabezado es texto del archivo, no confiable: solo se muestra). */
function ColumnSelect({
  f,
  count,
  names,
  value,
  onChange,
  disabled,
  testId,
  ...aria
}: {
  f: FormatContext;
  count: number;
  names: readonly (string | undefined)[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  testId: string;
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}) {
  return (
    <select
      {...aria}
      style={inputStyle}
      value={value}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{f.t('mapping.chooseColumn')}</option>
      {Array.from({ length: count }, (_, i) => (
        <option key={i} value={String(i)}>
          {names[i]
            ? f.t('mapping.columnNamed', { n: i + 1, name: truncate(names[i] ?? '') })
            : f.t('mapping.column', { n: i + 1 })}
        </option>
      ))}
    </select>
  );
}

const FIELD_LABEL: Readonly<Record<MappingField, string>> = {
  skipRows: 'mapping.skipRows',
  dateIndex: 'mapping.date',
  descriptionIndex: 'mapping.description',
  amountIndex: 'mapping.amount',
  signConvention: 'mapping.signConvention',
  debitIndex: 'mapping.debit',
  creditIndex: 'mapping.credit',
  dateFormat: 'mapping.dateFormat',
  decimalSeparator: 'mapping.decimalSeparator',
};

const errorText = (f: FormatContext, errors: MappingErrors, field: MappingField): string | undefined => {
  const code = errors[field];
  return code ? f.t(`mapping.errors.${code}`) : undefined;
};

/**
 * Paso 2 (Columnas): muestra el encabezado y la muestra de hasta 20 filas del archivo y pide, SIN adivinar, qué columna es
 * la fecha, la descripción y el monto (una columna con signo o débito y crédito), el formato de fecha, el separador
 * decimal, la convención de signo y las filas a saltar. Componente controlado: el formulario vive en el asistente.
 */
export function MappingStep({
  f,
  header,
  sampleRows,
  columnCount,
  form,
  errors,
  busy,
  canEdit,
  onChange,
  onApply,
  children,
}: {
  f: FormatContext;
  header: readonly string[];
  /** `undefined` cuando se retoma la importación: la muestra solo viaja al crearla. */
  sampleRows: readonly (readonly string[])[] | undefined;
  columnCount: number;
  form: MappingForm;
  errors: MappingErrors;
  busy: boolean;
  canEdit: boolean;
  onChange: (patch: Partial<MappingForm>) => void;
  onApply: () => void;
  children?: ReactNode;
}) {
  const names = columnNames(header, form.hasHeader, form.skipRows);
  const records = sampleRecords(header, sampleRows);
  const disabled = busy || !canEdit;
  const summaryRef = useRef<HTMLDivElement>(null);
  const failed = MAPPING_FIELD_ORDER.filter((field) => errors[field] !== undefined);
  const failedKey = failed.join(',');
  useEffect(() => {
    if (failedKey) summaryRef.current?.focus();
  }, [failedKey]);

  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-4)' }} data-testid="import-mapping">
      <section aria-labelledby="mapping-sample-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
        <h3 id="mapping-sample-title" style={{ margin: 0 }}>
          {f.t('mapping.sampleTitle')}
        </h3>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('mapping.untrusted')}</p>
        {sampleRows === undefined ? (
          <p style={{ ...mutedStyle, margin: 0 }} data-testid="mapping-no-sample">
            {f.t('mapping.noSample')}
          </p>
        ) : null}
        <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('mapping.sampleRegion')}>
          <table style={tableStyle} data-testid="mapping-sample">
            <caption className="pf-sr-only">{f.t('mapping.sampleCaption')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {f.t('mapping.recordNumber')}
                </th>
                {Array.from({ length: columnCount }, (_, i) => {
                  const role = roleOfColumn(form, i);
                  return (
                    <th key={i} scope="col" style={cellStyle} data-role={role}>
                      {f.t('mapping.column', { n: i + 1 })}
                      {role ? <span style={mutedStyle}> · {f.t(`mapping.roles.${role}`)}</span> : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {records.map((cells, r) => (
                <tr key={r}>
                  <th scope="row" style={cellStyle}>
                    {r + 1}
                  </th>
                  {Array.from({ length: columnCount }, (_, i) => (
                    <td key={i} style={cellStyle}>
                      {cells[i] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <form
        style={formStyle}
        noValidate
        aria-label={f.t('mapping.formLabel')}
        onSubmit={(e) => {
          e.preventDefault();
          onApply();
        }}
      >
        {failed.length > 0 ? (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            data-testid="mapping-errors"
            style={{ ...errorStyle, display: 'grid', gap: 'var(--pf-space-1)' }}
          >
            <strong>{f.t('mapping.errorsTitle')}</strong>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {failed.map((field) => (
                <li key={field}>
                  {f.t(FIELD_LABEL[field])}: {errorText(f, errors, field)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={rowStyle}>
          <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.hasHeader}
              disabled={disabled}
              data-testid="mapping-has-header"
              onChange={(e) => onChange({ hasHeader: e.target.checked })}
            />
            {f.t('mapping.hasHeader')}
          </label>
          <Field
            label={f.t('mapping.skipRows')}
            hint={f.t('mapping.skipRowsHint')}
            error={errorText(f, errors, 'skipRows')}
          >
            {(p) => (
              <input
                {...p}
                type="text"
                inputMode="numeric"
                style={inputStyle}
                value={form.skipRows}
                disabled={disabled}
                data-testid="mapping-skip-rows"
                onChange={(e) => onChange({ skipRows: e.target.value })}
              />
            )}
          </Field>
        </div>

        <div style={rowStyle}>
          <Field label={f.t('mapping.date')} error={errorText(f, errors, 'dateIndex')}>
            {(p) => (
              <ColumnSelect
                testId="mapping-date"
                {...p}
                f={f}
                count={columnCount}
                names={names}
                value={form.dateIndex}
                disabled={disabled}
                onChange={(dateIndex) => onChange({ dateIndex })}
              />
            )}
          </Field>
          <Field label={f.t('mapping.description')} error={errorText(f, errors, 'descriptionIndex')}>
            {(p) => (
              <ColumnSelect
                testId="mapping-description"
                {...p}
                f={f}
                count={columnCount}
                names={names}
                value={form.descriptionIndex}
                disabled={disabled}
                onChange={(descriptionIndex) => onChange({ descriptionIndex })}
              />
            )}
          </Field>
        </div>

        <fieldset style={{ display: 'grid', gap: 'var(--pf-space-2)' }} disabled={disabled}>
          <legend>{f.t('mapping.amountMode')}</legend>
          {(['SIGNED', 'DEBIT_CREDIT'] as const satisfies readonly AmountMode[]).map((mode) => (
            <label key={mode} style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
              <input
                type="radio"
                name="mapping-amount-mode"
                value={mode}
                checked={form.amountMode === mode}
                data-testid={`mapping-mode-${mode}`}
                onChange={() => onChange({ amountMode: mode })}
              />
              {f.t(`mapping.modes.${mode}`)}
            </label>
          ))}
        </fieldset>

        {form.amountMode === 'SIGNED' ? (
          <div style={rowStyle}>
            <Field label={f.t('mapping.amount')} error={errorText(f, errors, 'amountIndex')}>
              {(p) => (
                <ColumnSelect
                  testId="mapping-amount"
                  {...p}
                  f={f}
                  count={columnCount}
                  names={names}
                  value={form.amountIndex}
                  disabled={disabled}
                  onChange={(amountIndex) => onChange({ amountIndex })}
                />
              )}
            </Field>
            <Field
              label={f.t('mapping.signConvention')}
              error={errorText(f, errors, 'signConvention')}
              hint={f.t('mapping.signHint')}
            >
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={form.signConvention}
                  disabled={disabled}
                  data-testid="mapping-sign"
                  onChange={(e) =>
                    onChange({ signConvention: e.target.value as MappingForm['signConvention'] })
                  }
                >
                  <option value="">{f.t('mapping.chooseOption')}</option>
                  <option value="NEGATIVE_IS_OUTFLOW">{f.t('mapping.sign.NEGATIVE_IS_OUTFLOW')}</option>
                  <option value="POSITIVE_IS_OUTFLOW">{f.t('mapping.sign.POSITIVE_IS_OUTFLOW')}</option>
                </select>
              )}
            </Field>
          </div>
        ) : (
          <div style={rowStyle}>
            <Field label={f.t('mapping.debit')} error={errorText(f, errors, 'debitIndex')}>
              {(p) => (
                <ColumnSelect
                  testId="mapping-debit"
                  {...p}
                  f={f}
                  count={columnCount}
                  names={names}
                  value={form.debitIndex}
                  disabled={disabled}
                  onChange={(debitIndex) => onChange({ debitIndex })}
                />
              )}
            </Field>
            <Field label={f.t('mapping.credit')} error={errorText(f, errors, 'creditIndex')}>
              {(p) => (
                <ColumnSelect
                  testId="mapping-credit"
                  {...p}
                  f={f}
                  count={columnCount}
                  names={names}
                  value={form.creditIndex}
                  disabled={disabled}
                  onChange={(creditIndex) => onChange({ creditIndex })}
                />
              )}
            </Field>
          </div>
        )}

        <div style={rowStyle}>
          <Field
            label={f.t('mapping.dateFormat')}
            error={errorText(f, errors, 'dateFormat')}
            hint={f.t('mapping.dateFormatHint')}
          >
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.dateFormat}
                disabled={disabled}
                data-testid="mapping-date-format"
                onChange={(e) => onChange({ dateFormat: e.target.value as MappingForm['dateFormat'] })}
              >
                <option value="">{f.t('mapping.chooseOption')}</option>
                {DATE_FORMAT_OPTIONS.map((fmt) => (
                  <option key={fmt} value={fmt}>
                    {fmt} ({DATE_FORMAT_EXAMPLE[fmt]})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={f.t('mapping.decimalSeparator')}
            error={errorText(f, errors, 'decimalSeparator')}
            hint={f.t('mapping.decimalHint')}
          >
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.decimalSeparator}
                disabled={disabled}
                data-testid="mapping-decimal"
                onChange={(e) =>
                  onChange({ decimalSeparator: e.target.value as MappingForm['decimalSeparator'] })
                }
              >
                <option value="">{f.t('mapping.chooseOption')}</option>
                <option value=",">{f.t('mapping.decimal.comma')}</option>
                <option value=".">{f.t('mapping.decimal.dot')}</option>
              </select>
            )}
          </Field>
        </div>

        <div style={rowStyle}>
          {canEdit ? (
            <button type="submit" disabled={busy} data-testid="mapping-apply">
              {busy ? f.t('mapping.applying') : f.t('mapping.apply')}
            </button>
          ) : null}
          {children}
        </div>
      </form>
    </div>
  );
}
