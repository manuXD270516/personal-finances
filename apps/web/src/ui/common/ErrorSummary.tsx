import { ERROR_SUMMARY_ATTR } from './forms';
import { fieldAnchorId } from './ui';

export interface ErrorSummaryItem {
  /** Clave del campo (la misma que se pasa como `anchor` a `Field`). */
  readonly field: string;
  /** Etiqueta visible del campo. */
  readonly label: string;
  /** Motivo del error, que se muestra a continuación del enlace. */
  readonly message?: string;
}

/**
 * Resumen de errores de un formulario largo (decisión 3 del change, guía `accessible-error-announcement`): encabezado con el conteo y
 * un enlace por campo inválido. Recibe el foco tras un envío rechazado (`tabIndex={-1}`); no es región viva, así que
 * se anuncia al enfocarlo. El clic enfoca el campo con `focus()` porque el salto por ancla no siempre mueve el foco
 * en Safari.
 */
export function ErrorSummary({
  title,
  items,
  testId,
}: {
  /** Título ya traducido, con el conteo (`Forms.errorSummary.title`). */
  title: string;
  items: readonly ErrorSummaryItem[];
  testId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div
      {...{ [ERROR_SUMMARY_ATTR]: '' }}
      tabIndex={-1}
      className="pf-error-summary"
      data-testid={testId ?? 'error-summary'}
    >
      <h2 className="pf-error-summary-title">{title}</h2>
      <ul>
        {items.map((item) => {
          const id = fieldAnchorId(item.field);
          return (
            <li key={item.field}>
              <a
                href={`#${id}`}
                onClick={(e) => {
                  const target = document.getElementById(id);
                  if (!target) return;
                  e.preventDefault();
                  target.focus();
                }}
              >
                {item.label}
              </a>
              {item.message ? `: ${item.message}` : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
