// Quita la encriptación por defecto aplicada por extra-checks (RustFS la acepta pero luego rechaza PUTs sin master key).
import { S3Client, DeleteBucketEncryptionCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BACKENDS, BUCKET } from './backends.js';
for (const b of [BACKENDS.seaweedfs, BACKENDS.rustfs]) {
  const s3 = new S3Client({ endpoint: b.endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: b.accessKeyId, secretAccessKey: b.secretAccessKey }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  const before = await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'sse-probe', Body: 'x' })).then(() => 'PUT ok', (e) => `PUT ${e.name}: ${e.message}`);
  await s3.send(new DeleteBucketEncryptionCommand({ Bucket: BUCKET }));
  const after = await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'sse-probe', Body: 'x' })).then(() => 'PUT ok', (e) => `PUT ${e.name}`);
  console.log(`[${b.name}] con SSE-S3 default: ${before} | tras DeleteBucketEncryption: ${after}`);
}
