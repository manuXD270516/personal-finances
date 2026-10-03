import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { cardStyle, mutedStyle, warningStyle } from '../dashboard/styles';

/**
 * Piezas mínimas de UI (sin framework CSS) compartidas por las pantallas financieras: campos rotulados con error
 * accesible, paneles de confirmación y estilos que colapsan a una columna en móvil (NFR-USAB-006, 360 px).
 */

export const pageStyle: CSSProperties = { display: 'grid', gap: '1rem', maxWidth: '64rem', minWidth: 0 };
export const formStyle: CSSProperties = { ...cardStyle, display: 'grid', gap: '0.75rem' };
export const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  alignItems: 'end',
};
export const fieldStyle: CSSProperties = { display: 'grid', gap: '0.25rem', minWidth: 0, flex: '1 1 12rem' };
export const inputStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.375rem',
  minWidth: 0,
  maxWidth: '100%',
};
export const errorStyle: CSSProperties = { color: '#cf222e', fontSize: '0.875rem', margin: 0 };
export const tableWrapStyle: CSSProperties = { overflowX: 'auto', maxWidth: '100%' };
export const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' };
export const cellStyle: CSSProperties = {
  padding: '0.375rem 0.5rem',
  borderBottom: '1px solid #d0d7de',
  textAlign: 'left',
  verticalAlign: 'top',
};
export const numCellStyle: CSSProperties = { ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' };
export const badgeStyle: CSSProperties = {
  display: 'inline-block',
  border: '1px solid #d0d7de',
  borderRadius: '1rem',
  padding: '0 0.5rem',
  fontSize: '0.8rem',
};
export { cardStyle, mutedStyle, warningStyle };

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
