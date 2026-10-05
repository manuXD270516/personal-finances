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
export const HOME_CSS = `
.pf-home{--pf-bg:#FFFFFF;--pf-surface:#F8FAFC;--pf-fg:#0F172A;--pf-fg-muted:#475569;--pf-border:#E2E8F0;
--pf-primary:#1D4ED8;--pf-focus:#2563EB;--pf-fin-income:#047857;--pf-fin-expense:#334155;--pf-fin-warning:#B45309;
--pf-fin-ok:#15803D;--pf-fin-neutral:#64748B;--pf-track:#E2E8F0;
color:var(--pf-fg);display:grid;gap:1.5rem;min-width:0;max-width:72rem}
.pf-home a{color:var(--pf-primary)}
.pf-home a:focus-visible{outline:2px solid var(--pf-focus);outline-offset:2px;border-radius:4px}
.pf-home h2,.pf-home h3{margin:0;line-height:1.3}
.pf-home h2{font-size:1.25rem;font-weight:600}
.pf-home h3{font-size:1rem;font-weight:600}
.pf-home-card{background:var(--pf-bg);border:1px solid var(--pf-border);border-radius:8px;padding:1rem;min-width:0;
overflow-wrap:anywhere;display:grid;gap:0.5rem;align-content:start}
.pf-home-card p{margin:0}
.pf-home-hero{background:var(--pf-surface);border-left:4px solid var(--pf-primary);padding:1rem 1.25rem}
.pf-home-amount{font-size:1.5rem;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums}
.pf-home-hero .pf-home-amount{font-size:2.25rem}
.pf-home-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.pf-home-muted{color:var(--pf-fg-muted);font-size:0.875rem}
.pf-home-group{display:grid;gap:0.75rem;min-width:0}
.pf-home-group-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:0.25rem 1rem}
.pf-home-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));align-items:start}
.pf-home-kpis{display:grid;gap:1rem;grid-template-columns:1fr}
.pf-home-month{display:grid;gap:1rem;grid-template-columns:minmax(0,1fr)}
.pf-home-trend{display:inline}
.pf-home-trend-icon{font-size:0.75rem}
.pf-home-trend[data-tone="ok"]{color:var(--pf-fin-ok)}
.pf-home-trend[data-tone="warning"]{color:var(--pf-fin-warning)}
.pf-home-trend[data-tone="neutral"]{color:var(--pf-fg-muted)}
.pf-home-meter{position:relative;height:0.5rem;border-radius:9999px;background:var(--pf-track);overflow:visible}
.pf-home-meter-fill{display:block;height:100%;border-radius:9999px;background:var(--pf-fin-expense)}
.pf-home-meter-fill[data-kind="income"]{background:var(--pf-fin-income)}
.pf-home-meter-prev{position:absolute;top:-0.1875rem;bottom:-0.1875rem;width:2px;background:var(--pf-fg);opacity:0.55}
.pf-home-cats{list-style:none;margin:0;padding:0;display:grid;gap:0.875rem;counter-reset:pfcat}
.pf-home-cat{display:grid;gap:0.25rem;counter-increment:pfcat}
.pf-home-cat-head{display:flex;justify-content:space-between;gap:0.5rem;align-items:baseline}
.pf-home-cat-name::before{content:counter(pfcat) ". ";color:var(--pf-fg-muted);font-variant-numeric:tabular-nums}
.pf-home-legend{display:flex;flex-wrap:wrap;gap:0.25rem 1rem;align-items:center}
.pf-home-legend-mark{display:inline-block;width:2px;height:0.75rem;background:var(--pf-fg);opacity:0.55;margin-right:0.375rem;vertical-align:middle}
.pf-home-soon{border-style:dashed;background:var(--pf-surface)}
.pf-home-empty{background:var(--pf-surface);border:1px dashed var(--pf-border);border-radius:8px;padding:1rem;display:grid;gap:0.5rem}
.pf-home-empty p{margin:0}
.pf-home-warning{border-left:4px solid #bf8700;background:#fff8c5;padding:0.5rem;color:#3b2300}
.pf-home-list{list-style:none;padding:0;margin:0;display:grid;gap:0.5rem}
.pf-home-footer{color:var(--pf-fg-muted);font-size:0.875rem;border-top:1px solid var(--pf-border);padding-top:0.75rem}
.pf-home-footer p{margin:0 0 0.5rem}
.pf-home-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.pf-home-skel{background:var(--pf-track);border-radius:8px;animation:pf-home-pulse 1.2s ease-in-out infinite}
@keyframes pf-home-pulse{0%,100%{opacity:1}50%{opacity:0.55}}
@media (min-width:768px){
.pf-home-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (min-width:1024px){
.pf-home-month{grid-template-columns:minmax(0,2fr) minmax(0,3fr);align-items:start}
.pf-home-month>.pf-home-kpis{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){.pf-home-skel{animation:none}}
`;
