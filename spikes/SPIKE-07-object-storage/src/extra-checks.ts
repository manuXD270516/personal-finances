// SPIKE-07 — chequeos extra (lifecycle para abortar multipart incompletos / expirar no-actuales). Descartable.
import { S3Client, PutBucketLifecycleConfigurationCommand, GetBucketLifecycleConfigurationCommand, PutObjectLockConfigurationCommand, PutBucketEncryptionCommand } from '@aws-sdk/client-s3';
import { BACKENDS, BUCKET } from './backends.js';
for (const b of Object.values(BACKENDS)) {
  const s3 = new S3Client({ endpoint: b.endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: b.accessKeyId, secretAccessKey: b.secretAccessKey }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  const r: string[] = [];
  try {
    await s3.send(new PutBucketLifecycleConfigurationCommand({ Bucket: 'pfos-imports', ChecksumAlgorithm: undefined, LifecycleConfiguration: { Rules: [
      { ID: 'abort-mpu', Status: 'Enabled', Filter: { Prefix: '' }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } },
      { ID: 'expire-quarantine', Status: 'Enabled', Filter: { Prefix: 'quarantine/' }, Expiration: { Days: 7 } },
    ] } }));
    const g = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: 'pfos-imports' }));
    r.push(`lifecycle=PASS(${g.Rules?.length} reglas)`);
  } catch (e: any) { r.push(`lifecycle=FAIL(${e.name})`); }
  try {
    await s3.send(new PutBucketLifecycleConfigurationCommand({ Bucket: BUCKET, LifecycleConfiguration: { Rules: [
      { ID: 'noncurrent', Status: 'Enabled', Filter: { Prefix: '' }, NoncurrentVersionExpiration: { NoncurrentDays: 365 } } ] } }));
    r.push('lifecycle.noncurrent=PASS');
  } catch (e: any) { r.push(`lifecycle.noncurrent=FAIL(${e.name})`); }
  try {
    await s3.send(new PutBucketEncryptionCommand({ Bucket: BUCKET, ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] } }));
    r.push('sse-s3.bucketDefault=PASS');
  } catch (e: any) { r.push(`sse-s3.bucketDefault=FAIL(${e.name})`); }
  console.log(`[${b.name}] ${r.join(' ')}`);
}
