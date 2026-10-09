/**
 * Hoja de la evolución del patrimonio: usa los tokens `--pf-*` del Home (`.pf-home`, docs/28 §5). Las barras de
 * activos son sólidas y las de pasivos rayadas; la línea del neto es discontinua en los tramos con un punto
 * incompleto; el periodo en curso es un cuadrado y el incompleto un círculo hueco: el significado nunca depende solo
 * del color (WCAG 1.4.1). El SVG escala al ancho del contenedor (rejilla fluida, 360 px de base).
 */
export const NETWORTH_CSS = `
.pf-nw-figure{display:grid;gap:0.5rem;min-width:0}
.pf-nw-svg{width:100%;height:auto;display:block;overflow:visible}
.pf-nw-axis{stroke:var(--pf-border);stroke-width:1}
.pf-nw-tick{fill:var(--pf-fg-muted);font-size:11px;font-variant-numeric:tabular-nums}
.pf-nw-bar-assets{fill:var(--pf-fin-income)}
.pf-nw-bar-liabilities{stroke:var(--pf-fin-warning);stroke-width:1}
.pf-nw-hatch-bg{fill:var(--pf-bg)}
.pf-nw-hatch-line{stroke:var(--pf-fin-warning)}
.pf-nw-line{stroke:var(--pf-primary);stroke-width:2.5;fill:none}
.pf-nw-line[data-solid="false"]{stroke-dasharray:5 4}
.pf-nw-marker{stroke:var(--pf-primary);stroke-width:2;fill:var(--pf-primary)}
.pf-nw-marker[data-kind="incomplete"]{fill:var(--pf-bg)}
.pf-nw-marker[data-kind="partial"]{fill:var(--pf-bg);stroke-width:2.5}
.pf-nw-lock rect{fill:var(--pf-fg-muted)}
.pf-nw-lock path{stroke:var(--pf-fg-muted);stroke-width:1.5}
.pf-nw-legend{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:0.25rem 1rem;font-size:0.875rem;color:var(--pf-fg-muted)}
.pf-nw-legend li{display:inline-flex;align-items:center;gap:0.375rem}
.pf-nw-table-wrap{overflow-x:auto;min-width:0}
.pf-nw-table{width:100%;border-collapse:collapse;font-size:0.875rem}
.pf-nw-table caption{text-align:left;color:var(--pf-fg-muted);padding-bottom:0.25rem}
.pf-nw-table th,.pf-nw-table td{padding:0.25rem 0.5rem;border-bottom:1px solid var(--pf-border);text-align:left;vertical-align:top}
.pf-nw-table thead th{font-weight:600}
`;
