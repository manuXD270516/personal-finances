// Levanta UNA vez por corrida las dependencias reales (postgres:18 + SeaweedFS) y comparte sus coordenadas.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '@pf/platform/config';
import { createLogger } from '@pf/platform/logging';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { runMigrate } from '../../src/migrate/run-migrate.js';
import { renderExperimentBlock } from '../perf/experiment-block.js';
import {
  BLOCK_FILE,
  EXTRAS_FILE,
  experiment,
  experimentActive,
  experimentOutDir,
  METRICS_FILE,
  readNdjson,
  resetExperimentFiles,
  SAMPLES_FILE,
  writeText,
  type MetricRecord,
  type SampleRecord,
} from '../perf/experiment.js';
import type { BackgroundLoadEntry } from '../perf/perf-report.js';
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
  /** Superusuario del contenedor (ignora RLS): solo para medir el overhead de RLS en los benchmarks nightly. */
  readonly superuserUrl: string;
  readonly postgresHost: string;
  readonly postgresPort: number;
  readonly s3Endpoint: string;
  readonly s3Host: string;
  readonly s3Port: number;
  readonly s3AccessKey: string;
  readonly s3SecretKey: string;
  readonly bucket: string;
  /** Bucket de los exports del workspace (add-workspace-export). */
  readonly exportsBucket: string;
  /** Llavero de claves maestras de PRUEBA (generado por corrida, nunca en el repo): `k1:<base64url 32 bytes>`. */
  readonly exportKeys: string;
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
  const exportsBucket = 'pfos-test-exports';
  const exportKeys = `k1:${randomBytes(32).toString('base64url')}`;

  // Rama de experimentos de investigate-perf-under-load (no se fusiona): con PF_PERF_LABEL, PostgreSQL arranca con
  // pg_stat_statements precargado (y tiempos de E/S en EXPLAIN); `PF_PERF_MAX_CONNECTIONS` cambia max_connections.
  if (experimentActive) resetExperimentFiles();
  const postgres = new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('pfos');
  if (experimentActive) {
    const maxConnections = (process.env['PF_PERF_MAX_CONNECTIONS'] ?? '').trim();
    postgres.withCommand([
      'postgres',
      '-c',
      'shared_preload_libraries=pg_stat_statements',
      '-c',
      'pg_stat_statements.track=all',
      '-c',
      'pg_stat_statements.max=10000',
      '-c',
      'track_io_timing=on',
      ...(maxConnections !== '' ? ['-c', `max_connections=${maxConnections}`] : []),
    ]);
  }
  const [pg, s3]: [StartedPostgreSqlContainer, StartedTestContainer] = await Promise.all([
    postgres.start(),
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
  if (experimentActive) {
    const admin = new Client({ connectionString: pg.getConnectionUri() });
    await admin.connect();
    try {
      await admin.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    } finally {
      await admin.end();
    }
  }
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
      OBJECT_STORAGE_EXPORTS_BUCKET: exportsBucket,
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
    superuserUrl: withCredentials(pg.getConnectionUri(), pg.getUsername(), pg.getPassword()),
    postgresHost: pg.getHost(),
    postgresPort: pg.getPort(),
    s3Endpoint,
    s3Host: s3.getHost(),
    s3Port: s3.getMappedPort(8333),
    s3AccessKey,
    s3SecretKey,
    bucket,
    exportsBucket,
    exportKeys,
  });

  return async () => {
    if (experimentActive) {
      // Bloque que se recoge del log del job (`PERF-EXPERIMENT <label>`); también queda en el directorio del reporte.
      try {
        const out = experimentOutDir();
        const extrasPath = join(out, EXTRAS_FILE);
        const extras = existsSync(extrasPath) ? readFileSync(extrasPath, 'utf8') : '';
        const block = renderExperimentBlock({
          config: experiment,
          ...(process.env['GITHUB_RUN_ID']
            ? {
                runUrl: `${process.env['GITHUB_SERVER_URL'] ?? 'https://github.com'}/${process.env['GITHUB_REPOSITORY'] ?? ''}/actions/runs/${process.env['GITHUB_RUN_ID']}`,
              }
            : {}),
          metrics: readNdjson<MetricRecord>(join(out, METRICS_FILE)),
          load: readNdjson<BackgroundLoadEntry>(join(out, 'background-load.ndjson')),
          samples: readNdjson<SampleRecord>(join(out, SAMPLES_FILE)),
          extras,
        });
        writeText(BLOCK_FILE, block);
        process.stdout.write(`\n${block}\n`);
      } catch (err) {
        process.stderr.write(`[experiment] no se pudo escribir el bloque PERF-EXPERIMENT: ${String(err)}\n`);
      }
    }
    await Promise.all([pg.stop(), s3.stop()]);
  };
}
