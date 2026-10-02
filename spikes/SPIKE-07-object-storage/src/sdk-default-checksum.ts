// ¿Qué pasa con presigned PUT si NO se fija requestChecksumCalculation=WHEN_REQUIRED? (SDK v3 >= 3.729 calcula CRC32 por defecto)
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BACKENDS, BUCKET } from './backends.js';
for (const b of Object.values(BACKENDS)) {
  const s3 = new S3Client({ endpoint: b.endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: b.accessKeyId, secretAccessKey: b.secretAccessKey } });
  const body = Buffer.from('hola');
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: 'sdk-default/x', ContentType: 'text/plain' }), { expiresIn: 60 });
  const q = [...new URL(url).searchParams.keys()].filter((k) => /checksum|sdk/i.test(k));
  const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body });
  console.log(`[${b.name}] params extra=${q.join(',') || '(ninguno)'} → HTTP ${res.status} ${(await res.text()).slice(0, 140)}`);
}
