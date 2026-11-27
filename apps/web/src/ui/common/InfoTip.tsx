import { useId, type ReactNode } from 'react';

/**
 * Explicación corta accesible (change refine-perceived-performance, M-09, decisión 5; NFR-USAB-101/102/106).
 *
 * Un `<button type="button">` con nombre accesible (`label`: «Más información sobre …», ya traducido por el llamador)
 * que abre y cierra una capa con el atributo `popover` (Newly 2025-01-27, D500): clic, toque, Enter y Espacio abren y
 * cierran; Escape cierra y devuelve el foco al botón; todo es nativo, sin scripts ni estilos en línea (CSP). El
 * contenido está en el DOM, así que lo leen las tecnologías de asistencia cuando la capa está abierta.
 *
 * Sin soporte de `popover` el navegador ignora el atributo y el texto queda visible junto al botón: por eso el CSS NO
 * oculta `.pf-infotip-body` fuera de `:popover-open` (la regla `[popover]:not(:popover-open) { display: none }` es de la
 * hoja del propio navegador). El estilo de la capa abierta va solo bajo `:popover-open`.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="pf-infotip">
      <button type="button" className="pf-infotip-button" popoverTarget={id} aria-label={label}>
        <span aria-hidden="true">i</span>
      </button>
      <span id={id} popover="auto" className="pf-infotip-body">
        {children}
      </span>
    </span>
  );
}
