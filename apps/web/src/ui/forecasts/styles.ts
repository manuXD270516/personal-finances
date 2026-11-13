import { FORECAST_CHART_CSS } from './ForecastChart';

/**
 * Hoja de `/pronosticos` (docs/28): solo tokens de `app/globals.css` (claro/oscuro), mobile-first (una columna desde
 * 375 px) y sin animaciones. Todo cuelga de `.pf-fc` para no filtrar estilos al resto de la app.
 */
export const FORECASTS_CSS = `
${FORECAST_CHART_CSS}
.pf-fc{display:grid;gap:1.25rem;min-width:0;max-width:72rem;color:var(--pf-fg)}
.pf-fc h2,.pf-fc h3{margin:0;line-height:1.3}
.pf-fc h2{font-size:var(--pf-text-xl)}
.pf-fc h3{font-size:var(--pf-text-lg)}
.pf-fc p{margin:0}
.pf-fc-card{background:var(--pf-surface-raised);border:1px solid var(--pf-border);border-radius:var(--pf-radius-md);padding:var(--pf-space-4);min-width:0;overflow-wrap:anywhere;display:grid;gap:var(--pf-space-2);align-content:start}
.pf-fc-muted{color:var(--pf-fg-muted);font-size:var(--pf-text-sm)}
.pf-fc-num{font-variant-numeric:tabular-nums;text-align:right}
.pf-fc-controls{display:flex;flex-wrap:wrap;gap:var(--pf-space-3) var(--pf-space-6);align-items:flex-start}
.pf-fc-controls fieldset{border:1px solid var(--pf-border);border-radius:var(--pf-radius-md);padding:var(--pf-space-2) var(--pf-space-3);margin:0;min-width:0}
.pf-fc-controls legend{padding:0 var(--pf-space-1);font-weight:600}
.pf-fc-choice{display:inline-flex;align-items:center;gap:var(--pf-space-1);margin-right:var(--pf-space-3);min-height:2.5rem}
.pf-fc-button{min-height:2.75rem;padding:0 var(--pf-space-4);border-radius:var(--pf-radius-md);border:1px solid var(--pf-primary);background:var(--pf-primary);color:var(--pf-primary-fg);font-weight:600;cursor:pointer}
.pf-fc-button:disabled{opacity:0.6;cursor:progress}
.pf-fc-badge{display:inline-flex;align-items:center;gap:0.25rem;border:1px solid var(--pf-border-strong);border-radius:var(--pf-radius-full);padding:0 var(--pf-space-2);font-size:var(--pf-text-sm);font-weight:600;line-height:1.7;white-space:nowrap}
.pf-fc-badge[data-confidence="LOW"]{border-color:var(--pf-fin-warning);color:var(--pf-fin-warning)}
.pf-fc-badge[data-confidence="HIGH"]{border-color:var(--pf-fin-ok);color:var(--pf-fin-ok)}
.pf-fc-notice{border-left:4px solid var(--pf-warning-border);border-radius:var(--pf-radius-sm);background:var(--pf-warning-bg);color:var(--pf-warning-fg);padding:var(--pf-space-2) var(--pf-space-3)}
.pf-fc-notices{display:grid;gap:var(--pf-space-2)}
.pf-fc-title-row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pf-space-2) var(--pf-space-3)}
.pf-fc-headline{font-size:var(--pf-text-lg);font-variant-numeric:tabular-nums}
.pf-fc-table-wrap{overflow-x:auto;max-width:100%}
.pf-fc-table{width:100%;border-collapse:collapse;font-size:0.9375rem}
.pf-fc-table caption{text-align:left;padding:var(--pf-space-2) 0;font-weight:600}
.pf-fc-table th,.pf-fc-table td{padding:var(--pf-space-2) var(--pf-space-3);border-bottom:1px solid var(--pf-border);text-align:left;vertical-align:top}
.pf-fc-table td[data-num],.pf-fc-table th[data-num]{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pf-fc-table tr[aria-current="true"] th,.pf-fc-table tr[aria-current="true"] td{background:var(--pf-surface-raised);font-weight:600}
.pf-fc-detail{display:grid;gap:var(--pf-space-4);grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))}
.pf-fc-list{list-style:none;margin:0;padding:0;display:grid;gap:var(--pf-space-2)}
.pf-fc-known-item{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--pf-space-1) var(--pf-space-3)}
.pf-fc-known-main{display:grid;gap:0.125rem;min-width:0}
.pf-fc a:focus-visible,.pf-fc button:focus-visible,.pf-fc input:focus-visible,.pf-fc select:focus-visible{outline:2px solid var(--pf-focus);outline-offset:2px}
.pf-fc-footer{color:var(--pf-fg-muted);font-size:var(--pf-text-sm);border-top:1px solid var(--pf-border);padding-top:var(--pf-space-3)}
`;
