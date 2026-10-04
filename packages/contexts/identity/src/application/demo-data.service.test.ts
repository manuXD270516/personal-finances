import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { isDomainError } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoDataService } from './demo-data.service.js';
import { InMemoryIdentity } from './testing/in-memory.js';

const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;
const EVENTS = new URL('../../../../../contracts/events/', import.meta.url);
const load = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(path, EVENTS), 'utf8')) as Record<string, unknown>;

function payloadValidator(schemaPath: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const schema = load(schemaPath);
  ajv.addSchema(load('envelope.v1.schema.json'));
  ajv.addSchema(schema);
  return ajv.compile({ $ref: `${String(schema['$id'])}#/$defs/Payload` });
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return isDomainError(err) ? err.code : `NOT_DOMAIN_ERROR: ${String(err)}`;
  }
  return undefined;
}

describe('DemoDataService (identity/demo-data)', () => {
  let mem: InMemoryIdentity;
  let svc: DemoDataService;
  let owner: ReturnType<InMemoryIdentity['addUser']>;
  let editor: ReturnType<InMemoryIdentity['addUser']>;
  let w1: ReturnType<InMemoryIdentity['addWorkspace']>;

  beforeEach(() => {
    mem = new InMemoryIdentity();
    svc = new DemoDataService(mem.demoDeps());
    owner = mem.addUser('owner@demo.pfos.test');
    editor = mem.addUser('editor@demo.pfos.test');
    w1 = mem.addWorkspace('W1 Personal Demo', [
      [owner, 'OWNER'],
      [editor, 'EDITOR'],
    ]);
  });

  it('[TC-IDENTITY-DEMO-001] el OWNER crea un workspace demo LOADING del que es único OWNER y se encola la carga', async () => {
    const status = await svc.requestDemoData(owner.id, w1.id);
    expect(status).toMatchObject({
      originWorkspaceId: w1.id,
      status: 'LOADING',
      datasetVersion: '1',
      anchorDate: '2026-10-02',
      progress: { completedModules: [], totalModules: 6 },
      loadedAt: null,
      cleanupRequestedAt: null,
      purgedAt: null,
    });
    const demo = mem.workspaces.get(status.demoWorkspaceId);
    expect(demo?.isDemo).toBe(true);
    expect(demo?.settings.name).toBe('Demo — Finanzas de Valeria');
    expect(demo?.settings.baseCurrency.code).toBe('BOB');
    expect(demo?.memberships).toEqual([{ userId: owner.id, role: 'OWNER', status: 'ACTIVE' }]);
    expect(mem.loadJobs).toEqual([
      {
        demoWorkspaceId: status.demoWorkspaceId,
        originWorkspaceId: w1.id,
        requestedBy: owner.id,
        datasetVersion: '1',
        anchorDate: '2026-10-02',
      },
    ]);
  });

  it('[TC-IDENTITY-DEMO-002] un EDITOR del origen recibe INSUFFICIENT_ROLE y no se crea nada', async () => {
    expect(await codeOf(svc.requestDemoData(editor.id, w1.id))).toBe('INSUFFICIENT_ROLE');
    expect(mem.workspaces.size).toBe(1);
    expect(mem.loadJobs).toEqual([]);
    expect(mem.auditEntries).toEqual([]);
  });

  it('[TC-IDENTITY-DEMO-009] una segunda carga con un demo vigente se rechaza con DEMO_WORKSPACE_ALREADY_EXISTS', async () => {
    await svc.requestDemoData(owner.id, w1.id);
    const before = mem.workspaces.size;
    expect(await codeOf(svc.requestDemoData(owner.id, w1.id))).toBe('DEMO_WORKSPACE_ALREADY_EXISTS');
    expect(mem.workspaces.size).toBe(before);
    expect(mem.loadJobs).toHaveLength(1);
  });

  it('[TC-IDENTITY-DEMO-012] con la carga deshabilitada se rechaza con DEMO_DATA_DISABLED; la limpieza sigue disponible', async () => {
    const status = await svc.requestDemoData(owner.id, w1.id);
    await svc.markDemoLoaded(loadJob(status.demoWorkspaceId));
    const disabled = new DemoDataService(mem.demoDeps({ enabled: false }));
    expect(await codeOf(disabled.requestDemoData(owner.id, w1.id))).toBe('DEMO_DATA_DISABLED');
    expect((await disabled.cleanupDemoData(owner.id, status.demoWorkspaceId)).status).toBe('CLEANING');
    expect(disabled.enabled).toBe(false);
  });

  it('[TC-IDENTITY-DEMO-013] carga y limpieza se auditan en el workspace de origen con actor, instante y demo afectado', async () => {
    const status = await svc.requestDemoData(owner.id, w1.id);
    const demoId = status.demoWorkspaceId;
    await svc.markDemoLoaded(loadJob(demoId));
    await svc.cleanupDemoData(owner.id, demoId);
    await svc.purgeDemoWorkspace({
      demoWorkspaceId: demoId,
      originWorkspaceId: w1.id,
      requestedBy: owner.id,
    });
    const inOrigin = mem.auditEntries.filter((e) => e.workspaceId === w1.id);
    expect(inOrigin.map((e) => e.action)).toEqual([
      'identity.demo.load_requested',
      'identity.demo.loaded',
      'identity.demo.cleanup_requested',
      'identity.demo.purged',
    ]);
    for (const e of inOrigin) {
      expect(e.aggregateId).toBe(demoId);
      expect(e.changes?.find((c) => c.field === 'demoWorkspaceId')?.after).toBe(demoId);
    }
    expect(inOrigin.map((e) => e.actor)).toEqual([
      { type: 'USER', userId: owner.id },
      { type: 'SYSTEM', process: 'system:demo' },
      { type: 'USER', userId: owner.id },
      { type: 'SYSTEM', process: 'system:demo' },
    ]);
    // Sin datos financieros del demo: solo identificadores, versión, ancla y conteos.
    const fields = new Set(inOrigin.flatMap((e) => (e.changes ?? []).map((c) => c.field)));
    expect([...fields].sort()).toEqual([
      'anchorDate',
      'datasetVersion',
      'demoStatus',
      'demoWorkspaceId',
      'rowsDeleted',
    ]);
    expect(mem.purgeJobs).toEqual([
      { demoWorkspaceId: demoId, originWorkspaceId: w1.id, requestedBy: owner.id },
    ]);
  });

  it('[TC-IDENTITY-DEMO-006] limpiar un workspace real se rechaza con WORKSPACE_NOT_DEMO sin efectos', async () => {
    expect(await codeOf(svc.cleanupDemoData(owner.id, w1.id))).toBe('WORKSPACE_NOT_DEMO');
    expect(mem.workspaces.get(w1.id)?.status).toBe('ACTIVE');
    expect(mem.purgeJobs).toEqual([]);
    expect(mem.outboxEvents).toEqual([]);
    expect(await codeOf(svc.cleanupDemoData(editor.id, w1.id))).toBe('INSUFFICIENT_ROLE');
  });

  it('[TC-IDENTITY-DEMO-010] limpiar archiva al instante (deja de listarse), publica DemoDataCleaned y es idempotente', async () => {
    const status = await svc.requestDemoData(owner.id, w1.id);
    const demoId = status.demoWorkspaceId;
    await svc.markDemoLoaded(loadJob(demoId));
    const cleaned = await svc.cleanupDemoData(owner.id, demoId);
    expect(cleaned).toMatchObject({ status: 'CLEANING', cleanupRequestedAt: '2026-10-02T12:00:00.000Z' });
    const deps = mem.demoDeps();
    expect((await deps.workspaces.listForUser(owner.id)).map((w) => w.id)).toEqual([w1.id]);
    expect(await deps.memberships.activeRole(owner.id, demoId)).toBeNull();
    const again = await svc.cleanupDemoData(owner.id, demoId);
    expect(again.status).toBe('CLEANING');
    expect(mem.purgeJobs).toHaveLength(1);
    const events = mem.outboxEvents.filter((e) => e.eventType === 'identity.DemoDataCleaned');
    expect(events).toHaveLength(1);
    expect(events[0]?.workspaceId).toBe(w1.id);
    expect(events[0]?.aggregateId).toBe(demoId);
    const validate = payloadValidator('identity/DemoDataCleaned.v1.schema.json');
    expect(validate(events[0]?.payload), JSON.stringify(validate.errors)).toBe(true);
  });

  it('[TC-IDENTITY-DEMO-008] una carga fallida queda FAILED con su código, no se presenta como lista y puede limpiarse', async () => {
    const status = await svc.requestDemoData(owner.id, w1.id);
    const demoId = status.demoWorkspaceId;
    await svc.markDemoFailed(loadJob(demoId), 'DEMO_LOAD_FAILED');
    const failed = await svc.getDemoDataStatus(owner.id, w1.id);
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'DEMO_LOAD_FAILED', loadedAt: null });
    expect(await codeOf(svc.markDemoLoaded(loadJob(demoId)))).toBe('INVALID_STATUS_TRANSITION');
    expect((await svc.cleanupDemoData(owner.id, demoId)).status).toBe('CLEANING');
  });

  it('[TC-IDENTITY-DEMO-008] una carga interrumpida (reintento del job con progreso previo) se marca FAILED en lugar de reanudar', async () => {
    const status = await svc.requestDemoData(owner.id, w1.id);
    const job = loadJob(status.demoWorkspaceId);
    expect(await svc.beginDemoLoad(job)).toBe(true);
    await svc.recordDemoProgress(job, { completedModules: ['accounts'], totalModules: 6 });
    expect(await svc.beginDemoLoad(job)).toBe(false);
    expect((await svc.getDemoDataStatus(owner.id, w1.id)).status).toBe('FAILED');
    expect((await svc.getDemoDataStatus(owner.id, w1.id)).errorCode).toBe('DEMO_LOAD_INTERRUPTED');
  });

  it('DemoDataLoaded.v1 se publica en el workspace demo y cumple el schema; el estado pasa a READY', async () => {
    const status = await svc.requestDemoData(owner.id, w1.id);
    await svc.markDemoLoaded(loadJob(status.demoWorkspaceId));
    const loaded = mem.outboxEvents.filter((e) => e.eventType === 'identity.DemoDataLoaded');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.workspaceId).toBe(status.demoWorkspaceId);
    expect(loaded[0]?.actor).toEqual({ type: 'SYSTEM', id: 'system:demo' });
    const validate = payloadValidator('identity/DemoDataLoaded.v1.schema.json');
    expect(validate(loaded[0]?.payload), JSON.stringify(validate.errors)).toBe(true);
    expect(await svc.getDemoDataStatus(owner.id, status.demoWorkspaceId)).toMatchObject({
      status: 'READY',
      loadedAt: '2026-10-02T12:00:00.000Z',
    });
  });

  it('el estado desde el origen sin demos responde RESOURCE_NOT_FOUND; tras la purga, PURGED', async () => {
    expect(await codeOf(svc.getDemoDataStatus(owner.id, w1.id))).toBe('RESOURCE_NOT_FOUND');
    const status = await svc.requestDemoData(owner.id, w1.id);
    const demoId = status.demoWorkspaceId;
    await svc.markDemoLoaded(loadJob(demoId));
    await svc.cleanupDemoData(owner.id, demoId);
    await svc.purgeDemoWorkspace({
      demoWorkspaceId: demoId,
      originWorkspaceId: w1.id,
      requestedBy: owner.id,
    });
    expect((await svc.getDemoDataStatus(owner.id, w1.id)).status).toBe('PURGED');
    // Purgado el demo, el usuario puede pedir otro.
    expect((await svc.requestDemoData(owner.id, w1.id)).status).toBe('LOADING');
  });

  function loadJob(demoWorkspaceId: string) {
    return {
      demoWorkspaceId,
      originWorkspaceId: w1.id,
      requestedBy: owner.id,
      datasetVersion: '1',
      anchorDate: '2026-10-02',
    };
  }
});
