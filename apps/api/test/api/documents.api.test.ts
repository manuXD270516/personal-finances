/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import { createObjectStorageClient, S3ObjectStorage } from '@pf/platform/storage';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';
import { benignPdf, sha256Base64, sha256Hex } from '../support/malicious-files.js';

// Documentos adjuntos por HTTP contra PostgreSQL y SeaweedFS reales (openspec add-document-attachments, tareas 5.2 y
// 7.2): solicitud de subida con URL presignada, PUT directo del navegador a la cuarentena, confirmación con
// verificación síncrona, objeto cifrado en el bucket, descarga solo por la API con auditoría, vínculos a elementos
// reales, archivado, eliminación con destrucción de la clave, roles, idempotencia, cuota y aislamiento. Las respuestas
// se validan contra el OpenAPI.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const apiLog = capturingLogger('finance-api', 'api');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let worker: Pool;
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
  headers: Headers;
  text: string;
  bytes: Buffer;
}

async function tokenFor(sub: string): Promise<string> {
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

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] ??= 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString('utf8');
  return { status: res.status, headers: res.headers, body: parseJson(text), text, bytes };
}

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;

async function join(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [owner.ws, member.id, role],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  return { ...member, ws: owner.ws };
}

const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body !== undefined ? { body } : {}),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });
const checked = (operation: string, status: number, r: Reply) => {
  expect(r.status, `${r.text} ${apiErrors()}`).toBe(status);
  expect(contract.validateResponse(operation, status, r.body), r.text).toEqual([]);
  return r.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, `${r.text} ${apiErrors()}`).toBe(status);
  expect(r.body['code'], r.text).toBe(code);
};

interface Team {
  owner: User;
  editor: User;
  viewer: User;
}
async function team(label: string): Promise<Team> {
  const owner = await user(`kc-docs-${label}-${randomUUID()}`);
  const editor = await join(owner, await user(`kc-docs-${label}-ed-${randomUUID()}`), 'EDITOR');
  const viewer = await join(owner, await user(`kc-docs-${label}-vw-${randomUUID()}`), 'VIEWER');
  return { owner, editor, viewer };
}

/** Solicitud de subida de un archivo con su declaración. */
function requestUpload(u: User, content: Buffer, fileName: string, contentType: string, purpose = 'RECEIPT') {
  return post(u, '/documents/uploads', {
    fileName,
    contentType,
    sizeBytes: content.length,
    sha256: sha256Hex(content),
    purpose,
  });
}

/** El navegador sube directo a la URL presignada de la cuarentena. */
async function putToStorage(upload: any, content: Buffer): Promise<Response> {
  return fetch(upload.url as string, {
    method: upload.method as string,
    headers: upload.headers as Record<string, string>,
    body: content,
  });
}

/** Solicita, sube y deja el comprobante confirmado. */
async function uploadAndComplete(
  u: User,
  content: Buffer,
  fileName = 'factura-luz-octubre.pdf',
  contentType = 'application/pdf',
  purpose = 'RECEIPT',
) {
  const requested = checked(
    'requestDocumentUpload',
    201,
    await requestUpload(u, content, fileName, contentType, purpose),
  );
  const put = await putToStorage(requested['upload'], content);
  expect(put.status, await put.text()).toBe(200);
  const done = await post(u, `/documents/${requested['document'].id}/complete`);
  return { requested, done, id: requested['document'].id as string };
}

/** Fija los contadores de cuota del workspace con el rol de la app y su contexto RLS. */
async function setUsage(
  u: User,
  usage: { used?: number; reserved?: number; pending?: number },
): Promise<void> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: u.id, workspaceId: u.ws },
      () =>
        app.query(
          `INSERT INTO documents.storage_usage (workspace_id, used_bytes, reserved_bytes, pending_uploads)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id) DO UPDATE
             SET used_bytes = EXCLUDED.used_bytes, reserved_bytes = EXCLUDED.reserved_bytes,
                 pending_uploads = EXCLUDED.pending_uploads`,
          [u.ws, usage.used ?? 0, usage.reserved ?? 0, usage.pending ?? 0],
        ),
      true,
    );
  } finally {
    await app.end();
  }
}

