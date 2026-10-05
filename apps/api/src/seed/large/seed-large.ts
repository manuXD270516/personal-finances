import { writeFileSync } from 'node:fs';
import type { SeedConfig } from '@pf/platform/config';
import type { Logger } from '@pf/platform/logging';
import { systemClock } from '@pf/shared-kernel';
import { Pool, type Client } from 'pg';
import { seedWorkspaceProvisioning } from '../../identity/workspace-provisioning.js';
import { SeedRejectedError } from '../seed-errors.js';
import { loadLargeWorkspace, type LargeWorkspaceReport } from './large-loader.js';
import {
  anomaliesJsonl,
  buildLargePlan,
  LARGE_MANIFEST,
  largeSatelliteSubject,
  type LargePlanOptions,
  type LargeWorkspacePlan,
} from './large-plan.js';

export interface LargeSeedOptions extends LargePlanOptions {
  readonly concurrency?: number;
  readonly labelsOut?: string;
}

/**
 * Perfil `large` de `pnpm db:seed` (docs/29 §2.3/§4): crea el workspace principal (owner = owner de la Minimal Seed,
 * para poder abrirlo en la UI local) y 20 satélites (usuarios técnicos sin login), los provisiona con el mismo gancho
 * que `CreateWorkspace` y ejecuta el plan determinista por los casos de uso públicos, varios workspaces en paralelo.
 * Idempotente por `platform.seed_run`; una carga parcial previa (workspaces sin registro) se rechaza: `pnpm stack:reset`.
 */
export async function seedLarge(
  client: Client,
  config: SeedConfig,
  logger: Logger,
  mainOwnerId: string,
  options: LargeSeedOptions = {},
): Promise<readonly LargeWorkspaceReport[]> {
  const applied = await client.query(`SELECT 1 FROM platform.seed_run WHERE profile = 'large'`);
  if ((applied.rowCount ?? 0) > 0) {
    logger.info('el perfil large ya está aplicado: sin cambios');
    return [];
  }
  const started = process.hrtime.bigint();
  const plan = buildLargePlan(options);
  const issuer = config.OIDC_ISSUER_URL!.replace(/\/+$/, '');
  const owners = new Map<string, string>();
  for (const ws of plan.workspaces) {
    if (ws.owner === 'main') {
      owners.set(ws.workspaceId, mainOwnerId);
      continue;
    }
    const n = ws.owner.slice('satellite-'.length);
    const { rows } = await client.query<{ id: string }>('SELECT iam.provision_user($1, $2, $3, $4) AS id', [
      issuer,
      largeSatelliteSubject(Number(n)),
      `large-sat-${n}@demo.pfos.test`,
      `Large Satélite ${n}`,
    ]);
    owners.set(ws.workspaceId, rows[0]!.id);
  }
  for (const ws of plan.workspaces) await createWorkspace(client, config, ws, owners.get(ws.workspaceId)!);

  const concurrency = options.concurrency ?? 4;
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    application_name: 'pfos-seed',
    max: concurrency + 2,
  });
  try {
    const hook = seedWorkspaceProvisioning(pool, systemClock);
    for (const ws of plan.workspaces) {
      await hook.onWorkspaceCreated({
        workspaceId: ws.workspaceId,
        userId: owners.get(ws.workspaceId)!,
        seedDefaultCategories: true,
      });
    }
    // El principal (camino crítico) entra primero; los satélites ocupan las demás líneas.
    const queue = [...plan.workspaces];
    const reports: LargeWorkspaceReport[] = [];
    const lane = async () => {
      for (let ws = queue.shift(); ws; ws = queue.shift()) {
        reports.push(await loadLargeWorkspace(ws, owners.get(ws.workspaceId)!, { pool, logger, config }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, plan.workspaces.length) }, lane));
    if (options.labelsOut) {
      const ids = new Map(reports.flatMap((r) => [...r.transactionIds]));
      writeFileSync(options.labelsOut, `${anomaliesJsonl(plan, ids)}\n`, 'utf8');
    }
    logger.info(
      {
        'seed.profile': 'large',
        'seed.dataset_version': LARGE_MANIFEST.datasetVersion,
        'seed.scale': plan.scale,
        'seed.workspaces': reports.length,
        'seed.transactions': reports.reduce((n, r) => n + r.transactions, 0),
        'seed.duration_ms': Number((process.hrtime.bigint() - started) / 1_000_000n),
      },
      'large seed loaded',
    );
    return reports;
  } finally {
    await pool.end();
  }
}

async function createWorkspace(
  client: Client,
  config: SeedConfig,
  ws: LargeWorkspacePlan,
  ownerId: string,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
      [ownerId, ws.workspaceId],
    );
    const exists = await client.query('SELECT 1 FROM iam.workspace WHERE id = $1', [ws.workspaceId]);
    if ((exists.rowCount ?? 0) > 0) {
      throw new SeedRejectedError(
        `el workspace ${ws.workspaceId} ya existe sin registro del perfil large (carga parcial): pnpm stack:reset`,
      );
    }
    await client.query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, $2, $3, $4, $5)`,
      [ws.workspaceId, ws.name, 'BOB', LARGE_MANIFEST.timezone, config.APP_DEFAULT_LOCALE],
    );
    await client.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'OWNER', 'ACTIVE')`,
      [ws.workspaceId, ownerId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}
