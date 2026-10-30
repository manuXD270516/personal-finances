import { describe, expect, it } from 'vitest';
import { DOCUMENT_LIFECYCLE, Document } from './document.js';
import { DEFAULT_UPLOAD_LIMITS, validateDeclaration } from './file-type-policy.js';
import {
  DEFAULT_QUOTA_LIMITS,
  EMPTY_USAGE,
  assertLinkCapacity,
  free,
  promote,
  release,
  reserve,
} from './storage-quota.js';

const AT = '2026-10-29T14:00:00.000Z';
const LATER = '2026-10-29T14:01:00.000Z';
const USER = '0193a000-0000-7000-8000-000000000001';

function fresh(): Document {
  return Document.request({
    id: '0193a000-0000-7000-8000-0000000000d1',
    workspaceId: '0193a000-0000-7000-8000-0000000000a1',
    declared: validateDeclaration(
      {
        fileName: 'factura-luz-octubre.pdf',
        contentType: 'application/pdf',
        sizeBytes: 482_133,
        sha256: 'a'.repeat(64),
        purpose: 'RECEIPT',
      },
      DEFAULT_UPLOAD_LIMITS,
    ),
    quarantineKey: 'ws/x/y',
    uploadExpiresAt: '2026-10-29T14:05:00.000Z',
    createdBy: USER,
    at: AT,
  });
}

const accept = (d: Document): void =>
  d.accept(
    {
      detectedFormat: 'PDF',
      detectedContentType: 'application/pdf',
      objectKey: 'ws/x/documents/y',
      encryptedSizeBytes: 482_500,
      keyId: 'k1',
      wrappedKey: Buffer.alloc(60),
      scanStatus: 'NOT_SCANNED',
      scanEngine: null,
    },
    LATER,
  );

describe('Document: máquina de estados (audit/lifecycle-timeline)', () => {
  it('[TC-DOCUMENTS-ATTACH-026] declara los ocho pasos de la spec y dos estados terminales', () => {
    const def = DOCUMENT_LIFECYCLE.definition;
    expect(def.aggregateType).toBe('Document');
    expect(def.transitions.map((t) => t.code).sort()).toEqual(
      [
        'ACCEPT',
        'CONFIRM',
        'DELETE',
        'EXPIRE',
        'PURGE',
        'REJECT',
        'REQUEST_UPLOAD',
        'RESTORE_CONTENT',
      ].sort(),
    );
    expect(
      def.states
        .filter((s) => s.terminal)
        .map((s) => s.code)
        .sort(),
    ).toEqual(['DELETED', 'REJECTED']);
  });

  it('[TC-DOCUMENTS-ATTACH-003] solicitar → confirmar → aceptar deja el recorrido y limpia la cuarentena', () => {
    const d = fresh();
    expect(d.lastTransition).toEqual({ transition: 'REQUEST_UPLOAD', from: null, to: 'PENDING_UPLOAD' });
    d.confirm(AT);
    expect(d.lastTransition).toEqual({ transition: 'CONFIRM', from: 'PENDING_UPLOAD', to: 'UPLOADED' });
    expect(d.snapshot.verificationStartedAt).toBe(AT);
    accept(d);
    expect(d.status).toBe('AVAILABLE');
    expect(d.snapshot).toMatchObject({ quarantineKey: null, verificationStartedAt: null, version: 3 });
  });

  it('[TC-DOCUMENTS-ATTACH-006] una subida no confirmada expira como rechazada; confirmar o aceptar desde un estado inválido falla', () => {
    const expired = fresh();
    expired.expire(LATER);
    expect(expired.snapshot).toMatchObject({ status: 'REJECTED', rejectionReason: 'UPLOAD_NOT_COMPLETED' });
    expect(() => expired.confirm(LATER)).toThrow(/INVALID_STATUS_TRANSITION|not allowed/u);
    const pending = fresh();
    expect(() => accept(pending)).toThrow(/not allowed/u);
    expect(() => pending.reject('TYPE_MISMATCH', LATER)).toThrow(/not allowed/u);
  });

  it('[TC-DOCUMENTS-ATTACH-017] eliminar destruye la clave envuelta y no admite repetirse ni archivar', () => {
    const d = fresh();
    d.confirm(AT);
    accept(d);
    d.delete(USER, LATER);
    expect(d.snapshot).toMatchObject({ status: 'DELETED', wrappedKey: null, keyId: null, deletedBy: USER });
    expect(() => d.delete(USER, LATER)).toThrow(/not allowed/u);
    expect(() => d.archive(USER, LATER)).toThrow(/cannot archive/u);
  });

  it('[TC-DOCUMENTS-ATTACH-016] archivar y desarchivar son anotaciones: no cambian el estado y son idempotentes', () => {
    const d = fresh();
    d.confirm(AT);
    accept(d);
    const v = d.version;
    d.archive(USER, LATER);
    expect(d.lastTransition).toBeNull();
    expect(d.snapshot.archivedAt).toBe(LATER);
    expect(d.version).toBe(v + 1);
    d.archive(USER, LATER);
    expect(d.version).toBe(v + 1);
    d.unarchive(LATER);
    expect(d.snapshot.archivedAt).toBeNull();
  });

  it('[TC-DOCUMENTS-ATTACH-010] solo un documento disponible se puede vincular o descargar, con el código de cada estado', () => {
    const d = fresh();
    const code = (fn: () => void): string | undefined => {
      try {
        fn();
      } catch (e) {
        return (e as { code?: string }).code;
      }
      return undefined;
    };
    expect(code(() => d.assertLinkable())).toBe('DOCUMENT_NOT_AVAILABLE');
    d.expire(LATER);
    expect(code(() => d.assertLinkable())).toBe('DOCUMENT_REJECTED');
    const ok = fresh();
    ok.confirm(AT);
    accept(ok);
    expect(code(() => ok.assertDownloadable())).toBeUndefined();
    ok.delete(USER, LATER);
    expect(code(() => ok.assertDownloadable())).toBe('DOCUMENT_DELETED');
  });

  it('[TC-SECURITY-UPLOAD-017] re-envolver la clave no sube la versión ni deja recorrido', () => {
    const d = fresh();
    d.confirm(AT);
    accept(d);
    const v = d.version;
    d.rewrapKey({ keyId: 'k2', wrappedKey: Buffer.alloc(60, 1) });
    expect(d.version).toBe(v);
    expect(d.snapshot.keyId).toBe('k2');
  });
});

