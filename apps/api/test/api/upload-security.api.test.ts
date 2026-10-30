/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createObjectStorageClient, S3ObjectStorage } from '@pf/platform/storage';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';
import {
  benignPdf,
  maliciousCases,
  sha256Hex,
  sha256Base64,
  type MaliciousCase,
} from '../support/malicious-files.js';

// Suite de uploads maliciosos (TC-SECURITY-UPLOAD-022, exit criterion «uploads maliciosos de prueba rechazados» de
// Phase 6): los 17 archivos (18 con el escáner antimalware, que solo enciende el nightly con `PF_TEST_CLAMAV_HOST`) se
// rechazan de punta a punta contra la API y SeaweedFS reales —en la solicitud, en el almacenamiento o en la
// verificación— y al final el workspace no tiene ningún documento disponible ni descargable ni objeto en cuarentena.
// Los archivos se generan por código (`test/support/malicious-files.ts`); EICAR se arma por fragmentos.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const CLAMAV_HOST = process.env['PF_TEST_CLAMAV_HOST'];
const logs = capturingLogger('finance-api', 'api');

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let jwk: Record<string, unknown>;
const runtimes: ApiRuntime[] = [];
let baseUrl: string;
let shortUrl: string;
let scannerUrl: string | undefined;

const s3 = createObjectStorageClient({
  OBJECT_STORAGE_ENDPOINT: deps.s3Endpoint,
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_ACCESS_KEY: deps.s3AccessKey,
  OBJECT_STORAGE_SECRET_KEY: deps.s3SecretKey,
  OBJECT_STORAGE_FORCE_PATH_STYLE: true,
});
const store = new S3ObjectStorage({
  client: s3,
  publicEndpoint: deps.s3Endpoint,
  region: 'us-east-1',
  accessKey: deps.s3AccessKey,
  secretKey: deps.s3SecretKey,
});

function parseJson(text: string): Record<string, any> {
  try {
    return text ? (JSON.parse(text) as Record<string, any>) : {};
  } catch {
    return {};
  }
}

interface Reply {
  status: number;
  body: Record<string, any>;
  text: string;
}

async function token(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 300,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `${sub}@pfos.test`,
    email_verified: true,
    name: sub,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(signingKey);
}

async function call(url: string, method: string, path: string, tok: string, body?: unknown): Promise<Reply> {
  const headers: Record<string, string> = { authorization: `Bearer ${tok}` };
  if (method === 'POST') headers['idempotency-key'] = randomUUID();
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${url}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: parseJson(text), text };
}

async function keys(bucket: string, id?: string): Promise<string[]> {
  const out: string[] = [];
  for await (const o of store.list(bucket, '')) if (!id || o.key.includes(id)) out.push(o.key);
  return out;
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  const start = async (env: Record<string, string>) => {
    const rt = await createApiRuntime(apiConfig(baseEnv(deps, env)), logs.logger, {
      identity: {
        jwt: {
          issuer: ISSUER,
          audience: AUDIENCE,
          requiredScope: 'pfos.api',
          jwks: { keys: [jwk as never] },
        },
      },
    });
    runtimes.push(rt);
    return rt.listen(0, '127.0.0.1');
  };
  baseUrl = await start({});
  // Segunda API con URL de subida de 2 segundos: el caso de la dirección vencida.
  shortUrl = await start({ DOCUMENT_UPLOAD_URL_TTL: '2s' });
  // Tercera API con ClamAV (solo cuando el nightly lo proporciona).
  if (CLAMAV_HOST) {
    scannerUrl = await start({
      DOCUMENT_MALWARE_SCANNER: 'clamav',
      CLAMAV_HOST,
      CLAMAV_PORT: process.env['PF_TEST_CLAMAV_PORT'] ?? '3310',
    });
  }
}, 180_000);

afterAll(async () => {
  for (const rt of runtimes) await rt.close();
  s3.destroy();
});

