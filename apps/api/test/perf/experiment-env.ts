/**
 * Rama de experimentos de investigate-perf-under-load (tarea 3.1; NO se fusiona). Lee las variables `PF_PERF_*` que
 * activan cada variante E1–E8 (design, decisión 3). Sin ninguna, el benchmark se comporta exactamente como el de `main`.
 *
 *   PF_PERF_SUITES          archivos `*.perf.ts` a correr, en ese orden (`spendable,commitments`; con o sin extensión)
 *   PF_PERF_PURGE_BACKLOG   `1`: purga el backlog residual (outbox y colas `events.*`) al empezar cada suite
 *   PF_PERF_TRIVIAL_HANDLER `1`: handler trivial (no-op, con inbox) en los consumidores medidos
 *   PF_PERF_CONCURRENCY     concurrencia por consumidor (entero ≥ 1)
 *   PF_PERF_ONE_CONSUMER    solo este consumidor (p. ej. `planning.journal-entry-posted`); el resto no se registra
 *   PF_PERF_LABEL           etiqueta de la corrida: activa pg_stat_statements, muestreo, EXPLAIN y el bloque PERF-EXPERIMENT
 */
export interface ExperimentConfig {
  /** Archivos de suite en el orden pedido (vacío = todos, orden por defecto de Vitest). */
  readonly suites: readonly string[];
  readonly purgeBacklog: boolean;
  readonly trivialHandler: boolean;
  readonly concurrency: number | undefined;
  readonly oneConsumer: string | undefined;
  /** Vacío = sin experimento (no se instrumenta nada). */
  readonly label: string;
}

const truthy = (v: string | undefined): boolean => v !== undefined && /^(1|true|yes)$/i.test(v.trim());

/** `spendable`, `spendable.perf`, `spendable.perf.ts` y `test/perf/spendable.perf.ts` → `spendable.perf.ts`. */
export function normalizeSuiteName(raw: string): string {
  const base = raw.trim().split('/').pop() ?? '';
  return `${base.replace(/\.perf\.ts$/u, '').replace(/\.perf$/u, '')}.perf.ts`;
}

export function parseExperiment(env: Readonly<Record<string, string | undefined>>): ExperimentConfig {
  const suites = (env['PF_PERF_SUITES'] ?? '')
    .split(/[\s,]+/u)
    .filter((s) => s !== '')
    .map(normalizeSuiteName);
  const rawConcurrency = (env['PF_PERF_CONCURRENCY'] ?? '').trim();
  let concurrency: number | undefined;
  if (rawConcurrency !== '') {
    concurrency = Number(rawConcurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1)
      throw new Error(`PF_PERF_CONCURRENCY inválida: "${rawConcurrency}" (entero ≥ 1)`);
  }
  const oneConsumer = (env['PF_PERF_ONE_CONSUMER'] ?? '').trim();
  return {
    suites,
    purgeBacklog: truthy(env['PF_PERF_PURGE_BACKLOG']),
    trivialHandler: truthy(env['PF_PERF_TRIVIAL_HANDLER']),
    concurrency,
    oneConsumer: oneConsumer === '' ? undefined : oneConsumer,
    label: (env['PF_PERF_LABEL'] ?? '').trim(),
  };
}

/** Ordena `files` (rutas absolutas) según `suites`; las que no están en la lista se descartan. */
export function orderSuites<T>(
  files: readonly T[],
  suites: readonly string[],
  pathOf: (f: T) => string,
): T[] {
  if (suites.length === 0) return [...files];
  const rank = (f: T): number => suites.indexOf(pathOf(f).split('/').pop() ?? '');
  return files.filter((f) => rank(f) >= 0).sort((a, b) => rank(a) - rank(b));
}

export interface ConsumerLike {
  readonly consumer: string;
  readonly handler: (...args: never[]) => Promise<void>;
  readonly concurrency?: number;
}

/**
 * Aplica los interruptores de consumidores a una lista de definiciones: un solo consumidor, handler trivial y
 * concurrencia. Devuelve la lista nueva; si `oneConsumer` no existe, falla (un experimento mal escrito no debe correr).
 */
export function applyConsumerExperiment<T extends ConsumerLike>(
  defs: readonly T[],
  config: Pick<ExperimentConfig, 'trivialHandler' | 'concurrency' | 'oneConsumer'>,
): T[] {
  let out = [...defs];
  if (config.oneConsumer !== undefined) {
    out = out.filter((d) => d.consumer === config.oneConsumer);
    if (out.length === 0)
      throw new Error(
        `PF_PERF_ONE_CONSUMER="${config.oneConsumer}" no coincide con ningún consumidor (${defs
          .map((d) => d.consumer)
          .join(', ')})`,
      );
  }
  return out.map((d) => ({
    ...d,
    ...(config.trivialHandler ? { handler: async () => undefined } : {}),
    ...(config.concurrency !== undefined ? { concurrency: config.concurrency } : {}),
  }));
}
