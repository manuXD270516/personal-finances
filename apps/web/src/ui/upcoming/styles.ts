/**
 * Hoja de los próximos pagos: usa los tokens `--pf-*` del Home (`.pf-home`, docs/28 §5). El estado de un pago nunca
 * depende solo del color: lleva glifo y texto (WCAG 1.4.1). Mobile-first (360 px, una columna).
 */
export const UPCOMING_CSS = `
.pf-upc-list{list-style:none;margin:0;padding:0;display:grid;gap:0.5rem}
.pf-upc-item{display:grid;gap:0.125rem 0.75rem;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;
border-bottom:1px solid var(--pf-border);padding-bottom:0.5rem}
.pf-upc-item:last-child{border-bottom:0;padding-bottom:0}
.pf-upc-date{color:var(--pf-fg-muted);font-size:0.875rem}
.pf-upc-amount{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.pf-upc-badge{display:inline-flex;gap:0.25rem;align-items:center;font-size:0.8125rem;color:var(--pf-fg-muted)}
.pf-upc-badge[data-tone="danger"]{color:#b91c1c;font-weight:600}
.pf-upc-badge[data-tone="warn"]{color:var(--pf-fin-warning);font-weight:600}
.pf-upc-more{margin:0}
.pf-upc-table-wrap{overflow-x:auto;min-width:0}
.pf-upc-table{width:100%;border-collapse:collapse;font-size:0.875rem}
.pf-upc-table caption{text-align:left;color:var(--pf-fg-muted);padding-bottom:0.25rem}
.pf-upc-table th,.pf-upc-table td{padding:0.375rem 0.5rem;border-bottom:1px solid var(--pf-border);text-align:left;vertical-align:top}
.pf-upc-table thead th{font-weight:600}
.pf-upc-table .pf-upc-num{text-align:right;font-variant-numeric:tabular-nums}
.pf-upc-controls{display:flex;flex-wrap:wrap;gap:0.5rem 1rem;align-items:end}
.pf-upc-totals{display:grid;gap:0.25rem}
.pf-upc-projection{border-left:4px solid var(--pf-primary);padding-left:0.75rem}
`;
