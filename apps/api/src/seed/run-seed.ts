import type { SeedConfig } from '@pf/platform/config';
import type { Logger } from '@pf/platform/logging';
import { Client } from 'pg';

export const SEED_PROFILES = ['minimal', 'demo', 'large'] as const;
export type SeedProfile = (typeof SEED_PROFILES)[number];

/**
 * Datasets disponibles (docs/29). Sin bounded contexts todavía, la Minimal Seed solo registra su ejecución en
 * `platform.seed_run`; cada contexto añadirá sus datos a través de sus casos de uso. `demo`/`large` llegan con
 * los datasets de docs/29.
 */
export const SEED_DATASETS: Partial<Record<SeedProfile, { readonly datasetVersion: number }>> = {
  minimal: { datasetVersion: 1 },
};

export class SeedRejectedError extends Error {
  override readonly name = 'SeedRejectedError';
}

export function parseSeedProfile(argv: readonly string[]): SeedProfile {
  const arg = argv.find((a) => a.startsWith('--profile='));
  const value = arg ? arg.slice('--profile='.length) : 'minimal';
  if (!(SEED_PROFILES as readonly string[]).includes(value)) {
    throw new SeedRejectedError(`perfil de seed desconocido: ${value} (minimal | demo | large)`);
  }
  return value as SeedProfile;
}

/** Idempotente por `platform.seed_run`: re-ejecutar no duplica datos. Usa el rol de la app (DATABASE_URL). */
export async function runSeed(config: SeedConfig, logger: Logger, profile: SeedProfile): Promise<void> {
  // Los seeds son solo de desarrollo/CI (docs/19 §6.1, docs/29): nunca contra staging/production.
  if (config.PFOS_ENV === 'staging' || config.PFOS_ENV === 'production') {
    throw new SeedRejectedError('seed rejected outside local/ci');
  }
  const dataset = SEED_DATASETS[profile];
  if (!dataset) throw new SeedRejectedError(`el dataset "${profile}" todavía no existe (docs/29)`);

  const client = new Client({ connectionString: config.DATABASE_URL, application_name: 'pfos-seed' });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO platform.seed_run (profile, dataset_version) VALUES ($1, $2)
       ON CONFLICT (profile) DO UPDATE SET dataset_version = EXCLUDED.dataset_version, applied_at = now()`,
      [profile, dataset.datasetVersion],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
  logger.info({ profile, dataset_version: dataset.datasetVersion }, 'seed applied');
}
