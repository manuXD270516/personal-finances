'use client';

import { withViewTransition } from './motion';
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

/** Pestaña destino de una tecla (patrón WAI-ARIA tabs con activación automática); `null` si la tecla no navega. */
export function tabTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export interface TabSpec {
  /** Identificador estable (sufijo de los ids y `data-tab`). */
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

const panelStyle: CSSProperties = { display: 'grid', gap: '1rem', minWidth: 0, paddingTop: '1rem' };

/**
 * Pestañas accesibles (`tablist`/`tab`/`tabpanel`, `aria-selected`, foco itinerante y flechas, Inicio y Fin) en una sola
 * fila con desplazamiento horizontal (`.pf-tabs`/`.pf-tab`; guía `tabs`: sin `aria-controls`). Los paneles
 * inactivos quedan montados y ocultos (`hidden`): conservan su estado (formularios abiertos, datos cargados).
 */
export function Tabs({
  label,
  tabs,
  idPrefix,
  initial,
}: {
  label: string;
  tabs: readonly TabSpec[];
  idPrefix: string;
  initial?: string;
}) {
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      tabs.findIndex((t) => t.id === initial),
    ),
  );
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = Math.min(selected, tabs.length - 1);

  // Cambio de pestaña con transición breve (M-28): sin soporte o con movimiento reducido cambia al instante. El foco no se
  // mueve: ya está en la pestaña usada.
  const select = (index: number) => {
    if (index === active) return;
    withViewTransition(() => setSelected(index), { view: 'tabs' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = tabTarget(e.key, index, tabs.length);
    if (next === null) return;
    e.preventDefault();
    select(next);
    const target = refs.current[next];
    target?.focus();
    // La fila se desplaza en horizontal: la pestaña enfocada debe quedar a la vista (p. ej. Fin a 360 px).
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <div data-testid={`${idPrefix}-tabs`} className="pf-tabs-root">
      <div role="tablist" aria-label={label} className="pf-tabs">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            data-tab={tab.id}
            className="pf-tab"
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${idPrefix}-panel-${tab.id}`}
          aria-labelledby={`${idPrefix}-tab-${tab.id}`}
          tabIndex={0}
          hidden={i !== active}
          data-tab={tab.id}
          // Sin `display` en el panel oculto: un estilo en línea anularía el atributo `hidden`.
          style={i === active ? panelStyle : undefined}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
