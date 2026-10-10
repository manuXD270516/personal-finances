import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a COMMITMENTS (openspec add-workspace-export;
 * add-recurrence-engine decisión 21, rango de orden 750): definiciones, versiones inmutables de su plantilla y
 * ocurrencias; y (openspec add-subscriptions, decisión 17, órdenes 760–764, después de las del motor) las suscripciones,
 * su historial de precios, sus cargos, las propuestas de precio y los recordatorios emitidos. Los ids de cuentas,
 * categorías, contrapartes, definiciones, ocurrencias y transacciones se remapean al importar (columnas `uuid`), así
 * como `supersedes_id`, `proposal_id` y `charge_id`, que se resuelven con el mapa que siembra la primera pasada.
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
  {
    name: 'subscriptions',
    context: 'commitments',
    table: 'commitments.subscription',
    order: 760,
    orderBy: ['id'],
  },
  {
    name: 'subscription-prices',
    context: 'commitments',
    table: 'commitments.subscription_price',
    order: 761,
    orderBy: ['subscription_id', 'effective_from', 'recorded_at', 'id'],
    selfRefs: ['supersedes_id'],
    money: { amount: 't.currency' },
  },
  {
    name: 'subscription-charges',
    context: 'commitments',
    table: 'commitments.subscription_charge',
    order: 762,
    orderBy: ['subscription_id', 'occurrence_date', 'id'],
    money: {
      charged_amount: 't.charged_currency',
      price_currency_amount: 't.expected_currency',
      expected_amount: 't.expected_currency',
    },
  },
  {
    name: 'subscription-price-proposals',
    context: 'commitments',
    table: 'commitments.subscription_price_proposal',
    order: 763,
    orderBy: ['subscription_id', 'effective_from'],
    money: { previous_amount: 't.currency', proposed_amount: 't.currency' },
  },
  {
    name: 'subscription-reminders',
    context: 'commitments',
    table: 'commitments.subscription_reminder',
    order: 764,
    orderBy: ['subscription_id', 'kind', 'target_date'],
    idColumns: [],
  },
];
