/**
 * Orden determinista de los archivos `*.perf.ts` (investigate-perf-under-load, tarea 5.2). El orden por defecto de
 * Vitest no es determinista (usa la caché de duraciones y fallos de la corrida anterior), y cada suite deja carga de
 * fondo al terminar. Orden y razón:
 *
 *  1. `nightly`: siembra el Large Seed y mide los NFR sobre él; las suites siguientes miden con ese volumen de base
 *     (el escenario de TC-PLATFORM-PIPELINE-024) y la purga de D291 elimina el backlog que deja (eventos pendientes y
 *     ~1,39 M de trabajos `events.*`).
 *  2. Suites de latencia (`spendable`, `goals`, `loan-simulator`, `upcoming-payments`, `subscriptions`): sensibles a la
 *     carga del host; corren primero tras `nightly`, con la purga y la espera de quietud.
 *  3. `commitments`: mide el throughput del matcher y deja su inbox y sus ocurrencias.
 *  4. `imports`: deja la mayor carga del host (7,5–8) y ~112 000 filas muertas en `pgboss.job`; va al final para que no
 *     contamine a ninguna otra.
 */
export const PERF_SUITE_ORDER: readonly string[] = [
  'nightly.perf.ts',
  'spendable.perf.ts',
  'goals.perf.ts',
  'loan-simulator.perf.ts',
  'upcoming-payments.perf.ts',
  'subscriptions.perf.ts',
  'commitments.perf.ts',
  'imports.perf.ts',
];

/** Ordena `files` por `PERF_SUITE_ORDER`; los que no figuran van al final, por nombre (orden estable y explícito). */
export function orderPerfSuites<T>(
  files: readonly T[],
  pathOf: (f: T) => string,
  order: readonly string[] = PERF_SUITE_ORDER,
): T[] {
  const name = (f: T): string => pathOf(f).split(/[\\/]/u).pop() ?? '';
  const rank = (f: T): number => {
    const i = order.indexOf(name(f));
    return i === -1 ? order.length : i;
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || name(a).localeCompare(name(b)));
}
