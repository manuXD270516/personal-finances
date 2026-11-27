import type { MetadataRoute } from 'next';
import { NEW_TRANSACTION_PATH } from '../src/ui/shell/nav';
import { THEME_COLOR } from '../src/ui/common/theme';

/**
 * Manifiesto de la aplicación instalable (openspec add-pwa-install, M-33 de docs/78; D504: solo instalable, sin service
 * worker). Next lo sirve en `/manifest.webmanifest` (fuera del `matcher` de `proxy.ts`: sin sesión, sin redirecciones y
 * sin CSP de página) y enlaza `<link rel="manifest">` en todas las páginas. Uno solo para es/en/pt: `start_url: '/'` lo
 * resuelve next-intl al idioma del usuario. Todo es relativo al origen, así que no depende del dominio (M-34). Los
 * colores son los del tema claro: solo valen hasta la primera pintura, después manda el `theme-color` por esquema.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'PFOS — Finanzas personales',
    short_name: 'PFOS',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'es-BO',
    dir: 'ltr',
    theme_color: THEME_COLOR.light,
    background_color: THEME_COLOR.light,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Registrar gasto',
        url: NEW_TRANSACTION_PATH,
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
