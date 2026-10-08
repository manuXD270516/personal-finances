import { describe, expect, it } from 'vitest';
import { WS } from '../domain/fixtures.js';
import { PreferencesService } from './preferences.service.js';
import { NotificationsTestEnv, OWNER } from './testing/in-memory.js';

const setup = () => {
  const env = new NotificationsTestEnv();
  return { env, service: new PreferencesService(env.preferencesDeps()) };
};

describe('PreferencesService', () => {
  it('[TC-NOTIFICATIONS-PREFS-003] sin configuración devuelve los valores por defecto con la versión 1', async () => {
    const { service } = setup();
    expect(await service.get(WS, OWNER)).toEqual({
      types: [
        { type: 'BUDGET_THRESHOLD', inApp: true, email: true },
        { type: 'MONTH_CLOSE_PENDING', inApp: true, email: true },
      ],
      quietHours: null,
      includeDetailsInEmail: false,
      version: 1,
    });
  });

  it('[TC-NOTIFICATIONS-PREFS-001] el cambio de preferencias queda auditado campo a campo y sube la versión', async () => {
    const { env, service } = setup();
    const saved = await service.update({
      workspaceId: WS,
      userId: OWNER,
      expectedVersion: 1,
      preferences: {
        types: [{ type: 'BUDGET_THRESHOLD', inApp: true, email: false }],
        quietHours: { start: '22:00', end: '07:00' },
        includeDetailsInEmail: true,
      },
    });
    expect(saved.version).toBe(2);
    expect(saved.types[0]).toEqual({ type: 'BUDGET_THRESHOLD', inApp: true, email: false });
    expect(saved.quietHours).toEqual({ start: '22:00', end: '07:00' });
    expect(env.audit).toHaveLength(1);
    expect(env.audit[0]).toMatchObject({
      workspaceId: WS,
      action: 'notifications.preferences.updated',
      aggregateType: 'NotificationPreferences',
      aggregateId: OWNER,
      aggregateVersion: 2,
    });
    expect(env.audit[0]?.changes?.map((c) => c.field).sort()).toEqual([
      'byType.BUDGET_THRESHOLD.EMAIL',
      'includeDetailsInEmail',
      'quietHours',
    ]);
    expect(await service.get(WS, OWNER)).toEqual(saved);
  });

  it('un PUT idéntico no cambia la versión ni audita', async () => {
    const { env, service } = setup();
    const result = await service.update({
      workspaceId: WS,
      userId: OWNER,
      expectedVersion: 1,
      preferences: { types: [], quietHours: null, includeDetailsInEmail: false },
    });
    expect(result.version).toBe(1);
    expect(env.audit).toHaveLength(0);
  });

  it('un If-Match desactualizado responde PRECONDITION_FAILED con la versión actual y no cambia nada', async () => {
    const { env, service } = setup();
    await service.update({
      workspaceId: WS,
      userId: OWNER,
      expectedVersion: 1,
      preferences: { types: [], quietHours: null, includeDetailsInEmail: true },
    });
    await expect(
      service.update({
        workspaceId: WS,
        userId: OWNER,
        expectedVersion: 1,
        preferences: { types: [], quietHours: null, includeDetailsInEmail: false },
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', details: { currentVersion: 2 } });
    expect((await service.get(WS, OWNER)).includeDetailsInEmail).toBe(true);
    expect(env.audit).toHaveLength(1);
  });

  it('un horario de silencio inválido responde VALIDATION_FAILED y no audita', async () => {
    const { env, service } = setup();
    await expect(
      service.update({
        workspaceId: WS,
        userId: OWNER,
        expectedVersion: 1,
        preferences: {
          types: [],
          quietHours: { start: '25:00', end: '07:00' },
          includeDetailsInEmail: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(env.audit).toHaveLength(0);
  });
});
