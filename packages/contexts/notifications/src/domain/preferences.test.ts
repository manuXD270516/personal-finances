import { describe, expect, it } from 'vitest';
import { NotificationPreferences } from './preferences.js';

const USER = '01928c4e-0000-7000-8000-0000000ea001';
const WS = '01928c4e-0000-7000-8000-00000000a001';

describe('NotificationPreferences', () => {
  it('[TC-NOTIFICATIONS-PREFS-003] por defecto ambos canales activos, sin detalles y sin horario de silencio', () => {
    const prefs = NotificationPreferences.defaults(USER, WS);
    expect(prefs.toView()).toEqual({
      types: [
        { type: 'BUDGET_THRESHOLD', inApp: true, email: true },
        { type: 'MONTH_CLOSE_PENDING', inApp: true, email: true },
        { type: 'RECURRING_PAYMENT_UPCOMING', inApp: true, email: true },
        { type: 'RECURRING_APPROVAL_REQUIRED', inApp: true, email: true },
        { type: 'SUBSCRIPTION_RENEWAL', inApp: true, email: true },
        { type: 'SUBSCRIPTION_TRIAL_ENDING', inApp: true, email: true },
        { type: 'SUBSCRIPTION_PRICE_CHANGE', inApp: true, email: true },
        { type: 'CARD_PAYMENT_DUE', inApp: true, email: true },
        { type: 'CARD_UTILIZATION', inApp: true, email: true },
      ],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    expect(prefs.isEnabled('BUDGET_THRESHOLD', 'EMAIL')).toBe(true);
    expect(prefs.version).toBe(1);
    expect(prefs.persistedVersion).toBe(0);
  });

  it('[TC-NOTIFICATIONS-PREFS-001] desactivar el email de umbrales deja in-app activo y devuelve el cambio para auditar', () => {
    const prefs = NotificationPreferences.defaults(USER, WS);
    const changes = prefs.update({
      types: [{ type: 'BUDGET_THRESHOLD', inApp: true, email: false }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    expect(changes).toEqual([{ field: 'byType.BUDGET_THRESHOLD.EMAIL', before: true, after: false }]);
    expect(prefs.isEnabled('BUDGET_THRESHOLD', 'IN_APP')).toBe(true);
    expect(prefs.isEnabled('BUDGET_THRESHOLD', 'EMAIL')).toBe(false);
    expect(prefs.isEnabled('MONTH_CLOSE_PENDING', 'EMAIL')).toBe(true);
    expect(prefs.version).toBe(2);
  });

  it('el horario de silencio y el opt-in de detalles se auditan campo a campo', () => {
    const prefs = NotificationPreferences.defaults(USER, WS);
    const changes = prefs.update({
      types: [],
      quietHours: { start: '22:00', end: '07:00' },
      includeDetailsInEmail: true,
    });
    expect(changes.map((c) => c.field)).toEqual(['quietHours', 'includeDetailsInEmail']);
    expect(prefs.quietHours?.end).toBe('07:00');
    expect(prefs.includeDetailsInEmail).toBe(true);
  });

  it('un PUT idéntico no cambia versión ni produce cambios', () => {
    const prefs = NotificationPreferences.defaults(USER, WS);
    expect(prefs.update({ types: [], quietHours: null, includeDetailsInEmail: false })).toEqual([]);
    expect(prefs.version).toBe(1);
  });

  it('rechaza tipos desconocidos o repetidos y horarios inválidos', () => {
    const prefs = NotificationPreferences.defaults(USER, WS);
    expect(() =>
      prefs.update({
        types: [{ type: 'GOAL', inApp: true, email: true }],
        quietHours: null,
        includeDetailsInEmail: false,
      }),
    ).toThrow(/unknown notification type/);
    expect(() =>
      prefs.update({
        types: [
          { type: 'BUDGET_THRESHOLD', inApp: true, email: true },
          { type: 'BUDGET_THRESHOLD', inApp: false, email: true },
        ],
        quietHours: null,
        includeDetailsInEmail: false,
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      prefs.update({ types: [], quietHours: { start: '22:00', end: '22:00' }, includeDetailsInEmail: false }),
    ).toThrow(/differ/);
    expect(prefs.version).toBe(1);
  });

  it('los tipos omitidos en el PUT conservan su valor', () => {
    const prefs = NotificationPreferences.defaults(USER, WS);
    prefs.update({
      types: [{ type: 'MONTH_CLOSE_PENDING', inApp: false, email: true }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    prefs.update({
      types: [{ type: 'BUDGET_THRESHOLD', inApp: true, email: false }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    expect(prefs.isEnabled('MONTH_CLOSE_PENDING', 'IN_APP')).toBe(false);
    expect(prefs.isEnabled('BUDGET_THRESHOLD', 'EMAIL')).toBe(false);
  });
});
