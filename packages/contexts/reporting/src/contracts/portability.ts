import type { PortabilityExclusion, PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a REPORTING (openspec add-financial-reports-extended,
 * decisión del owner: las vistas guardadas viajan en el export). El export corre con el contexto RLS del solicitante, así
 * que solo incluye SUS vistas (son personales); al importar se restauran las del usuario que importa (el único OWNER del
 * workspace restaurado). Los ids de filtros que viajan dentro de `params` (jsonb) se reescriben con el mapa de ids. Orden
 * 820: después de los documentos (810–812) y antes de la auditoría (900). `reporting.workspace_data_version` es derivada
 * y no se exporta (se reconstruye con los eventos).
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
  {
    name: 'saved-report-views',
    context: 'reporting',
    table: 'reporting.saved_report_view',
    order: 820,
    orderBy: ['user_id', 'report_id', 'id'],
    importerColumn: 'user_id',
  },
];

export const REPORTING_PORTABILITY_EXCLUSIONS: readonly PortabilityExclusion[] = [
  {
    table: 'reporting.cash_flow_shortfall_episode',
    reason:
      'Dato derivado y reconstruible: el job reporting.cash-flow-watch vuelve a abrir el episodio si el riesgo persiste (D381).',
  },
];
