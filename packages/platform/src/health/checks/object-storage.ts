import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import type { DependencyCheck } from '../readiness.js';

/** Object storage: `HeadBucket` del bucket configurado (verifica alcance, credenciales y existencia). */
export function objectStorageCheck(client: S3Client, bucket: string): DependencyCheck {
  return {
    name: 'object-storage',
    async check(signal) {
      await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
    },
  };
}
