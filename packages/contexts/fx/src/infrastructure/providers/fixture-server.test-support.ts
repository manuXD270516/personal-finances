import { readFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/** Directorio de respuestas grabadas (texto exacto; ver design.md decisión 14 y tarea 1.3). */
export const FIXTURES_DIR = fileURLToPath(new URL('../../../test/fixtures/providers/', import.meta.url));

/** Texto EXACTO de un fixture grabado (sin normalizar). */
export const fixture = (name: string): string => readFileSync(`${FIXTURES_DIR}${name}`, 'utf8');

// pf-allow-loopback: servidor de pruebas que simula a los providers; escucha solo en loopback (sin red).
const LOOPBACK = '127.0.0.1';

export interface FixtureResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Retraso antes de responder (timeouts). */
  readonly delayMs?: number;
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly body: string;
}

/**
 * Servidor HTTP LOCAL que simula a los providers con respuestas grabadas (sin red en CI) y registra cada solicitud
 * (método, URL, cabeceras y cuerpo) para los tests de privacidad y de límites de uso.
 */
export class FixtureServer {
  readonly requests: RecordedRequest[] = [];
  private readonly routes = new Map<string, FixtureResponse | (() => FixtureResponse)>();
  private server: Server | undefined;
  private port = 0;

  route(path: string, response: FixtureResponse | (() => FixtureResponse)): this {
    this.routes.set(path, response);
    return this;
  }

  get baseUrl(): string {
    return `http://${LOOPBACK}:${this.port}`;
  }

  requestsTo(path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.url === path);
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        this.requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          rawHeaders: req.rawHeaders,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const found = this.routes.get((req.url ?? '').split('?')[0] ?? '');
        const r = typeof found === 'function' ? found() : found;
        const send = () => {
          if (!r) {
            res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
            return;
          }
          res
            .writeHead(r.status ?? 200, { 'content-type': 'application/json', ...r.headers })
            .end(r.body ?? '');
        };
        if (r?.delayMs) setTimeout(send, r.delayMs).unref();
        else send();
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, LOOPBACK, resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
