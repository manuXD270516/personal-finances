import type { CSSProperties } from 'react';

/** Estilos mínimos del Home (sin framework CSS): rejilla fluida que colapsa a una columna en móvil. */
export const gridStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))',
  alignItems: 'start',
};

export const cardStyle: CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: '0.5rem',
  padding: '1rem',
  minWidth: 0,
  overflowWrap: 'anywhere',
};

export const amountStyle: CSSProperties = { fontSize: '1.5rem', fontWeight: 600, margin: '0.25rem 0' };

export const mutedStyle: CSSProperties = { color: '#57606a', fontSize: '0.875rem' };

export const warningStyle: CSSProperties = {
  borderLeft: '4px solid #bf8700',
  background: '#fff8c5',
  padding: '0.5rem',
  color: '#3b2300',
};

export const listStyle: CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };

/**
 * Hoja del Home (docs/28 §5): tokens semánticos como variables CSS con valores light de referencia, escala de 4 px,
 * radios `md 8`, numerales tabulares en montos y KPI principal `display 2.25rem`. Mobile-first (base 360 px, una
 * columna) con rejillas fluidas desde `md 768`; respeta `prefers-reduced-motion` (el esqueleto no pulsa). Todo va
 * bajo `.pf-home` para no filtrar estilos al resto de la app.
 */
