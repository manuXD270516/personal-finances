/** Chequeo de una dependencia crítica para `/health/ready`. Debe rechazar si la dependencia no responde. */
export interface DependencyCheck {
  readonly name: string;
  check(signal: AbortSignal): Promise<void>;
}

export type DependencyStatus = 'up' | 'down';

export interface ReadinessReport {
  readonly status: 'ready' | 'not_ready';
  /** Estado por dependencia. Nunca incluye mensajes de error, hosts ni credenciales. */
  readonly checks: Readonly<Record<string, DependencyStatus>>;
  readonly failing: readonly string[];
}

export interface LivenessReport {
  readonly status: 'ok';
}

/** Liveness: solo indica que el proceso atiende peticiones. NO toca dependencias (evita ciclos de reinicio). */
export const LIVENESS_REPORT: LivenessReport = Object.freeze({ status: 'ok' });

export type CheckFailureListener = (name: string, error: unknown) => void;

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timeout after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

async function runWithTimeout(check: DependencyCheck, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    await Promise.race([check.check(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Evalúa todas las dependencias en paralelo, cada una con su timeout. Nunca lanza. */
export class ReadinessProbe {
  constructor(
    private readonly checks: readonly DependencyCheck[],
    private readonly timeoutMs: number,
    private readonly onFailure: CheckFailureListener = () => {},
  ) {}

  get dependencyNames(): readonly string[] {
    return this.checks.map((c) => c.name);
  }

  async evaluate(): Promise<ReadinessReport> {
    const results = await Promise.all(
      this.checks.map(async (c): Promise<[string, DependencyStatus]> => {
        try {
          await runWithTimeout(c, this.timeoutMs);
          return [c.name, 'up'];
        } catch (error) {
          this.onFailure(c.name, error);
          return [c.name, 'down'];
        }
      }),
    );
    const checks = Object.fromEntries(results);
    const failing = results.filter(([, s]) => s === 'down').map(([n]) => n);
    return { status: failing.length === 0 ? 'ready' : 'not_ready', checks, failing };
  }
}
