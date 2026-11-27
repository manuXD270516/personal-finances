import {
  themeCookieHeader,
  themeCookieValue,
  themeSchemeFromCookie,
  THEME_COOKIE,
  type ThemePreference,
} from './theme';

/** Esquema de la cookie espejo `pfos_theme` en este navegador (`undefined` = sigue al sistema). */
export function readThemeCookie(): 'light' | 'dark' | undefined {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === THEME_COOKIE)
      return themeSchemeFromCookie(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Aplica la preferencia en el navegador sin recargar: escribe (o borra) la cookie espejo y fija `data-theme` en
 * `<html>`. «Sistema» quita ambos y deja mandar a `prefers-color-scheme`.
 */
export function applyThemePreference(pref: ThemePreference): void {
  document.cookie = themeCookieHeader(pref, window.location.protocol === 'https:');
  const scheme = themeCookieValue(pref);
  if (scheme) document.documentElement.dataset.theme = scheme;
  else delete document.documentElement.dataset.theme;
}
