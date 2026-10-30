import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readArchive } from './contents-archive.js';
import { ContentsService } from './contents.service.js';
import { DownloadService } from './download.service.js';
import type { DocumentState } from '../domain/document.js';
import { EDITOR, InMemoryWorld, WORKSPACE } from './testing/in-memory.js';
import { UploadsService } from './uploads.service.js';

// Archivo de contenidos del export y su restauración (openspec add-document-attachments, tareas 8.2 y 8.3;
// TC-DOCUMENTS-ATTACH-024 y -025). Un mundo en memoria exporta; otro, con los mismos documentos como «contenido
// pendiente» (lo que deja el import), restaura.
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const bytes = (label: string, size = 400): Buffer =>
  Buffer.concat([Buffer.from(`${label}\n`), Buffer.alloc(size, 7)]);

async function seedAvailable(world: InMemoryWorld, items: readonly { name: string; content: Buffer }[]) {
  const uploads = new UploadsService(world.deps);
  const ids: string[] = [];
  for (const { name, content } of items) {
    const r = await uploads.requestUpload({
      workspaceId: WORKSPACE,
      userId: EDITOR,
      fileName: name,
      contentType: 'application/pdf',
      sizeBytes: content.length,
      sha256: sha(content),
      purpose: 'RECEIPT',
    });
    world.uploadToQuarantine(WORKSPACE, r.document.id, content);
    ids.push((await uploads.completeUpload({ workspaceId: WORKSPACE, documentId: r.document.id })).id);
  }
  return ids;
}

/** Lo que deja la importación: mismos metadatos y sumas, ids nuevos, `CONTENT_PENDING` y sin material de cifrado. */
function seedPending(world: InMemoryWorld, source: InMemoryWorld, sourceIds: readonly string[]): string[] {
  const out: string[] = [];
  sourceIds.forEach((id, i) => {
    const s = source.documents.get(id) as DocumentState;
    const newId = `0193a000-0000-7000-8000-00000000f${String(i).padStart(3, '0')}`;
    world.documents.set(newId, {
      ...s,
      id: newId,
      status: 'CONTENT_PENDING',
      objectKey: null,
      keyId: null,
      wrappedKey: null,
      encryptedSizeBytes: null,
      envelopeVersion: null,
      version: 1,
    });
    out.push(newId);
  });
  return out;
}

