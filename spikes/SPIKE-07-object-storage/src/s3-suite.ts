// SPIKE-07 — suite de compatibilidad S3 (código descartable).
// Uso: npx tsx src/s3-suite.ts <seaweedfs|garage|rustfs> [--phase=all|persist-write|persist-check]
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  S3Client,
  ListBucketsCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetBucketCorsCommand,
  GetBucketVersioningCommand,
  ListObjectVersionsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { ALLOWED_ORIGIN, BACKENDS, BUCKET, BUCKETS, DENIED_ORIGIN, type BackendName } from './backends.js';

type Status = 'PASS' | 'FAIL' | 'WARN' | 'INFO';
interface Result { id: string; status: Status; detail: string }

const backendName = process.argv[2] as BackendName;
const phase = (process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1] ?? 'all') as
  | 'all' | 'persist-write' | 'persist-check';
const backend = BACKENDS[backendName];
if (!backend) {
  console.error('Uso: tsx src/s3-suite.ts <seaweedfs|garage|rustfs> [--phase=...]');
  process.exit(2);
}

const s3 = new S3Client({
  endpoint: backend.endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: backend.accessKeyId, secretAccessKey: backend.secretAccessKey },
  // Imprescindible con SDK >= 3.729: si no, el SDK agrega CRC32 por defecto y rompe presigned/compat.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const results: Result[] = [];
function record(id: string, status: Status, detail: string) {
  results.push({ id, status, detail });
  const tag = { PASS: '\x1b[32mPASS\x1b[0m', FAIL: '\x1b[31mFAIL\x1b[0m', WARN: '\x1b[33mWARN\x1b[0m', INFO: '\x1b[36mINFO\x1b[0m' }[status];
  console.log(`${tag} [${backend.name}] ${id} — ${detail}`);
}
async function check(id: string, fn: () => Promise<{ ok: boolean | 'warn' | 'info'; detail: string }>) {
  try {
    const r = await fn();
    record(id, r.ok === true ? 'PASS' : r.ok === 'warn' ? 'WARN' : r.ok === 'info' ? 'INFO' : 'FAIL', r.detail);
  } catch (e: any) {
    record(id, 'FAIL', `excepción: ${e?.name ?? ''} ${e?.message ?? e}`.slice(0, 300));
  }
}

const sha256b64 = (b: Uint8Array) => createHash('sha256').update(b).digest('base64');
const md5hex = (b: Uint8Array) => createHash('md5').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ws = randomUUID();
const key = (ctx: string) => `ws/${ws}/${ctx}/${randomUUID()}`;
async function bodyText(res: Response) { return (await res.text()).replace(/\s+/g, ' ').slice(0, 160); }

// "PDF" mínimo de prueba (solo bytes; el contenido no importa para S3)
const pdf = Buffer.from('%PDF-1.4\n% SPIKE-07 test document\n' + 'x'.repeat(2000) + '\n%%EOF\n');

async function presignPut(k: string, contentType: string, size: number, extra: Record<string, unknown> = {}, expiresIn = 300) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: k, ContentType: contentType, ContentLength: size, ...extra }),
    {
      expiresIn,
      signableHeaders: new Set(['content-type', 'content-length']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    },
  );
}

