import type { PortabilityExclusion } from '@pf/shared-kernel';

/**
 * Los pronósticos NO viajan en la exportación del workspace (openspec add-ml-forecasting-service, decisión 17;
 * FR-IDENTITY-010, NFR-COMP-002): son datos derivados que se recalculan desde los datos exportados; un workspace importado
 * empieza sin corridas y su primer pronóstico lo genera el trabajo programado o una solicitud manual.
 */
export const FORECASTING_PORTABILITY_EXCLUSIONS: readonly PortabilityExclusion[] = [
  {
    table: 'forecasting.forecast_run',
    reason:
      'Dato derivado y reconstruible: el trabajo forecasting.schedule o una solicitud manual vuelven a generar el pronóstico.',
  },
  {
    table: 'forecasting.forecast_series',
    reason:
      'Dato derivado de la corrida (se recalcula con ella); contiene las referencias opacas de una petición ya enviada.',
  },
  {
    table: 'forecasting.forecast_point',
    reason: 'Dato derivado de la corrida (se recalcula con ella).',
  },
  {
    table: 'forecasting.forecast_known_item',
    reason:
      'Dato derivado de la corrida: los conocidos se recalculan desde los compromisos y los préstamos exportados.',
  },
  {
    table: 'forecasting.backtest_result',
    reason: 'Dato derivado de la corrida: el backtesting se recalcula con ella.',
  },
];
