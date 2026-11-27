import type { Page } from '@playwright/test';

/**
 * Medición informativa del tiempo de respuesta a la interacción (INP) desde Playwright, sin dependencias ni cambios
 * en la CSP de la app (refine-data-tables, decisión 10; docs/78 § 11.1 punto 9). El observador se inyecta con
 * `addInitScript` (no es código de la app), agrupa las entradas de Event Timing por `interactionId` y guarda la
 * duración máxima de cada interacción. Con ≤ 50 interacciones por flujo el percentil 98 es el máximo.
 *
 * Es informativo: `inpReport` nunca lanza y la suite no falla por el valor medido (el gate llegará, si llega,
 * tras 2-3 semanas de datos).
 */
export const INP_TARGET_MS = 200;
export const INP_WARNING_MS = 500;

interface InpWindow {
  __pfInp?: { byId: Record<string, number> };
}

/** Registra el observador en toda página nueva del contexto de `page` (llamar antes de navegar). */
export async function installInpObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as InpWindow;
    w.__pfInp = { byId: {} };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { interactionId?: number };
          if (!e.interactionId) continue;
          const key = String(e.interactionId);
          const store = w.__pfInp!.byId;
          if ((store[key] ?? 0) < e.duration) store[key] = e.duration;
        }
      }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    } catch {
      // Event Timing no disponible: el informe queda con 0 ms (sin interacciones medidas).
    }
  });
}

/** Descarta lo acumulado: se llama justo antes del flujo que se quiere medir. */
export async function resetInp(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as InpWindow).__pfInp = { byId: {} };
  });
}

/** Mayor duración (ms) entre las interacciones registradas desde el último `resetInp`. 0 si no hubo ninguna. */
export async function readInp(page: Page): Promise<number> {
  // Event Timing publica las entradas al terminar el cuadro: se deja asentar un cuadro antes de leer.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))),
  );
  return page.evaluate(() => {
    const store = (window as unknown as InpWindow).__pfInp?.byId ?? {};
    return Math.round(Math.max(0, ...Object.values(store)));
  });
}

export type InpStatus = 'ok' | 'above-target' | 'above-warning';

export interface InpRow {
  readonly flow: string;
  readonly ms: number;
}

export interface InpReportRow extends InpRow {
  readonly status: InpStatus;
  readonly target: number;
  readonly warning: number;
}

export const inpStatus = (ms: number): InpStatus =>
  ms > INP_WARNING_MS ? 'above-warning' : ms > INP_TARGET_MS ? 'above-target' : 'ok';

/** Informe por flujo con el objetivo y el aviso. Función pura: nunca lanza, aunque reciba valores raros. */
export function inpReport(rows: readonly InpRow[]): { rows: InpReportRow[]; text: string } {
  const out = rows.map((r): InpReportRow => {
    const ms = Number.isFinite(r.ms) ? Math.max(0, Math.round(r.ms)) : 0;
    return { flow: r.flow, ms, status: inpStatus(ms), target: INP_TARGET_MS, warning: INP_WARNING_MS };
  });
  const label: Record<InpStatus, string> = {
    ok: 'dentro del objetivo',
    'above-target': 'por encima del objetivo',
    'above-warning': 'por encima del aviso',
  };
  const lines = out.map(
    (r) =>
      `${r.flow.padEnd(28)} ${String(r.ms).padStart(5)} ms  (objetivo ${r.target}, aviso ${r.warning})  ${label[r.status]}`,
  );
  return { rows: out, text: ['INP por flujo (informativo)', ...lines].join('\n') };
}
