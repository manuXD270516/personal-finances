import { CASH_FLOW_CHART_CSS } from './CashFlowChart';

/**
 * Hoja de `/flujo-de-caja` (docs/28 §5): solo tokens de `app/globals.css` (claro/oscuro), mobile-first (una columna desde
 * 375 px) y sin animaciones. Todo cuelga de `.pf-cf` para no filtrar estilos al resto de la app.
 */
export const CASH_FLOW_CSS = `
${CASH_FLOW_CHART_CSS}
.pf-cf{display:grid;gap:1.25rem;min-width:0;max-width:72rem;color:var(--pf-fg)}
.pf-cf h1,.pf-cf h2,.pf-cf h3{margin:0;line-height:1.3}
.pf-cf h2{font-size:var(--pf-text-xl)}
.pf-cf h3{font-size:var(--pf-text-lg)}
.pf-cf p{margin:0}
.pf-cf-card{background:var(--pf-surface-raised);border:1px solid var(--pf-border);border-radius:var(--pf-radius-md);padding:var(--pf-space-4);min-width:0;overflow-wrap:anywhere;display:grid;gap:var(--pf-space-2);align-content:start}
.pf-cf-muted{color:var(--pf-fg-muted);font-size:var(--pf-text-sm)}
.pf-cf-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.pf-cf-controls{display:flex;flex-wrap:wrap;gap:var(--pf-space-3) var(--pf-space-6);align-items:flex-start}
.pf-cf-controls fieldset{border:1px solid var(--pf-border);border-radius:var(--pf-radius-md);padding:var(--pf-space-2) var(--pf-space-3);margin:0;min-width:0}
.pf-cf-controls legend{padding:0 var(--pf-space-1);font-weight:600}
.pf-cf-choice{display:inline-flex;align-items:center;gap:var(--pf-space-1);margin-right:var(--pf-space-3);min-height:2.5rem}
.pf-cf-badge{display:inline-flex;align-items:center;gap:0.25rem;border:1px solid var(--pf-border-strong);border-radius:var(--pf-radius-full);padding:0 var(--pf-space-2);font-size:var(--pf-text-sm);font-weight:600;line-height:1.7;white-space:nowrap}
.pf-cf-badge[data-risk="HIGH"]{border-color:var(--pf-error);color:var(--pf-error)}
.pf-cf-badge[data-risk="POSSIBLE"]{border-color:var(--pf-fin-warning);color:var(--pf-fin-warning)}
.pf-cf-badge[data-risk="LOW"]{border-color:var(--pf-primary);color:var(--pf-primary)}
.pf-cf-badge[data-risk="NONE"]{border-color:var(--pf-fin-ok);color:var(--pf-fin-ok)}
.pf-cf-notice{border-left:4px solid var(--pf-warning-border);border-radius:var(--pf-radius-sm);background:var(--pf-warning-bg);color:var(--pf-warning-fg);padding:var(--pf-space-2) var(--pf-space-3)}
.pf-cf-kpis{display:grid;gap:var(--pf-space-3);grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))}
.pf-cf-kpi{display:grid;gap:0.125rem}
.pf-cf-kpi strong{font-size:var(--pf-text-lg);font-variant-numeric:tabular-nums}
.pf-cf-table-wrap{overflow-x:auto;max-width:100%}
.pf-cf-table{width:100%;border-collapse:collapse;font-size:0.9375rem}
.pf-cf-table caption{text-align:left;padding:var(--pf-space-2) 0;font-weight:600}
.pf-cf-table th,.pf-cf-table td{padding:var(--pf-space-2) var(--pf-space-3);border-bottom:1px solid var(--pf-border);text-align:left;vertical-align:top}
.pf-cf-table td[data-num],.pf-cf-table th[data-num]{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pf-cf-table tr[data-below="true"] td,.pf-cf-table tr[data-below="true"] th{background:var(--pf-warning-bg)}
.pf-cf-days{list-style:none;margin:0;padding:0;display:grid;gap:var(--pf-space-3)}
.pf-cf-day{display:grid;gap:var(--pf-space-1);border-top:1px solid var(--pf-border);padding-top:var(--pf-space-2)}
.pf-cf-events{list-style:none;margin:0;padding:0;display:grid;gap:var(--pf-space-2)}
.pf-cf-event{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--pf-space-1) var(--pf-space-3)}
.pf-cf-event-main{display:grid;gap:0.125rem;min-width:0}
.pf-cf-tag{display:inline-block;border:1px solid var(--pf-border-strong);border-radius:var(--pf-radius-full);padding:0 var(--pf-space-2);font-size:var(--pf-text-xs);line-height:1.6;white-space:nowrap}
.pf-cf-tag[data-tone="warn"]{border-color:var(--pf-fin-warning);color:var(--pf-fin-warning)}
.pf-cf-list{list-style:none;margin:0;padding:0;display:grid;gap:var(--pf-space-2)}
.pf-cf a:focus-visible,.pf-cf button:focus-visible,.pf-cf input:focus-visible,.pf-cf select:focus-visible,.pf-cf summary:focus-visible{outline:2px solid var(--pf-focus);outline-offset:2px}
.pf-cf-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.pf-cf-footer{color:var(--pf-fg-muted);font-size:var(--pf-text-sm);border-top:1px solid var(--pf-border);padding-top:var(--pf-space-3);display:grid;gap:var(--pf-space-2)}
@media (max-width:480px){.pf-cf-choice{margin-right:var(--pf-space-2)}}
`;
