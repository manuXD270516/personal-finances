import { DomainError, LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/**
 * Máquina `ForecastRun` (openspec add-ml-forecasting-service, decisión 12; docs/31 D37): una corrida de pronóstico del
 * workspace. `COMPLETED → SUPERSEDED` y los reintentos (`RUNNING → REQUESTED`) son de sistema. `FAILED`,
 * `INSUFFICIENT_DATA` y `SUPERSEDED` son terminales.
 */
export const FORECAST_RUN_STATUSES = [
  'REQUESTED',
  'RUNNING',
  'COMPLETED',
  'INSUFFICIENT_DATA',
  'FAILED',
  'SUPERSEDED',
] as const;
export type ForecastRunStatus = (typeof FORECAST_RUN_STATUSES)[number];

export type ForecastRunTransition =
  'REQUEST' | 'START' | 'RETRY' | 'COMPLETE' | 'NO_DATA' | 'FAIL' | 'SUPERSEDE';
export type ForecastRunTransitionRecord = StateTransition<ForecastRunStatus, ForecastRunTransition>;

export const FORECAST_GENERATED_EVENT_TYPE = 'forecast.ForecastGenerated.v1';

export const FORECAST_RUN_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'ForecastRun',
  machineVersion: 1,
  states: [
    { code: 'REQUESTED', terminal: false },
    { code: 'RUNNING', terminal: false },
    { code: 'COMPLETED', terminal: false },
    { code: 'INSUFFICIENT_DATA', terminal: true },
    { code: 'FAILED', terminal: true },
    { code: 'SUPERSEDED', terminal: true },
  ],
  transitions: [
    {
      code: 'REQUEST',
      from: [],
      to: ['REQUESTED'],
      guard: 'función habilitada y ninguna otra corrida solicitada o en curso en el workspace',
      events: [],
    },
    {
      code: 'START',
      from: ['REQUESTED'],
      to: ['RUNNING'],
      guard: 'sistema: el ejecutor reclama la corrida más antigua con la espera cumplida',
      events: [],
    },
    {
      code: 'RETRY',
      from: ['RUNNING'],
      to: ['REQUESTED'],
      guard:
        'sistema: el servicio no respondió, rechazó la petición o excedió el tiempo, o la corrida quedó sin avance 15 minutos; quedan intentos y no pasaron 24 horas',
      events: [],
    },
    {
      code: 'COMPLETE',
      from: ['RUNNING'],
      to: ['COMPLETED'],
      guard: 'al menos una serie válida publicada',
      events: [FORECAST_GENERATED_EVENT_TYPE],
    },
    {
      code: 'NO_DATA',
      from: ['RUNNING'],
      to: ['INSUFFICIENT_DATA'],
      guard: 'ninguna serie con datos suficientes; no reemplaza al pronóstico vigente',
      events: [],
    },
    {
      code: 'FAIL',
      from: ['RUNNING'],
      to: ['FAILED'],
      guard: 'quinto intento fallido, 24 horas desde la solicitud o ninguna serie válida',
      events: [],
    },
    {
      code: 'SUPERSEDE',
      from: ['COMPLETED'],
      to: ['SUPERSEDED'],
      guard: 'sistema: otra corrida del workspace se completó',
      events: [],
    },
  ],
});

export const FAILURE_REASONS = [
  'SERVICE_UNAVAILABLE',
  'SERVICE_REJECTED',
  'TIMEOUT',
  'INVALID_OUTPUT',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export type ForecastTrigger = 'MANUAL' | 'SCHEDULED';

export interface ForecastRunState {
  readonly id: string;
  readonly workspaceId: string;
  readonly trigger: ForecastTrigger;
  readonly status: ForecastRunStatus;
  readonly requestedBy: string | null;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly asOfPeriod: string | null;
  readonly reportingCurrency: string;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly failureReason: FailureReason | null;
  readonly datasetSnapshotId: string | null;
  readonly serviceVersion: string | null;
  readonly supersededBy: string | null;
  readonly seriesPublished: number;
  readonly seriesInsufficient: number;
  readonly seriesInvalid: number;
  readonly version: number;
}

/** Política de reintentos (decisión 12): espera 5 min × 3^(intentos − 1); 5 intentos o 24 h desde la solicitud. */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly factor: number;
  readonly windowMs: number;
  /** Una corrida `RUNNING` sin progreso por tanto tiempo vuelve a `REQUESTED`. */
  readonly stallMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 5 * 60_000,
  factor: 3,
  windowMs: 24 * 3_600_000,
  stallMs: 15 * 60_000,
};

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * AR `ForecastRun`. Toda transición se valida contra `FORECAST_RUN_LIFECYCLE`; cada cambio sube `version` (el outbox exige
 * una versión por hecho).
 */
export class ForecastRun {
  private transition: ForecastRunTransitionRecord | null = null;

  private constructor(private state: ForecastRunState) {}

