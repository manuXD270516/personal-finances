import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { SessionCipher } from './session-crypto';

/** Tokens OIDC de una sesión. Viven SOLO del lado servidor, cifrados (nunca llegan al navegador). */
export interface TokenSet {
  readonly accessToken: string;
  /** Epoch ms en que expira el access token. */
  readonly accessTokenExpiresAt: number;
  readonly refreshToken?: string;
  readonly idToken?: string;
}

/** Estado de un login en curso (registro pre-sesión `PENDING_LOGIN`, un solo uso, TTL 10 min). */
export interface LoginState {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
}

export interface ActiveSession {
  readonly id: string;
  readonly userId: string;
  readonly tokens: TokenSet;
  readonly csrfSecret: string;
  readonly activeWorkspaceId: string | null;
  readonly createdAt: number;
  readonly idleExpiresAt: number;
  readonly absoluteExpiresAt: number;
}

export interface SessionTimeouts {
  readonly idleMs: number;
  readonly absoluteMs: number;
}

/**
 * Almacén de sesiones del BFF (`iam.bff_session`, design §2/§6). Todos los instantes los da el llamador (reloj
 * inyectable): la expiración por inactividad y absoluta se evalúa con ese reloj.
 */
export interface SessionStore {
  createPending(sidHash: Buffer, state: LoginState, now: number, ttlMs: number): Promise<void>;
  /** Consume (borra) el registro pre-sesión: un `state` no se puede reutilizar. `null` si no existe o expiró. */
  consumePending(sidHash: Buffer, now: number): Promise<LoginState | null>;
  createActive(input: {
    readonly sidHash: Buffer;
    readonly userId: string;
    readonly tokens: TokenSet;
    readonly csrfSecret: string;
    readonly now: number;
    readonly timeouts: SessionTimeouts;
  }): Promise<string>;
  /**
   * Sesión activa por `sha256(sid)`. Si expiró (inactividad o absoluta) la borra y devuelve `null`. Desliza la
   * inactividad como máximo una vez por minuto (no escribe en cada request).
   */
  findActive(sidHash: Buffer, now: number, timeouts: SessionTimeouts): Promise<ActiveSession | null>;
  /**
   * Ejecuta `fn` con el bloqueo exclusivo de la sesión (`pg_advisory_xact_lock`) y los tokens RELEÍDOS bajo el
   * bloqueo; si `fn` devuelve tokens nuevos se persisten en la misma transacción. `null` si la sesión ya no existe.
   */
  withRefreshLock(
    id: string,
    fn: (current: TokenSet) => Promise<TokenSet | undefined>,
  ): Promise<TokenSet | null>;
  setActiveWorkspace(id: string, workspaceId: string | null): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Margen de deslizamiento: `last_seen_at` se escribe como máximo una vez por minuto. */
export const SLIDE_EVERY_MS = 60_000;

interface Row {
  id: string;
  kind: 'PENDING_LOGIN' | 'ACTIVE';
  user_id: string | null;
  tokens_enc: Buffer | null;
  csrf_secret_enc: Buffer | null;
  active_workspace_id: string | null;
  created_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
}

const ms = (d: Date): number => d.getTime();
const at = (epochMs: number): Date => new Date(epochMs);

/** Adaptador PostgreSQL (rol `pf_bff`, grants solo sobre `iam.bff_session`). */
export class PgSessionStore implements SessionStore {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: SessionCipher,
  ) {}

  async createPending(sidHash: Buffer, state: LoginState, now: number, ttlMs: number): Promise<void> {
    const id = randomUUID();
    const expires = at(now + ttlMs);
    await this.pool.query(
      `INSERT INTO iam.bff_session (id, sid_hash, kind, login_state_enc, created_at, last_seen_at,
                                    idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, 'PENDING_LOGIN', $3, $4, $4, $5, $5)`,
      [id, sidHash, this.cipher.encrypt(JSON.stringify(state), `${id}:login`), at(now), expires],
    );
  }