async function exportAll(world: InMemoryWorld): Promise<Buffer> {
  const { stream } = await new ContentsService(world.deps).open(WORKSPACE);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function restoreWith(world: InMemoryWorld, zip: Buffer) {
  const contents = new ContentsService(world.deps);
  const staged = await contents.stageUpload(WORKSPACE, Readable.from([zip]));
  await contents.requestRestore({ workspaceId: WORKSPACE, userId: EDITOR, staged });
  const job = world.restoreJobsQueued.at(-1)!;
  const result = await contents.runRestore(job);
  return { staged, job, result, operation: world.operations.get(job.operationId)! };
}

const CONTENTS = [
  { name: 'factura-luz.pdf', content: bytes('luz') },
  { name: 'ticket-super.pdf', content: bytes('super', 900) },
  { name: 'garantia.pdf', content: bytes('garantia', 1500) },
];

async function scenario() {
  const origin = new InMemoryWorld();
  const originIds = await seedAvailable(origin, CONTENTS);
  const zip = await exportAll(origin);
  const target = new InMemoryWorld();
  const pendingIds = seedPending(target, origin, originIds);
  return { origin, originIds, zip, target, pendingIds };
}

describe('archivo de contenidos del export (identity/workspace-portability)', () => {
  it('[TC-DOCUMENTS-ATTACH-024] el archivo trae el índice primero y un contenido en claro por documento disponible', async () => {
    const { zip, originIds } = await scenario();
    const entries: { name: string; data: Buffer }[] = [];
    for await (const e of readArchive(Readable.from([zip]), {
      maxEntries: 50,
      maxEntryBytes: 1 << 20,
      maxTotalBytes: 1 << 24,
    }))
      entries.push(e);
    expect(entries[0]?.name).toBe('documents-manifest.json');
    const manifest = JSON.parse(entries[0]!.data.toString('utf8')) as {
      documents: { documentId: string; sha256: string; sizeBytes: number }[];
    };
    expect(manifest.documents.map((d) => d.documentId).sort()).toEqual([...originIds].sort());
    expect(
      entries
        .slice(1)
        .map((e) => e.name)
        .sort(),
    ).toEqual(originIds.map((id) => `documents/${id}`).sort());
    for (const e of entries.slice(1)) {
      const d = manifest.documents.find((m) => `documents/${m.documentId}` === e.name)!;
      expect(sha(e.data)).toBe(d.sha256);
      expect(e.data.length).toBe(d.sizeBytes);
    }
  });

  it('[TC-DOCUMENTS-ATTACH-024] los documentos eliminados o sin contenido no viajan en el archivo', async () => {
    const origin = new InMemoryWorld();
    const ids = await seedAvailable(origin, CONTENTS.slice(0, 2));
    const gone = origin.documents.get(ids[1]!) as DocumentState;
    origin.documents.set(ids[1]!, { ...gone, status: 'DELETED', keyId: null, wrappedKey: null });
    const { stream, count } = await new ContentsService(origin.deps).open(WORKSPACE);
    stream.destroy();
    expect(count).toBe(1);
  });

  it('[TC-DOCUMENTS-ATTACH-024] restaurar deja los documentos disponibles con claves nuevas y las sumas originales', async () => {
    const { zip, target, pendingIds, originIds, origin } = await scenario();
    const { operation, result, staged } = await restoreWith(target, zip);
    expect(result).toBe('SUCCEEDED');
    expect(operation.status).toBe('SUCCEEDED');
    expect(operation.result).toMatchObject({ restored: 3, alreadyAvailable: 0, mismatched: [], absent: [] });
    for (const [i, id] of pendingIds.entries()) {
      const d = target.documents.get(id)!;
      expect(d.status).toBe('AVAILABLE');
      expect(d.keyId).not.toBeNull();
      expect(d.sha256).toBe(origin.documents.get(originIds[i]!)!.sha256);
      expect(d.objectKey).toBe(`ws/${WORKSPACE}/documents/${id}`);
    }
    // El contenido sale íntegro por la descarga de siempre y el ZIP subido ya no queda en la cuarentena.
    const download = await new DownloadService(target.deps).download({
      workspaceId: WORKSPACE,
      userId: EDITOR,
      documentId: pendingIds[1]!,
    });
    const body: Buffer[] = [];
    for await (const c of download.stream) body.push(c as Buffer);
    expect(Buffer.concat(body).equals(CONTENTS[1]!.content)).toBe(true);
    expect(target.quarantineKeys()).not.toContain(`quarantine/${staged.objectKey}`);
    // Cada restauración deja su transición en el recorrido y la auditoría final.
    expect(
      target.lifecycle.filter((l) => l.entry.action === 'documents.document.content_restored'),
    ).toHaveLength(3);
    expect(target.audits.map((a) => a.action)).toContain('documents.contents_restore.completed');
  });

  it('[TC-DOCUMENTS-ATTACH-024] restaurar dos veces no crea objetos ni registros nuevos', async () => {
    const { zip, target } = await scenario();
    await restoreWith(target, zip);
    const objects = [...target.objects.keys()].filter((k) => k.startsWith('documents/')).sort();
    const docs = JSON.stringify([...target.documents.values()]);
    const second = await restoreWith(target, zip);
    expect(second.operation.result).toMatchObject({
      restored: 0,
      alreadyAvailable: 3,
      mismatched: [],
      absent: [],
    });
    expect([...target.objects.keys()].filter((k) => k.startsWith('documents/')).sort()).toEqual(objects);
    expect(JSON.stringify([...target.documents.values()])).toBe(docs);
  });

  it('[TC-DOCUMENTS-ATTACH-024] reintentar el job de una operación ya terminada no hace nada', async () => {
    const { zip, target } = await scenario();
    const first = await restoreWith(target, zip);
    expect(await new ContentsService(target.deps).runRestore(first.job)).toBe('SKIPPED');
  });

  it('[TC-DOCUMENTS-ATTACH-025] un contenido alterado en el archivo deja su documento pendiente y se informa', async () => {
    const { zip: original, target, pendingIds } = await scenario();
    // Mismo índice (con las sumas originales) pero el contenido del tercero está modificado.
    const zip = Buffer.from(original);
    const marker = Buffer.from('garantia\n');
    const at = zip.indexOf(marker);
    expect(at).toBeGreaterThan(0);
    // Cambia un byte del contenido y recalcula el CRC de su entrada para que el ZIP siga siendo válido.
    zip[at] = zip[at]! ^ 0x01;
    const entryNameStart = zip.lastIndexOf(Buffer.from('PK\x03\x04'), at);
    const crc = crc32(zip.subarray(at, at + CONTENTS[2]!.content.length));
    zip.writeUInt32LE(crc, entryNameStart + 14);
    const { operation } = await restoreWith(target, zip);
    const result = operation.result as {
      restored: number;
      mismatched: { documentId: string; reason: string }[];
    };
    expect(result.restored).toBe(2);
    expect(result.mismatched).toEqual([{ documentId: pendingIds[2], reason: 'CHECKSUM_MISMATCH' }]);
    expect(target.documents.get(pendingIds[2]!)!.status).toBe('CONTENT_PENDING');
    expect(target.documents.get(pendingIds[0]!)!.status).toBe('AVAILABLE');
    expect(target.documents.get(pendingIds[1]!)!.status).toBe('AVAILABLE');
  });

  it('[TC-DOCUMENTS-ATTACH-025] un contenido que no pasa la inspección (como en una subida nueva) queda pendiente con su motivo', async () => {
    const { zip, target, pendingIds } = await scenario();
    target.inspectVerdict = (content) =>
      content.includes(Buffer.from('super'))
        ? { ok: false, reason: 'ACTIVE_CONTENT' }
        : { ok: true, format: 'PDF' };
    const { operation } = await restoreWith(target, zip);
    const result = operation.result as {
      restored: number;
      mismatched: { documentId: string; reason: string }[];
    };
    expect(result.restored).toBe(2);
    expect(result.mismatched).toEqual([{ documentId: pendingIds[1], reason: 'ACTIVE_CONTENT' }]);
    expect(target.documents.get(pendingIds[1]!)!.status).toBe('CONTENT_PENDING');
  });

  it('[TC-DOCUMENTS-ATTACH-025] los documentos pendientes que el archivo no trae se informan como ausentes', async () => {
    const { zip, target, pendingIds } = await scenario();
    const extra = '0193a000-0000-7000-8000-00000000fabc';
    const base = target.documents.get(pendingIds[0]!)!;
    target.documents.set(extra, { ...base, id: extra, sha256: sha(Buffer.from('otro')), sizeBytes: 4 });
    const { operation } = await restoreWith(target, zip);
    expect(operation.result).toMatchObject({ restored: 3, absent: [extra] });
  });

  it('[TC-DOCUMENTS-ATTACH-024] un archivo que no es un archivo de contenidos se rechaza al subirlo o deja la operación FAILED', async () => {
    const { target } = await scenario();
    const contents = new ContentsService(target.deps);
    await expect(
      contents.stageUpload(WORKSPACE, Readable.from([Buffer.from('no soy un zip')])),
    ).rejects.toMatchObject({
      code: 'EXPORT_FORMAT_UNSUPPORTED',
    });
    expect(target.quarantineKeys()).toEqual([]);
    // Un ZIP válido sin el índice al principio.
    const { writeArchive } = await import('./contents-archive.js');
    const chunks: Buffer[] = [];
    for await (const c of writeArchive(
      (async function* () {
        yield { name: 'cualquiera.txt', data: Buffer.from('x') };
      })(),
      new Date(),
    ))
      chunks.push(c);
    const { operation, result } = await restoreWith(target, Buffer.concat(chunks));
    expect(result).toBe('FAILED');
    expect(operation).toMatchObject({ status: 'FAILED', error: { code: 'EXPORT_FORMAT_UNSUPPORTED' } });
  });

  it('[TC-DOCUMENTS-ATTACH-024] el archivo subido que supera el tope se rechaza con UPLOAD_TOO_LARGE y no queda en la cuarentena', async () => {
    const { target } = await scenario();
    target.settings = { ...target.settings, quota: { quotaBytes: 10, maxPendingUploads: 20 } };
    const contents = new ContentsService({ ...target.deps, settings: target.settings });
    const big = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(9 * 1024 * 1024)]);
    await expect(contents.stageUpload(WORKSPACE, Readable.from([big]))).rejects.toMatchObject({
      code: 'UPLOAD_TOO_LARGE',
    });
    expect(target.quarantineKeys()).toEqual([]);
  });
});
