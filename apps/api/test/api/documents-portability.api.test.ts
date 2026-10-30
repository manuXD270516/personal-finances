import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { ZipReader } from '@pf/identity/interface/identity.module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { benignPdf } from '../support/malicious-files.js';
import {
  asAdmin,
  buildMini,
  downloadExport,
  exportAndWait,
  importAndWait,
  money,
  s3Client,
  startHarness,
  until,
  uploadForm,
  w1Api,
  type Harness,
  type Json,
  type Mini,
  type User,
} from '../support/portability.js';

// Documentos y adjuntos en el export del workspace (openspec add-document-attachments, tarea 8.1; TC-DOCUMENTS-ATTACH-023):
// ida y vuelta de metadatos y vínculos con identificadores nuevos, documentos disponibles que quedan con contenido
// pendiente de restaurar, eliminado que sigue eliminado, y un export sin claves de datos, claves envueltas ni claves de
// objeto.
let h: Harness;
let m: Mini;

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  h = await startHarness({ worker: true });
  m = await buildMini(h, 'docs');
}, 180_000);

afterAll(async () => {
  await h?.close();
});

/** Sube y confirma un documento por la API real (PUT directo a la cuarentena de SeaweedFS). */
async function uploadDocument(u: User, ws: string, name: string, content: Buffer): Promise<string> {
  const requested = await h.call('POST', `/api/v1/workspaces/${ws}/documents/uploads`, {
    token: u.token,
    headers: { 'idempotency-key': randomUUID() },
    body: {
      fileName: name,
      contentType: 'application/pdf',
      sizeBytes: content.length,
      sha256: sha(content),
      purpose: 'RECEIPT',
    },
  });
  expect(requested.status, JSON.stringify(requested.body)).toBe(201);
  const upload = requested.body['upload'] as { url: string; headers: Record<string, string> };
  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
  expect(put.status).toBe(200);
  const id = (requested.body['document'] as { id: string }).id;
  const done = await h.call('POST', `/api/v1/workspaces/${ws}/documents/${id}/complete`, { token: u.token });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  expect(done.body['status']).toBe('AVAILABLE');
  return id;
}

