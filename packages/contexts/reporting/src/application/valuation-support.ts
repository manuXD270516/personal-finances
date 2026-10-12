import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import { dec } from '@pf/shared-kernel';
import type { ExactRate } from '../domain/index.js';

/** Ventana de vigencia por defecto de las tasas de valoración (días; docs/31 D53: ajuste de Reporting). */
export const DEFAULT_RATE_VALIDITY_WINDOW_DAYS = 7;

/** Clave de identidad de una tasa usada (misma versión almacenada y orientación ⇒ una sola entrada). */
export const rateKey = (r: ResolvedRateDto) =>
  `${r.fxRateId ?? JSON.stringify(r.components.map((c) => (c as { id?: unknown }).id))}|${r.rate.base}|${r.rate.quote}`;

/** Tasa exacta (sin redondeo) de una tasa de valoración de FX. */
export const toExact = (v: ValuationRateDto): ExactRate => ({
  base: v.exact.base,
  quote: v.exact.quote,
  value: dec(v.exact.value),
});
