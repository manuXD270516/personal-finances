import type { Clock } from '@pf/shared-kernel';
import { ApiProblem, type HttpResponseSnapshot } from '../errors/problem.js';
import { idempotencyRequestHash } from './request-hash.js';
import type { IdempotencyScope, IdempotencyStore, ReservationRef, SqlExecutor } from './store.js';

/** Reserva IN_PROGRESS: 30 s (design §3). */
export const DEFAULT_LOCK_TTL_MS = 30_000;
/** Retención mínima 24 h y máxima 7 días (spec "Retención limitada de claves de idempotencia"). */
export const MIN_RETENTION_MS = 24 * 3_600_000;
export const MAX_RETENTION_MS = 7 * 24 * 3_600_000;

export interface IdempotencyPolicyOptions {
  readonly retentionMs: number;
  readonly lockTtlMs?: number;
}

export interface IdempotentRequest {
  readonly scope: IdempotencyScope;
  readonly key: string;
  readonly method: string;
  readonly route: string;
  readonly body: unknown;
}

export interface CommandContext {
  /**
   * Confirma la respuesta dentro de la transacción del comando (`tx`) para que efectos y respuesta se confirmen
   * juntos. Si el comando no la llama, la política completa en una transacción propia al terminar.
   */
  complete(response: HttpResponseSnapshot, tx?: SqlExecutor): Promise<void>;
}

export type IdempotentOutcome =
  | { readonly replayed: false; readonly response: HttpResponseSnapshot }
  | { readonly replayed: true; readonly response: HttpResponseSnapshot };

/** Se almacenan 2xx y 4xx deterministas; nunca 5xx ni 429 (el reintento debe re-ejecutar, design §3 paso 3). */
export const isStorableStatus = (status: number): boolean => status < 500 && status !== 429;

/**
 * Política de idempotencia de POST financieros (docs/10 §7, design §3), independiente de HTTP/Nest:
 * - misma clave + mismo hash + COMPLETED ⇒ reproduce la respuesta almacenada (`replayed: true`);
 * - misma clave + hash distinto ⇒ 422 `IDEMPOTENCY_KEY_REUSED` (D1, docs/31);
 * - misma clave en curso ⇒ 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS` + `Retry-After: 1`;
 * - fallo 5xx/429 ⇒ libera la reserva; rechazo 4xx ⇒ lo almacena.
 */
export class IdempotencyPolicy {
  private readonly retentionMs: number;
  private readonly lockTtlMs: number;

  constructor(
    private readonly store: IdempotencyStore,
    private readonly clock: Clock,
    options: IdempotencyPolicyOptions,
  ) {
    if (options.retentionMs < MIN_RETENTION_MS || options.retentionMs > MAX_RETENTION_MS) {
      throw new RangeError('idempotency retention must be between 24 h and 7 days');
    }
    this.retentionMs = options.retentionMs;
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  }

  async execute(
    request: IdempotentRequest,
    run: (ctx: CommandContext) => Promise<HttpResponseSnapshot>,
    renderError: (err: unknown) => HttpResponseSnapshot,
  ): Promise<IdempotentOutcome> {
    const requestHash = idempotencyRequestHash(request.method, request.route, request.body);
    const reservation = await this.store.reserve({
      scope: request.scope,
      key: request.key,
      method: request.method.toUpperCase(),
      route: request.route,
      requestHash,
      now: this.clock.now().toDate(),
      lockTtlMs: this.lockTtlMs,
      retentionMs: this.retentionMs,
    });

    if (reservation.outcome !== 'reserved') {
      if (reservation.requestHash !== requestHash) {
        throw new ApiProblem(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used with a different payload',
        );
      }
      if (reservation.outcome === 'in-progress') {
        throw new ApiProblem(
          'IDEMPOTENCY_REQUEST_IN_PROGRESS',
          'the first request with this key is still running',
          {
            headers: { 'retry-after': '1' },
          },
        );
      }
      return { replayed: true, response: reservation.response };
    }

    return this.runReserved(reservation.ref, run, renderError);
  }

  private async runReserved(
    ref: ReservationRef,
    run: (ctx: CommandContext) => Promise<HttpResponseSnapshot>,
    renderError: (err: unknown) => HttpResponseSnapshot,
  ): Promise<IdempotentOutcome> {
    let completed = false;
    const ctx: CommandContext = {
      complete: async (response, tx) => {
        await this.store.complete(ref, response, this.clock.now().toDate(), tx);
        completed = true;
      },
    };
    try {
      const response = await run(ctx);
      if (!completed) await this.store.complete(ref, response, this.clock.now().toDate());
      return { replayed: false, response };
    } catch (err) {
      // Si la transacción del comando falló, `complete` dentro de ella se revirtió: la fila sigue IN_PROGRESS.
      const rendered = renderError(err);
      if (isStorableStatus(rendered.status)) {
        await this.store
          .complete(ref, rendered, this.clock.now().toDate())
          .catch(() => this.safeRelease(ref));
      } else {
        await this.safeRelease(ref);
      }
      throw err;
    }
  }

  private async safeRelease(ref: ReservationRef): Promise<void> {
    // Si la base no responde, la reserva vence sola (`locked_until`) y el reintento la retoma.
    await this.store.release(ref).catch(() => undefined);
  }
}
