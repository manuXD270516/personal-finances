import type { HttpResponseSnapshot } from '../errors/problem.js';

/**
 * Ámbito de una clave (design §3): el workspace de la ruta o, en operaciones sin workspace (p. ej.
 * `POST /workspaces`), el usuario. `userId` siempre está (quién ejecuta).
 */
export interface IdempotencyScope {
  readonly workspaceId?: string;
  readonly userId: string;
}

export const scopeIdOf = (scope: IdempotencyScope): string => scope.workspaceId ?? scope.userId;

export interface ReserveRequest {
  readonly scope: IdempotencyScope;
  readonly key: string;
  readonly method: string;
  /** Plantilla de ruta del contrato (`/workspaces/{workspaceId}/transactions`). */
  readonly route: string;
  /** SHA-256 hex de `method ‖ route ‖ JCS(body)`. */
  readonly requestHash: string;
  readonly now: Date;
  /** Vigencia de la reserva IN_PROGRESS (proceso caído ⇒ otra petición la retoma al vencer). */
  readonly lockTtlMs: number;
  /** Retención de la clave (≥ 24 h, ≤ 7 días). Pasada, la clave se trata como nueva. */
  readonly retentionMs: number;
}

/** Referencia a una reserva propia; `token` impide que un dueño vencido complete sobre una reserva retomada. */
export interface ReservationRef {
  readonly scope: IdempotencyScope;
  readonly key: string;
  readonly token: string;
}

export type ReserveResult =
  | { readonly outcome: 'reserved'; readonly ref: ReservationRef }
  | { readonly outcome: 'completed'; readonly requestHash: string; readonly response: HttpResponseSnapshot }
  | { readonly outcome: 'in-progress'; readonly requestHash: string };

/**
 * Transacción SQL abierta por la Unit of Work del comando. `complete` la usa para confirmar efectos y respuesta
 * juntos (exactly-once, design §3 paso 2). Estructuralmente compatible con `pg.PoolClient`.
 */
export interface SqlExecutor {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** Puerto de persistencia de claves de idempotencia (`platform.idempotency_key`). */
export interface IdempotencyStore {
  /** Reserva la clave (`IN_PROGRESS`) o informa el estado vigente. Transacción corta propia. */
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  /**
   * Marca la reserva `COMPLETED` con la respuesta. Con `tx`, dentro de la transacción del comando; sin `tx`, en una
   * transacción propia (rechazos 4xx deterministas). Falla si la reserva ya no es de `ref.token`.
   */
  complete(ref: ReservationRef, response: HttpResponseSnapshot, now: Date, tx?: SqlExecutor): Promise<void>;
  /** Borra la reserva (5xx/429): el reintento con la misma clave vuelve a ejecutar el comando. */
  release(ref: ReservationRef): Promise<void>;
}

/** La reserva dejó de pertenecer a quien intenta completarla (venció y otra petición la retomó). */
export class ReservationLostError extends Error {
  override readonly name = 'ReservationLostError';
  constructor() {
    super('idempotency reservation lost (expired and taken over)');
  }
}
