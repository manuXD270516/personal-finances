'use client';

import { useEffect, useMemo, useState } from 'react';
import { Field, inputStyle } from '../common/ui';
import { listAll, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import type { CustomFieldValues } from '../common/types';
import {
  activeFields,
  toInputText,
  type CustomFieldDefinition,
  type CustomFieldDraft,
  type CustomFieldError,
  type CustomFieldTarget,
} from './logic';

/** Definiciones de custom fields del workspace (activas y archivadas: los valores históricos conservan su etiqueta). */
export function useCustomFields(ctx: WorkspaceContext): {
  readonly loaded: boolean;
  readonly definitions: readonly CustomFieldDefinition[];
  readonly active: (target: CustomFieldTarget) => CustomFieldDefinition[];
} {
  const [definitions, setDefinitions] = useState<readonly CustomFieldDefinition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { api, base } = ctx;
  useEffect(() => {
    let cancelled = false;
    listAll<CustomFieldDefinition>(
      api,
      `${base}/custom-fields`,
      new URLSearchParams({ includeArchived: 'true' }),
    )
      .catch(() => [] as CustomFieldDefinition[])
      .then((list) => {
        if (cancelled) return;
        setDefinitions(list);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, base]);
  return useMemo(
    () => ({ loaded, definitions, active: (target) => activeFields(definitions, target) }),
    [loaded, definitions],
  );
}

/**
 * Controles dinámicos por tipo de los custom fields activos de una entidad (transacción, por split; o cuenta): texto,
 * entero y decimal (inputmode adecuado, el locale solo afecta lo escrito), fecha, Sí/No y selección. Cada campo lleva
 * su etiqueta; `suffix` desambigua las etiquetas cuando hay varios splits; `draft` solo guarda lo editado. `f` es del namespace `CustomFields`. La
 * validación final la hace la API.
 */
export function CustomFieldInputs({
  fields,
  draft,
  onChange,
  errors = {},
  f,
  idPrefix,
  suffix,
  original,
}: {
  fields: readonly CustomFieldDefinition[];
  draft: CustomFieldDraft;
  onChange: (key: string, value: string) => void;
  errors?: Readonly<Record<string, CustomFieldError>>;
  f: FormatContext;
  idPrefix: string;
  suffix?: string;
  /** Valores guardados del registro: se muestran mientras el campo no se edite (decimales con el separador del locale). */
  original?: CustomFieldValues | undefined;
}) {
  const { t } = f;
  if (fields.length === 0) return null;
  return (
    <>
      {fields.map((d) => {
        const label = `${d.label}${suffix ? ` ${suffix}` : ''}`;
        const error = errors[d.key] ? t(`errors.${errors[d.key]}`) : undefined;
        const hint = d.required ? t('required') : undefined;
        const value = draft[d.key] ?? toInputText(d, original?.[d.key], f.locale);
        const name = `${idPrefix}-${d.key}`;
        return (
          <Field key={d.id} label={label} error={error} hint={hint}>
            {(p) => {
              const common = {
                ...p,
                name,
                'data-custom-field': d.key,
                ...(d.required ? { 'aria-required': true as const } : {}),
              };
              switch (d.dataType) {
                case 'SELECT':
                  return (
                    <select
                      {...common}
                      style={inputStyle}
                      value={value}
                      onChange={(e) => onChange(d.key, e.target.value)}
                    >
                      <option value="">{t('none')}</option>
                      {d.options.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  );
                case 'BOOLEAN':
                  return (
                    <select
                      {...common}
                      style={inputStyle}
                      value={value}
                      onChange={(e) => onChange(d.key, e.target.value)}
                    >
                      <option value="">{t('none')}</option>
                      <option value="true">{t('yes')}</option>
                      <option value="false">{t('no')}</option>
                    </select>
                  );
                case 'DATE':
                  return (
                    <input
                      {...common}
                      type="date"
                      style={inputStyle}
                      value={value}
                      onChange={(e) => onChange(d.key, e.target.value)}
                    />
                  );
                case 'NUMBER':
                  return (
                    <input
                      {...common}
                      inputMode="numeric"
                      autoComplete="off"
                      style={inputStyle}
                      value={value}
                      onChange={(e) => onChange(d.key, e.target.value)}
                    />
                  );
                case 'DECIMAL':
                  return (
                    <input
                      {...common}
                      inputMode="decimal"
                      autoComplete="off"
                      style={inputStyle}
                      value={value}
                      onChange={(e) => onChange(d.key, e.target.value)}
                    />
                  );
                default:
                  return (
                    <input
                      {...common}
                      maxLength={500}
                      autoComplete="off"
                      style={inputStyle}
                      value={value}
                      onChange={(e) => onChange(d.key, e.target.value)}
                    />
                  );
              }
            }}
          </Field>
        );
      })}
    </>
  );
}