  static request(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly trigger: ForecastTrigger;
    readonly requestedBy: string | null;
    readonly at: string;
    readonly reportingCurrency: string;
  }): ForecastRun {
    if (input.trigger === 'MANUAL' && !input.requestedBy) {
      throw new DomainError('VALIDATION_FAILED', 'a manual run needs the requesting user');
    }
    const run = new ForecastRun({
      id: input.id,
      workspaceId: input.workspaceId,
      trigger: input.trigger,
      status: 'REQUESTED',
      requestedBy: input.requestedBy,
      requestedAt: input.at,
      startedAt: null,
      completedAt: null,
      asOfPeriod: null,
      reportingCurrency: input.reportingCurrency,
      attempts: 0,
      nextAttemptAt: input.at,
      failureReason: null,
      datasetSnapshotId: null,
      serviceVersion: null,
      supersededBy: null,
      seriesPublished: 0,
      seriesInsufficient: 0,
      seriesInvalid: 0,
      version: 1,
    });
    run.transition = FORECAST_RUN_LIFECYCLE.transition('REQUEST', null, 'REQUESTED');
    return run;
  }

  static restore(state: ForecastRunState): ForecastRun {
    return new ForecastRun(state);
  }

  get snapshot(): ForecastRunState {
    return this.state;
  }

  get id(): string {
    return this.state.id;
  }

  get workspaceId(): string {
    return this.state.workspaceId;
  }

  get status(): ForecastRunStatus {
    return this.state.status;
  }

  get version(): number {
    return this.state.version;
  }

  /** Transición aplicada por el último comando (para el recorrido); `null` si ninguna. */
  get lastTransition(): ForecastRunTransitionRecord | null {
    return this.transition;
  }

  /** `REQUESTED → RUNNING`: el ejecutor la reclama. */
  start(at: string): void {
    this.move('START', 'RUNNING', { startedAt: at }, at);
  }

  /**
   * Falla del intento (servicio caído, rechazo o tiempo): vuelve a `REQUESTED` con espera creciente o, agotados los
   * intentos o la ventana de 24 h, termina `FAILED` con el motivo.
   */
  failAttempt(
    reason: FailureReason,
    at: string,
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ): 'RETRY' | 'FAIL' {
    const attempts = this.state.attempts + 1;
    const exhausted =
      attempts >= policy.maxAttempts ||
      Date.parse(at) - Date.parse(this.state.requestedAt) >= policy.windowMs;
    if (exhausted) {
      this.move('FAIL', 'FAILED', { attempts, failureReason: reason, completedAt: at }, at);
      return 'FAIL';
    }
    const delay = policy.baseDelayMs * policy.factor ** (attempts - 1);
    this.move(
      'RETRY',
      'REQUESTED',
      { attempts, failureReason: reason, nextAttemptAt: iso(Date.parse(at) + delay) },
      at,
    );
    return 'RETRY';
  }

  /** `RUNNING → FAILED` sin reintentos (ninguna serie válida: salida inválida). */
  failNow(reason: FailureReason, at: string): void {
    this.move('FAIL', 'FAILED', { failureReason: reason, completedAt: at }, at);
  }

  /** Corrida `RUNNING` colgada (caída del worker): vuelve a `REQUESTED` como un intento fallido sin motivo del servicio. */
  isStalled(now: string, policy: RetryPolicy = DEFAULT_RETRY_POLICY): boolean {
    return (
      this.state.status === 'RUNNING' &&
      this.state.startedAt !== null &&
      Date.parse(now) - Date.parse(this.state.startedAt) >= policy.stallMs
    );
  }

  complete(input: {
    readonly at: string;
    readonly asOfPeriod: string;
    readonly datasetSnapshotId: string;
    readonly serviceVersion: string;
    readonly seriesPublished: number;
    readonly seriesInsufficient: number;
    readonly seriesInvalid: number;
  }): void {
    if (input.seriesPublished < 1) {
      throw new DomainError('VALIDATION_FAILED', 'a completed run needs at least one published series');
    }
    this.move(
      'COMPLETE',
      'COMPLETED',
      {
        completedAt: input.at,
        asOfPeriod: input.asOfPeriod,
        datasetSnapshotId: input.datasetSnapshotId,
        serviceVersion: input.serviceVersion,
        seriesPublished: input.seriesPublished,
        seriesInsufficient: input.seriesInsufficient,
        seriesInvalid: input.seriesInvalid,
        failureReason: null,
      },
      input.at,
    );
  }

  /** Sin ninguna serie con datos suficientes: `INSUFFICIENT_DATA`, sin reemplazar la vigente. */
  noData(input: {
    readonly at: string;
    readonly asOfPeriod: string | null;
    readonly seriesInsufficient: number;
  }): void {
    this.move(
      'NO_DATA',
      'INSUFFICIENT_DATA',
      { completedAt: input.at, asOfPeriod: input.asOfPeriod, seriesInsufficient: input.seriesInsufficient },
      input.at,
    );
  }

  /** `COMPLETED → SUPERSEDED` cuando otra corrida del workspace se completa. */
  supersede(by: string, at: string): void {
    this.move('SUPERSEDE', 'SUPERSEDED', { supersededBy: by }, at);
  }

  private move(
    code: ForecastRunTransition,
    to: ForecastRunStatus,
    patch: Partial<Mutable<ForecastRunState>>,
    _at: string,
  ): void {
    const record = FORECAST_RUN_LIFECYCLE.transition(code, this.state.status, to);
    this.state = { ...this.state, ...patch, status: to, version: this.state.version + 1 };
    this.transition = record;
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
