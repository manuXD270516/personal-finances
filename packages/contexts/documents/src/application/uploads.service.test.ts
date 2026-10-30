import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DocumentsService } from './documents.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { UploadsService } from './uploads.service.js';
import { EDITOR, InMemoryWorld, OTHER_WORKSPACE, WORKSPACE } from './testing/in-memory.js';

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('Factura de luz octubre '.repeat(100))]);

function setup() {
  const world = new InMemoryWorld();
  const uploads = new UploadsService(world.deps);
  const documents = new DocumentsService(world.deps);
  const maintenance = new MaintenanceService(world.deps, uploads, documents);
  const request = (over: Record<string, unknown> = {}, workspaceId = WORKSPACE) =>
    uploads.requestUpload({
      workspaceId,
      userId: EDITOR,
      fileName: 'factura-luz-octubre.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: sha(PDF),
      purpose: 'RECEIPT',
      ...over,
    });
  /** Solicita, sube a la cuarentena y confirma. */
  const upload = async (content = PDF, over: Record<string, unknown> = {}) => {
    const r = await request({ sizeBytes: content.length, sha256: sha(content), ...over });
    world.uploadToQuarantine(WORKSPACE, r.document.id, content);
    return r.document.id;
  };
  const complete = (documentId: string) => uploads.completeUpload({ workspaceId: WORKSPACE, documentId });
  return { world, uploads, documents, maintenance, request, upload, complete };
}

describe('solicitar la subida (documents/attachments)', () => {
  it('[TC-DOCUMENTS-ATTACH-001] registra el documento pendiente y entrega una URL que vence a los 5 minutos', async () => {
    const { world, request } = setup();
    const r = await request();
    expect(r.deduplicated).toBe(false);
    expect(r.document).toMatchObject({ status: 'PENDING_UPLOAD', sizeBytes: PDF.length, purpose: 'RECEIPT' });
    expect(r.upload?.expiresAt).toBe('2026-10-29T14:05:00.000Z');
    expect(r.upload?.headers['Content-Type']).toBe('application/pdf');
    expect(r.upload?.headers['x-amz-checksum-sha256']).toBe(Buffer.from(sha(PDF), 'hex').toString('base64'));
    expect(r.upload?.url).toContain('/quarantine/ws/');
    // La clave de objeto es opaca: no lleva el nombre original.
    expect(r.upload?.url).not.toMatch(/factura/iu);
    expect(world.usage.get(WORKSPACE)).toEqual({
      usedBytes: 0,
      reservedBytes: PDF.length,
      pendingUploads: 1,
    });
  });

  it('[TC-SECURITY-UPLOAD-001] tipo no permitido ⇒ UPLOAD_TYPE_NOT_ALLOWED sin registrar nada', async () => {
    const { world, request } = setup();
    await expect(request({ fileName: 'logo.svg', contentType: 'image/svg+xml' })).rejects.toMatchObject({
      code: 'UPLOAD_TYPE_NOT_ALLOWED',
    });
    expect(world.documents.size).toBe(0);
    expect(world.audits).toHaveLength(0);
  });

  it('[TC-SECURITY-UPLOAD-003] tamaño excedido ⇒ UPLOAD_TOO_LARGE sin registrar nada', async () => {
    const { world, request } = setup();
    await expect(request({ sizeBytes: 15_728_641 })).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
    expect(world.documents.size).toBe(0);
  });

  it('[TC-DOCUMENTS-ATTACH-007] mismo contenido en el workspace ⇒ documento existente, sin URL ni cuota; otro workspace no', async () => {
    const { world, upload, complete, request } = setup();
    const id = await upload();
    await complete(id);
    const usageBefore = world.usage.get(WORKSPACE);
    const again = await request({ fileName: 'copia.pdf' });
    expect(again.deduplicated).toBe(true);
    expect(again.upload).toBeNull();
    expect(again.document.id).toBe(id);
    expect(world.usage.get(WORKSPACE)).toEqual(usageBefore);
    const other = await request({}, OTHER_WORKSPACE);
    expect(other.deduplicated).toBe(false);
    expect(other.document.id).not.toBe(id);
  });

  it('[TC-SECURITY-UPLOAD-018] cuota agotada ⇒ DOCUMENT_QUOTA_EXCEEDED; subidas pendientes al máximo ⇒ DOCUMENT_PENDING_UPLOADS_EXCEEDED', async () => {
    const { world, request } = setup();
    world.usage.set(WORKSPACE, { usedBytes: 5_368_000_000, reservedBytes: 0, pendingUploads: 0 });
    await expect(request({ sizeBytes: 1_000_000 })).rejects.toMatchObject({
      code: 'DOCUMENT_QUOTA_EXCEEDED',
    });
    expect(world.documents.size).toBe(0);
    world.usage.set(WORKSPACE, { usedBytes: 0, reservedBytes: 0, pendingUploads: 20 });
    await expect(request({ sizeBytes: 10 })).rejects.toMatchObject({
      code: 'DOCUMENT_PENDING_UPLOADS_EXCEEDED',
    });
  });

  it('[TC-SECURITY-UPLOAD-018] quedan 1500000 bytes y llegan dos solicitudes de 1000000 ⇒ solo una se registra', async () => {
    const { world, request } = setup();
    world.usage.set(WORKSPACE, { usedBytes: 5_368_709_120 - 1_500_000, reservedBytes: 0, pendingUploads: 0 });
    const a = request({ sha256: 'a'.repeat(64), sizeBytes: 1_000_000 });
    const b = request({ sha256: 'b'.repeat(64), sizeBytes: 1_000_000 });
    const results = await Promise.allSettled([a, b]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'DOCUMENT_QUOTA_EXCEEDED' });
    expect(world.documents.size).toBe(1);
  });
});

