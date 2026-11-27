import { useCallback, useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';

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
/**
 * Región de una tabla de datos (refine-data-tables, M-16): nombre accesible, foco con el teclado (`tabIndex={0}`
 * siempre, porque axe exige el foco solo si hay desbordamiento y medirlo cuesta un `ResizeObserver` por tabla) y
 * desplazamiento propio. Con `tall` (tablas de mucho volumen) suma un alto máximo y la cabecera fija: un
 * `overflow-x: auto` sin alto no fija nada. Los estilos viven en `.pf-table-wrap` de `app/globals.css`.
 * El nombre es el título de la tabla: `label` con el mismo texto del `<caption>`, o `labelledBy` con su `id`.
 */
export type TableRegionProps = {
  readonly tall?: boolean;
  /** Solo para lectores de pantalla (la tabla es la alternativa accesible de un gráfico): sin foco ni borde. */
  readonly srOnly?: boolean;
  readonly testId?: string;
  readonly children: ReactNode;
} & (
  | { readonly label: string; readonly labelledBy?: undefined }
  | { readonly labelledBy: string; readonly label?: undefined }
);
export function TableRegion({ label, labelledBy, tall, srOnly, testId, children }: TableRegionProps) {
  // Un envoltorio recortado no puede recibir el foco de forma visible: conserva la tabla para los lectores de pantalla.
  if (srOnly) {
    return (
      <div className="pf-home-sr" {...(testId ? { 'data-testid': testId } : {})}>
        {children}
      </div>
    );
  }
  return (
    <div
      role="region"
      tabIndex={0}
      {...(label !== undefined ? { 'aria-label': label } : { 'aria-labelledby': labelledBy })}
      className={tall ? 'pf-table-wrap pf-table-wrap--tall' : 'pf-table-wrap'}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </div>
  );
}
/**
 * Medida de 0 a 100 (utilización de una tarjeta, avance de una meta): `<meter>` nativo con nombre, valor y texto
 * (refine-data-tables, M-10). No es el progreso de un proceso (eso es `<progress>`). `low`, `high` y `optimum`
 * dicen al navegador qué zona es buena; el color visible lo fija `color` y solo refuerza: el texto y el icono
 * del contexto dicen lo mismo.
 */
export function Meter({
  value,
  label,
  valueText,
  color,
  low,
  high,
  optimum,
  testId,
}: {
  value: number;
  label: string;
  valueText: string;
  color: string;
  low?: number;
  high?: number;
  optimum?: number;
  testId?: string;
}) {
  return (
    <meter
      className="pf-meter"
      min={0}
      max={100}
      value={value}
      {...(low !== undefined ? { low } : {})}
      {...(high !== undefined ? { high } : {})}
      {...(optimum !== undefined ? { optimum } : {})}
      aria-label={label}
      aria-valuetext={valueText}
      style={{ '--pf-meter-fill': color } as CSSProperties}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {valueText}
    </meter>
  );
}
// Modelo de bordes `separate`: con `collapse` el borde de una celda fija se pierde al desplazar en Chromium.
export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontSize: '0.9375rem',
};
export const cellStyle: CSSProperties = {
  padding: 'var(--pf-space-2) var(--pf-space-3)',
  borderBlockEnd: '1px solid var(--pf-border)',
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

/** Id estable del control de un campo con `anchor` (destino de los enlaces del resumen de errores). */
export const fieldAnchorId = (anchor: string): string => `field-${anchor.replace(/[^A-Za-z0-9_-]+/g, '-')}`;

/**
 * Campo rotulado: el `<label>` envuelve el control; el error se asocia con `aria-describedby`. Con `anchor`, el
 * control toma un id estable (`fieldAnchorId`) para que el resumen de errores del formulario pueda enlazarlo.
 */
export function Field({
  label,
  error,
  hint,
  children,
  style,
  anchor,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  anchor?: string;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
  style?: CSSProperties;
}) {
  const generatedId = useId();
  const id = anchor ? fieldAnchorId(anchor) : generatedId;
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

type ConfirmProps = {
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
};

/** Encabezado de la sección que contiene al elemento: destino del foco si el disparador ya no existe. */
function sectionHeadingOf(el: Element | null): HTMLElement | null {
  return (el?.closest('section, main, form')?.querySelector('h1, h2, h3') as HTMLElement | null) ?? null;
}

/**
 * Recuerda el elemento con foco al montarse el componente (antes de moverlo) y devuelve una función que lo
 * recupera: el disparador si sigue en el DOM; si no, el encabezado de la sección (NFR-USAB-102, decisión 7 del change).
 */
function useFocusReturn(anchor: { current: Element | null }): () => void {
  const previous = useRef<Element | null>(null);
  const heading = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (previous.current) return;
    const active = document.activeElement;
    previous.current = active && active !== document.body ? active : null;
    heading.current = sectionHeadingOf(anchor.current);
  }, [anchor]);
  return useCallback(() => {
    requestAnimationFrame(() => {
      const trigger = previous.current;
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus();
        return;
      }
      const target = heading.current;
      if (target?.isConnected) {
        if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
        target.focus();
      }
    });
  }, []);
}

