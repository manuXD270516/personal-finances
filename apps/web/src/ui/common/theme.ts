/**
 * Tema de la interfaz (change add-dark-theme, D501): el tema sigue al sistema y la preferencia propia vive en
 * `preferences.theme` del perfil (`/me`). La cookie `pfos_theme` (`light` | `dark`; ausente = sistema) es solo un espejo
 * para que el servidor ponga `data-theme` y `color-scheme` en el primer HTML, sin scripts en línea (CSP por nonce).
 * Módulo puro: lo usan el layout, el formulario de Preferencias y el BFF.
 */

export const THEME_COOKIE = 'pfos_theme';
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ThemeScheme = 'light' | 'dark';

/** Valores de `--pf-bg` por esquema (`app/globals.css`); `contrast.test.ts` comprueba que coinciden con la hoja. */
export const THEME_COLOR: Readonly<Record<ThemeScheme, string>> = { light: '#ffffff', dark: '#0b0f14' }; // color-data: meta theme-color, validado contra globals.css

const COOKIE_MAX_AGE_SECONDS = 31_536_000;

/** `preferences` es un objeto libre: cualquier valor desconocido se trata como «sistema». */
export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/** Valor de la cookie espejo: `light` o `dark`; «sistema» no lleva cookie. */
export function themeCookieValue(pref: ThemePreference): ThemeScheme | undefined {
  return pref === 'light' || pref === 'dark' ? pref : undefined;
}

/** Esquema de la cookie recibida; cualquier otro valor se ignora. */
export function themeSchemeFromCookie(raw: string | undefined): ThemeScheme | undefined {
  return raw === 'light' || raw === 'dark' ? raw : undefined;
}

/** Tema guardado en el cuerpo de `GET /api/v1/me` (sin cambio de contrato). */
export function themeFromMeBody(body: unknown): ThemePreference {
  if (typeof body !== 'object' || body === null) return 'system';
  const prefs = (body as { preferences?: unknown }).preferences;
  if (typeof prefs !== 'object' || prefs === null) return 'system';
  return parseThemePreference((prefs as { theme?: unknown }).theme);
}

/**
 * Cabecera `Set-Cookie` (o cadena para `document.cookie`) de la cookie espejo. Sin `HttpOnly` a propósito: la escribe el
 * cliente y solo contiene una de dos palabras. «Sistema» la borra.
 */
export function themeCookieHeader(pref: ThemePreference, secure: boolean): string {
  const value = themeCookieValue(pref);
  const parts = [
    `${THEME_COOKIE}=${value ?? ''}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${value ? COOKIE_MAX_AGE_SECONDS : 0}`,
  ];
  if (secure && value) parts.push('Secure');
  return parts.join('; ');
}
