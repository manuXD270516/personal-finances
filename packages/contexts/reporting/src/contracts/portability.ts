import type { PortabilityExclusion, PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a REPORTING (openspec add-cash-flow-forecast, design.md
 * decisión 12; D378): los ajustes del disponible (modo de horizonte y esenciales) y su lista de categorías esenciales. Las
 * categorías se remapean con el mapa de ids del import (las de CLASSIFICATION se importan antes, orden 300). Un archivo
 * exportado antes del cambio no trae ninguna de las dos secciones y se importa con los valores por omisión (periodo
 * financiero, sin esenciales).
 */
export const REPORTING_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'spendable-settings',
    context: 'reporting',
    table: 'reporting.spendable_setting',
    order: 745,
    orderBy: ['workspace_id'],
    idColumns: [],
  },
  {
    name: 'spendable-essential-categories',
    context: 'reporting',
    table: 'reporting.spendable_essential_category',
    order: 746,
    orderBy: ['category_id'],
    idColumns: [],
  },
];

export const REPORTING_PORTABILITY_EXCLUSIONS: readonly PortabilityExclusion[] = [
  {
    table: 'reporting.cash_flow_shortfall_episode',
    reason:
      'Dato derivado y reconstruible: el job reporting.cash-flow-watch vuelve a abrir el episodio si el riesgo persiste (D381).',
  },
];