/**
 * Confirmación en línea de una acción reversible o con un formulario propio (pausar, reanudar, aprobar una
 * ocurrencia…): región `alertdialog` rotulada. El foco inicial va a «Cancelar» (la acción segura), que precede a la
 * confirmación; Escape o «Cancelar» devuelven el foco al control que la abrió. Para acciones irreversibles o con
 * efecto contable se usa `ConfirmDialog` (decisión 5).
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
}: ConfirmProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const restoreFocus = useFocusReturn(ref);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  const cancel = () => {
    onCancel();
    restoreFocus();
  };
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid={testId ?? 'confirm-panel'}
      style={{ ...warningStyle, display: 'grid', gap: '0.5rem' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
      }}
    >
      <strong id={titleId}>{title}</strong>
      {description ? <p style={{ margin: 0 }}>{description}</p> : null}
      {children}
      <div style={rowStyle}>
        <button ref={cancelRef} type="button" onClick={cancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm} disabled={busy || confirmDisabled}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Confirmación modal de una acción irreversible o con efecto contable (anular, revertir, archivar, eliminar…) sobre
 * `<dialog>` + `showModal()` (decisión 5 del change; guía `dialog` de Modern Web Guidance): el navegador aporta la inertización del
 * resto de la página, la contención del foco, Escape y la devolución del foco al disparador. Misma firma que
 * `ConfirmPanel`: migrar un uso es cambiar el nombre del componente. El rol `alertdialog` se declara explícito
 * porque las pruebas y los lectores de pantalla lo esperan para una confirmación destructiva; el foco inicial va a
 * «Cancelar» con `focus()` tras `showModal()` (con `autoFocus`, React enfocaría con el `<dialog>` aún cerrado).
 */
export function ConfirmDialog({
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
}: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const restoreFocus = useFocusReturn(ref);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // StrictMode ejecuta el efecto dos veces: la guarda evita abrir dos veces un diálogo ya abierto.
    if (!el.open) {
      el.showModal();
      cancelRef.current?.focus();
    }
    return () => {
      if (el.open) el.close();
    };
  }, []);
  const cancel = () => {
    onCancel();
    restoreFocus();
  };
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      className="pf-confirm-dialog"
      aria-labelledby={titleId}
      {...(description ? { 'aria-describedby': descriptionId } : {})}
      data-testid={testId ?? 'confirm-dialog'}
      onCancel={(e) => {
        // Escape: el cierre lo decide React (desmonta el diálogo); el navegador no debe cerrarlo por su cuenta.
        e.preventDefault();
        cancel();
      }}
    >
      <strong id={titleId}>{title}</strong>
      {description ? (
        <p id={descriptionId} style={{ margin: 0 }}>
          {description}
        </p>
      ) : null}
      {children}
      <div style={rowStyle}>
        <button ref={cancelRef} type="button" onClick={cancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm} disabled={busy || confirmDisabled}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
