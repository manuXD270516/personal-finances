import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * Piezas mínimas de UI (sin framework CSS) compartidas por las pantallas financieras: campos rotulados con error
 * accesible, paneles de confirmación y estilos que colapsan a una columna en móvil (NFR-USAB-006, 360 px). Los
 * colores, radios y espaciados salen de los tokens de `app/globals.css` (docs/28 §5); controles, botones y tablas
 * toman su aspecto base de esa hoja, por eso aquí solo se fija el layout.
 */

export const cardStyle: CSSProperties = {
  background: 'var(--pf-surface-raised)',
  border: '1px solid var(--pf-border)',
  borderRadius: 'var(--pf-radius-md)',
  padding: 'var(--pf-space-4)',
  minWidth: 0,
  overflowWrap: 'anywhere',
};
export const mutedStyle: CSSProperties = { color: 'var(--pf-fg-muted)', fontSize: 'var(--pf-text-sm)' };
export const warningStyle: CSSProperties = {
  borderLeft: '4px solid var(--pf-warning-border)',
  borderRadius: 'var(--pf-radius-sm)',
  background: 'var(--pf-warning-bg)',
  padding: 'var(--pf-space-2) var(--pf-space-3)',
  color: 'var(--pf-warning-fg)',
};
export const pageStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--pf-space-4)',
  maxWidth: '64rem',
  minWidth: 0,
  alignContent: 'start',
};
export const formStyle: CSSProperties = { ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' };
export const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--pf-space-2) var(--pf-space-3)',
  alignItems: 'end',
};
export const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--pf-space-1)',
  minWidth: 0,
  flex: '1 1 12rem',
  alignContent: 'start',
};
export const inputStyle: CSSProperties = { minWidth: 0, maxWidth: '100%' };
export const errorStyle: CSSProperties = {
  color: 'var(--pf-error)',
  fontSize: 'var(--pf-text-sm)',
  margin: 0,
};
export const tableWrapStyle: CSSProperties = {
  overflowX: 'auto',
  maxWidth: '100%',
  background: 'var(--pf-surface-raised)',
  border: '1px solid var(--pf-border)',
  borderRadius: 'var(--pf-radius-md)',
};
export const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.9375rem' };
export const cellStyle: CSSProperties = {
  padding: 'var(--pf-space-2) var(--pf-space-3)',
  borderBottom: '1px solid var(--pf-border)',
  textAlign: 'left',
  verticalAlign: 'top',
};
export const numCellStyle: CSSProperties = {
  ...cellStyle,
  textAlign: 'right',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};
export const badgeStyle: CSSProperties = {
  display: 'inline-block',
  border: '1px solid var(--pf-border-strong)',
  borderRadius: 'var(--pf-radius-full)',
  padding: '0 var(--pf-space-2)',
  fontSize: 'var(--pf-text-xs)',
  fontWeight: 500,
  lineHeight: 1.6,
  whiteSpace: 'nowrap',
};

/** Campo rotulado: el `<label>` envuelve el control; el error se asocia con `aria-describedby`. */
export function Field({
  label,
  error,
  hint,
  children,
  style,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
  style?: CSSProperties;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <div style={{ ...fieldStyle, ...style }}>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })}
      {hint ? (
        <small id={hintId} style={mutedStyle}>
          {hint}
        </small>
      ) : null}
      {error ? (
        <p id={errorId} style={errorStyle} data-testid="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Confirmación en línea de una acción irreversible o con efecto contable (archivar, cerrar, anular…): región
 * `alertdialog` rotulada, con el foco al abrirse; Escape cancela.
 */
export function ConfirmPanel({
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy,
  confirmDisabled,
  onConfirm,
  onCancel,
  children,
  testId,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  /** Deshabilita solo el botón de confirmar (p. ej. falta el motivo). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid={testId ?? 'confirm-panel'}
      style={{ ...warningStyle, display: 'grid', gap: '0.5rem' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <strong id={titleId}>{title}</strong>
      {description ? <p style={{ margin: 0 }}>{description}</p> : null}
      {children}
      <div style={rowStyle}>
        <button type="button" onClick={onConfirm} disabled={busy || confirmDisabled}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