describe('suite de uploads maliciosos (security/file-upload-security)', () => {
  it('[TC-SECURITY-UPLOAD-022] todos los archivos maliciosos se rechazan de punta a punta y no queda nada disponible ni en cuarentena', async () => {
    // Cada caso usa su propio usuario y workspace: la cuota `costly` (10 por minuto) es por usuario y por workspace.
    const workspaces: { ws: string; tok: string }[] = [];
    const cases = maliciousCases().filter((c) => !c.needsScanner || scannerUrl !== undefined);
    expect(cases.length).toBe(scannerUrl ? 18 : 17);

    const outcomes: string[] = [];
    for (const c of cases) {
      const tok = await token(`kc-upload-sec-${c.n}-${randomUUID()}`);
      const me = await call(baseUrl, 'GET', '/api/v1/me', tok);
      const ws = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
      workspaces.push({ ws, tok });
      const W = `/api/v1/workspaces/${ws}`;
      const url = c.n === 6 ? shortUrl : c.needsScanner ? (scannerUrl as string) : baseUrl;
      const content = c.content ?? Buffer.alloc(0);
      const sizeBytes = c.declaredSize ?? content.length;
      const sha = c.content ? sha256Hex(content) : sha256Hex(Buffer.from(`sin-contenido-${c.n}`));
      const requested = await call(url, 'POST', `${W}/documents/uploads`, tok, {
        fileName: c.fileName,
        contentType: c.contentType,
        sizeBytes,
        sha256: sha,
        purpose: c.purpose,
      });

      if (c.stage === 'request') {
        const e = c.expect as { status: number; code: string };
        expect(requested.status, `caso ${c.n} ${c.label}: ${requested.text}`).toBe(e.status);
        expect(requested.body['code'], `caso ${c.n}`).toBe(e.code);
        outcomes.push(`${c.n}:request:${e.code}`);
        continue;
      }
      expect(requested.status, `caso ${c.n} ${c.label}: ${requested.text}`).toBe(201);
      const id = requested.body['document'].id as string;
      const upload = requested.body['upload'];

      if (c.stage === 'storage') {
        if (c.n === 6) {
          // La dirección ya venció cuando el navegador la usa.
          await new Promise((r) => setTimeout(r, 3500));
          const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
          expect(put.status, `caso 6: ${await put.text()}`).toBeGreaterThanOrEqual(400);
        } else {
          // Contenido sustituido: mismo largo, otra suma, con la URL firmada para la suma declarada.
          const swapped = Buffer.from(content);
          swapped[swapped.length - 1] = (swapped[swapped.length - 1] as number) ^ 0x7f;
          expect(sha256Hex(swapped)).not.toBe(sha);
          const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: swapped });
          expect(put.status, `caso 5: ${await put.text()}`).toBeGreaterThanOrEqual(400);
        }
        const e = c.expect as { completeCode: string };
        const done = await call(url, 'POST', `${W}/documents/${id}/complete`, tok);
        expect(done.status, `caso ${c.n}: ${done.text}`).toBe(409);
        expect(done.body['code']).toBe(e.completeCode);
        const doc = await call(url, 'GET', `${W}/documents/${id}`, tok);
        expect(doc.body['status']).toBe('PENDING_UPLOAD');
        outcomes.push(`${c.n}:storage:${e.completeCode}`);
        continue;
      }

      // Verificación: el archivo llega a la cuarentena y la confirmación lo rechaza con su motivo.
      const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
      expect(put.status, `caso ${c.n} PUT: ${await put.text()}`).toBe(200);
      const done = await call(url, 'POST', `${W}/documents/${id}/complete`, tok);
      expect(done.status, `caso ${c.n} ${c.label}: ${done.text}`).toBe(200);
      const e = c.expect as { rejected: string };
      expect(done.body['status'], `caso ${c.n} ${c.label}`).toBe('REJECTED');
      expect(done.body['rejectionReason'], `caso ${c.n} ${c.label}`).toBe(e.rejected);
      expect(await keys(deps.quarantineBucket, id), `caso ${c.n}: cuarentena`).toEqual([]);
      expect(await keys(deps.bucket, id), `caso ${c.n}: documentos`).toEqual([]);
      const dl = await call(url, 'GET', `${W}/documents/${id}/download`, tok);
      expect(dl.status, `caso ${c.n}`).toBe(409);
      expect(dl.body['code']).toBe('DOCUMENT_REJECTED');
      outcomes.push(`${c.n}:verification:${e.rejected}`);
    }
    expect(outcomes).toHaveLength(cases.length);

    // Al final: 0 documentos disponibles, cuarentena vacía y ningún objeto en el bucket de documentos de esos workspaces.
    for (const { ws, tok } of workspaces) {
      const W = `/api/v1/workspaces/${ws}`;
      const available = await call(baseUrl, 'GET', `${W}/documents?status=AVAILABLE&archived=include`, tok);
      expect(available.body['data']).toEqual([]);
      expect((await keys(deps.quarantineBucket)).filter((k) => k.includes(ws))).toEqual([]);
      expect((await keys(deps.bucket)).filter((k) => k.includes(ws))).toEqual([]);
      const usage = await call(baseUrl, 'GET', `${W}/documents/usage`, tok);
      expect(usage.body['usedBytes']).toBe(0);
    }
  }, 240_000);

  it('[TC-SECURITY-UPLOAD-005] la dirección de subida vencida es rechazada por el almacenamiento y el documento sigue pendiente', async () => {
    const tok = await token(`kc-upload-expired-${randomUUID()}`);
    const me = await call(shortUrl, 'GET', '/api/v1/me', tok);
    const ws = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
    const content = benignPdf('vencida');
    const r = await call(shortUrl, 'POST', `/api/v1/workspaces/${ws}/documents/uploads`, tok, {
      fileName: 'vencida.pdf',
      contentType: 'application/pdf',
      sizeBytes: content.length,
      sha256: sha256Hex(content),
      purpose: 'RECEIPT',
    });
    expect(r.status, r.text).toBe(201);
    // URL de 2 s: se usa a los 3,5 s.
    await new Promise((res) => setTimeout(res, 3500));
    const { url, headers } = r.body['upload'] as { url: string; headers: Record<string, string> };
    const put = await fetch(url, { method: 'PUT', headers, body: content });
    expect(put.status).toBeGreaterThanOrEqual(400);
    const id = (r.body['document'] as { id: string }).id;
    const done = await call(shortUrl, 'POST', `/api/v1/workspaces/${ws}/documents/${id}/complete`, tok);
    expect(done.status).toBe(409);
    expect(done.body['code']).toBe('DOCUMENT_UPLOAD_MISSING');
    const doc = await call(shortUrl, 'GET', `/api/v1/workspaces/${ws}/documents/${id}`, tok);
    expect(doc.body['status']).toBe('PENDING_UPLOAD');
  });

  it('[TC-SECURITY-UPLOAD-004] el almacenamiento rechaza un PUT con otro Content-Type o sin la suma firmada', async () => {
    const sub = `kc-upload-sec-hdr-${randomUUID()}`;
    const tok = await token(sub);
    const me = await call(baseUrl, 'GET', '/api/v1/me', tok);
    const ws = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
    const content = benignPdf('cabeceras');
    const r = await call(baseUrl, 'POST', `/api/v1/workspaces/${ws}/documents/uploads`, tok, {
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: content.length,
      sha256: sha256Hex(content),
      purpose: 'RECEIPT',
    });
    expect(r.status).toBe(201);
    const { url, headers } = r.body['upload'] as { url: string; headers: Record<string, string> };
    const otherType = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'text/html' },
      body: content,
    });
    expect(otherType.status).toBeGreaterThanOrEqual(400);
    const noChecksum = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: content,
    });
    expect(noChecksum.status).toBeGreaterThanOrEqual(400);
    const wrongSize = await fetch(url, {
      method: 'PUT',
      headers,
      body: Buffer.concat([content, Buffer.from('x')]),
    });
    expect(wrongSize.status).toBeGreaterThanOrEqual(400);
    expect(headers['x-amz-checksum-sha256']).toBe(sha256Base64(content));
    // Con las cabeceras firmadas la subida sí funciona.
    const ok = await fetch(url, { method: 'PUT', headers, body: content });
    expect(ok.status).toBe(200);
  });

  it('[TC-SECURITY-UPLOAD-021] la undécima solicitud de subida en un minuto: RATE_LIMITED sin registrar nada', async () => {
    const sub = `kc-upload-rate-${randomUUID()}`;
    const tok = await token(sub);
    const me = await call(baseUrl, 'GET', '/api/v1/me', tok);
    const ws = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
    const W = `/api/v1/workspaces/${ws}`;
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const r = await call(baseUrl, 'POST', `${W}/documents/uploads`, tok, {
        fileName: `n-${i}.csv`,
        contentType: 'text/csv',
        sizeBytes: 100 + i,
        sha256: sha256Hex(Buffer.from(`rate-${i}-${ws}`)),
        purpose: 'OTHER',
      });
      statuses.push(r.status);
      if (r.status === 429) expect(r.body['code']).toBe('RATE_LIMITED');
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
    const app = await connect(deps.databaseUrl);
    try {
      const n = await inTx(app, { userId: null, workspaceId: ws }, async () => {
        const { rows } = await app.query<{ n: string }>(
          `SELECT count(*) AS n FROM documents.document WHERE workspace_id = $1`,
          [ws],
        );
        return Number(rows[0]!.n);
      });
      expect(n).toBe(10);
    } finally {
      await app.end();
    }
  });
});

export type { MaliciousCase };
