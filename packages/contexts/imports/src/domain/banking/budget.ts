/**
 * Presupuesto de solicitudes y espera ante los límites del proveedor (openspec add-banking-providers decisión 7,
 * ADR-0029): ≤ 10 solicitudes por minuto por conexión; `Retry-After` (429, 418 de Binance) o la espera publicada
 * (Bybit 403: 30 min) se persiste en `retry_not_before`. Dominio puro: el reloj llega como milisegundos.
 */

export const DEFAULT_REQUESTS_PER_MINUTE = 10;
/** Espera ante un 429 sin `Retry-After`. */
export const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
/** Espera publicada tras un 403 de Bybit por exceso de solicitudes. */
export const FORBIDDEN_WAIT_MS = 30 * 60_000;

export interface ProviderResponseInfo {
  readonly status: number;
  /** Valor de la cabecera `Retry-After` (segundos) si la hay. */
  readonly retryAfter?: string | null;
}

/**
 * Milisegundos que hay que esperar según la respuesta del proveedor, o `null` si no pide espera. 429 y 418 usan
 * `Retry-After` (o 60 s si no lo envía); 403 espera 30 minutos (límite publicado por Bybit).
 */
export function waitFor(response: ProviderResponseInfo): number | null {
  if (response.status === 429 || response.status === 418) {
    const seconds =
      response.retryAfter === undefined || response.retryAfter === null ? NaN : Number(response.retryAfter);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : DEFAULT_RATE_LIMIT_WAIT_MS;
  }
  if (response.status === 403) return FORBIDDEN_WAIT_MS;
  return null;
}

/** Ventana deslizante de 60 s: devuelve cuántos ms faltan para poder enviar otra solicitud (0 = ya). */
export class RequestBudget {
  private readonly sent: number[] = [];

  constructor(private readonly limitPerMinute: number = DEFAULT_REQUESTS_PER_MINUTE) {}

  /** Registra una solicitud si hay cupo; si no, devuelve la espera. */
  take(nowMs: number): number {
    while (this.sent.length > 0 && (this.sent[0] as number) <= nowMs - 60_000) this.sent.shift();
    if (this.sent.length >= this.limitPerMinute) {
      return (this.sent[0] as number) + 60_000 - nowMs;
    }
    this.sent.push(nowMs);
    return 0;
  }
}
