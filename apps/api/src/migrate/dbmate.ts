import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@pf/platform/logging';
import { resolveBinary } from 'dbmate';

/** Migraciones SQL-first versionadas junto al código (en la imagen finance-api: `/app/db/migrations`). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

export interface DbmateOptions {
  readonly databaseUrl: string;
  readonly logger: Logger;
  readonly migrationsDir?: string;
  /** Espera a que la base acepte conexiones antes de migrar. */
  readonly waitTimeout?: string;
}

/**
 * Ejecuta `dbmate up` (binario del paquete npm `dbmate`: el mismo mecanismo en el host Windows y en la imagen
 * Linux). La URL viaja por el entorno del proceso hijo, nunca por argumentos visibles en `ps`. dbmate corre
 * cada migración en su propia transacción: un fallo no deja el schema a medias.
 */
export function runDbmateUp(options: DbmateOptions): Promise<void> {
  const args = [
    '--migrations-dir',
    options.migrationsDir ?? MIGRATIONS_DIR,
    '--no-dump-schema',
    '--wait',
    '--wait-timeout',
    options.waitTimeout ?? '60s',
    'up',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBinary(), args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      // El hijo hereda el entorno del sistema (PATH, SystemRoot en Windows); la config de la app ya se validó.
      // eslint-disable-next-line no-restricted-properties
      env: { ...process.env, DATABASE_URL: options.databaseUrl },
    });
    const forward = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line.trim() === '') continue;
        if (stream === 'stderr') options.logger.error({ tool: 'dbmate' }, line);
        else options.logger.info({ tool: 'dbmate' }, line);
      }
    };
    child.stdout.on('data', forward('stdout'));
    child.stderr.on('data', forward('stderr'));
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`dbmate up failed (code ${code ?? 'null'}, signal ${signal ?? 'none'})`));
    });
  });
}
