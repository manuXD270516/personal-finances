import type { SeedConfig } from '@pf/platform/config';
import type { Logger } from '@pf/platform/logging';
import { systemClock } from '@pf/shared-kernel';
import { Client, Pool } from 'pg';
import { seedWorkspaceProvisioning } from '../identity/workspace-provisioning.js';

export const SEED_PROFILES = ['minimal', 'demo', 'large'] as const;
export type SeedProfile = (typeof SEED_PROFILES)[number];

/**
 * Datasets disponibles (docs/29). La Minimal Seed registra su ejecución en `platform.seed_run` y, desde la versión
 * 2, siembra las identidades de IDENTITY (usuarios del realm de desarrollo, W1/W2 y sus membresías); desde la 3,
 * provisiona W1/W2 por el MISMO gancho que `CreateWorkspace` (categorías de sistema + catálogo sugerido es-BO y
 * monedas por defecto). Cada contexto añadirá sus datos. `demo`/`large` llegan con los datasets de docs/29.
 */
export const SEED_DATASETS: Partial<Record<SeedProfile, { readonly datasetVersion: number }>> = {
  minimal: { datasetVersion: 3 },
};

/**
 * Identidades de la Minimal Seed (docs/29 §2.1). `subject` = id fijo del usuario en el realm de desarrollo de
 * Keycloak (deploy/compose/keycloak/realm-pfos-dev.json): al iniciar sesión, la provisión JIT encuentra al usuario
 * ya sembrado y no crea un workspace personal (TC-IDENTITY-WORKSPACE-001, caso viewer).
 */
export const MINIMAL_USERS = [
  { key: 'owner', subject: '0199a000-0000-7000-8000-00000000c001', name: 'Owner Demo' },
  { key: 'editor', subject: '0199a000-0000-7000-8000-00000000c002', name: 'Editor Demo' },
  { key: 'viewer', subject: '0199a000-0000-7000-8000-00000000c003', name: 'Viewer Demo' },
  { key: 'outsider', subject: '0199a000-0000-7000-8000-00000000c004', name: 'Outsider Demo' },
] as const;
type SeedUser = (typeof MINIMAL_USERS)[number]['key'];

export const MINIMAL_WORKSPACES: readonly {
  readonly id: string;
  readonly name: string;
  readonly members: readonly { readonly user: SeedUser; readonly role: 'OWNER' | 'EDITOR' | 'VIEWER' }[];
}[] = [
  {
    id: '0199a000-0000-7000-8000-00000000a001',
    name: 'W1 Personal Demo',
    members: [
      { user: 'owner', role: 'OWNER' },
      { user: 'editor', role: 'EDITOR' },
      { user: 'viewer', role: 'VIEWER' },
    ],
  },
  {
    id: '0199a000-0000-7000-8000-00000000a002',
    name: 'W2 Other Demo',
    members: [
      { user: 'owner', role: 'OWNER' },
      { user: 'outsider', role: 'OWNER' },
    ],
  },
];

/**
 * Usuarios + W1/W2 + membresías, idempotente, con el rol de la app bajo RLS: cada
 * workspace en su propia transacción con `app.user_id`/`app.workspace_id` LOCAL (como la UnitOfWork).
 */
async function seedIdentity(client: Client, config: SeedConfig): Promise<Map<SeedUser, string>> {
  const issuer = config.OIDC_ISSUER_URL!.replace(/\/+$/, '');
  const ids = new Map<SeedUser, string>();
  for (const u of MINIMAL_USERS) {
    const { rows } = await client.query<{ id: string }>('SELECT iam.provision_user($1, $2, $3, $4) AS id', [
      issuer,
      u.subject,
      `${u.key}@demo.pfos.test`,
      u.name,
    ]);
    ids.set(u.key, rows[0]!.id);
  }
  for (const ws of MINIMAL_WORKSPACES) {
    const owner = ids.get(ws.members.find((m) => m.role === 'OWNER')!.user)!;
    await client.query('BEGIN');
    try {
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
        [owner, ws.id],
      );
      // Sin `ON CONFLICT`: con RLS, el upsert exige además la política SELECT (membresía), que aún no existe en la
      // primera ejecución. En las siguientes el owner ya es miembro y ve el workspace.
      const exists = await client.query('SELECT 1 FROM iam.workspace WHERE id = $1', [ws.id]);
      if (exists.rowCount === 0) {
        await client.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, $2, $3, $4, $5)`,
          [ws.id, ws.name, config.APP_REPORTING_CURRENCY, config.APP_TIMEZONE, config.APP_DEFAULT_LOCALE],
        );
      }
      for (const m of ws.members) {
        await client.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status)
           VALUES ($1, $2, $3, 'ACTIVE') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
          [ws.id, ids.get(m.user), m.role],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }
  return ids;
}

/**
 * Provisión de W1/W2 por el gancho de `CreateWorkspace` (idempotente: las categorías de sistema y del catálogo ya
 * presentes y las monedas ya habilitadas se omiten). Sin ella, registrar un gasto sin categoría falla con
 * `REFERENCE_NOT_FOUND` (no existe `UNCATEGORIZED`).
 */
async function provisionWorkspaces(config: SeedConfig, owners: ReadonlyMap<SeedUser, string>): Promise<void> {
  const pool = new Pool({ connectionString: config.DATABASE_URL, application_name: 'pfos-seed', max: 2 });
  try {
    const hook = seedWorkspaceProvisioning(pool, systemClock);
    for (const ws of MINIMAL_WORKSPACES) {
      const owner = owners.get(ws.members.find((m) => m.role === 'OWNER')!.user)!;
      await hook.onWorkspaceCreated({ workspaceId: ws.id, userId: owner, seedDefaultCategories: true });
    }
  } finally {
    await pool.end();
  }
}

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
    if (profile === 'minimal' && config.OIDC_ISSUER_URL) {
      await provisionWorkspaces(config, await seedIdentity(client, config));
    } else if (profile === 'minimal')
      logger.warn('OIDC_ISSUER_URL ausente: la Minimal Seed no siembra identidades');
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
