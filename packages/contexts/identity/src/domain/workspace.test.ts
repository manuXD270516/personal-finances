import { currency, isDomainError, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { LocaleTag } from './locale-tag.js';
import { PERMISSIONS, ROLES, isRole, minimumRoleFor, roleAtLeast, roleGrants } from './role.js';
import { TimeZoneId } from './time-zone.js';
import { User } from './user.js';
import { Workspace } from './workspace.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const OWNER = '0190a000-0000-7000-8000-000000000001';
const EDITOR = '0190a000-0000-7000-8000-000000000002';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return isDomainError(err) ? err.code : 'NOT_DOMAIN_ERROR';
  }
  return undefined;
};

const personal = () =>
  Workspace.create({
    id: '0190a000-0000-7000-8000-0000000000a1',
    name: 'Personal',
    baseCurrency: BOB,
    timeZone: 'America/La_Paz',
    locale: 'es-BO',
    ownerUserId: OWNER,
    personal: true,
  });

describe('Workspace (dominio IDENTITY)', () => {
  it('se crea con su creador como único OWNER, día fiscal 1 y sin reserva', () => {
    const ws = personal();
    expect(ws.memberships).toEqual([{ userId: OWNER, role: 'OWNER', status: 'ACTIVE' }]);
    expect(ws.settings.fiscalMonthStartDay).toBe(1);
    expect(ws.settings.minimumLiquidityReserve).toBeNull();
    expect(ws.personalOfUserId).toBe(OWNER);
    expect(ws.version).toBe(1);
    expect(ws.roleOf(OWNER)).toBe('OWNER');
    expect(ws.roleOf(EDITOR)).toBeNull();
  });

  it('exige al menos un OWNER activo: el último OWNER no puede salir ni degradarse', () => {
    const ws = personal();
    expect(codeOf(() => ws.revoke(OWNER))).toBe('LAST_OWNER_CANNOT_LEAVE');
    expect(codeOf(() => ws.changeRole(OWNER, 'EDITOR'))).toBe('LAST_OWNER_CANNOT_LEAVE');
    ws.addMember(EDITOR, 'EDITOR');
    ws.changeRole(EDITOR, 'OWNER');
    ws.revoke(OWNER);
    expect(ws.roleOf(OWNER)).toBeNull();
    expect(ws.roleOf(EDITOR)).toBe('OWNER');
  });

  it('admite una sola membresía por usuario', () => {
    const ws = personal();
    expect(codeOf(() => ws.addMember(OWNER, 'VIEWER'))).toBe('VALIDATION_FAILED');
    expect(
      codeOf(() =>
        Workspace.restore({
          ...ws.snapshot(),
          memberships: [
            { userId: OWNER, role: 'OWNER', status: 'ACTIVE' },
            { userId: OWNER, role: 'VIEWER', status: 'ACTIVE' },
          ],
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it.each([0, 29, 1.5, -1])('fiscalMonthStartDay %s fuera de 1..28 → VALIDATION_FAILED', (day) => {
    const ws = personal();
    expect(codeOf(() => ws.updateSettings({ fiscalMonthStartDay: day }))).toBe('VALIDATION_FAILED');
    expect(ws.version).toBe(1);
  });

  it('reserva mínima: 1500.00 BOB válida, 1500.005 BOB → AMOUNT_SCALE_EXCEEDED sin cambios, negativa rechazada', () => {
    const ws = personal();
    const changes = ws.updateSettings({ minimumLiquidityReserve: { amount: '1500.00', currency: BOB } });
    expect(changes).toEqual([
      { field: 'minimumLiquidityReserve', before: null, after: { amount: '1500.00', currency: 'BOB' } },
    ]);
    expect(ws.settings.minimumLiquidityReserve?.toJSON()).toEqual({ amount: '1500.00', currency: 'BOB' });
    expect(
      codeOf(() => ws.updateSettings({ minimumLiquidityReserve: { amount: '1500.005', currency: BOB } })),
    ).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(
      codeOf(() => ws.updateSettings({ minimumLiquidityReserve: { amount: '-1.00', currency: BOB } })),
    ).toBe('AMOUNT_OUT_OF_RANGE');
    expect(ws.settings.minimumLiquidityReserve?.toFixed()).toBe('1500.00');
    expect(ws.version).toBe(2);
    ws.updateSettings({ minimumLiquidityReserve: null });
    expect(ws.settings.minimumLiquidityReserve).toBeNull();
  });

  it('updateSettings es todo o nada y devuelve solo los cambios efectivos', () => {
    const ws = personal();
    expect(codeOf(() => ws.updateSettings({ name: 'Nuevo', timeZone: 'Mars/Olympus' }))).toBe(
      'INVALID_TIMEZONE',
    );
    expect(ws.settings.name).toBe('Personal');
    const changes = ws.updateSettings({ name: 'Personal', baseCurrency: USD, fiscalMonthStartDay: 25 });
    expect(changes).toEqual([
      { field: 'baseCurrency', before: 'BOB', after: 'USD' },
      { field: 'fiscalMonthStartDay', before: 1, after: 25 },
    ]);
    expect(ws.version).toBe(2);
    expect(ws.updateSettings({ baseCurrency: USD })).toEqual([]);
    expect(ws.version).toBe(2);
  });

  it('nombre vacío o de más de 100 caracteres → VALIDATION_FAILED', () => {
    expect(codeOf(() => personal().updateSettings({ name: '   ' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => personal().updateSettings({ name: 'x'.repeat(101) }))).toBe('VALIDATION_FAILED');
  });
});

describe('TimeZoneId, LocaleTag y User', () => {
  it.each(['America/La_Paz', 'America/Sao_Paulo', 'UTC', 'Europe/Madrid'])(
    '%s es una zona IANA válida',
    (tz) => {
      expect(TimeZoneId.of(tz).value).toBe(tz);
    },
  );

  it.each(['Mars/Olympus', '', 'America/La Paz', '../etc', 'x'.repeat(65)])('%j → INVALID_TIMEZONE', (tz) => {
    expect(codeOf(() => TimeZoneId.of(tz))).toBe('INVALID_TIMEZONE');
  });

  it('LocaleTag canoniza y limita a es/en/pt', () => {
    expect(LocaleTag.of('es-bo').value).toBe('es-BO');
    expect(LocaleTag.of('en-US').value).toBe('en-US');
    expect(codeOf(() => LocaleTag.of('fr-FR'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => LocaleTag.of('not a locale!'))).toBe('VALIDATION_FAILED');
  });

  it('User.updatePreferences valida la zona y solo versiona cambios reales', () => {
    const user = User.restore({
      id: OWNER,
      idpIssuer: 'http://keycloak/realms/pfos',
      idpSubject: 'kc-0001',
      email: 'owner@demo.pfos.test',
      displayName: 'Owner',
      locale: LocaleTag.of('es-BO'),
      timeZone: null,
      status: 'ACTIVE',
      version: 3,
    });
    expect(user.updatePreferences({ locale: 'en-US', timeZone: 'America/Sao_Paulo' })).toBe(true);
    expect(user.version).toBe(4);
    expect(codeOf(() => user.updatePreferences({ timeZone: 'Mars/Olympus' }))).toBe('INVALID_TIMEZONE');
    expect(user.timeZone?.value).toBe('America/Sao_Paulo');
    expect(user.updatePreferences({ locale: 'en-US' })).toBe(false);
    expect(user.updatePreferences({ timeZone: null })).toBe(true);
    expect(user.timeZone).toBeNull();
    expect(codeOf(() => User.restore({ ...user.snapshot(), email: 'no-es-email' }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('User.updatePreferences cambia el nombre visible y fusiona preferencias (null borra la clave)', () => {
    const user = User.restore({
      id: OWNER,
      idpIssuer: 'http://keycloak/realms/pfos',
      idpSubject: 'kc-0001',
      email: 'owner@demo.pfos.test',
      displayName: 'Owner',
      locale: LocaleTag.of('es-BO'),
      timeZone: null,
      status: 'ACTIVE',
      version: 1,
      preferences: { theme: 'light' },
    });
    expect(user.updatePreferences({ displayName: '  Ana  ', preferences: { density: 'compact' } })).toBe(
      true,
    );
    expect(user.displayName).toBe('Ana');
    expect(user.preferences).toEqual({ theme: 'light', density: 'compact' });
    expect(user.updatePreferences({ preferences: { theme: null } })).toBe(true);
    expect(user.preferences).toEqual({ density: 'compact' });
    expect(user.updatePreferences({ displayName: 'Ana', preferences: { density: 'compact' } })).toBe(false);
    expect(user.version).toBe(3);
    expect(codeOf(() => user.updatePreferences({ displayName: ' ' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => user.updatePreferences({ displayName: 'x'.repeat(101) }))).toBe('VALIDATION_FAILED');
    expect(user.displayName).toBe('Ana');
  });
});

describe('roleGrants (docs/12 §4)', () => {
  it('VIEWER solo lee; EDITOR escribe; OWNER administra', () => {
    expect(roleGrants('VIEWER', 'finance:read')).toBe(true);
    expect(roleGrants('VIEWER', 'finance:write')).toBe(false);
    expect(roleGrants('EDITOR', 'finance:write')).toBe(true);
    expect(roleGrants('EDITOR', 'workspace:admin')).toBe(false);
    expect(roleGrants('OWNER', 'workspace:admin')).toBe(true);
  });

  it('es monótona: si un rol concede un permiso, todo rol superior también', () => {
    for (const p of PERMISSIONS) {
      for (const r of ROLES) {
        if (roleGrants(r, p)) {
          for (const higher of ROLES.filter((x) => roleAtLeast(x, r)))
            expect(roleGrants(higher, p)).toBe(true);
        }
      }
      expect(roleGrants(minimumRoleFor(p), p)).toBe(true);
    }
  });
});

describe('VOs e invariantes restantes (cobertura de dominio ≥ 90 %, add-workspace-identity 4.1)', () => {
  it('TimeZoneId acepta alias IANA que el motor resuelve y compara por valor', () => {
    const alias = TimeZoneId.of('America/Buenos_Aires');
    expect(alias.toString()).toBe('America/Buenos_Aires');
    expect(alias.equals(TimeZoneId.of('America/Buenos_Aires'))).toBe(true);
    expect(alias.equals(TimeZoneId.of('America/La_Paz'))).toBe(false);
    expect(codeOf(() => TimeZoneId.of(42 as unknown as string))).toBe('INVALID_TIMEZONE');
  });

  it('LocaleTag rechaza etiquetas demasiado largas y se serializa como su valor canónico', () => {
    expect(String(LocaleTag.of('pt-br'))).toBe('pt-BR');
    expect(
      codeOf(() => LocaleTag.of(`es-${'x'.repeat(8)}-${'y'.repeat(8)}-${'z'.repeat(8)}-${'w'.repeat(8)}`)),
    ).toBe('VALIDATION_FAILED');
  });

  it('isRole y minimumRoleFor reflejan la tabla de docs/12 §4', () => {
    expect(ROLES.every((r) => isRole(r))).toBe(true);
    expect([isRole('ADMIN'), isRole(null), isRole(1)]).toEqual([false, false, false]);
    expect(minimumRoleFor('finance:read')).toBe('VIEWER');
    expect(minimumRoleFor('import:revert')).toBe('EDITOR');
    expect(minimumRoleFor('audit:read')).toBe('OWNER');
  });

  it('User expone su identidad del IdP y rechaza preferencias demasiado grandes sin cambios', () => {
    const user = User.restore({
      id: OWNER,
      idpIssuer: 'http://keycloak/realms/pfos',
      idpSubject: 'kc-0001',
      email: 'owner@demo.pfos.test',
      displayName: 'Owner',
      locale: LocaleTag.of('es-BO'),
      timeZone: null,
      status: 'DISABLED',
      version: 1,
    });
    expect([user.idpIssuer, user.idpSubject, user.status, user.email]).toEqual([
      'http://keycloak/realms/pfos',
      'kc-0001',
      'DISABLED',
      'owner@demo.pfos.test',
    ]);
    expect(user.preferences).toEqual({});
    expect(codeOf(() => user.updatePreferences({ preferences: { big: 'x'.repeat(20_000) } }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(user.preferences).toEqual({});
    expect(user.version).toBe(1);
  });

  it('restore rechaza estados imposibles: reserva negativa y ARCHIVED/PURGED de un workspace real', () => {
    const snap = personal().snapshot();
    expect(personal().createdAt).toBeNull();
    expect(
      codeOf(() =>
        Workspace.restore({
          ...snap,
          settings: { ...snap.settings, minimumLiquidityReserve: Money.parse('-1.00', BOB) },
        }),
      ),
    ).toBe('AMOUNT_OUT_OF_RANGE');
    expect(codeOf(() => Workspace.restore({ ...snap, status: 'ARCHIVED' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => Workspace.restore({ ...snap, status: 'PURGED' }))).toBe('VALIDATION_FAILED');
    expect(Workspace.restore({ ...snap, createdAt: '2026-10-01T00:00:00Z' }).createdAt).toBe(
      '2026-10-01T00:00:00Z',
    );
  });
});