async function objects(bucket: string): Promise<string[]> {
  const out: string[] = [];
  for await (const o of store.list(bucket, '')) out.push(o.key);
  return out;
}

async function auditOf(ws: string, where: string, params: unknown[] = []) {
  const client = await worker.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
      [ws],
    );
    const res = await client.query<{ action: string; changes: unknown }>(
      `SELECT action, changes FROM audit.audit_log WHERE ${where} ORDER BY occurred_at, id`,
      params,
    );
    await client.query('COMMIT');
    return res.rows;
  } finally {
    client.release();
  }
}

async function outboxOf(ws: string, eventType: string) {
  const { rows } = await worker.query<{ envelope: any }>(
    'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2 ORDER BY sequence',
    [ws, eventType],
  );
  return rows.map((r) => r.envelope);
}

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, {
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
}, 180_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
  s3.destroy();
});

describe('documentos adjuntos (documents/attachments)', () => {
  it('[TC-DOCUMENTS-ATTACH-001] solicitar la subida entrega una URL atada a tamaño, tipo y suma hacia la cuarentena', async () => {
    const t = await team('req');
    const content = benignPdf();
    const r = checked(
      'requestDocumentUpload',
      201,
      await requestUpload(t.editor, content, 'factura-luz-octubre.pdf', 'application/pdf'),
    );
    expect(r['document']).toMatchObject({
      status: 'PENDING_UPLOAD',
      sizeBytes: content.length,
      purpose: 'RECEIPT',
      sha256: sha256Hex(content),
    });
    expect(r['deduplicated']).toBe(false);
    const upload = r['upload'];
    const url = new URL(upload.url);
    // Cuarentena + clave opaca (workspace y documento): sin el nombre original.
    expect(url.pathname).toBe(`/${deps.quarantineBucket}/ws/${t.editor.ws}/${r['document'].id}`);
    expect(url.pathname).not.toMatch(/factura/iu);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host;x-amz-checksum-sha256',
    );
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBe(300);
    expect(upload.headers).toEqual({
      'Content-Type': 'application/pdf',
      'x-amz-checksum-sha256': sha256Base64(content),
    });
    expect(Date.parse(upload.expiresAt) - Date.parse(r['document'].createdAt)).toBe(300_000);
    const usage = checked('getDocumentStorageUsage', 200, await get(t.viewer, '/documents/usage'));
    expect(usage).toMatchObject({
      reservedBytes: content.length,
      usedBytes: 0,
      pendingUploads: 1,
      quotaBytes: 5_368_709_120,
      maxPendingUploads: 20,
    });
  });

  it('[TC-DOCUMENTS-ATTACH-002] un VIEWER no puede subir: INSUFFICIENT_ROLE y no se registra nada', async () => {
    const t = await team('viewer');
    const r = await requestUpload(t.viewer, benignPdf(), 'recibo.pdf', 'application/pdf');
    problem(r, 403, 'INSUFFICIENT_ROLE');
    expect(
      checked('listDocuments', 200, await get(t.viewer, '/documents?status=PENDING_UPLOAD'))['data'],
    ).toEqual([]);
    expect(checked('getDocumentStorageUsage', 200, await get(t.viewer, '/documents/usage'))).toMatchObject({
      reservedBytes: 0,
      pendingUploads: 0,
    });
  });

  it('[TC-DOCUMENTS-ATTACH-003] subir y confirmar: disponible, cuarentena vacía, objeto cifrado y descarga igual al original', async () => {
    const t = await team('flow');
    const content = benignPdf('Factura de luz octubre');
    const before = (await objects(deps.quarantineBucket)).length;
    const { done, id } = await uploadAndComplete(t.editor, content);
    const doc = checked('completeDocumentUpload', 200, done);
    expect(doc).toMatchObject({
      status: 'AVAILABLE',
      detectedContentType: 'application/pdf',
      detectedFormat: 'PDF',
      sizeBytes: content.length,
      sha256: sha256Hex(content),
      scanStatus: 'NOT_SCANNED',
      rejectionReason: null,
    });
    expect(done.headers.get('etag')).toBe(`"${doc['version']}"`);
    // La cuarentena ya no contiene el objeto de este documento.
    expect((await objects(deps.quarantineBucket)).filter((k) => k.includes(id))).toEqual([]);
    expect((await objects(deps.quarantineBucket)).length).toBe(before);
    // TC-SECURITY-UPLOAD-016: leído directo del almacenamiento no revela el contenido.
    const keys = (await objects(deps.bucket)).filter((k) => k.endsWith(id));
    expect(keys).toEqual([`ws/${t.editor.ws}/documents/${id}`]);
    const raw = Buffer.concat(await collect(await store.get(deps.bucket, keys[0]!)));
    expect(raw.subarray(0, 5).toString('latin1')).not.toBe('%PDF-');
    expect(raw.includes(Buffer.from('Factura de luz'))).toBe(false);
    expect(raw.subarray(0, 4).toString('ascii')).toBe('PFXE');
    // Un VIEWER descarga el contenido original con su suma (solo por la API).
    const dl = await get(t.viewer, `/documents/${id}/download`);
    expect(dl.status, apiErrors()).toBe(200);
    expect(createHash('sha256').update(dl.bytes).digest('hex')).toBe(sha256Hex(content));
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect(dl.headers.get('content-disposition')).toMatch(
      /^attachment; filename="factura-luz-octubre\.pdf"; filename\*=UTF-8''factura-luz-octubre\.pdf$/u,
    );
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dl.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(dl.headers.get('cache-control')).toBe('private, no-store');
    expect(dl.headers.get('repr-digest')).toBe(`sha-256=:${sha256Base64(content)}:`);
    // TC-DOCUMENTS-ATTACH-019: la descarga queda auditada sin el nombre del archivo.
    const audit = await auditOf(t.editor.ws, `aggregate_id = $1`, [id]);
    expect(audit.map((a) => a.action)).toEqual([
      'documents.document.upload_requested',
      'documents.document.upload_confirmed',
      'documents.document.accepted',
      'documents.document.downloaded',
    ]);
    expect(JSON.stringify(audit)).not.toContain('factura-luz-octubre');
    // TC-DOCUMENTS-ATTACH-021: un único evento de disponibilidad, sin el nombre.
    const events = await outboxOf(t.editor.ws, 'documents.AttachmentUploaded');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      documentId: id,
      contentType: 'application/pdf',
      format: 'PDF',
      sizeBytes: content.length,
      scanStatus: 'NOT_SCANNED',
      purpose: 'RECEIPT',
    });
    expect(JSON.stringify(events[0])).not.toContain('factura-luz');
  });

  it('[TC-DOCUMENTS-ATTACH-004] confirmar sin haber subido: DOCUMENT_UPLOAD_MISSING y el documento sigue pendiente', async () => {
    const t = await team('missing');
    const r = checked(
      'requestDocumentUpload',
      201,
      await requestUpload(t.editor, benignPdf(), 'a.pdf', 'application/pdf'),
    );
    problem(await post(t.editor, `/documents/${r['document'].id}/complete`), 409, 'DOCUMENT_UPLOAD_MISSING');
    expect(checked('getDocument', 200, await get(t.editor, `/documents/${r['document'].id}`))['status']).toBe(
      'PENDING_UPLOAD',
    );
  });

  it('[TC-DOCUMENTS-ATTACH-005] confirmar dos veces devuelve el mismo documento sin segunda verificación', async () => {
    const t = await team('replay');
    const { id } = await uploadAndComplete(t.editor, benignPdf('repetido'));
    const again = checked('completeDocumentUpload', 200, await post(t.editor, `/documents/${id}/complete`));
    expect(again['status']).toBe('AVAILABLE');
    const audit = await auditOf(t.editor.ws, `aggregate_id = $1 AND action = 'documents.document.accepted'`, [
      id,
    ]);
    expect(audit).toHaveLength(1);
    expect(await outboxOf(t.editor.ws, 'documents.AttachmentUploaded')).toHaveLength(1);
  });

  it('[TC-SECURITY-UPLOAD-021] la repetición idempotente de la solicitud no registra otro documento ni consume cuota', async () => {
    const t = await team('idem');
    const content = benignPdf('idempotente');
    const key = randomUUID();
    const body = {
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: content.length,
      sha256: sha256Hex(content),
      purpose: 'RECEIPT',
    };
    const one = await post(t.editor, '/documents/uploads', body, { 'idempotency-key': key });
    const two = await post(t.editor, '/documents/uploads', body, { 'idempotency-key': key });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(two.headers.get('idempotent-replayed')).toBe('true');
    expect(two.body['document'].id).toBe(one.body['document'].id);
    expect(checked('getDocumentStorageUsage', 200, await get(t.editor, '/documents/usage'))).toMatchObject({
      reservedBytes: content.length,
      pendingUploads: 1,
    });
  });

  it('[TC-DOCUMENTS-ATTACH-007] el mismo contenido en el workspace devuelve el documento existente sin URL ni cuota; otro workspace no lo ve', async () => {
    const t = await team('dedup');
    const content = benignPdf('dedupe');
    const { id } = await uploadAndComplete(t.editor, content, 'extracto-oct.pdf');
    const usage = checked('getDocumentStorageUsage', 200, await get(t.editor, '/documents/usage'));
    const again = checked(
      'requestDocumentUpload',
      200,
      await requestUpload(t.editor, content, 'copia-extracto.pdf', 'application/pdf'),
    );
    expect(again).toMatchObject({ deduplicated: true, upload: null });
    expect(again['document'].id).toBe(id);
    expect(checked('getDocumentStorageUsage', 200, await get(t.editor, '/documents/usage'))).toEqual(usage);
    const other = await team('dedup-other');
    const fresh = checked(
      'requestDocumentUpload',
      201,
      await requestUpload(other.editor, content, 'extracto-oct.pdf', 'application/pdf'),
    );
    expect(fresh['deduplicated']).toBe(false);
    expect(fresh['document'].id).not.toBe(id);
  });

  it('[TC-SECURITY-UPLOAD-020] un documento de otro workspace es indistinguible de uno inexistente (404)', async () => {
    const a = await team('iso-a');
    const b = await team('iso-b');
    const { id } = await uploadAndComplete(a.editor, benignPdf('ajeno'));
    const foreign = await call('GET', `${W(b.owner)}/documents/${id}/download`, { token: b.owner.token });
    const missing = await call('GET', `${W(b.owner)}/documents/${randomUUID()}/download`, {
      token: b.owner.token,
    });
    problem(foreign, 404, 'RESOURCE_NOT_FOUND');
    problem(missing, 404, 'RESOURCE_NOT_FOUND');
    expect(foreign.body['detail']).toBe(missing.body['detail']);
    problem(await get(b.owner, `/documents/${id}`), 404, 'RESOURCE_NOT_FOUND');
    expect((checked('listDocuments', 200, await get(b.owner, '/documents')) as any)['data']).toEqual([]);
  });

  it('[TC-DOCUMENTS-ATTACH-008] [TC-DOCUMENTS-ATTACH-009] [TC-DOCUMENTS-ATTACH-013] [TC-DOCUMENTS-ATTACH-026] vincula a elementos reales, rechaza destinos inexistentes o de otro workspace y lista por elemento', async () => {
    const t = await team('links');
    const other = await team('links-other');
    const account = async (u: User) =>
      (
        await post(u, '/accounts', {
          name: `Caja ${randomUUID().slice(0, 6)}`,
          type: 'CASH',
          currency: 'BOB',
          openingBalance: { amount: { amount: '100.00', currency: 'BOB' }, date: '2026-09-01' },
        })
      ).body['id'] as string;
    const acc = await account(t.owner);
    const foreignAcc = await account(other.owner);
    const tx = await post(t.owner, '/transactions', {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-10-05',
      accountId: acc,
      amount: { amount: '150.00', currency: 'BOB' },
      description: 'Supermercado',
    });
    expect(tx.status, tx.text).toBe(201);
    const doc = (await uploadAndComplete(t.editor, benignPdf('ticket'), 'ticket-supermercado.pdf')).id;
    const l1 = checked(
      'linkDocument',
      201,
      await post(t.editor, `/documents/${doc}/links`, { targetType: 'TRANSACTION', targetId: tx.body['id'] }),
    );
    const l2 = await post(t.editor, `/documents/${doc}/links`, {
      targetType: 'TRANSACTION',
      targetId: tx.body['id'],
    });
    expect(l2.status).toBe(200);
    expect(l2.body['id']).toBe(l1['id']);
    checked(
      'linkDocument',
      201,
      await post(t.editor, `/documents/${doc}/links`, { targetType: 'ACCOUNT', targetId: acc }),
    );
    problem(
      await post(t.editor, `/documents/${doc}/links`, { targetType: 'ACCOUNT', targetId: foreignAcc }),
      422,
      'REFERENCE_NOT_FOUND',
    );
    problem(
      await post(t.editor, `/documents/${doc}/links`, { targetType: 'LOAN', targetId: randomUUID() }),
      422,
      'REFERENCE_NOT_FOUND',
    );
    problem(
      await post(t.editor, `/documents/${doc}/links`, { targetType: 'CONVERSION', targetId: tx.body['id'] }),
      422,
      'REFERENCE_NOT_FOUND',
    );
    // VIEWER no adjunta.
    problem(
      await post(t.viewer, `/documents/${doc}/links`, { targetType: 'ACCOUNT', targetId: acc }),
      403,
      'INSUFFICIENT_ROLE',
    );
    // Un VIEWER ve los adjuntos del gasto.
    const onTx = checked(
      'listDocuments',
      200,
      await get(t.viewer, `/documents?targetType=TRANSACTION&targetId=${tx.body['id']}`),
    );
    expect((onTx as any)['data'].map((d: any) => d.originalName)).toEqual(['ticket-supermercado.pdf']);
    expect((onTx as any)['data'][0].links).toHaveLength(2);
    // Desvincular conserva el documento.
    const unlink = await call('DELETE', `${W(t.editor)}/documents/${doc}/links/${l1['id']}`, {
      token: t.editor.token,
    });
    expect(unlink.status).toBe(204);
    expect(checked('getDocument', 200, await get(t.editor, `/documents/${doc}`))['links']).toHaveLength(1);
    // El recorrido muestra las transiciones y las anotaciones de vínculo (TC-DOCUMENTS-ATTACH-026).
    const lifecycle = checked(
      'getDocumentLifecycle',
      200,
      await get(t.viewer, `/documents/${doc}/lifecycle`),
    );
    const items = (lifecycle as any)['items'] as any[];
    expect(items.filter((i) => i.kind === 'TRANSITION').map((i) => i.transition)).toEqual([
      'REQUEST_UPLOAD',
      'CONFIRM',
      'ACCEPT',
    ]);
    expect((lifecycle as any)['path']).toEqual(['PENDING_UPLOAD', 'UPLOADED', 'AVAILABLE']);
    // Vincular y desvincular son anotaciones del recorrido.
    expect(items.filter((i) => i.kind === 'ANNOTATION').length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(lifecycle)).not.toContain('ticket-supermercado');
  });

  it('[TC-DOCUMENTS-ATTACH-016] [TC-DOCUMENTS-ATTACH-017] archivar y eliminar: archivados fuera del listado, sigue descargable; eliminar destruye la clave y libera la cuota', async () => {
    const t = await team('del');
    const content = benignPdf('contrato');
    const { id } = await uploadAndComplete(
      t.editor,
      content,
      'contrato-alquiler-2025.pdf',
      'application/pdf',
      'CONTRACT',
    );
    const doc = await get(t.editor, `/documents/${id}`);
    const archived = checked(
      'archiveDocument',
      200,
      await call('POST', `${W(t.editor)}/documents/${id}/archive`, {
        token: t.editor.token,
        headers: { 'if-match': doc.headers.get('etag')! },
      }),
    );
    expect(archived['archivedAt']).not.toBeNull();
    expect((checked('listDocuments', 200, await get(t.editor, '/documents')) as any)['data']).toEqual([]);
    expect(
      (checked('listDocuments', 200, await get(t.editor, '/documents?archived=only')) as any)['data'],
    ).toHaveLength(1);
    expect((await get(t.viewer, `/documents/${id}/download`)).status).toBe(200);
    // If-Match obsoleto ⇒ 412.
    problem(
      await call('POST', `${W(t.editor)}/documents/${id}/unarchive`, {
        token: t.editor.token,
        headers: { 'if-match': '"1"' },
      }),
      412,
      'PRECONDITION_FAILED',
    );
    const unarchived = checked(
      'unarchiveDocument',
      200,
      await call('POST', `${W(t.editor)}/documents/${id}/unarchive`, {
        token: t.editor.token,
        headers: { 'if-match': `"${archived['version']}"` },
      }),
    );
    expect(unarchived['archivedAt']).toBeNull();
    // Eliminar.
    const usageBefore = checked('getDocumentStorageUsage', 200, await get(t.editor, '/documents/usage'));
    expect(usageBefore['usedBytes']).toBe(content.length);
    const del = await call('DELETE', `${W(t.editor)}/documents/${id}`, {
      token: t.editor.token,
      headers: { 'if-match': `"${unarchived['version']}"` },
    });
    expect(del.status, del.text).toBe(204);
    expect(
      checked('getDocumentStorageUsage', 200, await get(t.editor, '/documents/usage'))['usedBytes'],
    ).toBe(0);
    expect(await objects(deps.bucket).then((ks) => ks.filter((k) => k.endsWith(id)))).toEqual([]);
    const gone = await get(t.viewer, `/documents/${id}/download`);
    problem(gone, 410, 'DOCUMENT_DELETED');
    // La clave de datos envuelta se destruyó en la base (los metadatos se conservan).
    const client = await worker.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
        [t.editor.ws],
      );
      const { rows } = await client.query(
        `SELECT status, key_id, wrapped_key FROM documents.document WHERE id = $1`,
        [id],
      );
      await client.query('COMMIT');
      expect(rows[0]).toEqual({ status: 'DELETED', key_id: null, wrapped_key: null });
    } finally {
      client.release();
    }
    problem(
      await post(t.editor, `/documents/${id}/links`, { targetType: 'ACCOUNT', targetId: randomUUID() }),
      410,
      'DOCUMENT_DELETED',
    );
  });

  it('[TC-SECURITY-UPLOAD-016] un byte alterado en el objeto cifrado: DOCUMENT_CONTENT_CORRUPTED y ningún byte del bloque alterado', async () => {
    const t = await team('tamper');
    const content = Buffer.concat([benignPdf('integridad'), Buffer.alloc(200_000, 0x41)]);
    const { id } = await uploadAndComplete(t.editor, content);
    const key = `ws/${t.editor.ws}/documents/${id}`;
    const stored = Buffer.concat(await collect(await store.get(deps.bucket, key)));
    stored[40] = (stored[40] as number) ^ 0xff;
    await store.put(deps.bucket, key, stored);
    const dl = await get(t.viewer, `/documents/${id}/download`);
    problem(dl, 422, 'DOCUMENT_CONTENT_CORRUPTED');
    expect(dl.bytes.includes(Buffer.from('%PDF-'))).toBe(false);
  });

  it('[TC-SECURITY-UPLOAD-018] dos solicitudes concurrentes por el último espacio: exactamente una se registra', async () => {
    const t = await team('quota');
    await setUsage(t.owner, { used: 5_368_709_120 - 1_500_000 });
    const mk = (n: number) =>
      post(t.editor, '/documents/uploads', {
        fileName: `grande-${n}.csv`,
        contentType: 'text/csv',
        sizeBytes: 1_000_000,
        sha256: createHash('sha256').update(`doc-${n}-${t.owner.ws}`).digest('hex'),
        purpose: 'OTHER',
      });
    const [a, b] = await Promise.all([mk(1), mk(2)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses, `${a.text} ${b.text}`).toEqual([201, 422]);
    const loser = a.status === 422 ? a : b;
    expect(loser.body['code']).toBe('DOCUMENT_QUOTA_EXCEEDED');
    const usage = checked('getDocumentStorageUsage', 200, await get(t.viewer, '/documents/usage'));
    expect(usage['reservedBytes']).toBe(1_000_000);
  });

  it('[TC-SECURITY-UPLOAD-018] cuota agotada y subidas pendientes al máximo', async () => {
    const t = await team('quota2');
    await setUsage(t.owner, { used: 5_368_000_000 });
    const big = await post(t.editor, '/documents/uploads', {
      fileName: 'a.csv',
      contentType: 'text/csv',
      sizeBytes: 1_000_000,
      sha256: 'a'.repeat(64),
      purpose: 'OTHER',
    });
    problem(big, 422, 'DOCUMENT_QUOTA_EXCEEDED');
    expect(
      checked('listDocuments', 200, await get(t.viewer, '/documents?status=PENDING_UPLOAD'))['data'],
    ).toEqual([]);
    const full = await team('pending-max');
    await setUsage(full.owner, { pending: 20 });
    problem(
      await post(full.editor, '/documents/uploads', {
        fileName: 'b.csv',
        contentType: 'text/csv',
        sizeBytes: 10,
        sha256: 'b'.repeat(64),
        purpose: 'OTHER',
      }),
      409,
      'DOCUMENT_PENDING_UPLOADS_EXCEEDED',
    );
  });

  it('[TC-SECURITY-UPLOAD-001] [TC-SECURITY-UPLOAD-003] tipos no permitidos y tamaño excedido se rechazan en la solicitud sin registrar nada', async () => {
    const t = await team('policy');
    problem(
      await post(t.editor, '/documents/uploads', {
        fileName: 'logo.svg',
        contentType: 'image/svg+xml',
        sizeBytes: 100,
        sha256: 'c'.repeat(64),
        purpose: 'OTHER',
      }),
      422,
      'UPLOAD_TYPE_NOT_ALLOWED',
    );
    problem(
      await post(t.editor, '/documents/uploads', {
        fileName: 'extracto.pdf',
        contentType: 'text/html',
        sizeBytes: 100,
        sha256: 'c'.repeat(64),
        purpose: 'OTHER',
      }),
      422,
      'UPLOAD_TYPE_NOT_ALLOWED',
    );
    problem(
      await post(t.editor, '/documents/uploads', {
        fileName: 'c.pdf',
        contentType: 'application/pdf',
        sizeBytes: 15_728_641,
        sha256: 'c'.repeat(64),
        purpose: 'RECEIPT',
      }),
      413,
      'UPLOAD_TOO_LARGE',
    );
    const ok19 = await post(t.editor, '/documents/uploads', {
      fileName: 'extracto.csv',
      contentType: 'text/csv',
      sizeBytes: 19_922_944,
      sha256: 'd'.repeat(64),
      purpose: 'IMPORT_SOURCE',
    });
    expect(ok19.status, ok19.text).toBe(201);
    problem(
      await post(t.editor, '/documents/uploads', {
        fileName: 'vacio.csv',
        contentType: 'text/csv',
        sizeBytes: 0,
        sha256: 'e'.repeat(64),
        purpose: 'OTHER',
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('[TC-SECURITY-UPLOAD-013] un archivo rechazado queda REJECTED, sin cuarentena ni objeto, con su evento y la reserva liberada', async () => {
    const t = await team('reject');
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(40),
    ]);
    const { done, id } = await uploadAndComplete(t.editor, png, 'factura.pdf', 'application/pdf');
    const doc = checked('completeDocumentUpload', 200, done);
    expect(doc).toMatchObject({ status: 'REJECTED', rejectionReason: 'TYPE_MISMATCH', detectedFormat: null });
    expect((await objects(deps.quarantineBucket)).filter((k) => k.includes(id))).toEqual([]);
    expect((await objects(deps.bucket)).filter((k) => k.includes(id))).toEqual([]);
    problem(await get(t.viewer, `/documents/${id}/download`), 409, 'DOCUMENT_REJECTED');
    problem(
      await post(t.editor, `/documents/${id}/links`, { targetType: 'ACCOUNT', targetId: randomUUID() }),
      409,
      'DOCUMENT_REJECTED',
    );
    expect(checked('getDocumentStorageUsage', 200, await get(t.viewer, '/documents/usage'))).toMatchObject({
      reservedBytes: 0,
      usedBytes: 0,
      pendingUploads: 0,
    });
    const events = await outboxOf(t.editor.ws, 'documents.DocumentRejected');
    expect(events.map((e) => e.payload)).toEqual([
      { documentId: id, purpose: 'RECEIPT', reason: 'TYPE_MISMATCH' },
    ]);
  });

  it('[TC-SECURITY-UPLOAD-014] el nombre con datos personales no llega a claves de objeto, auditoría ni logs', async () => {
    const t = await team('pii');
    const { id } = await uploadAndComplete(t.editor, benignPdf('pii'), 'Extracto Juan Perez CI 1234567.pdf');
    const keys = [...(await objects(deps.bucket)), ...(await objects(deps.quarantineBucket))].filter((k) =>
      k.includes(id),
    );
    expect(keys.join('|')).not.toMatch(/Juan|Perez|1234567/u);
    const audit = await auditOf(t.editor.ws, `aggregate_id = $1`, [id]);
    expect(JSON.stringify(audit)).not.toMatch(/Juan|Perez|1234567/u);
    expect(JSON.stringify(apiLog.records())).not.toMatch(/Juan|Perez|1234567/u);
    const doc = checked('getDocument', 200, await get(t.viewer, `/documents/${id}`));
    expect(doc['originalName']).toBe('Extracto Juan Perez CI 1234567.pdf');
  });

  it('[TC-SECURITY-UPLOAD-014] un nombre con ruta y caracteres de control se guarda normalizado', async () => {
    const t = await team('names');
    const content = benignPdf('ruta');
    const r = await post(t.editor, '/documents/uploads', {
      fileName: '..\\..\\windows\\factura\n.pdf',
      contentType: 'application/pdf',
      sizeBytes: content.length,
      sha256: sha256Hex(content),
      purpose: 'RECEIPT',
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body['document'].originalName).toBe('factura.pdf');
  });

  it('[TC-SECURITY-UPLOAD-015] un nombre con comillas y punto y coma va codificado y la respuesta no lleva cabeceras extra', async () => {
    const t = await team('hdr');
    const { id } = await uploadAndComplete(t.editor, benignPdf('cabecera'), 'recibo";x=y.pdf');
    const dl = await get(t.viewer, `/documents/${id}/download`);
    expect(dl.status).toBe(200);
    const header = dl.headers.get('content-disposition')!;
    expect(header).not.toMatch(/[\r\n]/u);
    expect(/filename="([^"]*)"/u.exec(header)![1]).not.toMatch(/["\\;]/u);
    // Las comillas se eliminan al normalizar el nombre; el punto y coma queda codificado.
    expect(header).toContain("filename*=UTF-8''recibo%3Bx%3Dy.pdf");
    expect(dl.headers.get('x-evil')).toBeNull();
  });
});

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return chunks;
}
