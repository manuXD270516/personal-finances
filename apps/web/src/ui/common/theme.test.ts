import { describe, expect, it } from 'vitest';
import {
  THEME_COLOR,
  THEME_COOKIE,
  parseThemePreference,
  themeCookieHeader,
  themeCookieValue,
  themeFromMeBody,
  themeSchemeFromCookie,
} from './theme';

describe('[TC-PLATFORM-THEME-012] preferencia de tema y cookie espejo', () => {
  it('parseThemePreference acepta los tres valores y trata lo desconocido como «system»', () => {
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    for (const raw of [undefined, null, '', 'DARK', 'sepia', 3, {}, ['dark']]) {
      expect(parseThemePreference(raw)).toBe('system');
    }
  });

  it('themeCookieValue solo emite «light» o «dark»; «system» no lleva cookie', () => {
    expect(themeCookieValue('light')).toBe('light');
    expect(themeCookieValue('dark')).toBe('dark');
    expect(themeCookieValue('system')).toBeUndefined();
  });

  it('themeFromMeBody lee preferences.theme del cuerpo de /me y tolera cuerpos raros', () => {
    expect(themeFromMeBody({ id: 'x', preferences: { theme: 'dark' } })).toBe('dark');
    expect(themeFromMeBody({ preferences: { theme: 'light' } })).toBe('light');
    expect(themeFromMeBody({ preferences: { theme: 'system' } })).toBe('system');
    expect(themeFromMeBody({ preferences: {} })).toBe('system');
    expect(themeFromMeBody({ preferences: { theme: 'sepia' } })).toBe('system');
    for (const body of [null, undefined, 'x', 4, [], { preferences: null }, { preferences: 'dark' }]) {
      expect(themeFromMeBody(body)).toBe('system');
    }
  });

  it('themeSchemeFromCookie ignora cualquier valor que no sea «light» o «dark»', () => {
    expect(themeSchemeFromCookie('light')).toBe('light');
    expect(themeSchemeFromCookie('dark')).toBe('dark');
    for (const raw of [undefined, '', 'system', 'DARK', 'dark; Path=/', 'x'.repeat(200)]) {
      expect(themeSchemeFromCookie(raw)).toBeUndefined();
    }
  });
});

describe('[TC-PLATFORM-THEME-013] atributos de la cookie pfos_theme', () => {
  it('con «dark» la cabecera lleva valor exacto, Path=/, SameSite=Lax y un año, sin HttpOnly', () => {
    const header = themeCookieHeader('dark', false);
    expect(header).toBe(`${THEME_COOKIE}=dark; Path=/; SameSite=Lax; Max-Age=31536000`);
    expect(header).not.toMatch(/HttpOnly/i);
    expect(header).not.toMatch(/Secure/i);
  });

  it('con HTTPS agrega Secure', () => {
    expect(themeCookieHeader('light', true)).toBe(
      `${THEME_COOKIE}=light; Path=/; SameSite=Lax; Max-Age=31536000; Secure`,
    );
  });

  it('con «system» borra la cookie (valor vacío y Max-Age=0)', () => {
    expect(themeCookieHeader('system', false)).toBe(`${THEME_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
  });
});

describe('[TC-PLATFORM-THEME-019] colores de la barra del navegador', () => {
  it('THEME_COLOR tiene un color por esquema', () => {
    expect(THEME_COLOR.light).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME_COLOR.dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME_COLOR.light).not.toBe(THEME_COLOR.dark);
  });
});
