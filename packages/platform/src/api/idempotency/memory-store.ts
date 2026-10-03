import { randomUUID } from 'node:crypto';
import type { HttpResponseSnapshot } from '../errors/problem.js';
import {
  ReservationLostError,
  scopeIdOf,
  type IdempotencyStore,
  type ReservationRef,
  type ReserveRequest,
  type ReserveResult,
  type SqlExecutor,
} from './store.js';

interface Row {
  requestHash: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  token: string;
  lockedUntil: number;
  expiresAt: number;
  response?: HttpResponseSnapshot;
}

/**
 * `IdempotencyStore` en memoria con la misma semántica que `PgIdempotencyStore` (tests de la política y harness).
 * No apto para producción: no sobrevive reinicios ni se comparte entre réplicas.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly rows = new Map<string, Row>();

  private static id(scopeId: string, key: string): string {
    return `${scopeId}\u0000${key}`;
  }

  async reserve(req: ReserveRequest): Promise<ReserveResult> {
    const id = InMemoryIdempotencyStore.id(scopeIdOf(req.scope), req.key);
    const now = req.now.getTime();
    const row = this.rows.get(id);
    const takeOver = !row || row.expiresAt <= now || (row.status === 'IN_PROGRESS' && row.lockedUntil <= now);
    if (takeOver) {
      const token = randomUUID();
      this.rows.set(id, {
        requestHash: req.requestHash,
        status: 'IN_PROGRESS',
        token,
        lockedUntil: now + req.lockTtlMs,
        expiresAt: now + req.retentionMs,
      });
      return { outcome: 'reserved', ref: { scope: req.scope, key: req.key, token } };
    }
    if (row.status === 'COMPLETED' && row.response) {
      return { outcome: 'completed', requestHash: row.requestHash, response: row.response };
    }
    return { outcome: 'in-progress', requestHash: row.requestHash };
  }

  async complete(
    ref: ReservationRef,
    response: HttpResponseSnapshot,
    _now: Date,
    _tx?: SqlExecutor,
  ): Promise<void> {
    const row = this.rows.get(InMemoryIdempotencyStore.id(scopeIdOf(ref.scope), ref.key));
    if (!row || row.token !== ref.token || row.status !== 'IN_PROGRESS') throw new ReservationLostError();
    row.status = 'COMPLETED';
    row.response = structuredClone(response);
  }

  async release(ref: ReservationRef): Promise<void> {
    const id = InMemoryIdempotencyStore.id(scopeIdOf(ref.scope), ref.key);
    if (this.rows.get(id)?.token === ref.token) this.rows.delete(id);
  }

  /** Purga por retención (equivalente al job de `pf_maintenance`). */
  purgeExpired(now: Date): number {
    let purged = 0;
    for (const [id, row] of this.rows) {
      if (row.expiresAt <= now.getTime()) {
        this.rows.delete(id);
        purged += 1;
      }
    }
    return purged;
  }

  get size(): number {
    return this.rows.size;
  }
}
