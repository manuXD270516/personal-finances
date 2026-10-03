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
