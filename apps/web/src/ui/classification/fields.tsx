import type { CSSProperties } from 'react';
import { Field, inputStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { CATEGORY_ICONS, ICON_NAMES, isHexColor } from './logic';

/** Glifo decorativo del icono (el nombre accesible lo da el texto de la fila). */
export function IconGlyph({ icon }: { icon: string | null | undefined }) {
  if (!icon) return null;
  return (
    <span aria-hidden="true" data-testid="icon" data-icon={icon}>
      {CATEGORY_ICONS[icon] ?? '•'}{' '}
    </span>
  );
}

const swatch = (color: string): CSSProperties => ({
  display: 'inline-block',
  width: '0.85rem',
  height: '0.85rem',
  borderRadius: '50%',
  border: '1px solid #57606a',
  background: color,
  verticalAlign: 'middle',
  marginRight: '0.25rem',
});

/** Muestra de color decorativa (el color también figura como texto en el formulario de edición). */
export function ColorSwatch({ color }: { color: string | null | undefined }) {
  if (!color) return null;
  return <span aria-hidden="true" data-testid="color" data-color={color} style={swatch(color)} />;
}

/** Selector de icono con etiquetas traducidas; un icono guardado desconocido se conserva como opción. */
export function IconField({
  f,
  value,
  onChange,
  name = 'icon',
}: {
  f: FormatContext;
  value: string;
  onChange: (v: string) => void;
  name?: string;
}) {
  const { t, has } = f;
  const options = value && !ICON_NAMES.includes(value) ? [value, ...ICON_NAMES] : ICON_NAMES;
  return (
    <Field label={t('icon')} style={{ flex: '0 1 11rem' }}>
      {(p) => (
        <select
          {...p}
          name={name}
          style={inputStyle}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t('noIcon')}</option>
          {options.map((icon) => (
            <option key={icon} value={icon}>
              {CATEGORY_ICONS[icon] ?? '•'} {has?.(`icons.${icon}`) ? t(`icons.${icon}`) : icon}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * Color opcional: `<input type="color">` (accesible por teclado en los navegadores soportados) más una casilla
 * "Sin color"; el valor se guarda como `#RRGGBB`.
 */
export function ColorField({
  f,
  value,
  onChange,
  name = 'color',
}: {
  f: FormatContext;
  value: string;
  onChange: (v: string) => void;
  name?: string;
}) {
  const { t } = f;
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'end', flexWrap: 'wrap' }}>
      <Field label={t('color')} style={{ flex: '0 0 auto' }}>
        {(p) => (
          <input
            {...p}
            type="color"
            name={name}
            value={isHexColor(value) ? value : '#1565c0'}
            disabled={!value}
            onChange={(e) => onChange(e.target.value)}
            style={{ minWidth: '3rem', minHeight: '2rem' }}
          />
        )}
      </Field>
      <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', paddingBottom: '0.4rem' }}>
        <input
          type="checkbox"
          name={`${name}-none`}
          checked={!value}
          onChange={(e) => onChange(e.target.checked ? '' : '#1565c0')}
        />
        {t('noColor')}
      </label>
    </div>
  );
}
