import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a COMMITMENTS (openspec add-workspace-export;
 * add-recurrence-engine decisión 21, rango de orden 750): definiciones, versiones inmutables de su plantilla y
 * ocurrencias. Los ids de cuentas, categorías, contrapartes y transacciones se remapean al importar (columnas `uuid`).
 */
export const COMMITMENTS_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'recurring-definitions',
    context: 'commitments',
    table: 'commitments.recurring_definition',
    order: 750,
    orderBy: ['id'],
  },
  {
    name: 'recurring-definition-versions',
    context: 'commitments',
    table: 'commitments.recurring_definition_version',
    order: 751,
    orderBy: ['definition_id', 'version_no'],
    idColumns: [],
    money: {
      amount: 't.currency',
      amount_min: 't.currency',
      amount_max: 't.currency',
    },
  },
  {
    name: 'recurring-occurrences',
    context: 'commitments',
    table: 'commitments.recurring_occurrence',
    order: 752,
    orderBy: ['definition_id', 'occurrence_date', 'id'],
    money: {
      expected_amount: 't.currency',
      expected_min: 't.currency',
      expected_max: 't.currency',
    },
  },
];
