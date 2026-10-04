import { createServer, type IncomingMessage, type Server } from 'node:http';
import { PgBoss } from 'pg-boss';
import { randomUUID } from 'node:crypto';
import { env } from './helpers.js';
import { FX_SIM_PORT } from './stack.js';

/**
 * Providers de tasas SIMULADOS para las pruebas E2E (add-market-rate-providers 7.2): un servidor HTTP local del harness
 * responde como paralelo.bo (`/api/v1/rate`, `/api/v1/historical.json`) y bo.dolarapi.com (`/v1/dolares`) con el
 * formato de los fixtures grabados (packages/contexts/fx/test/fixtures/providers). El worker del stack lo alcanza por
 * `FX_PROVIDER_*_URL=http://host.docker.internal:<puerto>` (solo local/ci): nunca la red real. Los valores se escriben
 * como texto JSON a partir de strings decimales (sin `number`).
 */

export interface ParaleloState {
  /** `null` ⇒ HTTP 503 (provider caído). */
  readonly rate: {
    readonly median: string;
    readonly buy?: string;
    readonly sell?: string;
    readonly at: Date;
  } | null;
  /** Puntos diarios `{ día UTC, valor }` del histórico (siempre disponible). */
  readonly history: readonly { readonly day: string; readonly value: string }[];
}

export interface DolarApiState {
  /** `null` ⇒ HTTP 503. Casa `binance` (compra/venta) y casa `oficial`. */
  readonly binance: { readonly compra: string; readonly venta: string; readonly at: Date } | null;
  readonly oficial: { readonly compra: string; readonly venta: string; readonly at: Date };
}

export interface SimRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
}

export class FxProviderSim {
  paralelo: ParaleloState = { rate: null, history: [] };
  dolarapi: DolarApiState = {
    binance: null,
    oficial: { compra: '12', venta: '12', at: new Date() },
  };
  readonly requests: SimRequest[] = [];
  private server: Server | undefined;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      const body = this.respond(req.url ?? '');
      if (body === null) {
        res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"unavailable"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(body);
    });
    // Docker Desktop (Windows/macOS) reenvía host.docker.internal al loopback del host; en Linux llega por el
    // gateway del bridge (`host-gateway`), así que se escucha en todas las interfaces solo ahí.
    const host =
      process.env['PF_E2E_FX_SIM_HOST'] ?? (process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1'); // pf-allow-loopback: servidor del harness E2E
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(FX_SIM_PORT, host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private respond(url: string): string | null {
    if (url === '/api/v1/rate') {
      const r = this.paralelo.rate;
      if (!r) return null;
      const side = (k: string, v: string | undefined) => (v === undefined ? '' : `"${k}":${v},`);
      return `{"timestamp":"${r.at.toISOString()}",${side('buy', r.buy)}${side('sell', r.sell)}"median":${r.median},"spreadPct":-1.6972,"sourceCount":4,"methodologyVersion":"ec2-backend"}`;
    }
    if (url === '/api/v1/historical.json') {
      const points = this.paralelo.history
        .map((p) => `{"t":"${p.day}T12:00:00.000Z","v":${p.value}}`)
        .join(',');
      return `{"currencyPair":"USD/BOB","market":"parallel","resolution":"daily","illustrative":false,"generatedAt":"${new Date().toISOString()}","source":"https://paralelo.bo/historico","license":"CC-BY-4.0","methodologyUrl":"https://paralelo.bo/metodologia","points":[${points}]}`;
    }
    if (url === '/v1/dolares') {
      const b = this.dolarapi.binance;
      if (!b) return null;
      const o = this.dolarapi.oficial;
      return `[{"moneda":"USD","casa":"oficial","nombre":"Oficial","compra":${o.compra},"venta":${o.venta},"fechaActualizacion":"${o.at.toISOString()}"},{"moneda":"USD","casa":"binance","nombre":"Binance","compra":${b.compra},"venta":${b.venta},"fechaActualizacion":"${b.at.toISOString()}"}]`;
    }
    return null;
  }
}

/** Días UTC `YYYY-MM-DD` desde hace `from` hasta hace `to` días (inclusive), del más antiguo al más reciente. */
export function pastDays(from: number, to: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let d = from; d >= to; d -= 1)
    out.push(new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Hace `minutes` minutos. */
export const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

/**
 * Dispara un ciclo de consulta (`fx.poll-market-rates`) como lo haría el cron del worker: el stack E2E programa el cron
 * cada 24 h para que las consultas ocurran solo cuando la prueba las pide. Rol de la app (`pf_app`, productor).
 */
export async function triggerPoll(): Promise<void> {
  const boss = new PgBoss({
    connectionString: env()['DATABASE_URL']!,
    schema: 'pgboss',
    migrate: false,
    supervise: false,
    schedule: false,
    max: 1,
  });
  await boss.start();
  try {
    const id = await boss.send('fx.poll-market-rates', {
      v: 1,
      correlationId: randomUUID(),
      traceContext: {},
      payload: { trigger: 'e2e' },
    });
    if (!id) throw new Error('pg-boss no aceptó el job de consulta');
  } finally {
    await boss.stop({ graceful: false, close: true });
  }
}
