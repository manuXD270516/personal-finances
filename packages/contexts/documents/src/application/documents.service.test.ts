import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AttachmentsService } from './attachments.service.js';
import { DocumentsQueries } from './documents.queries.js';
import { DocumentsService } from './documents.service.js';
import { DownloadService } from './download.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { EDITOR, InMemoryWorld, OTHER_WORKSPACE, WORKSPACE } from './testing/in-memory.js';
import { UploadsService } from './uploads.service.js';

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const EXPENSE_150 = '0193a000-0000-7000-8000-000000000150';
const EXPENSE_35 = '0193a000-0000-7000-8000-000000000035';
const LOAN = '0193a000-0000-7000-8000-0000000000aa';
const bytes = (label: string, size = 400): Buffer =>
  Buffer.concat([Buffer.from(`${label}\n`), Buffer.alloc(size, 7)]);

function setup() {
  const world = new InMemoryWorld();
  world.targets.set('TRANSACTION', new Set([EXPENSE_150, EXPENSE_35]));
  world.targets.set('LOAN', new Set([LOAN]));
  world.targets.set('MONTH_CLOSING', new Set(['0193a000-0000-7000-8000-0000000c1054']));
  const uploads = new UploadsService(world.deps);
  const documents = new DocumentsService(world.deps);
  const attachments = new AttachmentsService(world.deps);
  const queries = new DocumentsQueries(world.deps);
  const download = new DownloadService(world.deps);
  const maintenance = new MaintenanceService(world.deps, uploads, documents);
  /** Sube y deja disponible un documento. */
  const available = async (name: string, content: Buffer, purpose = 'RECEIPT') => {
    const ext = name.split('.').pop()!;
    const type = ext === 'jpg' ? 'image/jpeg' : ext === 'csv' ? 'text/csv' : 'application/pdf';
    const r = await uploads.requestUpload({
      workspaceId: WORKSPACE,
      userId: EDITOR,
      fileName: name,
      contentType: type,
      sizeBytes: content.length,
      sha256: sha(content),
      purpose,
    });
    world.uploadToQuarantine(WORKSPACE, r.document.id, content);
    return uploads.completeUpload({ workspaceId: WORKSPACE, documentId: r.document.id });
  };
  const link = (documentId: string, targetType: string, targetId: string) =>
    attachments.link({ workspaceId: WORKSPACE, userId: EDITOR, documentId, targetType, targetId });
  return { world, uploads, documents, attachments, queries, download, maintenance, available, link };
}

const act = (documentId: string, expectedVersion?: number) => ({
  workspaceId: WORKSPACE,
  userId: EDITOR,
  documentId,
  expectedVersion,
});

