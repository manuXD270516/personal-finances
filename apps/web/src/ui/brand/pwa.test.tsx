import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import manifest from '../../../app/manifest';
import { InstallApp } from '../common/InstallApp';
import { THEME_COLOR } from '../common/theme';
import es from '../../../messages/es.json';

/**
 * Manifiesto, íconos y marcado del botón de instalación (change add-pwa-install; D504: solo instalable).
 */
const WEB = resolve(__dirname, '../../..');
const m = manifest();

/** Ancho y alto del encabezado IHDR de un PNG (sin dependencias). */
function pngSize(file: string): { width: number; height: number; signature: boolean } {
  const bytes = readFileSync(file);
  const signature = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { signature, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('manifiesto', () => {
  it('[TC-PLATFORM-PWA-001] declara identidad, inicio y alcance relativos, presentación independiente e idioma es-BO', () => {
    expect(m).toMatchObject({
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      lang: 'es-BO',
      name: 'PFOS — Finanzas personales',
      short_name: 'PFOS',
    });
  });

  it('[TC-PLATFORM-PWA-001] no depende del dominio: ninguna ruta del manifiesto es absoluta', () => {
    const urls = [
      m.id,
      m.start_url,
      m.scope,
      ...(m.icons ?? []).map((i) => i.src),
      ...(m.shortcuts ?? []).map((s) => s.url),
    ];
    for (const url of urls) expect(url).toMatch(/^\/(?!\/)/);
  });

  it('[TC-PLATFORM-PWA-003] declara el atajo «Registrar gasto» al alta de transacción dentro del alcance', () => {
    expect(m.shortcuts).toEqual([
      expect.objectContaining({ name: 'Registrar gasto', url: '/transacciones/nueva' }),
    ]);
    expect(m.shortcuts?.[0]?.url.startsWith(m.scope ?? '')).toBe(true);
  });

  it('[TC-PLATFORM-PWA-015] los colores son los de la superficie del tema claro', () => {
    expect(m.theme_color).toBe(THEME_COLOR.light);
    expect(m.background_color).toBe(THEME_COLOR.light);
  });
});

describe('íconos', () => {
  it('[TC-PLATFORM-PWA-004] cada ícono del manifiesto existe, es PNG y mide lo que declara', () => {
    expect(m.icons?.map((i) => `${i.sizes}:${i.purpose}`).sort()).toEqual([
      '192x192:any',
      '512x512:any',
      '512x512:maskable',
    ]);
    for (const icon of m.icons ?? []) {
      const [w, h] = (icon.sizes ?? '').split('x').map(Number);
      const size = pngSize(resolve(WEB, 'public', icon.src.slice(1)));
      expect(size, icon.src).toEqual({ signature: true, width: w, height: h });
    }
  });

  it('[TC-PLATFORM-PWA-005] el ícono de iOS app/apple-icon.png es PNG de 180 × 180', () => {
    expect(pngSize(resolve(WEB, 'app/apple-icon.png'))).toEqual({ signature: true, width: 180, height: 180 });
  });

  it('[TC-PLATFORM-PWA-005] el motivo del SVG fuente cabe en la zona segura (círculo del 80 % del lado)', () => {
    const svg = readFileSync(resolve(WEB, 'src/ui/brand/app-icon.svg'), 'utf8');
    const side = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
    const safeRadius = side * 0.4;
    for (const tag of svg.match(/<circle[^>]*>/g) ?? []) {
      const r = Number(/\br="([\d.]+)"/.exec(tag)?.[1]);
      const stroke = Number(/stroke-width="([\d.]+)"/.exec(tag)?.[1] ?? 0);
      expect(r + stroke / 2, tag).toBeLessThanOrEqual(safeRadius);
    }
  });
});

describe('botón «Instalar la aplicación»', () => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="es" messages={es} timeZone="America/La_Paz">
      <InstallApp />
    </NextIntlClientProvider>,
  );

  it('[TC-PLATFORM-PWA-007] oculto por omisión: sin aviso del navegador no se renderiza botón, enlace ni texto', () => {
    expect(html).toBe('');
  });
});

describe('sin service worker', () => {
  it('[TC-PLATFORM-PWA-010] ninguna parte del código de la web registra un service worker', () => {
    const roots = ['app', 'src'].map((d) => resolve(WEB, d));
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/serviceWorker/.test(readFileSync(path, 'utf8'))) found.push(path);
        }
      }
    };
    roots.forEach(walk);
    expect(found).toEqual([]);
  });
});
