import { Instant, isDomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { WorkspaceExport, type ExportResult } from './workspace-export.js';
import { WorkspaceImport } from './workspace-import.js';

const T0 = Instant.parse('2026-04-01T10:00:00.000Z');
const DAY = 24 * 3_600_000;
const RESULT: ExportResult = {
  objectKey: 'exports/ws/e1.enc',
  sizeBytes: 1234,
  sha256: 'a'.repeat(64),
  keyId: 'k1',
  wrappedKey: new Uint8Array(60),
  counts: { transactions: 120 },
};

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return isDomainError(err) ? err.code : 'NOT_DOMAIN_ERROR';
  }
  return undefined;
};

const requested = () =>
  WorkspaceExport.request({
    id: 'e1',
    workspaceId: 'w1',
    operationId: 'op1',
    requestedBy: 'u1',
    formatVersion: 1,
    at: T0,
  });

const ready = () => {
  const e = requested();
  e.start();
  e.complete(RESULT, T0, 7 * DAY);
  return e;
};

describe('WorkspaceExport (dominio IDENTITY)', () => {
  it('[TC-IDENTITY-EXPORT-001] nace REQUESTED y cuenta como en curso hasta terminar', () => {
    const e = requested();
    expect(e.status).toBe('REQUESTED');
    expect(e.inProgress).toBe(true);
    expect(e.start()).toBe(true);
    expect(e.status).toBe('RUNNING');
    expect(e.start()).toBe(false);
    expect(e.inProgress).toBe(true);
  });

  it('[TC-IDENTITY-EXPORT-007] al terminar vence a los 7 días y solo entonces rechaza la descarga con EXPORT_EXPIRED', () => {
    const e = ready();
    expect(e.snapshot().expiresAt).toBe('2026-04-08T10:00:00.000Z');
    expect(e.inProgress).toBe(false);
    expect(codeOf(() => e.assertDownloadable(Instant.parse('2026-04-08T09:59:59.999Z')))).toBeUndefined();
    expect(codeOf(() => e.assertDownloadable(Instant.parse('2026-04-08T10:00:01.000Z')))).toBe(
      'EXPORT_EXPIRED',
    );
    expect(e.expire(Instant.parse('2026-04-08T09:00:00.000Z'))).toBe(false);
    expect(e.expire(Instant.parse('2026-04-08T10:00:01.000Z'))).toBe(true);
    const s = e.snapshot();
    expect(s).toMatchObject({ status: 'EXPIRED', objectKey: null, sizeBytes: 1234, sha256: 'a'.repeat(64) });
    expect(codeOf(() => e.assertDownloadable(T0))).toBe('EXPORT_EXPIRED');
    expect(e.expire(Instant.parse('2026-04-09T10:00:01.000Z'))).toBe(false);
  });

  it('[TC-IDENTITY-EXPORT-006] un export en curso o fallido no se descarga (EXPORT_NOT_READY)', () => {
    const e = requested();
    expect(codeOf(() => e.assertDownloadable(T0))).toBe('EXPORT_NOT_READY');
    e.start();
    expect(codeOf(() => e.assertDownloadable(T0))).toBe('EXPORT_NOT_READY');
    e.fail({ code: 'EXPORT_FAILED', message: 'boom' }, T0);
    expect(e.status).toBe('FAILED');
    expect(codeOf(() => e.assertDownloadable(T0))).toBe('EXPORT_NOT_READY');
    expect(codeOf(() => e.fail({ code: 'X', message: 'y' }, T0))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-IDENTITY-EXPORT-008] eliminar un export terminado conserva el registro y es idempotente', () => {
    const e = ready();
    expect(e.discard('u1', T0.plusMillis(DAY))).toBe(true);
    expect(e.snapshot()).toMatchObject({
      status: 'DISCARDED',
      objectKey: null,
      discardedBy: 'u1',
      sizeBytes: 1234,
    });
    expect(e.discard('u1', T0.plusMillis(2 * DAY))).toBe(false);
    expect(codeOf(() => e.assertDownloadable(T0))).toBe('EXPORT_EXPIRED');
    expect(codeOf(() => requested().discard('u1', T0))).toBe('EXPORT_NOT_READY');
  });

  it('solo se completa un export en ejecución y con retención positiva', () => {
    expect(codeOf(() => requested().complete(RESULT, T0, DAY))).toBe('INVALID_STATUS_TRANSITION');
    const e = requested();
    e.start();
    expect(codeOf(() => e.complete(RESULT, T0, 0))).toBe('VALIDATION_FAILED');
  });
});

describe('WorkspaceImport (dominio IDENTITY)', () => {
  const received = () =>
    WorkspaceImport.receive({
      id: 'i1',
      requestedBy: 'u1',
      objectKey: 'imports/u1/i1.enc',
      keyId: 'k1',
      wrappedKey: new Uint8Array(60),
      sizeBytes: 10,
      sourceWorkspaceId: 'w1',
      sourceExportedAt: '2026-04-01T10:00:00.000Z',
      formatVersion: 1,
      at: T0,
    });

  it('[TC-IDENTITY-RESTORE-001] recorre los estados en orden y termina con workspace destino y sin archivo', () => {
    const i = received();
    expect(i.inProgress).toBe(true);
    i.advance('VALIDATING');
    i.advance('IMPORTING');
    i.advance('VERIFYING');
    i.succeed('w2', { rows: 3 }, T0);
    expect(i.snapshot()).toMatchObject({ status: 'SUCCEEDED', targetWorkspaceId: 'w2', objectKey: null });
    expect(i.inProgress).toBe(false);
  });

  it('[TC-IDENTITY-RESTORE-003] no se puede saltar un paso y una falla no deja workspace destino', () => {
    const i = received();
    expect(codeOf(() => i.advance('IMPORTING'))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => i.succeed('w2', {}, T0))).toBe('INVALID_STATUS_TRANSITION');
    i.advance('VALIDATING');
    i.fail({ code: 'EXPORT_VERIFICATION_FAILED', message: 'x' }, T0);
    expect(i.snapshot()).toMatchObject({ status: 'FAILED', targetWorkspaceId: null, objectKey: null });
    expect(codeOf(() => i.fail({ code: 'X', message: 'y' }, T0))).toBe('INVALID_STATUS_TRANSITION');
  });
});
