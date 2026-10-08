import { dec } from '@pf/shared-kernel';

export interface ThresholdEvaluation {
  /** Umbral más alto cruzado ahora (el del hecho emitido). */
  readonly highest: string;
  /** Umbrales menores cruzados a la vez, ascendentes (`alsoCrossed`). */
  readonly alsoCrossed: readonly string[];
  /** Todos los umbrales nuevos (los que hay que registrar como cruzados), ascendentes. */
  readonly newlyCrossed: readonly string[];
}

/**
 * DS `ThresholdEvaluator` (design decisión 7-8), puro. Un umbral `t` está cruzado cuando `gastado >= t/100 x
 * referencia` con `referencia > 0`. Devuelve los umbrales cruzados que aún NO están registrados: el hecho lleva el más
 * alto y los menores como `alsoCrossed` (docs/33 D80); todos quedan registrados para no emitirse después. Bajar y
 * volver a subir no re-emite porque el cruce persiste (la tabla de cruces es append-only).
 *
 * Comparación con los montos a la escala de la moneda (los mismos que ve el usuario): `gastado x 100 >= t x referencia`.
 */
export const ThresholdEvaluator = {
  evaluate(input: {
    readonly thresholds: readonly string[];
    readonly alreadyCrossed: ReadonlySet<string> | readonly string[];
    readonly actual: string;
    readonly reference: string;
  }): ThresholdEvaluation | null {
    const reference = dec(input.reference);
    if (!reference.gt(0)) return null;
    const actual100 = dec(input.actual).times(100);
    const already = new Set<string>([...input.alreadyCrossed].map((t) => dec(t).toFixed()));
    const fresh = input.thresholds
      .map((t) => dec(t))
      .filter((t) => actual100.gte(reference.times(t)) && !already.has(t.toFixed()))
      .sort((a, b) => a.comparedTo(b))
      .map((t) => t.toFixed());
    if (fresh.length === 0) return null;
    const highest = fresh[fresh.length - 1] as string;
    return { highest, alsoCrossed: fresh.slice(0, -1), newlyCrossed: fresh };
  },
} as const;
