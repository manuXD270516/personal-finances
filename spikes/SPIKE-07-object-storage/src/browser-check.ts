// SPIKE-07 — verificación CORS en navegador real (descartable).
// Sirve http://localhost:61600 (origen permitido por CORS). La página pide presigned URLs
// a este mismo servidor (simula finance-api) y sube/descarga DIRECTO al backend S3 con fetch.
// Uso: npx tsx src/browser-check.ts  →  abrir http://localhost:61600
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BACKENDS, BUCKET, type BackendName } from './backends.js';

const clients = Object.fromEntries(
  Object.values(BACKENDS).map((b) => [
    b.name,
    new S3Client({
      endpoint: b.endpoint, region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: b.accessKeyId, secretAccessKey: b.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  ]),
) as Record<BackendName, S3Client>;

const page = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>SPIKE-07 CORS</title>
<style>body{font:14px system-ui;margin:24px}pre{background:#f4f4f4;padding:12px}</style></head><body>
<h1>SPIKE-07 — subida presignada desde el navegador</h1>
<button id="run">Ejecutar en los 3 backends</button><pre id="out">listo</pre>
<script>
const out = document.getElementById('out');
const log = (s) => { out.textContent += '\\n' + s; };
async function sha256b64(buf){ const d = await crypto.subtle.digest('SHA-256', buf); return btoa(String.fromCharCode(...new Uint8Array(d))); }
async function one(backend){
  const body = new TextEncoder().encode('%PDF-1.4 navegador ' + backend + ' ' + Date.now());
  const sum = await sha256b64(body);
  const p = await (await fetch('/presign?backend=' + backend + '&size=' + body.length + '&sha=' + encodeURIComponent(sum))).json();
  try {
    const put = await fetch(p.putUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': sum }, body });
    log(backend + ' PUT ' + put.status + ' ETag(expuesto)=' + put.headers.get('etag'));
    const get = await fetch(p.getUrl);
    const txt = await get.text();
    log(backend + ' GET ' + get.status + ' igual=' + (txt === new TextDecoder().decode(body)));
    const bad = await fetch(p.putUrl, { method: 'PUT', headers: { 'content-type': 'text/html', 'x-amz-checksum-sha256': sum }, body }).then(r => 'HTTP ' + r.status, e => 'bloqueado: ' + e.message);
    log(backend + ' PUT content-type incorrecto → ' + bad);
  } catch (e) { log(backend + ' ERROR (CORS?) ' + e.message); }
}
document.getElementById('run').onclick = async () => {
  out.textContent = 'origen: ' + location.origin;
  for (const b of ['seaweedfs','garage','rustfs']) await one(b);
  log('FIN');
};
</script></body></html>`;

createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://localhost:61600');
  if (u.pathname === '/presign') {
    const b = u.searchParams.get('backend') as BackendName;
    const key = `ws/${randomUUID()}/documents/${randomUUID()}`;
    const s3 = clients[b];
    const putUrl = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: BUCKET, Key: key, ContentType: 'application/pdf',
      ContentLength: Number(u.searchParams.get('size')), ChecksumSHA256: u.searchParams.get('sha')!,
    }), { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']), unhoistableHeaders: new Set(['x-amz-checksum-sha256']) });
    const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 60 });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ putUrl, getUrl }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
}).listen(61600, '127.0.0.1', () => console.log('http://localhost:61600'));