async function runAll() {
  // 1. Buckets creados por el init (idempotente)
  await check('buckets.init', async () => {
    const out = await s3.send(new ListBucketsCommand({}));
    const names = (out.Buckets ?? []).map((b) => b.Name);
    return { ok: BUCKETS.every((b) => names.includes(b)), detail: `buckets=${names.join(',')}` };
  });

  // 2. Presigned PUT con Content-Type + Content-Length firmados, subida con fetch "como navegador"
  const putKey = key('documents');
  const putUrl = await presignPut(putKey, 'application/pdf', pdf.length);
  const signed = new URL(putUrl).searchParams.get('X-Amz-SignedHeaders') ?? '';
  record('presignPut.signedHeaders', signed.includes('content-type') && signed.includes('content-length') ? 'PASS' : 'FAIL', `X-Amz-SignedHeaders=${signed}`);

  await check('presignPut.upload.fetch', async () => {
    const res = await fetch(putUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: pdf });
    return { ok: res.ok, detail: `HTTP ${res.status} ETag=${res.headers.get('etag')}` };
  });
  await check('presignPut.rejects.wrongContentType', async () => {
    const res = await fetch(putUrl, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: pdf });
    return { ok: res.status === 403, detail: `HTTP ${res.status} (esperado 403) ${await bodyText(res)}` };
  });
  await check('presignPut.rejects.biggerBody', async () => {
    const big = Buffer.concat([pdf, Buffer.alloc(1024 * 1024, 0x41)]);
    const res = await fetch(putUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: big });
    return { ok: res.status === 403, detail: `HTTP ${res.status} (esperado 403, content-length firmado) ${await bodyText(res)}` };
  });
  await check('presignPut.rejects.missingContentType', async () => {
    const res = await fetch(putUrl, { method: 'PUT', body: pdf });
    return { ok: res.status >= 400 && res.status < 500 ? (res.status === 403 ? true : "warn") : false, detail: `HTTP ${res.status} (AWS devuelve 403; cualquier 4xx = rechazado)` };
  });

  // 3. HEAD: tamaño, ETag (MD5 en single-part), Content-Type
  await check('head.sizeEtagType', async () => {
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: putKey }));
    const etag = (h.ETag ?? '').replaceAll('"', '');
    const ok = h.ContentLength === pdf.length && etag === md5hex(pdf) && h.ContentType === 'application/pdf';
    return { ok, detail: `size=${h.ContentLength}/${pdf.length} etag=${etag} md5=${md5hex(pdf)} type=${h.ContentType}` };
  });

  // 4. Listado por prefijo de workspace
  await check('list.prefix', async () => {
    const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `ws/${ws}/` }));
    return { ok: (out.KeyCount ?? 0) >= 1, detail: `KeyCount=${out.KeyCount}` };
  });

  // 5. Presigned GET: contenido, Content-Disposition attachment y expiración corta
  await check('presignGet.contentDisposition', async () => {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: putKey, ResponseContentDisposition: 'attachment; filename="doc.pdf"' }),
      { expiresIn: 60 },
    );
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const cd = res.headers.get('content-disposition');
    return { ok: res.ok && buf.equals(pdf) && (cd ?? '').startsWith('attachment'), detail: `HTTP ${res.status} bytesOk=${buf.equals(pdf)} content-disposition=${cd}` };
  });
  await check('presignGet.expiryEnforced', async () => {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: putKey }), { expiresIn: 2 });
    const before = await fetch(url);
    await before.arrayBuffer();
    await sleep(5000);
    const after = await fetch(url);
    const rejected = after.status >= 400 && after.status < 500;
    return { ok: before.status === 200 && rejected ? (after.status === 403 ? true : "warn") : false, detail: `t0=HTTP ${before.status}, t+5s=HTTP ${after.status} (AWS: 403 AccessDenied) ${await bodyText(after)}` };
  });

  // 6. Presigned POST policy (content-length-range + Content-Type)
  await check('presignPost.withinRange', async () => {
    const k = key('documents');
    const { url, fields } = await createPresignedPost(s3, {
      Bucket: BUCKET, Key: k, Expires: 300,
      Conditions: [['content-length-range', 1, 4096], ['eq', '$Content-Type', 'application/pdf']],
      Fields: { 'Content-Type': 'application/pdf' },
    });
    const fd = new FormData();
    for (const [n, v] of Object.entries(fields)) fd.append(n, v);
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }));
    const res = await fetch(url, { method: 'POST', body: fd });
    return { ok: res.status === 204 || res.status === 200 || res.status === 201, detail: `HTTP ${res.status} ${res.ok ? '' : await bodyText(res)}` };
  });
  await check('presignPost.rejects.tooLarge', async () => {
    const k = key('documents');
    const { url, fields } = await createPresignedPost(s3, {
      Bucket: BUCKET, Key: k, Expires: 300,
      Conditions: [['content-length-range', 1, 4096]],
      Fields: { 'Content-Type': 'application/pdf' },
    });
    const fd = new FormData();
    for (const [n, v] of Object.entries(fields)) fd.append(n, v);
    fd.append('file', new Blob([Buffer.alloc(64 * 1024, 0x41)], { type: 'application/pdf' }));
    const res = await fetch(url, { method: 'POST', body: fd });
    let exists = false;
    try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k })); exists = true; } catch {}
    return { ok: res.status >= 400 && !exists, detail: `HTTP ${res.status} objetoCreado=${exists} ${await bodyText(res)}` };
  });

  // 7. Checksum SHA-256 server-side
  await check('checksum.sdkPut.valid+head', async () => {
    const k = key('documents');
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: pdf, ContentType: 'application/pdf', ChecksumSHA256: sha256b64(pdf) }));
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k, ChecksumMode: 'ENABLED' }));
    return { ok: h.ChecksumSHA256 === sha256b64(pdf) ? true : 'warn', detail: `HEAD x-amz-checksum-sha256=${h.ChecksumSHA256 ?? '(no devuelto)'}` };
  });
  await check('checksum.sdkPut.rejectsWrong', async () => {
    const k = key('documents');
    try {
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: pdf, ChecksumSHA256: sha256b64(Buffer.from('otro contenido')) }));
      return { ok: false, detail: 'PUT con checksum incorrecto ACEPTADO' };
    } catch (e: any) {
      return { ok: true, detail: `rechazado: ${e.name} HTTP ${e.$metadata?.httpStatusCode}` };
    }
  });
  await check('checksum.presignPut.tamperedBodyRejected', async () => {
    const k = key('documents');
    const url = await presignPut(k, 'application/pdf', pdf.length, { ChecksumSHA256: sha256b64(pdf) });
    const sh = new URL(url).searchParams.get('X-Amz-SignedHeaders');
    const tampered = Buffer.from(pdf); tampered[100] ^= 0xff; // mismo tamaño, distinto contenido
    const bad = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': sha256b64(pdf) }, body: tampered });
    const badTxt = await bodyText(bad);
    const good = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': sha256b64(pdf) }, body: pdf });
    return { ok: bad.status === 400 && good.ok, detail: `signed=${sh}; manipulado=HTTP ${bad.status} ${badTxt.slice(0, 80)}; correcto=HTTP ${good.status}` };
  });

  // 8. CORS
  await check('cors.getBucketCors', async () => {
    const c = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
    return { ok: (c.CORSRules ?? []).some((r) => r.AllowedOrigins?.includes(ALLOWED_ORIGIN)), detail: JSON.stringify(c.CORSRules?.[0]?.AllowedOrigins) };
  });
  const corsKey = key('documents');
  const corsUrl = await presignPut(corsKey, 'application/pdf', pdf.length);
  await check('cors.preflight.allowedOrigin', async () => {
    const res = await fetch(corsUrl, { method: 'OPTIONS', headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
    const acao = res.headers.get('access-control-allow-origin');
    return { ok: res.status < 300 && (acao === ALLOWED_ORIGIN || acao === '*'), detail: `HTTP ${res.status} ACAO=${acao} ACAM=${res.headers.get('access-control-allow-methods')} ACAH=${res.headers.get('access-control-allow-headers')}` };
  });
  await check('cors.preflight.deniedOrigin', async () => {
    const res = await fetch(corsUrl, { method: 'OPTIONS', headers: { Origin: DENIED_ORIGIN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
    const acao = res.headers.get('access-control-allow-origin');
    // El navegador exige status 2xx + ACAO coincidente; cualquiera de los dos que falle bloquea la subida.
    const denied = res.status >= 300 || !acao || (acao !== DENIED_ORIGIN && acao !== '*');
    return { ok: denied ? (acao ? "warn" : true) : false, detail: `HTTP ${res.status} ACAO=${acao} (navegador bloquea si status!=2xx o ACAO no coincide)` };
  });
  await check('cors.actualPut.exposeEtag', async () => {
    const res = await fetch(corsUrl, { method: 'PUT', headers: { Origin: ALLOWED_ORIGIN, 'content-type': 'application/pdf' }, body: pdf });
    const acao = res.headers.get('access-control-allow-origin');
    const aceh = (res.headers.get('access-control-expose-headers') ?? '').toLowerCase();
    return { ok: res.ok && !!acao && aceh.includes('etag'), detail: `HTTP ${res.status} ACAO=${acao} ACEH=${aceh || '(vacío)'}` };
  });

  // 9. Versioning
  let versioningEnabled = false;
  await check('versioning.status', async () => {
    const v = await s3.send(new GetBucketVersioningCommand({ Bucket: BUCKET }));
    versioningEnabled = v.Status === 'Enabled';
    return { ok: versioningEnabled, detail: `Status=${v.Status ?? '(sin configurar)'}` };
  });
  if (versioningEnabled) {
    await check('versioning.twoVersions+restore+deleteMarker', async () => {
      const k = key('documents');
      const p1 = await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: 'v1' }));
      const p2 = await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: 'v2' }));
      const lv = await s3.send(new ListObjectVersionsCommand({ Bucket: BUCKET, Prefix: k }));
      const n = (lv.Versions ?? []).filter((v) => v.Key === k).length;
      const old = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: k, VersionId: p1.VersionId }));
      const oldBody = await old.Body!.transformToString();
      const del = await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k }));
      let headAfter = 0;
      try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k })); headAfter = 200; } catch (e: any) { headAfter = e.$metadata?.httpStatusCode; }
      const old2 = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: k, VersionId: p2.VersionId }));
      const v2Body = await old2.Body!.transformToString();
      const ok = n === 2 && oldBody === 'v1' && del.DeleteMarker === true && headAfter === 404 && v2Body === 'v2';
      return { ok, detail: `versiones=${n} v1=${oldBody} deleteMarker=${del.DeleteMarker} headTrasDelete=${headAfter} v2Recuperable=${v2Body === 'v2'} ids=${p1.VersionId?.slice(0, 12)}…,${p2.VersionId?.slice(0, 12)}…` };
    });
  } else {
    record('versioning.twoVersions+restore+deleteMarker', 'FAIL', 'omitido: versioning no disponible');
  }

  // 10. Multipart 50 MiB con partes presignadas subidas vía fetch (flujo navegador)
  await check('multipart.50MiB.presignedParts', async () => {
    const size = 50 * 1024 * 1024, partSize = 10 * 1024 * 1024;
    const data = randomBytes(size);
    const k = key('imports');
    const t0 = performance.now();
    const cmu = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: k, ContentType: 'text/csv' }));
    const parts: { ETag: string; PartNumber: number }[] = [];
    try {
      for (let i = 0; i * partSize < size; i++) {
        const chunk = data.subarray(i * partSize, Math.min(size, (i + 1) * partSize));
        const url = await getSignedUrl(s3, new UploadPartCommand({ Bucket: BUCKET, Key: k, UploadId: cmu.UploadId, PartNumber: i + 1 }), { expiresIn: 300 });
        const res = await fetch(url, { method: 'PUT', body: chunk, headers: { Origin: ALLOWED_ORIGIN } });
        if (!res.ok) throw new Error(`part ${i + 1} HTTP ${res.status} ${await bodyText(res)}`);
        parts.push({ ETag: res.headers.get('etag')!, PartNumber: i + 1 });
      }
      await s3.send(new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: k, UploadId: cmu.UploadId, MultipartUpload: { Parts: parts } }));
    } catch (e) {
      await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: k, UploadId: cmu.UploadId })).catch(() => {});
      throw e;
    }
    const tUp = performance.now() - t0;
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k }));
    const get = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: k }));
    const got = Buffer.from(await get.Body!.transformToByteArray());
    const same = createHash('sha256').update(got).digest('hex') === createHash('sha256').update(data).digest('hex');
    const etag = (h.ETag ?? '').replaceAll('"', '');
    return { ok: h.ContentLength === size && same && etag.endsWith('-5'), detail: `size=${h.ContentLength} etag=${etag} sha256Igual=${same} subida=${Math.round(tUp)}ms (${(size / 1048576 / (tUp / 1000)).toFixed(0)} MiB/s)` };
  });

  // 11. Delete
  await check('delete.object', async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: putKey }));
    try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: putKey })); return { ok: false, detail: 'HEAD sigue devolviendo 200' }; }
    catch (e: any) { return { ok: e.$metadata?.httpStatusCode === 404, detail: `HEAD tras delete → HTTP ${e.$metadata?.httpStatusCode}` }; }
  });
}

