import type { CDPSession, Page } from '@playwright/test';
import { median, SLOW_CPU_RATE } from './inp.js';

/**
 * Medición informativa de la navegación entre secciones (change adopt-client-navigation, etapa 1; TC-PLATFORM-CLIENTNAV-001
 * y -002) contra el objetivo de LCP ≤ 2.5 s de NFR-PERF-004. Reutiliza `median` y la tasa de CPU de `inp.ts`.
 *
 * Con navegación por documento el contexto JS se pierde al hacer clic, así que el instante del clic se guarda en
 * `sessionStorage` (como época absoluta: `performance.timeOrigin + performance.now()`) desde un oyente de captura
 * inyectado con `addInitScript` (no es código de la app) y el documento de destino lo lee. Allí, un
 * `MutationObserver` anota el primer instante en que existe el selector del contenido propio de la sección
 * (`sessionStorage.__pfNavSel`) y un `PerformanceObserver` guarda la mayor pintura de contenido. Todo es informativo:
 * `navigationReport` nunca lanza y la suite no falla por el valor medido.
 */
export const NAV_TARGET_MS = 2500;
export const MEDIAN_RUNS = 3;

export type NavProfile = 'desktop' | 'phone';

/** «Fast 4G» emulada (decisión 1 del diseño): 150 ms de latencia, ≈ 1.6 Mbps de bajada y ≈ 750 kbps de subida. */
export const FAST_4G = {
  offline: false,
  latency: 150,
  downloadThroughput: Math.round((1.6 * 1000 * 1000) / 8),
  uploadThroughput: Math.round((750 * 1000) / 8),
} as const;

interface NavWindow {
  __pfNav?: { contentAt?: number; lcpAt?: number };
}

/** Registra los observadores y el oyente del clic en todo documento nuevo del contexto de `page` (antes de navegar). */
export async function installNavigationProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as NavWindow;
    w.__pfNav = {};
    const epoch = () => performance.timeOrigin + performance.now();
    try {
      window.addEventListener(
        'click',
        (event) => {
          if (event.target instanceof Element && event.target.closest('a[href]')) {
            sessionStorage.setItem('__pfNavT0', String(epoch()));
          }
        },
        true,
      );
      const check = () => {
        const selector = sessionStorage.getItem('__pfNavSel');
        if (!selector || w.__pfNav!.contentAt !== undefined) return;
        if (document.querySelector(selector)) w.__pfNav!.contentAt = epoch();
      };
      new MutationObserver(check).observe(document, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', check);
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) w.__pfNav!.lcpAt = performance.timeOrigin + last.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // Sin sessionStorage u observadores: la muestra queda sin valores (el informe lo marca «n/d»).
    }
  });
}

/** Guarda el selector del contenido propio que espera el documento de destino y descarta el clic anterior. */
export async function armNavigation(page: Page, contentSelector: string): Promise<void> {
  await page.evaluate((selector) => {
    sessionStorage.setItem('__pfNavSel', selector);
    sessionStorage.removeItem('__pfNavT0');
  }, contentSelector);
}

export interface NavReading {
  /** Del clic al primer instante con el contenido propio de la sección en el DOM; `null` si no se midió. */
  readonly contentMs: number | null;
  /** Del clic a la mayor pintura de contenido del documento de destino; `null` si no hubo. */
  readonly lcpMs: number | null;
  /** Del clic al primer byte de la respuesta del documento (`PerformanceNavigationTiming`); `null` si no se midió. */
  readonly ttfbMs: number | null;
}

/** Lee las marcas del documento de destino (llamar con el contenido ya presente; deja asentar la pintura). */
export async function readNavigation(page: Page): Promise<NavReading> {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 800)));
  return page.evaluate(() => {
    const w = window as unknown as NavWindow;
    const t0 = Number(sessionStorage.getItem('__pfNavT0'));
    if (!Number.isFinite(t0) || t0 <= 0) return { contentMs: null, lcpMs: null, ttfbMs: null };
    const rel = (at: number | undefined) => (at === undefined ? null : Math.max(0, Math.round(at - t0)));
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      contentMs: rel(w.__pfNav?.contentAt),
      lcpMs: rel(w.__pfNav?.lcpAt),
      ttfbMs: nav ? rel(performance.timeOrigin + nav.responseStart) : null,
    };
  });
}

