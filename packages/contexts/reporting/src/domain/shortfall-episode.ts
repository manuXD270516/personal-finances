import type { CashFlowRisk } from './cash-flow-risk.js';

/**
 * Política del episodio de riesgo de déficit (openspec add-cash-flow-forecast, design.md decisión 13; D381): un episodio por
 * moneda mientras el riesgo del calendario de 30 días es `HIGH`. Puro: decide la acción sin tocar la base.
 *   - sin episodio abierto y riesgo `HIGH` ⇒ ABRIR (se publica el hecho detectado una sola vez);
 *   - con episodio abierto y riesgo `HIGH` ⇒ SOSTENER (se actualiza la última evaluación; no se publica nada);
 *   - con episodio abierto y riesgo `NONE` o `LOW` ⇒ CERRAR (se publica el hecho de riesgo resuelto);
 *   - `POSSIBLE` se ignora (no abre ni cierra) y `LOW` nunca abre.
 */
export type ShortfallEpisodeAction = 'OPEN' | 'SUSTAIN' | 'CLOSE' | 'NONE';

export const ShortfallEpisodePolicy = {
  decide(input: { readonly hasOpenEpisode: boolean; readonly risk: CashFlowRisk }): ShortfallEpisodeAction {
    if (input.risk === 'POSSIBLE') return 'NONE';
    if (!input.hasOpenEpisode) return input.risk === 'HIGH' ? 'OPEN' : 'NONE';
    return input.risk === 'HIGH' ? 'SUSTAIN' : 'CLOSE';
  },
} as const;