describe('adjuntar documentos (documents/attachments)', () => {
  it('[TC-DOCUMENTS-ATTACH-008] N:M: un comprobante en dos gastos y dos documentos en un gasto', async () => {
    const { available, link, queries } = setup();
    const ticket = await available('ticket-supermercado.jpg', bytes('ticket'));
    const warranty = await available('garantia.pdf', bytes('garantia'));
    await link(ticket.id, 'TRANSACTION', EXPENSE_150);
    await link(ticket.id, 'TRANSACTION', EXPENSE_35);
    await link(warranty.id, 'TRANSACTION', EXPENSE_150);
    const onExpense = await queries.list(WORKSPACE, { targetType: 'TRANSACTION', targetId: EXPENSE_150 });
    expect(onExpense.items.map((d) => d.originalName).sort()).toEqual([
      'garantia.pdf',
      'ticket-supermercado.jpg',
    ]);
    expect(
      (await queries.list(WORKSPACE, { targetType: 'TRANSACTION', targetId: EXPENSE_35 })).items,
    ).toHaveLength(1);
    expect((await queries.get(WORKSPACE, ticket.id)).links).toHaveLength(2);
  });

  it('[TC-DOCUMENTS-ATTACH-008] adjuntar dos veces devuelve el vínculo existente', async () => {
    const { available, link, queries } = setup();
    const doc = await available('garantia.pdf', bytes('garantia'));
    const first = await link(doc.id, 'TRANSACTION', EXPENSE_150);
    const second = await link(doc.id, 'TRANSACTION', EXPENSE_150);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.link.id).toBe(first.link.id);
    expect((await queries.get(WORKSPACE, doc.id)).links).toHaveLength(1);
  });

  it('[TC-DOCUMENTS-ATTACH-009] destino inexistente o de otro workspace ⇒ REFERENCE_NOT_FOUND; tipo no soportado ⇒ VALIDATION_FAILED', async () => {
    const { available, link, world } = setup();
    const doc = await available('garantia.pdf', bytes('garantia'));
    await expect(link(doc.id, 'TRANSACTION', '0193a000-0000-7000-8000-00000000ffff')).rejects.toMatchObject({
      code: 'REFERENCE_NOT_FOUND',
    });
    await expect(link(doc.id, 'GOAL', EXPENSE_150)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(world.links.size).toBe(0);
  });

  it('[TC-DOCUMENTS-ATTACH-010] rechazado, pendiente o eliminado no se pueden adjuntar, sin crear el vínculo', async () => {
    const { world, available, link, uploads, documents } = setup();
    world.inspectVerdict = () => ({ ok: false, reason: 'TYPE_MISMATCH' });
    const rejected = await available('factura.pdf', bytes('png'));
    world.inspectVerdict = null;
    await expect(link(rejected.id, 'TRANSACTION', EXPENSE_150)).rejects.toMatchObject({
      code: 'DOCUMENT_REJECTED',
    });
    const pending = await uploads.requestUpload({
      workspaceId: WORKSPACE,
      userId: EDITOR,
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
      sha256: 'd'.repeat(64),
      purpose: 'RECEIPT',
    });
    await expect(link(pending.document.id, 'TRANSACTION', EXPENSE_150)).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_AVAILABLE',
    });
    const doc = await available('b.pdf', bytes('b'));
    await documents.delete(act(doc.id));
    await expect(link(doc.id, 'TRANSACTION', EXPENSE_150)).rejects.toMatchObject({
      code: 'DOCUMENT_DELETED',
    });
    expect(world.links.size).toBe(0);
  });

  it('[TC-DOCUMENTS-ATTACH-010] un documento con contenido pendiente de restaurar no se adjunta', async () => {
    const { world, available, link } = setup();
    const doc = await available('b.pdf', bytes('b'));
    world.documents.set(doc.id, { ...world.documents.get(doc.id)!, status: 'CONTENT_PENDING' });
    await expect(link(doc.id, 'TRANSACTION', EXPENSE_150)).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_AVAILABLE',
    });
  });

  it('[TC-DOCUMENTS-ATTACH-011] el vínculo número 21 ⇒ ATTACHMENT_LIMIT_EXCEEDED', async () => {
    const { available, link, world } = setup();
    for (let i = 0; i < 20; i += 1) {
      const doc = await available(`doc-${i}.pdf`, bytes(`doc ${i}`));
      await link(doc.id, 'TRANSACTION', EXPENSE_150);
    }
    const extra = await available('extra.pdf', bytes('extra'));
    await expect(link(extra.id, 'TRANSACTION', EXPENSE_150)).rejects.toMatchObject({
      code: 'ATTACHMENT_LIMIT_EXCEEDED',
    });
    expect([...world.links.values()].filter((l) => l.targetId === EXPENSE_150)).toHaveLength(20);
  });

  it('[TC-DOCUMENTS-ATTACH-012] adjuntar a un cierre de mes ya cerrado no consulta periodos ni modifica nada más (D65)', async () => {
    const { available, link, world } = setup();
    const doc = await available('recibo-alquiler.pdf', bytes('alquiler'));
    const out = await link(doc.id, 'MONTH_CLOSING', '0193a000-0000-7000-8000-0000000c1054');
    expect(out.created).toBe(true);
    // Solo el vínculo y su auditoría: ningún evento nuevo.
    expect(world.events.map((e) => e.eventType)).toEqual(['documents.AttachmentUploaded.v1']);
  });

  it('[TC-DOCUMENTS-ATTACH-008] desvincular conserva el documento y sus demás vínculos', async () => {
    const { available, link, attachments, queries, world } = setup();
    const ticket = await available('ticket-supermercado.jpg', bytes('ticket'));
    const a = await link(ticket.id, 'TRANSACTION', EXPENSE_150);
    const b = await link(ticket.id, 'TRANSACTION', EXPENSE_35);
    await attachments.unlink({
      workspaceId: WORKSPACE,
      userId: EDITOR,
      documentId: ticket.id,
      linkId: b.link.id,
    });
    const view = await queries.get(WORKSPACE, ticket.id);
    expect(view.status).toBe('AVAILABLE');
    expect(view.links.map((l) => l.id)).toEqual([a.link.id]);
    expect(world.documents.get(ticket.id)?.lastUnlinkedAt).toBeNull();
    await attachments.unlink({
      workspaceId: WORKSPACE,
      userId: EDITOR,
      documentId: ticket.id,
      linkId: a.link.id,
    });
    expect(world.documents.get(ticket.id)?.lastUnlinkedAt).not.toBeNull();
    await expect(
      attachments.unlink({
        workspaceId: WORKSPACE,
        userId: EDITOR,
        documentId: ticket.id,
        linkId: a.link.id,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('[TC-DOCUMENTS-ATTACH-020] el contrato para IMPORTS vincula idempotente y audita en la unidad de trabajo del llamador', async () => {
    const { world, available, attachments } = setup();
    world.targets.set('IMPORT_JOB', new Set(['0193a000-0000-7000-8000-0000000000b1']));
    const doc = await available('extracto-oct.csv', bytes('csv'), 'IMPORT_SOURCE');
    const cmd = attachments.asCommand();
    const input = {
      workspaceId: WORKSPACE,
      documentId: doc.id,
      targetType: 'IMPORT_JOB' as const,
      targetId: '0193a000-0000-7000-8000-0000000000b1',
      actorUserId: EDITOR,
    };
    const first = await world.deps.uow.run(WORKSPACE, () => cmd.link(input));
    const second = await world.deps.uow.run(WORKSPACE, () => cmd.link(input));
    expect(first.created).toBe(true);
    expect(second).toEqual({ linkId: first.linkId, created: false });
    // Si la unidad de trabajo del llamador falla, el vínculo se revierte con ella.
    await expect(
      world.deps.uow.run(WORKSPACE, async () => {
        await cmd.unlink(input);
        throw new Error('falla del llamador');
      }),
    ).rejects.toThrow('falla del llamador');
    expect(world.links.size).toBe(1);
  });
});

describe('consulta, archivado y eliminación (documents/attachments)', () => {
  it('[TC-DOCUMENTS-ATTACH-013] el listado filtra por propósito y estado y excluye archivados por defecto; nunca otro workspace', async () => {
    const { world, available, documents, queries, uploads } = setup();
    const receipt = await available('ticket.jpg', bytes('t'));
    const contract = await available('contrato-alquiler-2025.pdf', bytes('c'), 'CONTRACT');
    await documents.archive(act(contract.id));
    const other = await uploads.requestUpload({
      workspaceId: OTHER_WORKSPACE,
      userId: EDITOR,
      fileName: 'ajeno.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4,
      sha256: 'e'.repeat(64),
      purpose: 'RECEIPT',
    });
    expect(other.document.id).toBeTruthy();
    expect((await queries.list(WORKSPACE, {})).items.map((d) => d.id)).toEqual([receipt.id]);
    expect((await queries.list(WORKSPACE, { archived: 'only' })).items.map((d) => d.id)).toEqual([
      contract.id,
    ]);
    expect((await queries.list(WORKSPACE, { archived: 'include' })).items).toHaveLength(2);
    expect((await queries.list(WORKSPACE, { purpose: 'CONTRACT', archived: 'include' })).items).toHaveLength(
      1,
    );
    await expect(queries.list(WORKSPACE, { purpose: 'NOPE' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // Un documento de otro workspace es indistinguible de uno inexistente.
    await expect(queries.get(WORKSPACE, other.document.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    void world;
  });

  it('[TC-DOCUMENTS-ATTACH-016] archivar conserva vínculos, sigue descargable y desarchivar lo devuelve; If-Match obsoleto ⇒ 412', async () => {
    const { available, documents, download, link, queries } = setup();
    const doc = await available('contrato-alquiler-2025.pdf', bytes('c'), 'CONTRACT');
    await link(doc.id, 'LOAN', LOAN);
    await expect(documents.archive(act(doc.id, doc.version + 5))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    const archived = await documents.archive(act(doc.id, doc.version));
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.links).toHaveLength(1);
    const file = await download.download({ workspaceId: WORKSPACE, userId: EDITOR, documentId: doc.id });
    expect(file.contentLength).toBeGreaterThan(0);
    file.stream.destroy();
    expect((await documents.unarchive(act(doc.id))).archivedAt).toBeNull();
    expect((await queries.list(WORKSPACE, {})).items).toHaveLength(1);
  });

  it('[TC-DOCUMENTS-ATTACH-017] eliminar: quita vínculos, destruye la clave, borra el objeto y libera la cuota', async () => {
    const { world, available, documents, link, queries } = setup();
    const content = bytes('ticket', 1_250);
    const doc = await available('ticket-supermercado.jpg', content);
    await link(doc.id, 'TRANSACTION', EXPENSE_150);
    expect(world.usage.get(WORKSPACE)?.usedBytes).toBe(content.length);
    await documents.delete(act(doc.id));
    const stored = world.documents.get(doc.id)!;
    expect(stored).toMatchObject({ status: 'DELETED', wrappedKey: null, keyId: null });
    expect(world.links.size).toBe(0);
    expect(world.documentKeys()).toEqual([]);
    expect(world.usage.get(WORKSPACE)?.usedBytes).toBe(0);
    expect((await queries.get(WORKSPACE, doc.id)).status).toBe('DELETED');
    await expect(documents.delete(act(doc.id))).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    expect(world.audits.map((a) => a.action)).toContain('documents.document.deleted');
  });

  it('[TC-DOCUMENTS-ATTACH-018] purga: disponible, sin vínculos ni archivo por más de 30 días ⇒ eliminado con actor SYSTEM', async () => {
    const { world, available, documents, maintenance, link } = setup();
    const orphan = await available('borrador.pdf', bytes('borrador'));
    const archived = await available('archivado.pdf', bytes('archivado'));
    const linked = await available('vinculado.pdf', bytes('vinculado'));
    await documents.archive(act(archived.id));
    await link(linked.id, 'TRANSACTION', EXPENSE_150);
    world.advance(29 * 86_400_000);
    expect(await maintenance.purgeUnlinkedDocuments()).toMatchObject({ affected: 0 });
    world.advance(2 * 86_400_000);
    const report = await maintenance.purgeUnlinkedDocuments();
    expect(report).toMatchObject({ examined: 1, affected: 1, failed: 0 });
    expect(world.documents.get(orphan.id)?.status).toBe('DELETED');
    expect(world.documents.get(archived.id)?.status).toBe('AVAILABLE');
    expect(world.documents.get(linked.id)?.status).toBe('AVAILABLE');
    const purge = world.audits.find((a) => a.action === 'documents.document.purged');
    expect(purge?.actor).toEqual({ type: 'SYSTEM', process: 'documents.purge-unlinked' });
    // Idempotente.
    expect(await maintenance.purgeUnlinkedDocuments()).toMatchObject({ affected: 0 });
  });

  it('[TC-DOCUMENTS-ATTACH-018] quitar el último vínculo reinicia el plazo de la purga', async () => {
    const { world, available, attachments, maintenance, link } = setup();
    const doc = await available('x.pdf', bytes('x'));
    const l = await link(doc.id, 'TRANSACTION', EXPENSE_150);
    world.advance(40 * 86_400_000);
    await attachments.unlink({
      workspaceId: WORKSPACE,
      userId: EDITOR,
      documentId: doc.id,
      linkId: l.link.id,
    });
    expect(await maintenance.purgeUnlinkedDocuments()).toMatchObject({ affected: 0 });
    world.advance(31 * 86_400_000);
    expect(await maintenance.purgeUnlinkedDocuments()).toMatchObject({ affected: 1 });
  });

  it('[TC-SECURITY-UPLOAD-017] SweepOrphanObjects borra objetos sin fila que los referencie y de más de 24 h', async () => {
    const { world, available, maintenance } = setup();
    const doc = await available('x.pdf', bytes('x'));
    world.objects.set(`documents/ws/${WORKSPACE}/documents/huerfano`, {
      body: Buffer.from('x'),
      lastModified: world.clock.now().toDate(),
    });
    world.advance(25 * 3_600_000);
    const report = await maintenance.sweepOrphanObjects();
    expect(report).toMatchObject({ affected: 1, failed: 0 });
    expect(world.documentKeys()).toEqual([`documents/ws/${WORKSPACE}/documents/${doc.id}`]);
  });
});

describe('descarga y cifrado (security/file-upload-security)', () => {
  async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  it('[TC-DOCUMENTS-ATTACH-014] descarga el contenido original con su suma y cabeceras de entrega segura; audita sin el nombre', async () => {
    const { world, available, download } = setup();
    const content = bytes('Factura de luz', 150_000);
    const doc = await available('factura-luz-octubre.pdf', content);
    const file = await download.download({ workspaceId: WORKSPACE, userId: EDITOR, documentId: doc.id });
    const body = await readAll(file.stream);
    expect(sha(body)).toBe(sha(content));
    expect(file.contentLength).toBe(content.length);
    expect(file.contentType).toBe('application/pdf');
    expect(file.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'cache-control': 'private, no-store',
      'repr-digest': `sha-256=:${Buffer.from(sha(content), 'hex').toString('base64')}:`,
    });
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename="factura-luz-octubre\.pdf"/u);
    const audit = world.audits.find((a) => a.action === 'documents.document.downloaded')!;
    expect(audit.aggregateId).toBe(doc.id);
    expect(JSON.stringify(audit)).not.toContain('factura-luz-octubre');
  });

  it('[TC-SECURITY-UPLOAD-015] un nombre con comillas y punto y coma va codificado y no inyecta cabeceras', async () => {
    const { world, available, download } = setup();
    const doc = await available('foto-recibo.jpg', bytes('foto'));
    world.documents.set(doc.id, { ...world.documents.get(doc.id)!, originalName: 'a";b\\c.jpg' });
    const file = await download.download({ workspaceId: WORKSPACE, userId: EDITOR, documentId: doc.id });
    file.stream.destroy();
    const header = file.headers['content-disposition']!;
    expect(header).not.toMatch(/[\r\n]/u);
    expect(/filename="([^"]*)"/u.exec(header)![1]).not.toMatch(/[";\\]/u);
    expect(header).toContain("filename*=UTF-8''a%22%3Bb%5Cc.jpg");
  });

  it('[TC-DOCUMENTS-ATTACH-015] descargar un documento eliminado, rechazado o pendiente ⇒ DOCUMENT_DELETED, DOCUMENT_REJECTED, DOCUMENT_NOT_AVAILABLE', async () => {
    const { world, available, download, documents, uploads } = setup();
    const deleted = await available('d.pdf', bytes('d'));
    await documents.delete(act(deleted.id));
    await expect(
      download.download({ workspaceId: WORKSPACE, userId: EDITOR, documentId: deleted.id }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_DELETED' });
    world.inspectVerdict = () => ({ ok: false, reason: 'ACTIVE_CONTENT' });
    const rejected = await available('r.pdf', bytes('r'));
    world.inspectVerdict = null;
    await expect(
      download.download({ workspaceId: WORKSPACE, userId: EDITOR, documentId: rejected.id }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_REJECTED' });
    const pending = await uploads.requestUpload({
      workspaceId: WORKSPACE,
      userId: EDITOR,
      fileName: 'p.pdf',
      contentType: 'application/pdf',
      sizeBytes: 5,
      sha256: 'f'.repeat(64),
      purpose: 'OTHER',
    });
    await expect(
      download.download({ workspaceId: WORKSPACE, userId: EDITOR, documentId: pending.document.id }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_NOT_AVAILABLE' });
    // Documento de otro workspace ≡ inexistente.
    await expect(
      download.download({ workspaceId: OTHER_WORKSPACE, userId: EDITOR, documentId: deleted.id }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(world.audits.filter((a) => a.action === 'documents.document.downloaded')).toHaveLength(0);
  });

  it('[TC-SECURITY-UPLOAD-016] un byte alterado en el objeto ⇒ DOCUMENT_CONTENT_CORRUPTED sin entregar el bloque alterado', async () => {
    const { world, available, download } = setup();
    const content = bytes('Factura', 200_000);
    const doc = await available('f.pdf', content);
    const key = world.documentKeys()[0]!;
    const stored = Buffer.from(world.objects.get(key)!.body);
    // Altera un byte del primer bloque cifrado.
    stored[40] = (stored[40] as number) ^ 0xff;
    world.objects.set(key, { body: stored, lastModified: new Date() });
    await expect(
      download.download({ workspaceId: WORKSPACE, userId: EDITOR, documentId: doc.id }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_CONTENT_CORRUPTED' });
  });

  it('[TC-SECURITY-UPLOAD-016] un byte alterado en un bloque posterior interrumpe el flujo sin emitir el bloque alterado', async () => {
    const { world, available, download } = setup();
    const content = bytes('Factura', 200_000);
    const doc = await available('f.pdf', content);
    const key = world.documentKeys()[0]!;
    const stored = Buffer.from(world.objects.get(key)!.body);
    const record = 64 * 1024 + 16;
    stored[13 + record * 2 + 100] = (stored[13 + record * 2 + 100] as number) ^ 0xff;
    world.objects.set(key, { body: stored, lastModified: new Date() });
    // Según cómo llegue el objeto en fragmentos, el fallo aparece al abrir (422) o a mitad del flujo; en ambos casos
    // nunca se emite el bloque alterado (tercero) ni los siguientes.
    const received: Buffer[] = [];
    let failed = false;
    try {
      const file = await download.download({ workspaceId: WORKSPACE, userId: EDITOR, documentId: doc.id });
      for await (const c of file.stream) received.push(c as Buffer);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(Buffer.concat(received).length).toBeLessThanOrEqual(64 * 1024 * 2);
  });

  it('[TC-DOCUMENTS-ATTACH-020] el lector para el pipeline entrega el contenido original; pendiente ⇒ DOCUMENT_NOT_AVAILABLE', async () => {
    const { world, available, download, uploads } = setup();
    const content = bytes('csv;a;b\n1;2;3', 100_000);
    const doc = await available('extracto-oct.csv', content, 'IMPORT_SOURCE');
    const meta = await download.getForProcessing({ workspaceId: WORKSPACE, documentId: doc.id });
    expect(meta).toMatchObject({
      status: 'AVAILABLE',
      purpose: 'IMPORT_SOURCE',
      detectedFormat: 'CSV',
      sizeBytes: content.length,
      sha256: sha(content),
    });
    const body = await readAll(await download.open({ workspaceId: WORKSPACE, documentId: doc.id }));
    expect(body.equals(content)).toBe(true);
    const pending = await uploads.requestUpload({
      workspaceId: WORKSPACE,
      userId: EDITOR,
      fileName: 'p.csv',
      contentType: 'text/csv',
      sizeBytes: 5,
      sha256: 'a1'.repeat(32),
      purpose: 'IMPORT_SOURCE',
    });
    await expect(
      download.open({ workspaceId: WORKSPACE, documentId: pending.document.id }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_NOT_AVAILABLE' });
    expect(await download.getForProcessing({ workspaceId: OTHER_WORKSPACE, documentId: doc.id })).toBeNull();
    void world;
  });

  it('[TC-SECURITY-UPLOAD-017] rotación: tras activar k2 el mantenimiento re-envuelve las claves y siguen descargables', async () => {
    const { world, available, maintenance, download } = setup();
    const docs = [];
    for (let i = 0; i < 3; i += 1) docs.push(await available(`d${i}.pdf`, bytes(`doc ${i}`, 1_000)));
    expect([...world.documents.values()].every((d) => d.keyId === 'k1')).toBe(true);
    world.rotateKeys();
    const report = await maintenance.rewrapDocumentKeys();
    expect(report).toMatchObject({ affected: 3, failed: 0 });
    expect([...world.documents.values()].every((d) => d.keyId === 'k2')).toBe(true);
    for (const d of docs) {
      const file = await download.download({ workspaceId: WORKSPACE, userId: EDITOR, documentId: d.id });
      expect((await readAll(file.stream)).length).toBe(d.sizeBytes);
    }
  });

  it('[TC-SECURITY-UPLOAD-017] arrancar sin una clave en uso falla nombrando la clave faltante', async () => {
    const { world, available, maintenance } = setup();
    await available('d.pdf', bytes('d'));
    await expect(maintenance.assertKeysAvailable()).resolves.toBeUndefined();
    const stored = [...world.documents.values()][0]!;
    world.documents.set(stored.id, { ...stored, keyId: 'k-retirada' });
    await expect(maintenance.assertKeysAvailable()).rejects.toThrow(/k-retirada/u);
  });

  it('[TC-SECURITY-UPLOAD-018] la deriva de la cuota se detecta contra la suma real', async () => {
    const { world, available, maintenance } = setup();
    await available('d.pdf', bytes('d', 500));
    expect(await maintenance.checkUsageDrift()).toEqual([]);
    world.usage.set(WORKSPACE, { usedBytes: 99_999, reservedBytes: 0, pendingUploads: 0 });
    const drift = await maintenance.checkUsageDrift();
    expect(drift).toHaveLength(1);
    expect(drift[0]!.driftBytes).toBeGreaterThan(0);
  });
});
