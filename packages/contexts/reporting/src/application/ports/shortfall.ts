/** Unidad de trabajo del job: una transacción por workspace (misma forma que `ReportingUnitOfWork.run`). */
interface ShortfallUnitOfWork {
  run<T>(
    ctx: { readonly userId: string | null; readonly workspaceId: string },
    fn: () => Promise<T>,
  ): Promise<T>;
}

/** Episodio de riesgo de déficit de una moneda (`reporting.cash_flow_shortfall_episode`). */
export interface ShortfallEpisode {
  readonly id: string;
  readonly workspaceId: string;
  readonly currency: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly firstShortfallDate: string;
  readonly lowestAmount: string;
  readonly lowestDate: string;
  readonly thresholdAmount: string;
  readonly belowZero: boolean;
  readonly lastEvaluatedAt: string;
  readonly lastLowestAmount: string;
}

export interface ShortfallEpisodeRepository {
  /** Episodios ABIERTOS del workspace por moneda. */
  listOpen(workspaceId: string): Promise<readonly ShortfallEpisode[]>;
  /**
   * Abre el episodio; `false` si otra réplica del worker ya abrió uno para esa moneda (índice único parcial): en ese caso
   * no se publica nada.
   */
  open(episode: ShortfallEpisode): Promise<boolean>;
  /** Riesgo sostenido: actualiza la última evaluación y el último saldo más bajo, sin publicar. */
  touch(id: string, input: { readonly evaluatedAt: string; readonly lowestAmount: string }): Promise<void>;
  /** Cierra el episodio abierto; `false` si ya estaba cerrado (otra réplica). */
  close(id: string, closedAt: string): Promise<boolean>;
  /** Retención: borra los episodios cerrados antes de `cutoff`; devuelve cuántos. */
  purgeClosedBefore(cutoff: string): Promise<number>;
}

/** Workspaces activos con su zona horaria y moneda base (IDENTITY, directorio). */
export interface ShortfallWorkspacesPort {
  list(): Promise<
    readonly { readonly workspaceId: string; readonly timeZone: string; readonly baseCurrency: string }[]
  >;
}

/** Hechos de dominio del outbox (misma transacción). Devuelve el `eventId` para encadenar la notificación. */
export interface ShortfallOutboxPort {
  append(event: {
    readonly eventId: string;
    readonly eventType: string;
    readonly eventVersion: number;
    readonly occurredAt: string;
    readonly workspaceId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly actor?: { readonly type: 'USER' | 'SYSTEM' | 'SERVICE'; readonly id: string | null };
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

/** Notificación directa a NOTIFY (`NotificationIntakePort`, D249), dentro de la unidad de trabajo del llamador. */
export interface ShortfallNotifierPort {
  notify(fact: {
    readonly workspaceId: string;
    readonly episodeId: string;
    readonly sourceEventId: string;
    readonly occurredAt: string;
    readonly timeZone: string;
    readonly currency: string;
    readonly horizonDays: number;
    readonly firstShortfallDate: string;
    readonly lowest: { readonly amount: string; readonly currency: string };
    readonly lowestDate: string;
    readonly threshold: { readonly amount: string; readonly currency: string };
    readonly belowZero: boolean;
  }): Promise<void>;
}

export interface ShortfallIds {
  next(): string;
}

export interface ShortfallWatchDeps {
  readonly uow: ShortfallUnitOfWork;
  readonly workspaces: ShortfallWorkspacesPort;
  readonly episodes: ShortfallEpisodeRepository;
  readonly outbox: ShortfallOutboxPort;
  readonly notifier: ShortfallNotifierPort;
  readonly ids: ShortfallIds;
  readonly clock: { now(): { toString(): string; readonly epochMillis: number } };
  /** Horizonte de la alerta (7, 30, 60 o 90; 30 por omisión, D381). */
  readonly horizonDays: number;
  /** Retención de episodios cerrados en días (400). */
  readonly retentionDays?: number;
}
