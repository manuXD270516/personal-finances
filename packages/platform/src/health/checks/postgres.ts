import type { Pool } from 'pg';
import type { DependencyCheck } from '../readiness.js';

/** PostgreSQL: `SELECT 1` usando el pool de la aplicación (mismo rol y red que el tráfico real). */
export function postgresCheck(pool: Pool): DependencyCheck {
  return {
    name: 'postgres',
    async check() {
      await pool.query('SELECT 1');
    },
  };
}