describe('confirmar y verificar (documents/attachments)', () => {
  it('[TC-DOCUMENTS-ATTACH-003] PDF válido ⇒ disponible, tipo detectado, cuarentena vacía y contenido cifrado', async () => {
    const { world, upload, complete } = setup();
    const id = await upload();
    const view = await complete(id);
    expect(view).toMatchObject({
      status: 'AVAILABLE',
      detectedContentType: 'application/pdf',
      detectedFormat: 'PDF',
      sizeBytes: PDF.length,
      sha256: sha(PDF),
      scanStatus: 'NOT_SCANNED',
    });
    expect(world.quarantineKeys()).toEqual([]);
    // TC-SECURITY-UPLOAD-016: el objeto almacenado está cifrado.
    const [key] = world.documentKeys();
    expect(key).toBe(`documents/ws/${WORKSPACE}/documents/${id}`);
    const stored = world.objects.get(key!)!.body;
    expect(stored.subarray(0, 5).toString('latin1')).not.toBe('%PDF-');
    expect(stored.includes(Buffer.from('Factura de luz'))).toBe(false);
    expect(world.usage.get(WORKSPACE)).toEqual({
      usedBytes: PDF.length,
      reservedBytes: 0,
      pendingUploads: 0,
    });
  });

  it('[TC-DOCUMENTS-ATTACH-004] confirmar sin haber subido ⇒ DOCUMENT_UPLOAD_MISSING y sigue pendiente', async () => {
    const { world, request, complete } = setup();
    const r = await request();
    await expect(complete(r.document.id)).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_MISSING' });
    expect(world.documents.get(r.document.id)?.status).toBe('PENDING_UPLOAD');
  });

  it('[TC-DOCUMENTS-ATTACH-005] confirmar dos veces devuelve el mismo documento sin segunda verificación', async () => {
    const { world, upload, complete } = setup();
    const id = await upload();
    await complete(id);
    const before = { audits: world.audits.length, events: world.events.length, inspected: world.inspected };
    const again = await complete(id);
    expect(again.status).toBe('AVAILABLE');
    expect(world.audits).toHaveLength(before.audits);
    expect(world.events).toHaveLength(before.events);
    expect(world.inspected).toBe(before.inspected);
    expect(world.events.filter((e) => e.eventType === 'documents.AttachmentUploaded.v1')).toHaveLength(1);
  });

  it('[TC-SECURITY-UPLOAD-004] contenido sustituido (otra suma) ⇒ REJECTED/CHECKSUM_MISMATCH, nunca disponible', async () => {
    const { world, request, complete } = setup();
    const r = await request();
    world.uploadToQuarantine(WORKSPACE, r.document.id, randomBytes(PDF.length));
    const view = await complete(r.document.id);
    expect(view).toMatchObject({ status: 'REJECTED', rejectionReason: 'CHECKSUM_MISMATCH' });
    expect(world.quarantineKeys()).toEqual([]);
    expect(world.documentKeys()).toEqual([]);
  });

  it('[TC-SECURITY-UPLOAD-004] tamaño distinto del declarado ⇒ REJECTED/SIZE_MISMATCH', async () => {
    const { world, request, complete } = setup();
    const r = await request();
    world.uploadToQuarantine(WORKSPACE, r.document.id, Buffer.concat([PDF, Buffer.from('extra')]));
    expect(await complete(r.document.id)).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'SIZE_MISMATCH',
    });
  });

  it('[TC-SECURITY-UPLOAD-013] un rechazo libera la reserva, elimina la cuarentena y publica DocumentRejected', async () => {
    const { world, upload, complete } = setup();
    world.inspectVerdict = () => ({ ok: false, reason: 'TYPE_MISMATCH' });
    const id = await upload();
    const view = await complete(id);
    expect(view).toMatchObject({ status: 'REJECTED', rejectionReason: 'TYPE_MISMATCH' });
    expect(world.quarantineKeys()).toEqual([]);
    expect(world.documentKeys()).toEqual([]);
    expect(world.usage.get(WORKSPACE)).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
    expect(world.events.map((e) => e.eventType)).toEqual(['documents.DocumentRejected.v1']);
    expect(world.events[0]!.payload).toEqual({ documentId: id, purpose: 'RECEIPT', reason: 'TYPE_MISMATCH' });
  });

  it('[TC-DOCUMENTS-ATTACH-021] el evento de disponibilidad lleva tipo, tamaño, suma y propósito, pero no el nombre', async () => {
    const { world, upload, complete } = setup();
    const id = await upload(PDF, { fileName: 'extracto-oct.pdf' });
    await complete(id);
    const event = world.events.find((e) => e.eventType === 'documents.AttachmentUploaded.v1')!;
    expect(event.payload).toEqual({
      documentId: id,
      purpose: 'RECEIPT',
      contentType: 'application/pdf',
      format: 'PDF',
      sizeBytes: PDF.length,
      sha256: sha(PDF),
      scanStatus: 'NOT_SCANNED',
    });
    expect(JSON.stringify(event)).not.toContain('extracto-oct');
  });

  it('[TC-DOCUMENTS-ATTACH-019] la auditoría de la solicitud, la aceptación y el rechazo no contiene el nombre original', async () => {
    const { world, upload, complete } = setup();
    const id = await upload(PDF, { fileName: 'Extracto Juan Perez CI 1234567.pdf' });
    await complete(id);
    const json = JSON.stringify(world.audits);
    expect(json).not.toMatch(/Juan|Perez|1234567/u);
    expect(world.audits.map((a) => a.action)).toEqual([
      'documents.document.upload_requested',
      'documents.document.upload_confirmed',
      'documents.document.accepted',
    ]);
  });

  it('[TC-SECURITY-UPLOAD-019] con escáner: infectado ⇒ MALWARE_DETECTED; caído ⇒ 503 y sigue UPLOADED; recupera después', async () => {
    const { world, upload, complete } = setup();
    world.scanResult = { status: 'INFECTED', signature: 'Eicar-Test-Signature' };
    const bad = await upload(PDF);
    expect(await complete(bad)).toMatchObject({ status: 'REJECTED', rejectionReason: 'MALWARE_DETECTED' });

    const other = Buffer.concat([PDF, Buffer.from('otro')]);
    world.scanResult = { status: 'UNAVAILABLE' };
    const id = await upload(other);
    await expect(complete(id)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(world.documents.get(id)?.status).toBe('UPLOADED');
    world.scanResult = { status: 'CLEAN' };
    world.advance(11 * 60_000);
    const refs = await world.deps.scan.stuckUploads(world.clock.now().plusMillis(-600_000).toString());
    expect(refs.map((r) => r.documentId)).toEqual([id]);
    const report = await new MaintenanceService(
      world.deps,
      new UploadsService(world.deps),
      new DocumentsService(world.deps),
    ).recoverStuckUploads();
    expect(report).toMatchObject({ affected: 1, failed: 0 });
    expect(world.documents.get(id)).toMatchObject({
      status: 'AVAILABLE',
      scanStatus: 'CLEAN',
      scanEngine: 'fake-av',
    });
  });

  it('semáforo lleno ⇒ 503 con Retry-After sugerido y sin cambiar el estado', async () => {
    const { world, upload, complete } = setup();
    const id = await upload();
    world.semaphoreFull = true;
    await expect(complete(id)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: { retryAfterSeconds: 5 },
    });
    expect(world.documents.get(id)?.status).toBe('PENDING_UPLOAD');
  });

  it('[TC-DOCUMENTS-ATTACH-003] atomicidad (INV-029): si el outbox falla, el documento queda UPLOADED y sin auditoría de aceptación', async () => {
    const { world, upload, complete } = setup();
    const id = await upload();
    world.failNextOutbox = true;
    await expect(complete(id)).rejects.toThrow('outbox caído');
    expect(world.documents.get(id)?.status).toBe('UPLOADED');
    expect(world.audits.map((a) => a.action)).not.toContain('documents.document.accepted');
    // El objeto aún no se perdió: el reintento (o RecoverStuckUploads) termina la verificación.
    world.advance(11 * 60_000);
    expect((await complete(id)).status).toBe('AVAILABLE');
  });

  it('una verificación en curso (reciente) no se pisa con otra confirmación', async () => {
    const { world, upload, complete } = setup();
    const id = await upload();
    world.failNextOutbox = true;
    await expect(complete(id)).rejects.toThrow();
    await expect(complete(id)).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });
});