const persistFile = `results/${backend.name}-persist.json`;
async function persistWrite() {
  const k = `persist/marker-${randomUUID()}.txt`;
  const content = `SPIKE-07 ${backend.name} ${new Date().toISOString()}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: content, ContentType: 'text/plain' }));
  writeFileSync(persistFile, JSON.stringify({ key: k, content }));
  record('persistence.write', 'PASS', `escrito ${k}`);
}
async function persistCheck() {
  const { key: k, content } = JSON.parse(readFileSync(persistFile, 'utf8'));
  await check('persistence.afterRestart', async () => {
    const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: k }));
    const body = await o.Body!.transformToString();
    const c = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET })).then(() => 'ok', () => 'perdido');
    return { ok: body === content, detail: `objeto ${body === content ? 'intacto' : 'DISTINTO'}; CORS ${c}` };
  });
}

mkdirSync('results', { recursive: true });
if (phase === 'persist-write') await persistWrite();
else if (phase === 'persist-check') await persistCheck();
else await runAll();

const suffix = phase === 'all' ? 'suite' : phase;
writeFileSync(`results/${backend.name}-${suffix}.json`, JSON.stringify(results, null, 2));
const fails = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n[${backend.name}] ${results.filter((r) => r.status === 'PASS').length} PASS, ${results.filter((r) => r.status === 'WARN').length} WARN, ${fails} FAIL`);
process.exitCode = fails ? 1 : 0;
