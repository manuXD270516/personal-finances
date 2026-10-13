import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a FX (openspec add-workspace-export): monedas
 * habilitadas, preferencias de tasa y las tasas PROPIAS del workspace (las globales de provider, sin workspace, no son
 * del usuario) con sus revisiones de anomalía y las marcas de anulada de las observaciones de conversiones propias. Las tasas viajan como decimal exacto sin ceros de relleno.
 */
export const FX_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'workspace-currencies',
    context: 'fx',
    table: 'fx.workspace_currency',
    order: 200,
    orderBy: ['currency_code'],
    idColumns: [],
  },
  {
    name: 'rate-preference-sets',
    context: 'fx',
    table: 'fx.rate_preference_set',
    order: 205,
    orderBy: ['workspace_id'],
    idColumns: [],
  },
  {
    name: 'rate-preferences',
    context: 'fx',
    table: 'fx.rate_preference',
    order: 206,
    orderBy: ['base_currency', 'quote_currency'],
    idColumns: [],
  },
  {
    name: 'exchange-rates',
    context: 'fx',
    table: 'fx.exchange_rate',
    order: 210,
    orderBy: ['id'],
    selfRefs: ['supersedes_id', 'anomaly_baseline_rate_id'],
  },
  {
    name: 'rate-anomaly-reviews',
    context: 'fx',
    table: 'fx.rate_anomaly_review',
    order: 220,
    orderBy: ['exchange_rate_id'],
    idColumns: [],
  },
  {
    // Marca de anulada de una observación de conversión propia (add-conversion-cost-analysis, D231): después de las
    // tasas que referencia; `transaction_id` se remapea con el id de la conversión importada (sin FK cross-schema).
    name: 'rate-withdrawals',
    context: 'fx',
    table: 'fx.rate_withdrawal',
    order: 225,
    orderBy: ['exchange_rate_id'],
    idColumns: [],
  },
];