describe('expiración de subidas (documents/attachments)', () => {
  it('[TC-DOCUMENTS-ATTACH-006] subida abandonada ⇒ REJECTED/UPLOAD_NOT_COMPLETED y baja la reserva', async () => {
    const { world, request, maintenance } = setup();
    const r = await request({
      sizeBytes: 2_000_000,
      sha256: 'c'.repeat(64),
      fileName: 'extracto.csv',
      contentType: 'text/csv',
    });
    world.uploadToQuarantine(WORKSPACE, r.document.id, Buffer.from('parcial'));
    expect(world.usage.get(WORKSPACE)?.reservedBytes).toBe(2_000_000);
    // 10:00 + URL vencida a las 10:05 + 1 h de gracia ⇒ a las 11:10 ya vence.
    world.advance(70 * 60_000);
    const report = await maintenance.expirePendingUploads();
    expect(report).toMatchObject({ affected: 1, failed: 0 });
    expect(world.documents.get(r.document.id)).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'UPLOAD_NOT_COMPLETED',
    });
    expect(world.usage.get(WORKSPACE)).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
    expect(world.quarantineKeys()).toEqual([]);
    // Idempotente.
    expect(await maintenance.expirePendingUploads()).toMatchObject({ affected: 0 });
  });

  it('[TC-DOCUMENTS-ATTACH-006] antes de plazo + gracia no se expira', async () => {
    const { world, request, maintenance } = setup();
    await request();
    world.advance(30 * 60_000);
    expect(await maintenance.expirePendingUploads()).toMatchObject({ examined: 0, affected: 0 });
  });

  it('[TC-SECURITY-UPLOAD-017] ningún objeto permanece más de 24 horas en la cuarentena', async () => {
    const { world, request, maintenance } = setup();
    const r = await request();
    world.uploadToQuarantine(WORKSPACE, r.document.id, PDF);
    world.advance(23 * 3_600_000);
    expect(await maintenance.sweepQuarantine()).toMatchObject({ affected: 0 });
    world.advance(2 * 3_600_000);
    expect(await maintenance.sweepQuarantine()).toMatchObject({ affected: 1 });
    expect(world.quarantineKeys()).toEqual([]);
  });
});
