import { Instant, isDomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { InMemoryPortability } from '../testing/in-memory-portability.js';
import { WorkspaceExportService, exportObjectKey } from './workspace-export.service.js';

const setup = () => {
  const p = new InMemoryPortability();
  const owner = p.base.addUser('owner@demo.pfos.test');
  const editor = p.base.addUser('editor@demo.pfos.test');
  const ws = p.base.addWorkspace('W1', [
    [owner, 'OWNER'],
    [editor, 'EDITOR'],
  ]);
  const service = new WorkspaceExportService(p.deps());
  return { p, owner, editor, ws, service };
};

const codeOf = async (fn: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await fn();
  } catch (err) {
    return isDomainError(err) ? err.code : `NOT_DOMAIN_ERROR:${String(err)}`;
  }
  return undefined;
};

describe('WorkspaceExportService — solicitud (identity/workspace-portability)', () => {
  it('[TC-IDENTITY-EXPORT-001] el OWNER autenticado hace 3 min obtiene una operación pendiente, auditada y con su job', async () => {
    const { p, owner, ws, service } = setup();
    const view = await service.requestExport({
      userId: owner.id,
      workspaceId: ws.id,
      authTimeSeconds: p.authTime(3),
    });
    expect(view).toMatchObject({ status: 'REQUESTED', workspaceId: ws.id, requestedBy: owner.id });
    const op = await service.getOperation(owner.id, ws.id, view.operationId);
    expect(op).toMatchObject({ kind: 'EXPORT', status: 'PENDING', resourceId: view.id });
    expect(p.exportJobs).toEqual([{ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id }]);
    expect(p.base.auditEntries.map((e) => e.action)).toEqual(['identity.export.requested']);
  });

  it('[TC-IDENTITY-EXPORT-001] autenticado hace 45 min ⇒ REAUTHENTICATION_REQUIRED y no se crea ninguna operación', async () => {
    const { p, owner, ws, service } = setup();
    expect(
      await codeOf(() =>
        service.requestExport({ userId: owner.id, workspaceId: ws.id, authTimeSeconds: p.authTime(45) }),
      ),
    ).toBe('REAUTHENTICATION_REQUIRED');
    expect(
      await codeOf(() =>
        service.requestExport({ userId: owner.id, workspaceId: ws.id, authTimeSeconds: undefined }),
      ),
    ).toBe('REAUTHENTICATION_REQUIRED');
    expect(p.operations.size).toBe(0);
    expect(p.exports.size).toBe(0);
    expect(p.exportJobs).toHaveLength(0);
  });

  it('[TC-IDENTITY-EXPORT-001] un EDITOR recibe INSUFFICIENT_ROLE y un no miembro WORKSPACE_ACCESS_DENIED', async () => {
    const { p, editor, ws, service } = setup();
    const outsider = p.base.addUser('out@demo.pfos.test');
    expect(
      await codeOf(() =>
        service.requestExport({ userId: editor.id, workspaceId: ws.id, authTimeSeconds: p.authTime(1) }),
      ),
    ).toBe('INSUFFICIENT_ROLE');
    expect(
      await codeOf(() =>
        service.requestExport({ userId: outsider.id, workspaceId: ws.id, authTimeSeconds: p.authTime(1) }),
      ),
    ).toBe('WORKSPACE_ACCESS_DENIED');
    expect(await codeOf(() => service.listExports(editor.id, ws.id))).toBe('INSUFFICIENT_ROLE');
    expect(p.exports.size).toBe(0);
  });

  it('[TC-IDENTITY-EXPORT-001] una segunda exportación en curso se rechaza con EXPORT_IN_PROGRESS', async () => {
    const { p, owner, ws, service } = setup();
    await service.requestExport({ userId: owner.id, workspaceId: ws.id, authTimeSeconds: p.authTime(2) });
    expect(
      await codeOf(() =>
        service.requestExport({ userId: owner.id, workspaceId: ws.id, authTimeSeconds: p.authTime(2) }),
      ),
    ).toBe('EXPORT_IN_PROGRESS');
    expect(p.exports.size).toBe(1);
  });
});