/** Perfil de teléfono modesto por CDP: «Fast 4G» y CPU ×4. Devuelve la sesión para volver a escritorio. */
export async function applyPhoneProfile(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { ...FAST_4G });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW_CPU_RATE });
  return cdp;
}

export async function clearPhoneProfile(cdp: CDPSession): Promise<void> {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

export interface NavSample extends NavReading {
  readonly destination: string;
  readonly profile: NavProfile;
}

export type NavStatus = 'ok' | 'above-target' | 'n/a';

export interface NavReportRow {
  readonly destination: string;
  readonly profile: NavProfile;
  readonly runs: number;
  readonly contentMs: number | null;
  readonly lcpMs: number | null;
  readonly ttfbMs: number | null;
  readonly contentStatus: NavStatus;
  readonly lcpStatus: NavStatus;
  readonly target: number;
}

const valid = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Mediana de los valores medidos; `null` si no hubo ninguno. */
function medianOf(values: readonly (number | null | undefined)[]): number | null {
  const ok = values.filter(valid).map((v) => Math.round(v));
  return ok.length === 0 ? null : median(ok);
}

export const navStatus = (ms: number | null): NavStatus =>
  ms === null ? 'n/a' : ms > NAV_TARGET_MS ? 'above-target' : 'ok';

/**
 * Informe por destino y perfil con la mediana de las corridas y su estado frente a 2.5 s. Función pura: nunca lanza,
 * aunque reciba valores raros, y conserva el orden de aparición. `exceeded` lista los destinos del perfil de teléfono
 * modesto cuya mediana de contenido o de LCP supera el objetivo (criterio de la etapa 2, decisión 2 del diseño).
 */
export function navigationReport(samples: readonly NavSample[]): {
  rows: NavReportRow[];
  text: string;
  exceeded: string[];
} {
  const groups = new Map<string, NavSample[]>();
  for (const s of samples) {
    const key = `${s.profile}|${s.destination}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const rows = [...groups.values()].map((group): NavReportRow => {
    const first = group[0]!;
    const contentMs = medianOf(group.map((g) => g.contentMs));
    const lcpMs = medianOf(group.map((g) => g.lcpMs));
    return {
      destination: first.destination,
      profile: first.profile,
      runs: group.length,
      contentMs,
      lcpMs,
      ttfbMs: medianOf(group.map((g) => g.ttfbMs)),
      contentStatus: navStatus(contentMs),
      lcpStatus: navStatus(lcpMs),
      target: NAV_TARGET_MS,
    };
  });
  const fmt = (v: number | null) => (v === null ? 'n/d' : `${v} ms`).padStart(8);
  const label: Record<NavStatus, string> = {
    ok: 'dentro de 2.5 s',
    'above-target': 'por encima de 2.5 s',
    'n/a': 'sin dato',
  };
  const lines = rows.map(
    (r) =>
      `${(r.profile === 'phone' ? 'teléfono' : 'escritorio').padEnd(10)} ${r.destination.padEnd(22)} contenido ${fmt(r.contentMs)}  LCP ${fmt(r.lcpMs)}  TTFB ${fmt(r.ttfbMs)}  (${r.runs} corridas)  ${label[r.contentStatus]} / ${label[r.lcpStatus]}`,
  );
  const exceeded = rows
    .filter(
      (r) => r.profile === 'phone' && (r.contentStatus === 'above-target' || r.lcpStatus === 'above-target'),
    )
    .map((r) => r.destination);
  return {
    rows,
    text: [
      `Navegación entre secciones (informativo; objetivo ${NAV_TARGET_MS} ms, NFR-PERF-004)`,
      ...lines,
    ].join('\n'),
    exceeded,
  };
}
