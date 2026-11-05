import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';
import type {
  ConnectionRepository,
  CredentialSummary,
  StoredCredential,
} from '../application/banking/ports.js';
import type { SealedCredential } from '../application/banking/credential-vault.js';
import { Connection, type ConnectionState } from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();
const ISO = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

interface ConnectionRow {
  id: string;
  workspace_id: string;
  provider_id: string;
  name: string;
  status: ConnectionState['status'];
  asset_mappings: ConnectionState['assetMappings'];
  sync_cursor: string | null;
  cursor_confirmed_at: string | null;
  pending_sync: ConnectionState['pendingSync'];
  retry_not_before: string | null;
  last_error_code: string | null;
  last_sync_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  revoked_at: string | null;
}

const COLUMNS = sql`
  c.id, c.workspace_id, c.provider_id, c.name, c.status, c.asset_mappings, c.sync_cursor,
  ${ISO('c.cursor_confirmed_at')} AS cursor_confirmed_at, c.pending_sync,
  ${ISO('c.retry_not_before')} AS retry_not_before, c.last_error_code,
  ${ISO('c.last_sync_at')} AS last_sync_at, c.version,
  ${ISO('c.created_at')} AS created_at, ${ISO('c.updated_at')} AS updated_at, c.created_by,
  ${ISO('c.revoked_at')} AS revoked_at`;

const toConnection = (r: ConnectionRow): Connection =>
  Connection.rehydrate({
    id: r.id,
    workspaceId: r.workspace_id,
    providerId: r.provider_id,
    name: r.name,
    status: r.status,
    assetMappings: r.asset_mappings,
    syncCursor: r.sync_cursor,
    cursorConfirmedAt: r.cursor_confirmed_at,
    pendingSync: r.pending_sync,
    retryNotBefore: r.retry_not_before,
    lastErrorCode: r.last_error_code,
    lastSyncAt: r.last_sync_at,
    version: Number(r.version),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    revokedAt: r.revoked_at,
  });

const json = (value: unknown): string => JSON.stringify(value);
const jsonOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);
const bytes = (b: Uint8Array): Buffer => Buffer.from(b);

/**
 * Repositorio de conexiones sobre PostgreSQL (RLS forzada por workspace). Las lecturas de la API NUNCA piden
 * `wrapped_dek` ni `ciphertext` (grants por columna: `pf_app` no puede leerlos); `loadSealed` y `credentialsOf` solo
 * funcionan con el rol del worker.
 */
export class PgConnectionRepository implements ConnectionRepository {
  async insert(connection: Connection): Promise<void> {
    const s = connection.state;
    await sql`
      INSERT INTO imports.connection
        (id, workspace_id, provider_id, name, status, asset_mappings, sync_cursor, cursor_confirmed_at, pending_sync,
         retry_not_before, last_error_code, last_sync_at, version, created_at, updated_at, created_by, revoked_at)
      VALUES
        (${s.id}, ${s.workspaceId}, ${s.providerId}, ${s.name}, ${s.status}, ${json(s.assetMappings)}::jsonb,
         ${s.syncCursor}, ${s.cursorConfirmedAt}::timestamptz, ${jsonOrNull(s.pendingSync)}::jsonb,
         ${s.retryNotBefore}::timestamptz, ${s.lastErrorCode}, ${s.lastSyncAt}::timestamptz, ${s.version},
         ${s.createdAt}::timestamptz, ${s.updatedAt}::timestamptz, ${s.createdBy}, ${s.revokedAt}::timestamptz)`.execute(
      db(),
    );
  }

  async findById(workspaceId: string, id: string, options?: { readonly lock?: 'update' }) {
    const { rows } = await sql<ConnectionRow>`
      SELECT ${COLUMNS} FROM imports.connection c
       WHERE c.workspace_id = ${workspaceId} AND c.id = ${id}
       ${options?.lock === 'update' ? sql`FOR UPDATE` : sql``}`.execute(db());
    return rows[0] ? toConnection(rows[0]) : null;
  }