describe('documentos en el export y la importación del workspace (identity/workspace-portability)', () => {
  it('[TC-DOCUMENTS-ATTACH-023] ida y vuelta: metadatos y vínculos con ids nuevos, contenido pendiente, eliminado conservado y sin claves en el export', async () => {
    const api = w1Api(h, m);
    const expense = (
      await api.post(m.owner, '/transactions', {
        kind: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-10-05',
        accountId: m.bank,
        amount: money('150.00'),
        description: 'Supermercado',
      })
    ).body['id'] as string;
    const expense2 = (
      await api.post(m.owner, '/transactions', {
        kind: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-10-06',
        accountId: m.bank,
        amount: money('35.50'),
        description: 'Kiosco',
      })
    ).body['id'] as string;
    const files = [
      { name: 'ticket-supermercado.pdf', content: benignPdf('ticket') },
      { name: 'garantia.pdf', content: benignPdf('garantia') },
      { name: 'recibo.pdf', content: benignPdf('recibo') },
      { name: 'borrado.pdf', content: benignPdf('borrado') },
    ];
    const ids: string[] = [];
    for (const f of files) ids.push(await uploadDocument(m.editor, m.ws, f.name, f.content));
    const link = async (doc: string, targetType: string, targetId: string) =>
      expect((await api.post(m.editor, `/documents/${doc}/links`, { targetType, targetId })).status).toBe(
        201,
      );
    await link(ids[0]!, 'TRANSACTION', expense);
    await link(ids[0]!, 'TRANSACTION', expense2);
    await link(ids[1]!, 'TRANSACTION', expense);
    await link(ids[2]!, 'ACCOUNT', m.bank);
    // El cuarto documento se elimina (conserva sus metadatos, sin clave).
    const doc4 = await api.get(m.owner, `/documents/${ids[3]!}`);
    const del = await h.call('DELETE', `/api/v1/workspaces/${m.ws}/documents/${ids[3]!}`, {
      token: m.owner.token,
      headers: { 'if-match': doc4.headers.get('etag')! },
    });
    expect(del.status).toBe(204);

    // Exporta y revisa el contenido del ZIP.
    const exported = await exportAndWait(h, m.owner, m.ws);
    const file = await downloadExport(h, m.owner, m.ws, exported['id'] as string);
    expect(file.status).toBe(200);
    const reader = ZipReader.open(file.raw);
    const docsJsonl = reader.read('json/documents.jsonl').toString('utf8');
    const linksJsonl = reader.read('json/attachment-links.jsonl').toString('utf8');
    const docRows = docsJsonl
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Json);
    expect(docRows).toHaveLength(4);
    expect(docRows.map((r) => r['status']).sort()).toEqual([
      'AVAILABLE',
      'AVAILABLE',
      'AVAILABLE',
      'DELETED',
    ]);
    expect(linksJsonl.split('\n').filter(Boolean)).toHaveLength(4);
    // Sin claves de datos, claves envueltas, identificadores de clave maestra ni claves de objeto.
    const everything = reader
      .names()
      .map((n) => reader.read(n).toString('latin1'))
      .join('\n');
    for (const forbidden of ['wrapped_key', 'key_id', 'object_key', 'quarantine_key', 'envelope_version']) {
      expect(docsJsonl).not.toContain(forbidden);
      expect(linksJsonl).not.toContain(forbidden);
    }
    expect(everything).not.toContain('ws/' + m.ws + '/documents/');
    expect(docRows.find((r) => r['original_name'] === 'ticket-supermercado.pdf')).toMatchObject({
      size_bytes: String(files[0]!.content.length),
      purpose: 'RECEIPT',
    });

    // Importa: un workspace nuevo con los 4 documentos, contenido pendiente, y los vínculos apuntando a las copias.
    const done = await importAndWait(h, m.owner, file.raw);
    expect(done['status'], JSON.stringify(done)).toBe('SUCCEEDED');
    const ws2 = done['workspaceId'] as string;
    expect(ws2).toBeTruthy();
    expect(ws2).not.toBe(m.ws);
    const list = await h.call('GET', `/api/v1/workspaces/${ws2}/documents?status=CONTENT_PENDING`, {
      token: m.owner.token,
    });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const pending = list.body['data'] as {
      id: string;
      originalName: string;
      sizeBytes: number;
      sha256: string;
      status: string;
      links: unknown[];
    }[];
    expect(pending.map((d) => d.originalName).sort()).toEqual([
      'garantia.pdf',
      'recibo.pdf',
      'ticket-supermercado.pdf',
    ]);
    const ticket = pending.find((d) => d.originalName === 'ticket-supermercado.pdf')!;
    expect(ticket).toMatchObject({
      sizeBytes: files[0]!.content.length,
      sha256: sha(files[0]!.content),
      status: 'CONTENT_PENDING',
    });
    expect(ticket.id).not.toBe(ids[0]);
    expect(ticket.links).toHaveLength(2);
    // El borrado sigue eliminado.
    const deleted = await h.call('GET', `/api/v1/workspaces/${ws2}/documents?status=DELETED`, {
      token: m.owner.token,
    });
    expect((deleted.body['data'] as { originalName: string }[]).map((d) => d.originalName)).toEqual([
      'borrado.pdf',
    ]);
    // Los vínculos apuntan a las COPIAS de los gastos y de la cuenta (ids distintos, existentes en el workspace nuevo).
    const targets = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ target_type: string; exists: boolean }>(
            `SELECT l.target_type,
                  CASE l.target_type
                    WHEN 'TRANSACTION' THEN EXISTS (SELECT 1 FROM txn.transaction t WHERE t.id = l.target_id AND t.workspace_id = l.workspace_id)
                    WHEN 'ACCOUNT' THEN EXISTS (SELECT 1 FROM accounts.account a WHERE a.id = l.target_id AND a.workspace_id = l.workspace_id)
                  END AS exists
             FROM documents.attachment_link l WHERE l.workspace_id = $1`,
            [ws2],
          )
        ).rows,
    );
    expect(targets).toHaveLength(4);
    expect(targets.every((t) => t.exists)).toBe(true);
    const oldTargets = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ n: string }>(
            `SELECT count(*) AS n FROM documents.attachment_link WHERE workspace_id = $1 AND target_id = ANY($2::uuid[])`,
            [ws2, [expense, expense2, m.bank]],
          )
        ).rows[0]!.n,
    );
    expect(Number(oldTargets)).toBe(0);
    // Cuota recalculada: los CONTENT_PENDING cuentan como usados.
    const usage = await h.call('GET', `/api/v1/workspaces/${ws2}/documents/usage`, { token: m.owner.token });
    expect(usage.body['usedBytes']).toBe(files.slice(0, 3).reduce((s, f) => s + f.content.length, 0));
    expect(usage.body['pendingUploads']).toBe(0);
    // Un documento con contenido pendiente no se descarga ni se adjunta hasta restaurar su contenido.
    const dl = await h.call('GET', `/api/v1/workspaces/${ws2}/documents/${ticket.id}/download`, {
      token: m.owner.token,
    });
    expect(dl.status).toBe(409);
    expect(dl.body['code']).toBe('DOCUMENT_NOT_AVAILABLE');
    const relink = await h.call('POST', `/api/v1/workspaces/${ws2}/documents/${ticket.id}/links`, {
      token: m.owner.token,
      headers: { 'idempotency-key': randomUUID() },
      body: { targetType: 'ACCOUNT', targetId: randomUUID() },
    });
    expect(relink.status).toBe(409);
    expect(relink.body['code']).toBe('DOCUMENT_NOT_AVAILABLE');
  }, 240_000);
});

