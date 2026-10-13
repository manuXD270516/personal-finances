import type { Clock, Instant } from '@pf/shared-kernel';
import { ProviderError, type FxRateProvider } from '../domain/index.js';
import type {
  IdGenerator,
  ProviderRun,
  ProviderRunKind,
  ProviderRunOutcome,
  ProviderRunRepository,
} from './ports/index.js';

export interface ProviderCycleResult {
  readonly provider: FxRateProvider;
  readonly outcome: ProviderRunOutcome;
  readonly newSamples: number;
  readonly errorCode: string | null;
}

/** Bitácora de intentos de providers (`fx.provider_run`, tabla de instalación sin datos de usuario). */
export class ProviderRunLog {
  constructor(
    private readonly runs: ProviderRunRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Registra una falla del provider (`ProviderError`); cualquier otro error es un bug y se propaga. */
  failure(
    provider: FxRateProvider,
    kind: ProviderRunKind,
    startedAt: Instant,
    err: unknown,
  ): Promise<ProviderCycleResult> {
    if (!(err instanceof ProviderError)) throw err;
    return this.finish(provider, kind, startedAt, 'FAILED', 0, err, {
      retryAfterUntil: err.retryAfterUntil,
    });
  }

  async finish(
    provider: FxRateProvider,
    kind: ProviderRunKind,
    startedAt: Instant,
    outcome: ProviderRunOutcome,
    newSamples: number,
    error: ProviderError | null,
    extra: Partial<Pick<ProviderRun, 'retryAfterUntil' | 'historyPoints' | 'historyFrom' | 'historyTo'>> = {},
  ): Promise<ProviderCycleResult> {
    const finishedAt = this.clock.now();
    await this.runs.record({
      id: this.ids.next(),
      provider,
      kind,
      startedAt: startedAt.toString(),
      finishedAt: finishedAt.toString(),
      outcome,
      errorCode: error?.code ?? null,
      httpStatus: error?.httpStatus ?? null,
      latencyMs: Math.max(0, finishedAt.epochMillis - startedAt.epochMillis),
      newSamples,
      retryAfterUntil: extra.retryAfterUntil ?? null,
      historyPoints: extra.historyPoints ?? null,
      historyFrom: extra.historyFrom ?? null,
      historyTo: extra.historyTo ?? null,
    });
    return { provider, outcome, newSamples, errorCode: error?.code ?? null };
  }
}