  async save(connection: Connection): Promise<boolean> {
    const s = connection.state;
    const result = await sql`
      UPDATE imports.connection SET
        name = ${s.name}, status = ${s.status}, asset_mappings = ${json(s.assetMappings)}::jsonb,
        sync_cursor = ${s.syncCursor}, cursor_confirmed_at = ${s.cursorConfirmedAt}::timestamptz,
        pending_sync = ${jsonOrNull(s.pendingSync)}::jsonb, retry_not_before = ${s.retryNotBefore}::timestamptz,
        last_error_code = ${s.lastErrorCode}, last_sync_at = ${s.lastSyncAt}::timestamptz,
        updated_at = ${s.updatedAt}::timestamptz, version = ${s.version}, revoked_at = ${s.revokedAt}::timestamptz
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id} AND version = ${connection.persistedVersion}`.execute(
      db(),
    );
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async list(workspaceId: string): Promise<readonly Connection[]> {
    const { rows } = await sql<ConnectionRow>`
      SELECT ${COLUMNS} FROM imports.connection c
       WHERE c.workspace_id = ${workspaceId}
       ORDER BY c.created_at DESC, c.id DESC`.execute(db());
    return rows.map(toConnection);
  }

  async nameTaken(workspaceId: string, name: string, exceptId?: string): Promise<boolean> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*) AS n FROM imports.connection c
       WHERE c.workspace_id = ${workspaceId} AND lower(c.name) = lower(${name}) AND c.status <> 'REVOKED'
         AND (${exceptId ?? null}::uuid IS NULL OR c.id <> ${exceptId ?? null}::uuid)`.execute(db());
    return Number(rows[0]?.n ?? 0) > 0;
  }

  // ───────────────────────────────────────────────────────────── credencial

  async insertCredential(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly credentialVersion: number;
    readonly sealed: SealedCredential;
    readonly fingerprint: string;
  }): Promise<void> {
    const c = input.sealed;
    await sql`
      INSERT INTO imports.connection_credential
        (workspace_id, connection_id, credential_version, kid, ephemeral_public_key, wrapped_dek, dek_nonce,
         ciphertext, nonce, key_fingerprint)
      VALUES
        (${input.workspaceId}, ${input.connectionId}, ${input.credentialVersion}, ${c.kid},
         ${bytes(c.ephemeralPublicKey)}, ${bytes(c.wrappedDek)}, ${bytes(c.dekNonce)}, ${bytes(c.ciphertext)},
         ${bytes(c.nonce)}, ${input.fingerprint})`.execute(db());
  }

  async replaceCredential(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly credentialVersion: number;
    readonly sealed: SealedCredential;
    readonly fingerprint: string;
  }): Promise<void> {
    const c = input.sealed;
    await sql`
      UPDATE imports.connection_credential SET
        credential_version = ${input.credentialVersion}, kid = ${c.kid}, ephemeral_public_key = ${bytes(c.ephemeralPublicKey)},
        wrapped_dek = ${bytes(c.wrappedDek)}, dek_nonce = ${bytes(c.dekNonce)}, ciphertext = ${bytes(c.ciphertext)},
        nonce = ${bytes(c.nonce)}, key_fingerprint = ${input.fingerprint}, permissions = NULL, verified_at = NULL,
        destroyed_at = NULL
       WHERE workspace_id = ${input.workspaceId} AND connection_id = ${input.connectionId}`.execute(db());
  }

  async credentialSummary(workspaceId: string, connectionId: string): Promise<CredentialSummary | null> {
    const { rows } = await sql<{
      key_fingerprint: string;
      kid: string;
      credential_version: number;
      verified_at: string | null;
      permissions: CredentialSummary['permissions'];
      destroyed_at: string | null;
    }>`
      SELECT key_fingerprint, kid, credential_version, ${ISO('verified_at')} AS verified_at, permissions,
             destroyed_at::text AS destroyed_at
        FROM imports.connection_credential
       WHERE workspace_id = ${workspaceId} AND connection_id = ${connectionId}`.execute(db());
    const r = rows[0];
    return r
      ? {
          fingerprint: r.key_fingerprint,
          kid: r.kid,
          credentialVersion: Number(r.credential_version),
          verifiedAt: r.verified_at,
          permissions: r.permissions,
          destroyed: r.destroyed_at !== null,
        }
      : null;
  }

  async loadSealed(workspaceId: string, connectionId: string): Promise<StoredCredential | null> {
    const { rows } = await sql<{
      credential_version: number;
      kid: string;
      ephemeral_public_key: Buffer;
      wrapped_dek: Buffer | null;
      dek_nonce: Buffer;
      ciphertext: Buffer | null;
      nonce: Buffer;
    }>`
      SELECT credential_version, kid, ephemeral_public_key, wrapped_dek, dek_nonce, ciphertext, nonce
        FROM imports.connection_credential
       WHERE workspace_id = ${workspaceId} AND connection_id = ${connectionId}`.execute(db());
    const r = rows[0];
    if (!r || r.wrapped_dek === null || r.ciphertext === null) return null;
    return {
      credentialVersion: Number(r.credential_version),
      kid: r.kid,
      ephemeralPublicKey: new Uint8Array(r.ephemeral_public_key),
      wrappedDek: new Uint8Array(r.wrapped_dek),
      dekNonce: new Uint8Array(r.dek_nonce),
      ciphertext: new Uint8Array(r.ciphertext),
      nonce: new Uint8Array(r.nonce),
    };
  }

  async setVerification(
    workspaceId: string,
    connectionId: string,
    input: {
      readonly permissions: NonNullable<CredentialSummary['permissions']>;
      readonly verifiedAt: string;
    },
  ): Promise<void> {
    await sql`
      UPDATE imports.connection_credential
         SET permissions = ${json(input.permissions)}::jsonb, verified_at = ${input.verifiedAt}::timestamptz
       WHERE workspace_id = ${workspaceId} AND connection_id = ${connectionId}`.execute(db());
  }

  async destroyCredential(workspaceId: string, connectionId: string, at: string): Promise<void> {
    await sql`
      UPDATE imports.connection_credential
         SET wrapped_dek = NULL, ciphertext = NULL, destroyed_at = ${at}::timestamptz
       WHERE workspace_id = ${workspaceId} AND connection_id = ${connectionId} AND destroyed_at IS NULL`.execute(
      db(),
    );
  }

  async rewrapCredential(
    workspaceId: string,
    connectionId: string,
    wrapped: {
      readonly kid: string;
      readonly ephemeralPublicKey: Uint8Array;
      readonly wrappedDek: Uint8Array;
      readonly dekNonce: Uint8Array;
    },
  ): Promise<void> {
    await sql`
      UPDATE imports.connection_credential SET
        kid = ${wrapped.kid}, ephemeral_public_key = ${bytes(wrapped.ephemeralPublicKey)},
        wrapped_dek = ${bytes(wrapped.wrappedDek)}, dek_nonce = ${bytes(wrapped.dekNonce)}
       WHERE workspace_id = ${workspaceId} AND connection_id = ${connectionId} AND destroyed_at IS NULL`.execute(
      db(),
    );
  }

  async credentialsOf(workspaceId: string) {
    const { rows } = await sql<{ connection_id: string; kid: string; credential_version: number }>`
      SELECT connection_id, kid, credential_version FROM imports.connection_credential
       WHERE workspace_id = ${workspaceId} AND destroyed_at IS NULL
       ORDER BY connection_id`.execute(db());
    return rows.map((r) => ({
      connectionId: r.connection_id,
      kid: r.kid,
      credentialVersion: Number(r.credential_version),
    }));
  }
}
