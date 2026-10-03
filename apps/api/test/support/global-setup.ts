// Levanta UNA vez por corrida las dependencias reales (postgres:18 + SeaweedFS) y comparte sus coordenadas.
import { randomBytes } from 'node:crypto';
import { loadConfig } from '@pf/platform/config';
import { createLogger } from '@pf/platform/logging';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { runMigrate } from '../../src/migrate/run-migrate.js';
import { POSTGRES_IMAGE, SEAWEEDFS_IMAGE } from './images.js';

/** Mismo bootstrap que el init de postgres en Compose (deploy/compose/compose.yaml → configs.postgres-init). */
async function bootstrapMigratorRole(superuserUrl: string, password: string): Promise<void> {
  const client = new Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query(
      `CREATE ROLE pf_migrator LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD ${client.escapeLiteral(password)}`,
    );
    await client.query('ALTER DATABASE pfos OWNER TO pf_migrator');
  } finally {
    await client.end();
  }
}

function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  u.searchParams.set('sslmode', 'disable');
  return u.toString();
}

export interface Dependencies {
  /** Rol de la app (`pf_app`, sin BYPASSRLS ni DDL), igual que en Compose y cloud. */
  readonly databaseUrl: string;
  /** Rol del BFF (`pf_bff`, grants solo sobre `iam.bff_session`), igual que en Compose. */
  readonly bffDatabaseUrl: string;
  /** Rol del worker (`pf_worker`: relay del outbox, inbox, dead-letter), igual que en Compose. */
  readonly workerDatabaseUrl: string;
  /** Rol propietario de migraciones (`pf_migrator`). */
  readonly migratorUrl: string;
  readonly postgresHost: string;
  readonly postgresPort: number;
  readonly s3Endpoint: string;
  readonly s3Host: string;
  readonly s3Port: number;
  readonly s3AccessKey: string;
  readonly s3SecretKey: string;
  readonly bucket: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    deps: Dependencies;
  }
}

export default async function setup(project: TestProject) {
  // Credenciales efímeras generadas por corrida (nunca valores fijos en el repo).
  const s3AccessKey = `pftest${randomBytes(6).toString('hex')}`;
  const s3SecretKey = randomBytes(24).toString('hex');
  const bucket = 'pfos-test-documents';

  const [pg, s3]: [StartedPostgreSqlContainer, StartedTestContainer] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('pfos').start(),
    new GenericContainer(SEAWEEDFS_IMAGE)
      .withCommand([
        'mini',
        '-dir=/data',
        '-s3.port=8333',
        '-s3.config=/etc/seaweedfs/s3.json',
        '-webdav=false',
        '-admin.ui=false',
        '-s3.port.iceberg=0',
        '-s3.port.lance=0',
      ])
      .withEnvironment({ GOMEMLIMIT: '200MiB' })
      .withCopyContentToContainer([
        {
          target: '/etc/seaweedfs/s3.json',
          content: JSON.stringify({
            identities: [
              {
                name: 'pfos-test',
                credentials: [{ accessKey: s3AccessKey, secretKey: s3SecretKey }],
                actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
              },
            ],
          }),
        },
      ])
      .withExposedPorts(8333)
      .withWaitStrategy(Wait.forHttp('/healthz', 8333).forStatusCode(200))
      .withStartupTimeout(120_000)
      .start(),
  ]);

  const s3Endpoint = `http://${s3.getHost()}:${s3.getMappedPort(8333)}`;
  const migratorUrl = withCredentials(pg.getConnectionUri(), 'pf_migrator', randomBytes(18).toString('hex'));
  const databaseUrl = withCredentials(pg.getConnectionUri(), 'pf_app', randomBytes(18).toString('hex'));
  const bffDatabaseUrl = withCredentials(pg.getConnectionUri(), 'pf_bff', randomBytes(18).toString('hex'));
  const workerDatabaseUrl = withCredentials(
    pg.getConnectionUri(),
    'pf_worker',
    randomBytes(18).toString('hex'),
  );
  await bootstrapMigratorRole(pg.getConnectionUri(), new URL(migratorUrl).password);
  // El comando `migrate` real: dbmate (binario del host) + rol pf_app + pg-boss + bucket.
  await runMigrate(
    loadConfig('migrate', {
      PFOS_ENV: 'ci',
      LOG_LEVEL: 'warn',
      DATABASE_MIGRATOR_URL: migratorUrl,
      DATABASE_URL: databaseUrl,
      BFF_DATABASE_URL: bffDatabaseUrl,
      WORKER_DATABASE_URL: workerDatabaseUrl,
      OBJECT_STORAGE_ENDPOINT: s3Endpoint,
      OBJECT_STORAGE_BUCKET: bucket,
      OBJECT_STORAGE_ACCESS_KEY: s3AccessKey,
      OBJECT_STORAGE_SECRET_KEY: s3SecretKey,
      OBJECT_STORAGE_ENSURE_BUCKET: 'true',
    }),
    createLogger({ service: 'finance-api', role: 'migrate', environment: 'ci', level: 'warn' }),
  );

  project.provide('deps', {
    databaseUrl,
    bffDatabaseUrl,
    workerDatabaseUrl,
    migratorUrl,
    postgresHost: pg.getHost(),
    postgresPort: pg.getPort(),
    s3Endpoint,
    s3Host: s3.getHost(),
    s3Port: s3.getMappedPort(8333),
    s3AccessKey,
    s3SecretKey,
    bucket,
  });

  return async () => {
    await Promise.all([pg.stop(), s3.stop()]);
  };
}
