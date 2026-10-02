// Levanta UNA vez por corrida las dependencias reales (postgres:18 + SeaweedFS) y comparte sus coordenadas.
import { randomBytes } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { POSTGRES_IMAGE, SEAWEEDFS_IMAGE } from './images.js';

export interface Dependencies {
  readonly databaseUrl: string;
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
  const client = new S3Client({
    endpoint: s3Endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  // El servidor S3 de `weed mini` puede tardar unos segundos más que /healthz.
  for (let attempt = 1; ; attempt++) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  client.destroy();

  project.provide('deps', {
    databaseUrl: pg.getConnectionUri(),
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
