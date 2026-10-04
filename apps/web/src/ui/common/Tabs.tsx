'use client';

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

const listStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.25rem',
  borderBottom: '1px solid #d0d7de',
};
const tabStyle = (selected: boolean): CSSProperties => ({
  font: 'inherit',
  padding: '0.5rem 0.75rem',
  border: '1px solid transparent',
  borderBottom: selected ? '3px solid #0969da' : '3px solid transparent',
  background: 'none',
  fontWeight: selected ? 600 : 400,
  cursor: 'pointer',
  color: 'inherit',
});
const panelStyle: CSSProperties = { display: 'grid', gap: '1rem', minWidth: 0, paddingTop: '1rem' };

/**
 * Pestañas accesibles (`tablist`/`tab`/`tabpanel`, `aria-selected`, foco itinerante y flechas, Inicio y Fin). Los paneles
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

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = tabTarget(e.key, index, tabs.length);
    if (next === null) return;
    e.preventDefault();
    setSelected(next);
    refs.current[next]?.focus();
  };

  return (
    <div data-testid={`${idPrefix}-tabs`}>
      <div role="tablist" aria-label={label} style={listStyle}>
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
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={i === active ? 0 : -1}
            data-tab={tab.id}
            style={tabStyle(i === active)}
            onClick={() => setSelected(i)}
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
