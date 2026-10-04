import { currency, isDomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { Workspace } from './workspace.js';

const BOB = currency('BOB', 2);
const OWNER = '0190a000-0000-7000-8000-000000000001';
const ORIGIN = '0190a000-0000-7000-8000-0000000000a1';
const DEMO = '0190a000-0000-7000-8000-0000000000d1';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return isDomainError(err) ? err.code : 'NOT_DOMAIN_ERROR';
  }
  return undefined;
};

const demo = () =>
  Workspace.createDemo({
    id: DEMO,
    name: 'Demo — Finanzas de Valeria',
    baseCurrency: BOB,
    timeZone: 'America/La_Paz',
    locale: 'es-BO',
    ownerUserId: OWNER,
    originWorkspaceId: ORIGIN,
    datasetVersion: '1',
  });

const real = () =>
  Workspace.create({
    id: ORIGIN,
    name: 'W1 Personal Demo',
    baseCurrency: BOB,
    timeZone: 'America/La_Paz',
    locale: 'es-BO',
    ownerUserId: OWNER,
    personal: false,
  });

describe('Workspace demo (identity/demo-data, ADR-0026)', () => {
  it('[TC-IDENTITY-DEMO-001] createDemo crea un workspace marcado como demo, LOADING, con el solicitante como único OWNER', () => {
    const ws = demo();
    expect(ws.isDemo).toBe(true);
    expect(ws.demo).toEqual({
      status: 'LOADING',
      originWorkspaceId: ORIGIN,
      requestedBy: OWNER,
      datasetVersion: '1',
    });
    expect(ws.status).toBe('ACTIVE');
    expect(ws.memberships).toEqual([{ userId: OWNER, role: 'OWNER', status: 'ACTIVE' }]);
    expect(ws.personalOfUserId).toBeNull();
    expect(ws.isRetired).toBe(false);
  });

  it('[TC-IDENTITY-DEMO-005] un workspace real no es demo y no hay operación que cambie la marca', () => {
    const ws = real();
    expect(ws.isDemo).toBe(false);
    expect(ws.demo).toBeNull();
    // La marca solo existe en la fábrica: el agregado no expone ninguna mutación de `isDemo`.
    expect(
      Object.getOwnPropertyNames(Workspace.prototype).filter((m) => /isDemo|setDemo|markAsDemo/.test(m)),
    ).toEqual(['isDemo']);
    expect(codeOf(() => Workspace.createDemo({ ...demoInput(), originWorkspaceId: DEMO }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('[TC-IDENTITY-DEMO-008] máquina de estados: LOADING → READY | FAILED → CLEANING → PURGED', () => {
    const ready = demo();
    ready.markDemoLoaded();
    expect(ready.demo?.status).toBe('READY');
    expect(codeOf(() => ready.markDemoLoaded())).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => ready.markDemoFailed())).toBe('INVALID_STATUS_TRANSITION');

    const failed = demo();
    failed.markDemoFailed();
    expect(failed.demo?.status).toBe('FAILED');
    expect(failed.isRetired).toBe(false);
    expect(failed.requestDemoCleanup()).toBe(true);
    expect(failed.demo?.status).toBe('CLEANING');

    expect(codeOf(() => demo().markDemoPurged())).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-IDENTITY-DEMO-010] limpiar archiva al instante y es idempotente; no se limpia un demo que aún carga', () => {
    const ws = demo();
    expect(codeOf(() => ws.requestDemoCleanup())).toBe('INVALID_STATUS_TRANSITION');
    ws.markDemoLoaded();
    const v = ws.version;
    expect(ws.requestDemoCleanup()).toBe(true);
    expect(ws.status).toBe('ARCHIVED');
    expect(ws.isRetired).toBe(true);
    expect(ws.demo?.status).toBe('CLEANING');
    expect(ws.version).toBe(v + 1);
    // Repetir no tiene efectos.
    expect(ws.requestDemoCleanup()).toBe(false);
    expect(ws.version).toBe(v + 1);
    ws.markDemoPurged();
    expect(ws.status).toBe('PURGED');
    expect(ws.demo?.status).toBe('PURGED');
    expect(ws.requestDemoCleanup()).toBe(false);
  });

  it('[TC-IDENTITY-DEMO-006] limpiar un workspace real se rechaza con WORKSPACE_NOT_DEMO', () => {
    const ws = real();
    expect(codeOf(() => ws.requestDemoCleanup())).toBe('WORKSPACE_NOT_DEMO');
    expect(codeOf(() => ws.markDemoPurged())).toBe('WORKSPACE_NOT_DEMO');
    expect(codeOf(() => ws.markDemoLoaded())).toBe('WORKSPACE_NOT_DEMO');
    expect(ws.status).toBe('ACTIVE');
  });

  it('restore conserva la marca y el estado demo', () => {
    const ws = demo();
    ws.markDemoLoaded();
    const copy = Workspace.restore(ws.snapshot());
    expect(copy.isDemo).toBe(true);
    expect(copy.demo?.status).toBe('READY');
    expect(codeOf(() => Workspace.restore({ ...ws.snapshot(), status: 'PURGED', demo: null }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

function demoInput() {
  return {
    id: DEMO,
    name: 'Demo — Finanzas de Valeria',
    baseCurrency: BOB,
    timeZone: 'America/La_Paz',
    locale: 'es-BO',
    ownerUserId: OWNER,
    originWorkspaceId: ORIGIN,
    datasetVersion: '1',
  };
}
