import { S3Client } from '@aws-sdk/client-s3';

export interface ObjectStorageClientConfig {
  readonly OBJECT_STORAGE_ENDPOINT: string;
  readonly OBJECT_STORAGE_REGION: string;
  readonly OBJECT_STORAGE_ACCESS_KEY: string;
  readonly OBJECT_STORAGE_SECRET_KEY: string;
  readonly OBJECT_STORAGE_FORCE_PATH_STYLE: boolean;
}

/**
 * Cliente S3 interno (ADR-0009, SPIKE-07): path-style y checksums `WHEN_REQUIRED` (SeaweedFS/RustFS no
 * aceptan los checksums por defecto del SDK v3). El adapter `ObjectStorage` completo llega con Documents.
 */
export function createObjectStorageClient(config: ObjectStorageClientConfig): S3Client {
  return new S3Client({
    endpoint: config.OBJECT_STORAGE_ENDPOINT,
    region: config.OBJECT_STORAGE_REGION,
    forcePathStyle: config.OBJECT_STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: config.OBJECT_STORAGE_SECRET_KEY,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
  });
}
