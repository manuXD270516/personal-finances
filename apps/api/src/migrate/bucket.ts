import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketVersioningCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { Logger } from '@pf/platform/logging';

export interface EnsureBucketOptions {
  readonly bucket: string;
  readonly corsOrigins: readonly string[];
  readonly logger: Logger;
  readonly attempts?: number;
  readonly delayMs?: number;
}

function httpStatus(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

/**
 * Solo local/CI (`OBJECT_STORAGE_ENSURE_BUCKET=true`): crea el bucket si falta y aplica (idempotente) la regla
 * CORS para la subida directa con URL presignada y el versioning (paridad con S3, SPIKE-07). Reintenta porque
 * el S3 de `weed mini` puede tardar unos segundos más que su `/healthz`.
 */
export async function ensureBucket(s3: S3Client, options: EnsureBucketOptions): Promise<void> {
  const attempts = options.attempts ?? 30;
  for (let attempt = 1; ; attempt++) {
    try {
      let created = false;
      try {
        await s3.send(new HeadBucketCommand({ Bucket: options.bucket }));
      } catch (err) {
        if (httpStatus(err) !== 404) throw err;
        await s3.send(new CreateBucketCommand({ Bucket: options.bucket }));
        created = true;
      }
      if (options.corsOrigins.length > 0) {
        await s3.send(
          new PutBucketCorsCommand({
            Bucket: options.bucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: [...options.corsOrigins],
                  AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
                  AllowedHeaders: ['*'],
                  ExposeHeaders: ['ETag', 'x-amz-version-id', 'x-amz-checksum-sha256'],
                  MaxAgeSeconds: 600,
                },
              ],
            },
          }),
        );
      }
      await s3.send(
        new PutBucketVersioningCommand({
          Bucket: options.bucket,
          VersioningConfiguration: { Status: 'Enabled' },
        }),
      );
      options.logger.info(
        { bucket: options.bucket, created, cors_origins: options.corsOrigins.length },
        'object storage bucket ready',
      );
      return;
    } catch (err) {
      const status = httpStatus(err);
      // Errores de autorización/configuración no se arreglan reintentando indefinidamente.
      if ((status === 400 || status === 403) && attempt > 3) throw err;
      if (attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, options.delayMs ?? 1000));
    }
  }
}