describe('cuota de almacenamiento (security/file-upload-security)', () => {
  it('[TC-SECURITY-UPLOAD-018] reserva → promoción → liberación mueven los contadores sin perder bytes', () => {
    const reserved = reserve(EMPTY_USAGE, 2_000_000, DEFAULT_QUOTA_LIMITS);
    expect(reserved).toEqual({ usedBytes: 0, reservedBytes: 2_000_000, pendingUploads: 1 });
    const promoted = promote(reserved, 2_000_000);
    expect(promoted).toEqual({ usedBytes: 2_000_000, reservedBytes: 0, pendingUploads: 0 });
    expect(free(promoted, 2_000_000)).toEqual(EMPTY_USAGE);
    expect(release(reserved, 2_000_000)).toEqual(EMPTY_USAGE);
  });

  it('[TC-SECURITY-UPLOAD-018] 5368000000 usados + 1000000 ⇒ DOCUMENT_QUOTA_EXCEEDED; 20 pendientes ⇒ DOCUMENT_PENDING_UPLOADS_EXCEEDED; 709120 libres admiten 709120', () => {
    const code = (fn: () => unknown): string | undefined => {
      try {
        fn();
      } catch (e) {
        return (e as { code?: string }).code;
      }
      return undefined;
    };
    const used = { usedBytes: 5_368_000_000, reservedBytes: 0, pendingUploads: 0 };
    expect(code(() => reserve(used, 1_000_000, DEFAULT_QUOTA_LIMITS))).toBe('DOCUMENT_QUOTA_EXCEEDED');
    expect(code(() => reserve(used, 709_120, DEFAULT_QUOTA_LIMITS))).toBeUndefined();
    expect(code(() => reserve(used, 709_121, DEFAULT_QUOTA_LIMITS))).toBe('DOCUMENT_QUOTA_EXCEEDED');
    expect(code(() => reserve({ ...EMPTY_USAGE, pendingUploads: 20 }, 1, DEFAULT_QUOTA_LIMITS))).toBe(
      'DOCUMENT_PENDING_UPLOADS_EXCEEDED',
    );
  });

  it('[TC-DOCUMENTS-ATTACH-011] el vínculo número 21 de un elemento se rechaza', () => {
    expect(() => assertLinkCapacity(19, 20)).not.toThrow();
    expect(() => assertLinkCapacity(20, 20)).toThrow(/maximum number of attachments/u);
  });
});
