/**
 * Navegación principal del marco autenticado (docs/28 §2.1): secciones habilitadas en Phase 1, en el orden de la
 * sidebar (más Planificación, Phase 2). Lógica pura (sin React) para poder probar qué sección queda activa en cada ruta.
 */

export type NavKey = 'home' | 'transactions' | 'accounts' | 'fx' | 'classification' | 'planning' | 'settings';

export interface NavItem {
  readonly key: NavKey;
  /** Ruta sin prefijo de locale. */
  readonly path: string;
  /** Otras rutas que pertenecen a la sección (p. ej. transferencias dentro de Transacciones). */
  readonly also?: readonly string[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', path: '/' },
  { key: 'transactions', path: '/transacciones', also: ['/transferencias'] },
  { key: 'accounts', path: '/cuentas', also: ['/instituciones'] },
  { key: 'fx', path: '/fx' },
  { key: 'classification', path: '/clasificacion' },
  // Phase 2 (add-financial-periods): calendario financiero; pf-p2b agrega presupuestos bajo /planificacion.
  { key: 'planning', path: '/planificacion/periodos', also: ['/planificacion'] },
  { key: 'settings', path: '/configuracion' },
];

/** Ruta sin el prefijo de locale (`/en/cuentas` → `/cuentas`, `/pt` → `/`) ni barra final. */
export function stripLocale(pathname: string): string {
  const bare = pathname.replace(/^\/(?:es|en|pt)(?=\/|$)/, '') || '/';
  return bare.length > 1 ? bare.replace(/\/+$/, '') || '/' : bare;
}

const within = (path: string, base: string): boolean => path === base || path.startsWith(`${base}/`);

/** Sección activa para la ruta actual (`aria-current="page"`); `undefined` fuera de la navegación principal. */
export function activeNav(pathname: string): NavKey | undefined {
  const path = stripLocale(pathname);
  // La evolución del patrimonio (/patrimonio) cuelga del Home: no es una sección propia de la sidebar.
  if (path === '/' || within(path, '/patrimonio')) return 'home';
  return NAV_ITEMS.find(
    (item) => item.path !== '/' && [item.path, ...(item.also ?? [])].some((base) => within(path, base)),
  )?.key;
}

/** Inicial para el avatar del menú de usuario (primera letra del nombre visible). */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : '?';
}

/**
 * La bandeja y el detalle de notificaciones (/notificaciones, /notificaciones/{id}) no son una sección de la
 * sidebar: su acceso es la campana de la barra superior, que se marca con aria-current en esas rutas.
 */
export function isNotificationsRoute(pathname: string): boolean {
  return within(stripLocale(pathname), '/notificaciones');
}
