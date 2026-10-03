import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { Client } from 'pg';

/** Rol de runtime de api/worker/seed (sin BYPASSRLS ni DDL). Lo crea la migración de bootstrap. */
export const APP_ROLE = 'pf_app';

const SCRAM_ITERATIONS = 4096;

/**
 * Verificador SCRAM-SHA-256 (RFC 5802/7677, formato de `pg_authid.rolpassword`). Enviar el verificador en vez
 * de la contraseña evita que el texto plano llegue al servidor (logs de sentencias, pg_stat_statements).
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, SCRAM_ITERATIONS, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** Credenciales del rol de la app a partir de su URL de conexión (DATABASE_URL). */
export function appRoleCredentials(databaseUrl: string): { user: string; password: string } {
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== APP_ROLE) {
    throw new Error(`DATABASE_URL debe usar el rol ${APP_ROLE} (rol sin BYPASSRLS ni DDL)`);
  }
  if (password.length < 12) {
    throw new Error('DATABASE_URL: la contraseña del rol de la app es demasiado corta (mínimo 12)');
  }
  return { user, password };
}

/**
 * Alinea la contraseña de `pf_app` con DATABASE_URL (en cloud ambas vienen del secrets manager). Lo ejecuta
 * `pf_migrator`, que tiene ADMIN OPTION sobre `pf_app` por haberlo creado (PostgreSQL ≥ 16).
 */
export async function ensureAppRolePassword(migrator: Client, databaseUrl: string): Promise<void> {
  const { password } = appRoleCredentials(databaseUrl);
  const verifier = scramSha256Verifier(password);
  await migrator.query(`ALTER ROLE ${APP_ROLE} PASSWORD ${migrator.escapeLiteral(verifier)}`);
}

/** Rol del BFF (`finance-web`): grants solo sobre `iam.bff_session`. Lo crea la migración de roles (sin contraseña). */
export const BFF_ROLE = 'pf_bff';

/**
 * Alinea la contraseña de `pf_bff` con BFF_DATABASE_URL (credencial separada del BFF, design §6). Mismo
 * mecanismo que `pf_app`: `pf_migrator` creó el rol y tiene ADMIN OPTION; se envía el verificador SCRAM.
 */
export async function ensureBffRolePassword(migrator: Client, bffDatabaseUrl: string): Promise<void> {
  const url = new URL(bffDatabaseUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== BFF_ROLE) throw new Error(`BFF_DATABASE_URL debe usar el rol ${BFF_ROLE}`);
  if (password.length < 12) {
    throw new Error('BFF_DATABASE_URL: la contraseña del rol del BFF es demasiado corta (mínimo 12)');
  }
  await migrator.query(
    `ALTER ROLE ${BFF_ROLE} PASSWORD ${migrator.escapeLiteral(scramSha256Verifier(password))}`,
  );
}

/** Rol del worker (relay del outbox, consumidores): miembro de `pf_app`, sin BYPASSRLS ni DDL. */
export const WORKER_ROLE = 'pf_worker';

/**
 * Alinea la contraseña de `pf_worker` con WORKER_DATABASE_URL (openspec add-event-outbox, design §4). Mismo
 * mecanismo que `pf_app`/`pf_bff`: `pf_migrator` creó el rol y envía el verificador SCRAM, nunca el texto plano.
 */
export async function ensureWorkerRolePassword(migrator: Client, workerDatabaseUrl: string): Promise<void> {
  const url = new URL(workerDatabaseUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== WORKER_ROLE) throw new Error(`WORKER_DATABASE_URL debe usar el rol ${WORKER_ROLE}`);
  if (password.length < 12) {
    throw new Error('WORKER_DATABASE_URL: la contraseña del rol del worker es demasiado corta (mínimo 12)');
  }
  await migrator.query(
    `ALTER ROLE ${WORKER_ROLE} PASSWORD ${migrator.escapeLiteral(scramSha256Verifier(password))}`,
  );
}
