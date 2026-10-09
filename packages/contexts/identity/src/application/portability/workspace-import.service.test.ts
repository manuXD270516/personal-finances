import { isDomainError, DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { serializeExportManifest, type ExportManifest } from '../../domain/export-manifest.js';
import { InMemoryPortability } from '../testing/in-memory-portability.js';
import { WorkspaceImportService, importObjectKey } from './workspace-import.service.js';

const manifest = (over: Partial<ExportManifest> = {}): ExportManifest => ({
  format: 'pfos-export',
  formatVersion: 1,
  workspaceId: '0190a000-0000-7000-8000-0000000000d1',
  workspaceName: 'W1',
  isDemo: false,
  exportedAt: '2026-10-01T10:00:00.000Z',
  snapshotAt: '2026-10-01T10:00:00.000Z',
  pfosVersion: '0.0.0',
  baseCurrency: 'BOB',
  timezone: 'America/La_Paz',
  sections: [],
  csv: [],
  verification: { accountBalances: [], trialBalance: [] },
  actors: [],
  ...over,
});
// En los dobles, el "ZIP" es el manifiesto serializado (el inspector real lee el manifest.json del ZIP).
const file = (over: Partial<ExportManifest> = {}) =>
  Buffer.from(serializeExportManifest(manifest(over)), 'utf8');

const setup = () => {
  const p = new InMemoryPortability();
  const user = p.base.addUser('u1@demo.pfos.test');
  const home = p.base.addWorkspace('Personal', [[user, 'OWNER']]);
  p.base.workspaces.set(home.id, home);
  const base = p.deps();
  const deps = { ...base, settings: { ...base.settings, maxImportBytes: 4096 } };
  return { p, user, home, service: new WorkspaceImportService(deps) };
};

const codeOf = async (fn: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await fn();
  } catch (err) {
    return isDomainError(err) ? err.code : `NOT_DOMAIN_ERROR:${String(err)}`;
  }
  return undefined;
};

describe('WorkspaceImportService — solicitud (validación previa)', () => {
  it('[TC-IDENTITY-RESTORE-001] un export válido se guarda cifrado, se registra, se audita en el hogar y se encola', async () => {
    const { p, user, home, service } = setup();
    const view = await service.requestImport({
      userId: user.id,
      file: file(),
      authTimeSeconds: p.authTime(1),
    });
    expect(view).toMatchObject({
      status: 'RECEIVED',
      workspaceId: null,
      sourceWorkspaceId: manifest().workspaceId,
    });
    expect(p.importJobs).toEqual([{ importId: view.id, requestedBy: user.id }]);
    const stored = p.objects.get(importObjectKey(user.id, view.id));
    expect(stored?.toString('utf8')).not.toContain('pfos-export');
    expect(p.base.auditEntries).toEqual([
      expect.objectContaining({
        action: 'identity.import.requested',
        workspaceId: home.id,
        aggregateType: 'WorkspaceImport',
      }),
    ]);
  });

  it('[TC-IDENTITY-RESTORE-004] manifiesto ausente o archivo alterado ⇒ EXPORT_FILE_CORRUPTED sin crear nada', async () => {
    const { p, user, service } = setup();
    expect(
      await codeOf(() =>
        service.requestImport({
          userId: user.id,
          file: Buffer.from('no es un zip'),
          authTimeSeconds: p.authTime(1),
        }),
      ),
    ).toBe('EXPORT_FILE_CORRUPTED');
    expect(p.imports.size).toBe(0);
    expect(p.objects.size).toBe(0);
    expect(p.importJobs).toHaveLength(0);
    expect(p.base.workspaces.size).toBe(1);
  });

  it('[TC-IDENTITY-RESTORE-004] versión de formato 99 ⇒ EXPORT_FORMAT_UNSUPPORTED', async () => {
    const { p, user, service } = setup();
    const bad = Buffer.from(JSON.stringify({ ...manifest(), formatVersion: 99 }));
    expect(
      await codeOf(() =>
        service.requestImport({ userId: user.id, file: bad, authTimeSeconds: p.authTime(1) }),
      ),
    ).toBe('EXPORT_FORMAT_UNSUPPORTED');
    expect(p.imports.size).toBe(0);
  });

  it('[TC-IDENTITY-RESTORE-006] el export de un workspace demo se rechaza, no crea nada y deja la solicitud auditada sin contenido', async () => {
    const { p, user, home, service } = setup();
    const demo = Buffer.from(JSON.stringify({ ...manifest(), isDemo: true, workspaceName: 'Demo secreto' }));
    expect(
      await codeOf(() =>
        service.requestImport({ userId: user.id, file: demo, authTimeSeconds: p.authTime(1) }),
      ),
    ).toBe('EXPORT_FORMAT_UNSUPPORTED');
    expect(p.imports.size).toBe(0);
    expect(p.objects.size).toBe(0);
    expect(p.base.workspaces.size).toBe(1);
    expect(p.base.auditEntries).toHaveLength(1);
    expect(p.base.auditEntries[0]).toMatchObject({
      action: 'identity.import.rejected',
      workspaceId: home.id,
    });
    expect(JSON.stringify(p.base.auditEntries)).not.toContain('Demo secreto');
    expect(JSON.stringify(p.base.auditEntries[0]?.changes)).toContain('EXPORT_FORMAT_UNSUPPORTED');
  });

  it('[TC-IDENTITY-RESTORE-007] un archivo mayor que el límite ⇒ UPLOAD_TOO_LARGE sin crear ni almacenar nada', async () => {
    const { p, user, service } = setup();
    expect(
      await codeOf(() =>
        service.requestImport({
          userId: user.id,
          file: Buffer.alloc(5000, 1),
          authTimeSeconds: p.authTime(1),
        }),
      ),
    ).toBe('UPLOAD_TOO_LARGE');
    expect(p.imports.size).toBe(0);
    expect(p.objects.size).toBe(0);
  });

  it('[TC-IDENTITY-RESTORE-001] exige autenticación reciente', async () => {
    const { p, user, service } = setup();
    expect(
      await codeOf(() =>
        service.requestImport({ userId: user.id, file: file(), authTimeSeconds: p.authTime(45) }),
      ),
    ).toBe('REAUTHENTICATION_REQUIRED');
    expect(p.objects.size).toBe(0);
  });

  it('una segunda importación en curso del mismo usuario ⇒ IMPORT_IN_PROGRESS y no deja objeto huérfano', async () => {
    const { p, user, service } = setup();
    await service.requestImport({ userId: user.id, file: file(), authTimeSeconds: p.authTime(1) });
    expect(
      await codeOf(() =>
        service.requestImport({ userId: user.id, file: file(), authTimeSeconds: p.authTime(1) }),
      ),
    ).toBe('IMPORT_IN_PROGRESS');
    expect(p.objects.size).toBe(1);
    expect(p.imports.size).toBe(1);
  });
});

