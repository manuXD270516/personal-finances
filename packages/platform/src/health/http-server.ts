import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LIVENESS_REPORT, type ReadinessProbe } from './readiness.js';

export interface HealthServerOptions {
  readonly port: number;
  readonly host: string;
  readonly probe: ReadinessProbe;
  /** true mientras el proceso drena (apagado ordenado): `/health/ready` responde 503 sin consultar dependencias. */
  readonly isDraining?: () => boolean;
}

export interface HealthServer {
  readonly port: number;
  close(): Promise<void>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

/**
 * Probes HTTP mínimos para procesos sin servidor HTTP propio (worker): `/health/live` y `/health/ready` con el
 * mismo formato que finance-api. Solo red interna (no se publica en Compose).
 */
export async function startHealthServer(options: HealthServerOptions): Promise<HealthServer> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET' || (path !== '/health/live' && path !== '/health/ready')) {
      res.writeHead(404, JSON_HEADERS).end('{"status":"not_found"}');
      return;
    }
    if (path === '/health/live') {
      res.writeHead(200, JSON_HEADERS).end(JSON.stringify(LIVENESS_REPORT));
      return;
    }
    if (options.isDraining?.()) {
      res
        .writeHead(503, JSON_HEADERS)
        .end(JSON.stringify({ status: 'not_ready', checks: {}, failing: ['shutdown'] }));
      return;
    }
    options.probe.evaluate().then(
      (report) =>
        res.writeHead(report.status === 'ready' ? 200 : 503, JSON_HEADERS).end(JSON.stringify(report)),
      () => res.writeHead(503, JSON_HEADERS).end('{"status":"not_ready","checks":{},"failing":[]}'),
    );
  });
  server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