describe('WorkspaceExportService — ejecución, descarga, retención y auditoría', () => {
  const requested = async (ctx = setup()) => {
    const view = await ctx.service.requestExport({
      userId: ctx.owner.id,
      workspaceId: ctx.ws.id,
      authTimeSeconds: ctx.p.authTime(1),
    });
    return { ...ctx, view };
  };

  it('[TC-IDENTITY-EXPORT-005] el job deja el archivo CIFRADO (sin texto en claro), READY, auditado y con el evento sin cifras', async () => {
    const { p, owner, ws, service, view } = await requested();
    expect(await service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id })).toBe('READY');
    const stored = p.objects.get(exportObjectKey(ws.id, view.id));
    expect(stored).toBeDefined();
    expect(stored?.toString('utf8')).not.toContain('Bank A');
    expect(stored?.subarray(0, 2).toString('ascii')).not.toBe('PK');
    const done = await service.getExport(owner.id, ws.id, view.id);
    expect(done).toMatchObject({ status: 'READY', counts: { transactions: 120 }, errorCode: null });
    expect(done.expiresAt).toBe('2026-10-09T12:00:00.000Z');
    expect(done.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect((await service.getOperation(owner.id, ws.id, view.operationId)).status).toBe('SUCCEEDED');
    const event = p.base.outboxEvents.find((e) => e.eventType === 'identity.WorkspaceExportCompleted');
    expect(event?.payload).toEqual({
      workspaceId: ws.id,
      exportId: view.id,
      status: 'READY',
      expiresAt: '2026-10-09T12:00:00.000Z',
      requestedBy: owner.id,
    });
    expect(JSON.stringify(event)).not.toMatch(/Bank A|3099/u);
    expect(p.base.auditEntries.map((e) => e.action)).toEqual([
      'identity.export.requested',
      'identity.export.completed',
    ]);
  });

  it('[TC-IDENTITY-EXPORT-002] una falla al construir deja FAILED sin objeto huérfano, auditada y con evento FAILED', async () => {
    const { p, owner, ws, service, view } = await requested();
    p.buildFailure = new Error('boom with secret detail');
    await expect(
      service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id }),
    ).rejects.toThrow('boom');
    expect(p.objects.size).toBe(0);
    const failed = await service.getExport(owner.id, ws.id, view.id);
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'EXPORT_FAILED' });
    expect(JSON.stringify(p.exports.get(view.id)?.snapshot().error)).not.toContain('secret detail');
    expect(p.base.outboxEvents.at(-1)?.payload).toMatchObject({ status: 'FAILED', expiresAt: null });
    expect(p.base.auditEntries.at(-1)?.action).toBe('identity.export.failed');
    // Un reintento del job sobre un export ya fallido no hace nada.
    expect(await service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id })).toBe(
      'SKIPPED',
    );
  });

  it('[TC-IDENTITY-EXPORT-006] el OWNER con autenticación reciente descarga el ZIP en claro con su SHA-256 y queda auditado', async () => {
    const { p, owner, ws, service, view } = await requested();
    await service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id });
    const dl = await service.download({
      userId: owner.id,
      workspaceId: ws.id,
      exportId: view.id,
      authTimeSeconds: p.authTime(2),
    });
    const chunks: Buffer[] = [];
    for await (const c of dl.stream) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    expect(body.equals(p.zipContent)).toBe(true);
    expect(dl.sha256).toBe((await service.getExport(owner.id, ws.id, view.id)).sha256);
    expect(dl.fileName).toMatch(/^pfos-export-.+\.zip$/u);
    expect(p.base.auditEntries.filter((e) => e.action === 'identity.export.downloaded')).toHaveLength(1);
  });

  it('[TC-IDENTITY-EXPORT-006] descarga: en curso ⇒ EXPORT_NOT_READY; EDITOR ⇒ INSUFFICIENT_ROLE; sin reauth ⇒ REAUTHENTICATION_REQUIRED', async () => {
    const { p, owner, editor, ws, service, view } = await requested();
    expect(
      await codeOf(() =>
        service.download({
          userId: owner.id,
          workspaceId: ws.id,
          exportId: view.id,
          authTimeSeconds: p.authTime(2),
        }),
      ),
    ).toBe('EXPORT_NOT_READY');
    await service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id });
    expect(
      await codeOf(() =>
        service.download({
          userId: editor.id,
          workspaceId: ws.id,
          exportId: view.id,
          authTimeSeconds: p.authTime(2),
        }),
      ),
    ).toBe('INSUFFICIENT_ROLE');
    expect(
      await codeOf(() =>
        service.download({
          userId: owner.id,
          workspaceId: ws.id,
          exportId: view.id,
          authTimeSeconds: p.authTime(60),
        }),
      ),
    ).toBe('REAUTHENTICATION_REQUIRED');
    expect(p.base.auditEntries.filter((e) => e.action === 'identity.export.downloaded')).toHaveLength(0);
  });

  it('[TC-IDENTITY-EXPORT-005] un objeto alterado en el almacenamiento ⇒ EXPORT_FILE_CORRUPTED sin entregar contenido ni auditar descarga', async () => {
    const { p, owner, ws, service, view } = await requested();
    await service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id });
    const key = exportObjectKey(ws.id, view.id);
    const object = Buffer.from(p.objects.get(key) as Buffer);
    object[0] = (object[0] as number) ^ 0xff;
    p.objects.set(key, object);
    expect(
      await codeOf(() =>
        service.download({
          userId: owner.id,
          workspaceId: ws.id,
          exportId: view.id,
          authTimeSeconds: p.authTime(1),
        }),
      ),
    ).toBe('EXPORT_FILE_CORRUPTED');
    expect(p.base.auditEntries.filter((e) => e.action === 'identity.export.downloaded')).toHaveLength(0);
  });

  it('[TC-IDENTITY-EXPORT-007] a los 7 días el job de retención elimina el objeto, marca EXPIRED y la descarga da EXPORT_EXPIRED', async () => {
    const { p, owner, ws, service, view } = await requested();
    await service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id });
    const before = await service.getExport(owner.id, ws.id, view.id);
    p.base.clock.set(Instant.parse('2026-10-09T12:00:00.000Z'));
    // Aún sin correr el job: ya se rechaza como vencido (nunca se descarga un export vencido).
    p.base.clock.advance(1_000);
    expect(
      await codeOf(() =>
        service.download({
          userId: owner.id,
          workspaceId: ws.id,
          exportId: view.id,
          authTimeSeconds: p.authTime(1),
        }),
      ),
    ).toBe('EXPORT_EXPIRED');
    expect(await service.expireDue()).toBe(1);
    expect(await service.expireDue()).toBe(0);
    expect(p.objects.size).toBe(0);
    const after = await service.getExport(owner.id, ws.id, view.id);
    expect(after).toMatchObject({ status: 'EXPIRED', sizeBytes: before.sizeBytes, sha256: before.sha256 });
    expect(
      await codeOf(() =>
        service.download({
          userId: owner.id,
          workspaceId: ws.id,
          exportId: view.id,
          authTimeSeconds: p.authTime(1),
        }),
      ),
    ).toBe('EXPORT_EXPIRED');
    const expiredAudit = p.base.auditEntries.find((e) => e.action === 'identity.export.expired');
    expect(expiredAudit?.actor).toEqual({ type: 'SYSTEM', process: 'identity.export-retention' });
  });

  it('[TC-IDENTITY-EXPORT-008] eliminar un export terminado borra el objeto, conserva el registro y es idempotente', async () => {
    const { p, owner, editor, ws, service, view } = await requested();
    await service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id });
    expect(await codeOf(() => service.discard(editor.id, ws.id, view.id))).toBe('INSUFFICIENT_ROLE');
    expect((await service.discard(owner.id, ws.id, view.id)).status).toBe('DISCARDED');
    expect((await service.discard(owner.id, ws.id, view.id)).status).toBe('DISCARDED');
    expect(p.objects.size).toBe(0);
    expect(p.base.auditEntries.filter((e) => e.action === 'identity.export.discarded')).toHaveLength(1);
    expect(
      await codeOf(() =>
        service.download({
          userId: owner.id,
          workspaceId: ws.id,
          exportId: view.id,
          authTimeSeconds: p.authTime(1),
        }),
      ),
    ).toBe('EXPORT_EXPIRED');
  });

  it('[TC-IDENTITY-EXPORT-008] no se elimina un export en curso (EXPORT_NOT_READY)', async () => {
    const { owner, ws, service, view } = await requested();
    expect(await codeOf(() => service.discard(owner.id, ws.id, view.id))).toBe('EXPORT_NOT_READY');
  });

  it('[TC-IDENTITY-EXPORT-009] el ciclo completo queda auditado en orden y sin contenido exportado', async () => {
    const { p, owner, ws, service, view } = await requested();
    await service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id });
    for (let i = 0; i < 2; i += 1) {
      const dl = await service.download({
        userId: owner.id,
        workspaceId: ws.id,
        exportId: view.id,
        authTimeSeconds: p.authTime(1),
      });
      for await (const _ of dl.stream) void _;
    }
    p.base.clock.set(Instant.parse('2026-10-10T00:00:00.000Z'));
    await service.expireDue();
    const trail = p.base.auditEntries.filter((e) => e.aggregateType === 'WorkspaceExport');
    expect(trail.map((e) => e.action)).toEqual([
      'identity.export.requested',
      'identity.export.completed',
      'identity.export.downloaded',
      'identity.export.downloaded',
      'identity.export.expired',
    ]);
    expect(trail.map((e) => e.aggregateId)).toEqual(Array(5).fill(view.id));
    expect(trail.map((e) => e.actor?.type)).toEqual(['USER', 'SYSTEM', 'USER', 'USER', 'SYSTEM']);
    expect(JSON.stringify(trail)).not.toMatch(/Bank A/u);
  });

  it('[TC-IDENTITY-EXPORT-011] el evento de export terminado no contiene montos ni nombres de cuentas', async () => {
    const { p, owner, ws, service, view } = await requested();
    await service.run({ workspaceId: ws.id, exportId: view.id, requestedBy: owner.id });
    const event = p.base.outboxEvents.find((e) => e.eventType === 'identity.WorkspaceExportCompleted');
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual([
      'expiresAt',
      'exportId',
      'requestedBy',
      'status',
      'workspaceId',
    ]);
  });
});