// Archivo de contenidos del export y su restauración (tareas 8.2 y 8.3; TC-DOCUMENTS-ATTACH-024 y -025).
describe('archivo de contenidos de documentos del export (identity/workspace-portability)', () => {
  const FILES = [
    { name: 'ticket-supermercado.pdf', content: benignPdf('contenido ticket') },
    { name: 'garantia.pdf', content: benignPdf('contenido garantia') },
    { name: 'recibo.pdf', content: benignPdf('contenido recibo') },
  ];

  /** Workspace con 3 documentos disponibles, su export con contenidos y el ZIP principal. */
  async function scenario(label: string) {
    const mini = await buildMini(h, label);
    const ids: string[] = [];
    for (const f of FILES) ids.push(await uploadDocument(mini.editor, mini.ws, f.name, f.content));
    const exported = await exportAndWait(h, mini.owner, mini.ws, { includeDocumentContents: true });
    const main = await downloadExport(h, mini.owner, mini.ws, exported['id'] as string);
    const contents = await h.call(
      'GET',
      `/api/v1/workspaces/${mini.ws}/exports/${exported['id'] as string}/document-contents/download`,
      { token: mini.owner.token },
    );
    return { mini, ids, exported, main, contents };
  }

  async function importMain(owner: User, zip: Buffer): Promise<{ ws: string; pending: Json[] }> {
    const done = await importAndWait(h, owner, zip);
    expect(done['status'], JSON.stringify(done)).toBe('SUCCEEDED');
    const ws = done['workspaceId'] as string;
    const list = await h.call('GET', `/api/v1/workspaces/${ws}/documents?status=CONTENT_PENDING`, {
      token: owner.token,
    });
    return { ws, pending: list.body['data'] as Json[] };
  }

  async function restore(owner: User, ws: string, zip: Buffer, key: string = randomUUID()) {
    return h.call('POST', `/api/v1/workspaces/${ws}/documents/content-restores`, {
      token: owner.token,
      form: uploadForm(zip, 'documentos.zip'),
      headers: { 'idempotency-key': key },
    });
  }

  async function restoreAndWait(owner: User, ws: string, zip: Buffer, key?: string): Promise<Json> {
    const accepted = await restore(owner, ws, zip, key);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(202);
    expect(accepted.headers.get('location')).toBe(
      `/api/v1/workspaces/${ws}/operations/${accepted.body['id'] as string}`,
    );
    return until(async () => {
      const op = await h.call('GET', `/api/v1/workspaces/${ws}/operations/${accepted.body['id'] as string}`, {
        token: owner.token,
      });
      return op.body['status'] === 'SUCCEEDED' || op.body['status'] === 'FAILED' ? op.body : undefined;
    });
  }

  it('[TC-DOCUMENTS-ATTACH-024] el export con contenidos guarda un archivo APARTE cifrado, descargable con reauth, y el ZIP principal no lleva binarios', async () => {
    const { mini, exported, main, contents } = await scenario('contents-export');
    expect(exported['documentContents']).toMatchObject({ count: 3 });
    expect(main.status).toBe(200);
    expect(contents.status, JSON.stringify(contents.body)).toBe(200);
    expect(contents.headers.get('content-type')).toContain('application/zip');
    expect(contents.headers.get('repr-digest')).toBe(
      `sha-256=:${Buffer.from((exported['documentContents'] as { sha256: string }).sha256, 'hex').toString('base64')}:`,
    );
    const reader = ZipReader.open(contents.raw);
    expect(reader.names()).toHaveLength(4);
    expect(reader.has('documents-manifest.json')).toBe(true);
    // Los binarios están en el archivo de contenidos y NO en el ZIP principal.
    const mainReader = ZipReader.open(main.raw);
    const mainBytes = mainReader.names().map((n) => mainReader.read(n));
    for (const f of FILES) {
      expect(mainBytes.some((b) => b.includes(f.content.subarray(0, 40)))).toBe(false);
    }
    const bodies = reader
      .names()
      .filter((n) => n.startsWith('documents/'))
      .map((n) => reader.read(n));
    for (const f of FILES) expect(bodies.some((b) => b.equals(f.content))).toBe(true);
    // El objeto almacenado es el sobre cifrado (PFXE), nunca el ZIP en claro.
    const stored = await s3Client(h.deps).send(
      new GetObjectCommand({
        Bucket: h.deps.exportsBucket,
        Key: `exports/${mini.ws}/${exported['id'] as string}.documents.pfxe`,
      }),
    );
    const raw = Buffer.from(await stored.Body!.transformToByteArray());
    expect(raw.subarray(0, 4).toString('ascii')).toBe('PFXE');
    expect(raw.includes(FILES[0]!.content.subarray(0, 40))).toBe(false);
    // Mismos requisitos que el export: autenticación reciente y rol OWNER; sin contenidos pedidos ⇒ 404.
    const url = `/api/v1/workspaces/${mini.ws}/exports/${exported['id'] as string}/document-contents/download`;
    const reauth = await h.call('GET', url, { token: await h.token(mini.owner.sub, 3600) });
    expect(reauth.status).toBe(403);
    expect(reauth.body['code']).toBe('REAUTHENTICATION_REQUIRED');
    expect((await h.call('GET', url, { token: mini.editor.token })).status).toBe(403);
    const plain = await exportAndWait(h, mini.owner, mini.ws);
    expect(plain['documentContents']).toBeNull();
    const none = await h.call(
      'GET',
      `/api/v1/workspaces/${mini.ws}/exports/${plain['id'] as string}/document-contents/download`,
      { token: mini.owner.token },
    );
    expect(none.status).toBe(404);
  }, 240_000);

  it('[TC-DOCUMENTS-ATTACH-024] restaurar deja los 3 documentos disponibles con sus sumas originales y repetirlo no crea nada', async () => {
    const { mini, main, contents } = await scenario('contents-restore');
    const { ws, pending } = await importMain(mini.owner, main.raw);
    expect(pending).toHaveLength(3);
    const result = await restoreAndWait(mini.owner, ws, contents.raw);
    expect(result['status'], JSON.stringify(result)).toBe('SUCCEEDED');
    expect(result['kind']).toBe('DOCUMENT_CONTENTS_RESTORE');
    expect(result['result']).toMatchObject({ restored: 3, alreadyAvailable: 0, mismatched: [], absent: [] });
    const available = await h.call('GET', `/api/v1/workspaces/${ws}/documents?status=AVAILABLE`, {
      token: mini.owner.token,
    });
    const docs = available.body['data'] as { id: string; originalName: string; sha256: string }[];
    expect(docs.map((d) => d.originalName).sort()).toEqual(FILES.map((f) => f.name).sort());
    for (const f of FILES) {
      const doc = docs.find((d) => d.originalName === f.name)!;
      expect(doc.sha256).toBe(sha(f.content));
      const dl = await h.call('GET', `/api/v1/workspaces/${ws}/documents/${doc.id}/download`, {
        token: mini.owner.token,
      });
      expect(dl.status).toBe(200);
      expect(dl.raw.equals(f.content)).toBe(true);
    }
    const snapshot = () =>
      asAdmin(
        h,
        async (c) =>
          (
            await c.query(
              `SELECT id, status, version, object_key, encode(wrapped_key, 'hex') AS wk
               FROM documents.document WHERE workspace_id = $1 ORDER BY id`,
              [ws],
            )
          ).rows,
      );
    const before = await snapshot();
    expect(before.every((r) => r['status'] === 'AVAILABLE' && r['object_key'] && r['wk'])).toBe(true);
    // Segunda restauración (otra clave): idempotente, sin objetos ni registros nuevos.
    const again = await restoreAndWait(mini.owner, ws, contents.raw);
    expect(again['result']).toMatchObject({ restored: 0, alreadyAvailable: 3, mismatched: [], absent: [] });
    expect(await snapshot()).toEqual(before);
    // La misma clave de idempotencia con el mismo archivo repite la respuesta; con otro archivo ⇒ 422.
    const key = randomUUID();
    const first = await restore(mini.owner, ws, contents.raw, key);
    const replay = await restore(mini.owner, ws, contents.raw, key);
    expect(replay.status).toBe(202);
    expect(replay.body['id']).toBe(first.body['id']);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    const reused = await restore(mini.owner, ws, Buffer.from(main.raw), key);
    expect(reused.status).toBe(422);
    expect(reused.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  }, 300_000);

  it('[TC-DOCUMENTS-ATTACH-025] un contenido alterado en el archivo deja ese documento pendiente y se informa con CHECKSUM_MISMATCH', async () => {
    const { mini, main, contents } = await scenario('contents-tamper');
    const { ws, pending } = await importMain(mini.owner, main.raw);
    // Altera UN contenido (y recalcula el CRC de su entrada para que el ZIP siga siendo válido).
    const reader = ZipReader.open(contents.raw);
    const target = reader.names().find((n) => n.startsWith('documents/'))!;
    const original = reader.read(target);
    const tampered = Buffer.from(contents.raw);
    const nameAt = tampered.indexOf(Buffer.from(target));
    const dataAt = nameAt + Buffer.byteLength(target);
    tampered[dataAt + 12] = (tampered[dataAt + 12] ?? 0) ^ 0x01;
    tampered.writeUInt32LE(crc32(tampered.subarray(dataAt, dataAt + original.length)), nameAt - 30 + 14);
    const expectedPending = pending.find((d) => d['sha256'] === sha(original))!;
    const result = await restoreAndWait(mini.owner, ws, tampered);
    expect(result['status'], JSON.stringify(result)).toBe('SUCCEEDED');
    expect(result['result']).toMatchObject({
      restored: 2,
      mismatched: [{ documentId: expectedPending['id'], reason: 'CHECKSUM_MISMATCH' }],
      absent: [],
    });
    const statuses = await asAdmin(
      h,
      async (c) =>
        (
          await c.query<{ id: string; status: string }>(
            `SELECT id, status FROM documents.document WHERE workspace_id = $1`,
            [ws],
          )
        ).rows,
    );
    expect(statuses.filter((r) => r.status === 'AVAILABLE')).toHaveLength(2);
    expect(statuses.find((r) => r.id === expectedPending['id'])?.status).toBe('CONTENT_PENDING');
  }, 300_000);

  it('[TC-DOCUMENTS-ATTACH-025] un archivo que no es de contenidos, un EDITOR y una autenticación vieja se rechazan sin dejar nada', async () => {
    const { mini, main, contents } = await scenario('contents-reject');
    const { ws } = await importMain(mini.owner, main.raw);
    // No es un archivo de contenidos (ni siquiera un ZIP) ⇒ 422 al subirlo.
    const junk = await restore(mini.owner, ws, Buffer.from('esto no es un zip'));
    expect(junk.status).toBe(422);
    expect(junk.body['code']).toBe('EXPORT_FORMAT_UNSUPPORTED');
    // El export principal arranca como ZIP pero usa compresión (no es un archivo de contenidos) ⇒ la operación falla.
    const wrong = await restoreAndWait(mini.owner, ws, main.raw);
    expect(wrong['status']).toBe('FAILED');
    expect(wrong['error']).toMatchObject({ code: 'EXPORT_FILE_CORRUPTED' });
    // EDITOR ⇒ 403; autenticación vieja ⇒ 403 REAUTHENTICATION_REQUIRED; sin Idempotency-Key ⇒ 428.
    expect((await restore(mini.editor, ws, contents.raw)).status).toBe(403);
    const stale = await restore(
      { ...mini.owner, token: await h.token(mini.owner.sub, 3600) },
      ws,
      contents.raw,
    );
    expect(stale.status).toBe(403);
    expect(stale.body['code']).toBe('REAUTHENTICATION_REQUIRED');
    const noKey = await h.call('POST', `/api/v1/workspaces/${ws}/documents/content-restores`, {
      token: mini.owner.token,
      form: uploadForm(contents.raw, 'documentos.zip'),
    });
    expect(noKey.status).toBe(428);
    // Ningún rechazo dejó el archivo subido en la cuarentena.
    const left = await s3Client(h.deps).send(
      new ListObjectsV2Command({ Bucket: h.deps.quarantineBucket, Prefix: `ws/${ws}/restores/` }),
    );
    expect(left.KeyCount ?? 0).toBe(0);
  }, 300_000);
});
