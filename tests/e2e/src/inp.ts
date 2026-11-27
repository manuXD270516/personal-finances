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
  /** Valor con el procesador ralentizado ×4 (`Emulation.setCPUThrottlingRate`), si se midió (change 83, pregunta 4). */
  readonly slowMs?: number;
}

export interface InpReportRow extends InpRow {
  readonly status: InpStatus;
  readonly slowStatus?: InpStatus;
  readonly target: number;
  readonly warning: number;
}

/** Mediana de una lista de mediciones (la de tres corridas locales del change 83); 0 si no hay ninguna. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Tasa de ralentización de la CPU de la columna «CPU ×4»: estima un teléfono modesto. */
export const SLOW_CPU_RATE = 4;

const clean = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

export const inpStatus = (ms: number): InpStatus =>
  ms > INP_WARNING_MS ? 'above-warning' : ms > INP_TARGET_MS ? 'above-target' : 'ok';

/** Informe por flujo con el objetivo y el aviso. Función pura: nunca lanza, aunque reciba valores raros. */
export function inpReport(rows: readonly InpRow[]): { rows: InpReportRow[]; text: string } {
  const out = rows.map((r): InpReportRow => {
    const ms = clean(r.ms);
    const slow = r.slowMs === undefined ? undefined : clean(r.slowMs);
    return {
      flow: r.flow,
      ms,
      status: inpStatus(ms),
      ...(slow === undefined ? {} : { slowMs: slow, slowStatus: inpStatus(slow) }),
      target: INP_TARGET_MS,
      warning: INP_WARNING_MS,
    };
  });
  const label: Record<InpStatus, string> = {
    ok: 'dentro del objetivo',
    'above-target': 'por encima del objetivo',
    'above-warning': 'por encima del aviso',
  };
  const lines = out.map((r) => {
    const base = `${r.flow.padEnd(28)} ${String(r.ms).padStart(5)} ms  (objetivo ${r.target}, aviso ${r.warning})  ${label[r.status]}`;
    return r.slowMs === undefined || r.slowStatus === undefined
      ? base
      : `${base}
${''.padEnd(28)} ${String(r.slowMs).padStart(5)} ms  CPU ×${SLOW_CPU_RATE}  ${label[r.slowStatus]}`;
  });
  return { rows: out, text: ['INP por flujo (informativo)', ...lines].join('\n') };
}