  async consumePending(sidHash: Buffer, now: number): Promise<LoginState | null> {
    const { rows } = await this.pool.query<{
      id: string;
      login_state_enc: Buffer | null;
      absolute_expires_at: Date;
    }>(
      `DELETE FROM iam.bff_session WHERE sid_hash = $1 AND kind = 'PENDING_LOGIN'
       RETURNING id, login_state_enc, absolute_expires_at`,
      [sidHash],
    );
    const row = rows[0];
    if (!row?.login_state_enc || ms(row.absolute_expires_at) <= now) return null;
    try {
      return JSON.parse(this.cipher.decrypt(row.login_state_enc, `${row.id}:login`)) as LoginState;
    } catch {
      return null;
    }
  }

  async createActive(input: Parameters<SessionStore['createActive']>[0]): Promise<string> {
    const id = randomUUID();
    const { now, timeouts } = input;
    const absolute = now + timeouts.absoluteMs;
    await this.pool.query(
      `INSERT INTO iam.bff_session (id, sid_hash, kind, user_id, tokens_enc, csrf_secret_enc, created_at,
                                    last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6, $6, $7, $8)`,
      [
        id,
        input.sidHash,
        input.userId,
        this.cipher.encrypt(JSON.stringify(input.tokens), `${id}:tokens`),
        this.cipher.encrypt(input.csrfSecret, `${id}:csrf`),
        at(now),
        at(Math.min(now + timeouts.idleMs, absolute)),
        at(absolute),
      ],
    );
    return id;
  }

  async findActive(sidHash: Buffer, now: number, timeouts: SessionTimeouts): Promise<ActiveSession | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT id, kind, user_id, tokens_enc, csrf_secret_enc, active_workspace_id, created_at, last_seen_at,
              idle_expires_at, absolute_expires_at
         FROM iam.bff_session WHERE sid_hash = $1 AND kind = 'ACTIVE'`,
      [sidHash],
    );
    const row = rows[0];
    if (!row) return null;
    const session = this.decode(row);
    if (!session || now >= session.idleExpiresAt || now >= session.absoluteExpiresAt) {
      await this.delete(row.id);
      return null;
    }
    if (now - ms(row.last_seen_at) >= SLIDE_EVERY_MS) {
      const idle = Math.min(now + timeouts.idleMs, session.absoluteExpiresAt);
      await this.pool.query(
        `UPDATE iam.bff_session SET last_seen_at = $2, idle_expires_at = $3 WHERE id = $1`,
        [row.id, at(now), at(idle)],
      );
      return { ...session, idleExpiresAt: idle };
    }
    return session;
  }

  async withRefreshLock(
    id: string,
    fn: (current: TokenSet) => Promise<TokenSet | undefined>,
  ): Promise<TokenSet | null> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [id]);
      const { rows } = await client.query<{ tokens_enc: Buffer | null }>(
        `SELECT tokens_enc FROM iam.bff_session WHERE id = $1 AND kind = 'ACTIVE'`,
        [id],
      );
      const blob = rows[0]?.tokens_enc;
      if (!blob) {
        await client.query('COMMIT');
        return null;
      }
      const current = JSON.parse(this.cipher.decrypt(blob, `${id}:tokens`)) as TokenSet;
      const next = await fn(current);
      if (next) {
        await client.query(
          'UPDATE iam.bff_session SET tokens_enc = $2, version = version + 1 WHERE id = $1',
          [id, this.cipher.encrypt(JSON.stringify(next), `${id}:tokens`)],
        );
      }
      await client.query('COMMIT');
      return next ?? current;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async setActiveWorkspace(id: string, workspaceId: string | null): Promise<void> {
    await this.pool.query('UPDATE iam.bff_session SET active_workspace_id = $2 WHERE id = $1', [
      id,
      workspaceId,
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM iam.bff_session WHERE id = $1', [id]);
  }

  private decode(row: Row): ActiveSession | null {
    if (!row.user_id || !row.tokens_enc || !row.csrf_secret_enc) return null;
    try {
      return {
        id: row.id,
        userId: row.user_id,
        tokens: JSON.parse(this.cipher.decrypt(row.tokens_enc, `${row.id}:tokens`)) as TokenSet,
        csrfSecret: this.cipher.decrypt(row.csrf_secret_enc, `${row.id}:csrf`),
        activeWorkspaceId: row.active_workspace_id,
        createdAt: ms(row.created_at),
        idleExpiresAt: ms(row.idle_expires_at),
        absoluteExpiresAt: ms(row.absolute_expires_at),
      };
    } catch {
      // Blob ilegible (clave retirada o manipulación): la sesión no es utilizable.
      return null;
    }
  }
}
