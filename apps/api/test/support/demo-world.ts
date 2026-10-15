import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  createDemoDataRuntime,
  identityWorkspaceTimeZones,
  type DemoLoadJob,
} from '@pf/identity/interface/identity.module';
import { FixedClock, Instant, systemClock } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { inject } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { DEMO_MANIFEST } from '../../src/demo/dataset/demo-plan.js';
import { DemoDataLoader } from '../../src/demo/demo-data-loader.js';
import { AUDIT_POLICIES, outboxPort } from '../../src/identity/identity-wiring.js';
import { seedWorkspaceProvisioning } from '../../src/identity/workspace-provisioning.js';
import { createWorkerRuntime, type WorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import { apiConfig, baseEnv, capturingLogger, workerConfig } from './harness.js';

const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

export interface DemoUser {
  readonly token: string;
  readonly id: string;
  readonly personal: string;
}

export interface DemoLoad {
  readonly user: DemoUser;
  readonly job: DemoLoadJob;
  readonly outcome: string;
  readonly durationMs: number | null;
  /** Línea de log de fallo (si la hubo). */
  readonly failure: string | null;
}

/**
 * Mundo de las pruebas de integración de la demo: API real (JWT de prueba) + worker real (relay del outbox y
 * consumidores asíncronos) sobre la misma PostgreSQL, con una carga en proceso con ancla fija como la del seed.
 */
export class DemoWorld {
  api!: ApiRuntime;
  worker!: WorkerRuntime;
  baseUrl = '';
  workerPool!: Pool;
  /** Cargas hechas por este mundo: se limpian y purgan al terminar para no dejar workspaces demo en la instalación. */
  private readonly loads: DemoLoad[] = [];
  private signingKey!: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  private readonly deps = inject('deps');

  async start(): Promise<void> {
    const pair = await generateKeyPair('RS256', { extractable: true });
    this.signingKey = pair.privateKey;
    const jwks = {
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' }],
    };
    this.api = await createApiRuntime(
      apiConfig(baseEnv(this.deps)),
      capturingLogger('finance-api', 'api').logger,
      { identity: { jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks } } },
    );
    this.baseUrl = await this.api.listen(0, '127.0.0.1');
    this.worker = await createWorkerRuntime(
      workerConfig(baseEnv(this.deps)),
      capturingLogger('finance-worker', 'worker').logger,
      { ledgerMaintenanceOnStart: false, fxGapFillOnStart: false },
    );
    this.workerPool = new Pool({ connectionString: this.deps.workerDatabaseUrl, max: 2 });
  }

  /** Limpieza inmediata y purga física (worker) de todas las cargas del mundo; la instalación queda como estaba. */
  async cleanupAll(timeoutMs = 240_000): Promise<void> {
    for (const load of this.loads.splice(0)) {
      const demoId = load.job.demoWorkspaceId;
      const origin = load.job.originWorkspaceId;
      await this.call('POST', `/api/v1/workspaces/${demoId}/demo-data/cleanup`, load.user.token);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const status = await this.call('GET', `/api/v1/workspaces/${origin}/demo-data`, load.user.token);
        if (status.status === 200 && status.body['status'] === 'PURGED') break;
        if (Date.now() > deadline) throw new Error(`la purga del demo ${demoId} no terminó`);
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    await this.api?.close();
    await this.workerPool?.end();
  }

  private async token(sub: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: ISSUER,
      aud: AUDIENCE,
      sub,
      iat: now - 5,
      exp: now + 900,
      typ: 'Bearer',
      scope: 'openid pfos.api',
      email: `${sub}@pfos.test`,
      email_verified: true,
      name: sub,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
      .sign(this.signingKey);
  }

  async call(method: string, path: string, token: string, body?: unknown) {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (method === 'POST') headers['idempotency-key'] = randomUUID();
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }

  async user(prefix: string): Promise<DemoUser> {
    const token = await this.token(`${prefix}-${randomUUID()}`);
    const me = await this.call('GET', '/api/v1/me', token);
    const memberships = me.body['memberships'] as { workspaceId: string }[];
    return { token, id: me.body['id'] as string, personal: memberships[0]!.workspaceId };
  }

  /** Carga en proceso con ancla fija (como `pnpm db:seed -- --profile=demo`, rol de la app). */
  async load(input: {
    readonly anchor: string;
    readonly user?: DemoUser;
    readonly catalogDir?: string;
    readonly failAt?: string;
  }): Promise<DemoLoad> {
    const user = input.user ?? (await this.user('demo-v2'));
    const pool = new Pool({ connectionString: this.deps.databaseUrl, max: 2 });
    try {
      const audit = createAuditRuntime({
        pool,
        clock: systemClock,
        policies: AUDIT_POLICIES,
        timeZones: identityWorkspaceTimeZones(pool),
      });
      let job: DemoLoadJob | undefined;
      const demo = createDemoDataRuntime({
        pool,
        clock: new FixedClock(Instant.parse(`${input.anchor}T16:00:00.000Z`)),
        outbox: outboxPort(),
        audit: audit.port,
        defaults: {
          baseCurrency: 'BOB',
          timeZone: 'America/La_Paz',
          locale: 'es-BO',
          personalWorkspaceName: 'P',
        },
        onWorkspaceCreated: seedWorkspaceProvisioning(pool, systemClock),
        demo: {
          settings: {
            enabled: true,
            datasetVersion: DEMO_MANIFEST.datasetVersion,
            workspaceName: DEMO_MANIFEST.workspaceName,
            modules: DEMO_MANIFEST.modules,
          },
          jobs: {
            enqueueLoad: async (j) => {
              job = j;
            },
            enqueuePurge: async () => undefined,
          },
        },
      });
      await demo.requestDemoData(user.id, user.personal);
      const logs = capturingLogger('finance-api', 'seed');
      const loader = new DemoDataLoader({
        pool,
        logger: logs.logger,
        demo,
        config: {
          APP_TIMEZONE: 'America/La_Paz',
          FX_PROVIDER_PRIMARY: 'none',
          FX_PROVIDER_FALLBACK: 'none',
          FX_PROVIDER_OFFICIAL: 'none',
          ...(input.catalogDir ? { ACCOUNTS_INSTITUTION_CATALOG_DIR: input.catalogDir } : {}),
        },
        ...(input.failAt ? { failAt: input.failAt } : {}),
      });
      const outcome = await loader.load(job!);
      const records = logs.records();
      const loaded = records.find((r) => r['msg'] === 'demo data loaded');
      const failed = records.find((r) => r['msg'] === 'demo data load failed');
      const result: DemoLoad = {
        user,
        job: job!,
        outcome,
        durationMs: loaded ? Number(loaded['demo.duration_ms']) : null,
        failure: failed ? JSON.stringify(failed['err']) : null,
      };
      this.loads.push(result);
      return result;
    } finally {
      await pool.end();
    }
  }

  /** Espera a que el relay publique todo el outbox del workspace (los consumidores corren tras la publicación). */
  async waitPublished(workspaceId: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { rows } = await this.workerPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform.outbox WHERE workspace_id = $1 AND published_at IS NULL`,
        [workspaceId],
      );
      if (rows[0]!.n === 0) return;
      if (Date.now() > deadline) throw new Error(`el outbox del workspace no se publicó: ${rows[0]!.n}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Reintenta `check` hasta que devuelve un valor definido (consumidores asíncronos del outbox). */
export async function eventually<T>(
  check: () => Promise<T | undefined>,
  options: { readonly timeoutMs?: number; readonly what?: string } = {},
): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 180_000);
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timeout esperando ${options.what ?? 'la convergencia'}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