describe('WorkspaceImportService — ejecución del job', () => {
  it('[TC-IDENTITY-RESTORE-001] crea el workspace nuevo, audita la restauración, publica el evento y borra el archivo subido', async () => {
    const { p, user, home, service } = setup();
    const view = await service.requestImport({
      userId: user.id,
      file: file(),
      authTimeSeconds: p.authTime(1),
    });
    expect(await service.run({ importId: view.id, requestedBy: user.id })).toBe('SUCCEEDED');
    expect(p.importCalls).toHaveLength(1);
    expect(p.importCalls[0]?.name).toBe('W1 (restaurado)');
    const done = await service.getImport(user.id, view.id);
    expect(done).toMatchObject({ status: 'SUCCEEDED', counts: { transactions: 120 } });
    expect(done.workspaceId).toBe(p.importCalls[0]?.newWorkspaceId);
    expect(done.workspaceId).not.toBe(manifest().workspaceId);
    expect(p.objects.size).toBe(0);
    const actions = p.base.auditEntries.map(
      (e) => `${e.workspaceId === home.id ? 'home' : 'new'}:${e.action}`,
    );
    expect(actions).toEqual([
      'home:identity.import.requested',
      'new:identity.workspace.restored',
      'home:identity.import.succeeded',
    ]);
    const restored = p.base.outboxEvents.find((e) => e.eventType === 'identity.WorkspaceRestored');
    expect(restored?.payload).toMatchObject({
      workspaceId: done.workspaceId,
      importId: view.id,
      sourceWorkspaceId: manifest().workspaceId,
    });
  });

  it('[TC-IDENTITY-RESTORE-003] una verificación fallida deja FAILED, sin workspace nuevo, y borra el archivo subido', async () => {
    const { p, user, service } = setup();
    const view = await service.requestImport({
      userId: user.id,
      file: file(),
      authTimeSeconds: p.authTime(1),
    });
    p.importFailure = new DomainError('EXPORT_VERIFICATION_FAILED', 'balance mismatch');
    expect(await service.run({ importId: view.id, requestedBy: user.id })).toBe('FAILED');
    const failed = await service.getImport(user.id, view.id);
    expect(failed).toMatchObject({
      status: 'FAILED',
      errorCode: 'EXPORT_VERIFICATION_FAILED',
      workspaceId: null,
    });
    expect(p.base.outboxEvents.some((e) => e.eventType === 'identity.WorkspaceRestored')).toBe(false);
    expect(p.objects.size).toBe(0);
    expect(p.base.auditEntries.at(-1)).toMatchObject({ action: 'identity.import.failed' });
    // Reintentar un job ya terminal no hace nada.
    expect(await service.run({ importId: view.id, requestedBy: user.id })).toBe('SKIPPED');
  });

  it('un error inesperado marca FAILED (IMPORT_FAILED) y se propaga para que la cola reintente', async () => {
    const { p, user, service } = setup();
    const view = await service.requestImport({
      userId: user.id,
      file: file(),
      authTimeSeconds: p.authTime(1),
    });
    p.importFailure = new Error('conexión caída');
    await expect(service.run({ importId: view.id, requestedBy: user.id })).rejects.toThrow('conexión caída');
    expect((await service.getImport(user.id, view.id)).errorCode).toBe('IMPORT_FAILED');
  });

  it('un usuario no ve las importaciones de otro (RESOURCE_NOT_FOUND)', async () => {
    const { p, user, service } = setup();
    const other = p.base.addUser('u2@demo.pfos.test');
    const view = await service.requestImport({
      userId: user.id,
      file: file(),
      authTimeSeconds: p.authTime(1),
    });
    expect(await codeOf(() => service.getImport(other.id, view.id))).toBe('RESOURCE_NOT_FOUND');
  });
});
